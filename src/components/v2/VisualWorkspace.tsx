import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { ContentBlock } from "../../types";
import type {
  SubjectRecord,
  VisualInstance,
  VisualizationPlacement,
} from "../../v2types";
import VisualBlock from "../visuals/VisualBlock";
import { invoke } from "../../lib/bridge";
import {
  assetIdentifier,
  duplicateVisualInstance,
  jsonValue,
  makeVisualInstance,
  reparentVisualHost,
  resolvePlacement,
  updateVisualInstance,
  VisualRuntimeContext,
  VisualCreatorContext,
  VisualCatalogContext,
  VisualSlotContext,
  visualTitle,
} from "../../lib/visualState";
import "./visual-workspace.css";
type DockPlacement = "side" | "split" | "fullscreen";

// Older libraries retain their placement metadata, but a lesson always embeds
// its figure. Reparent the existing live host instead of remounting the SDK.
function inlinePlacement(
  instance: VisualInstance,
  preference: VisualizationPlacement,
) {
  const placement = resolvePlacement(instance, preference);
  return placement === "side" || placement === "split" ? "inline" : placement;
}

type Workspace = {
  ready: boolean;
  subjectId: string;
  instances: VisualInstance[];
  preference: VisualizationPlacement;
  notice: string;
  register: (instance: VisualInstance) => void;
  registerAnchor: (id: string, element: HTMLElement | null) => void;
  registerDock: (placement: DockPlacement, element: HTMLElement | null) => void;
  update: (id: string, patch: Partial<VisualInstance>) => void;
  move: (id: string, placement: VisualizationPlacement) => void;
  activate: (id: string) => void;
  duplicate: (id: string) => VisualInstance | undefined;
  remove: (id: string) => void;
  create: (
    block: ContentBlock,
    options?: Partial<VisualInstance>,
  ) => VisualInstance;
  exportVisual: (id: string, format: "json" | "svg" | "html") => void;
  preview: (id: string) => string | undefined;
  status: (message: string) => void;
  setExplain: (id: string, callback?: (text: string) => void) => void;
};
const WorkspaceContext = createContext<Workspace | null>(null);
export function useVisualWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("A visual workspace must be open.");
  return context;
}
export function useOptionalVisualWorkspace() {
  return useContext(WorkspaceContext);
}
function download(data: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function svgFromHost(host: HTMLElement | undefined) {
  const svg = host?.querySelector<SVGSVGElement>(
    "svg.diagram-canvas, .js-plotly-plot svg.main-svg",
  );
  if (!svg) return undefined;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const original = [svg, ...svg.querySelectorAll<SVGElement>("*")],
    copies = [clone, ...clone.querySelectorAll<SVGElement>("*")];
  copies.forEach((node, i) => {
    const style = getComputedStyle(original[i]);
    for (const key of [
      "fill",
      "stroke",
      "font-family",
      "font-size",
      "font-weight",
      "opacity",
    ])
      node.style.setProperty(key, style.getPropertyValue(key));
  });
  return new XMLSerializer().serializeToString(clone);
}
export function VisualWorkspaceProvider({
  subjectId,
  initialInstances = [],
  instances: controlledInstances,
  onInstancesChange,
  preference = "auto",
  children,
  onFlush,
  onExplain,
  ready = true,
  visibleMessageIds,
}: {
  subjectId: string;
  ready?: boolean;
  visibleMessageIds?: ReadonlySet<string>;
  initialInstances?: VisualInstance[];
  instances?: VisualInstance[];
  onInstancesChange?: (
    instances: VisualInstance[],
    changed?: VisualInstance,
  ) => void;
  preference?: VisualizationPlacement;
  children: ReactNode;
  onFlush?: () => void | Promise<void>;
  onExplain?: (text: string) => void;
}) {
  const [instances, setInstances] = useState<VisualInstance[]>(() =>
      initialInstances.length ? initialInstances : (controlledInstances ?? []),
    ),
    [active, setActive] = useState<Set<string>>(
      () =>
        new Set(
          (initialInstances.length
            ? initialInstances
            : (controlledInstances ?? [])
          )
            .filter((instance) => instance.placement === "fullscreen")
            .map((instance) => instance.id),
        ),
    ),
    [version, setVersion] = useState(0),
    [notice, setNotice] = useState("");
  const instanceRef = useRef(instances);
  instanceRef.current = instances;
  const changeRef = useRef(onInstancesChange);
  changeRef.current = onInstancesChange;
  const flushRef = useRef(onFlush);
  flushRef.current = onFlush;
  const preferenceRef = useRef(preference);
  preferenceRef.current = preference;
  const anchors = useRef(new Map<string, HTMLElement>()),
    docks = useRef(new Map<DockPlacement, HTMLElement>()),
    fallbacks = useRef(new Map<DockPlacement, HTMLElement>()),
    hosts = useRef(new Map<string, HTMLElement>()),
    explain = useRef(new Map<string, (text: string) => void>()),
    parking = useRef<HTMLDivElement>(null),
    assetCache = useRef(new Map<string, Promise<unknown>>()),
    changed = useRef<VisualInstance | undefined>(undefined),
    first = useRef(true),
    lastPlacements = useRef(new Map<string, VisualizationPlacement>());
  const checkpoints = useRef(new Map<string, Map<string, () => unknown>>());
  useLayoutEffect(() => {
    const incoming = controlledInstances ?? initialInstances;
    if (!incoming.length) return;
    setActive((previous) => {
      const next = new Set(previous);
      for (const instance of incoming)
        if (
          instance.subjectId === subjectId &&
          instance.placement === "fullscreen"
        )
          next.add(instance.id);
      return next.size === previous.size ? previous : next;
    });
    setInstances((current) => {
      let modified = false;
      const merged = current.slice();
      for (const value of incoming) {
        if (value.subjectId !== subjectId) continue;
        const index = merged.findIndex((item) => item.id === value.id);
        if (index < 0) {
          merged.push(value);
          modified = true;
        } else if (
          Date.parse(value.updatedAt) > Date.parse(merged[index].updatedAt)
        ) {
          merged[index] = value;
          modified = true;
        }
      }
      if (modified) instanceRef.current = merged;
      return modified ? merged : current;
    });
  }, [controlledInstances, initialInstances, subjectId]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    changeRef.current?.(instances, changed.current);
    changed.current = undefined;
  }, [instances]);
  useEffect(() => {
    const flush = () => {
      const next = instanceRef.current.map((instance) => {
        const readers = checkpoints.current.get(instance.id);
        if (!readers?.size) return instance;
        const state = { ...instance.state };
        for (const [key, reader] of readers) {
          try {
            const value = reader();
            if (value !== undefined) state[key] = jsonValue(value);
          } catch {}
        }
        return JSON.stringify(state) === JSON.stringify(instance.state)
          ? instance
          : updateVisualInstance(instance, { state });
      });
      instanceRef.current = next;
      setInstances(next);
      changeRef.current?.(next, changed.current);
      void flushRef.current?.();
    };
    window.addEventListener("studio:flush-visuals", flush);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      changeRef.current?.(instanceRef.current, changed.current);
      void flushRef.current?.();
      window.removeEventListener("studio:flush-visuals", flush);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, []);
  const activate = useCallback(
    (id: string) =>
      setActive((previous) =>
        previous.has(id) ? previous : new Set([...previous, id]),
      ),
    [],
  );
  const register = useCallback(
    (value: VisualInstance) => {
      setInstances((previous) => {
        if (previous.some((instance) => instance.id === value.id))
          return previous;
        changed.current = value;
        return [...previous, value];
      });
      activate(value.id);
    },
    [activate],
  );
  const registerAnchor = useCallback(
    (id: string, element: HTMLElement | null) => {
      if (element) {
        if (anchors.current.get(id) === element) return;
        anchors.current.set(id, element);
      } else if (!anchors.current.delete(id)) return;
      setVersion((v) => v + 1);
    },
    [],
  );
  const registerDock = useCallback(
    (placement: DockPlacement, element: HTMLElement | null) => {
      if (element) {
        if (docks.current.get(placement) === element) return;
        docks.current.set(placement, element);
      } else if (!docks.current.delete(placement)) return;
      setVersion((v) => v + 1);
    },
    [],
  );
  const update = useCallback((id: string, patch: Partial<VisualInstance>) => {
    const next = instanceRef.current.map((instance) => {
      if (instance.id !== id) return instance;
      if (
        JSON.stringify(patch) ===
        JSON.stringify(
          Object.fromEntries(
            Object.keys(patch).map((key) => [
              key,
              instance[key as keyof VisualInstance],
            ]),
          ),
        )
      )
        return instance;
      const updated = updateVisualInstance(instance, patch);
      changed.current = updated;
      return updated;
    });
    instanceRef.current = next;
    setInstances(next);
  }, []);
  const move = useCallback(
    (id: string, placement: VisualizationPlacement) => {
      if (placement === "side" || placement === "split" || placement === "auto")
        placement = "inline";
      const instance = instanceRef.current.find((value) => value.id === id);
      if (!instance) return;
      if (placement === "fullscreen" && instance.placement !== "fullscreen")
        lastPlacements.current.set(id, instance.placement);
      activate(id);
      update(id, { placement });
    },
    [activate, update],
  );
  const create = useCallback(
    (block: ContentBlock, options: Partial<VisualInstance> = {}) => {
      const instance = makeVisualInstance(subjectId, block, options);
      register(instance);
      return instance;
    },
    [register, subjectId],
  );
  const duplicate = useCallback(
    (id: string) => {
      const source = instanceRef.current.find((instance) => instance.id === id);
      if (!source) return;
      const result = duplicateVisualInstance(source);
      register(result);
      return result;
    },
    [register],
  );
  const remove = useCallback((id: string) => {
    setInstances((values) => values.filter((instance) => instance.id !== id));
    setActive((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  }, []);
  const preview = useCallback((id: string) => {
    const host = hosts.current.get(id);
    const image = host?.querySelector<HTMLImageElement>(
      ".image-viewport img,.local-chemical-svg",
    );
    if (image?.src) return image.src;
    const canvas = host?.querySelector<HTMLCanvasElement>(
      ".molecule-canvas canvas,.science-three-canvas canvas",
    );
    if (canvas) {
      try {
        return canvas.toDataURL("image/png");
      } catch {}
    }
    const svg = svgFromHost(host);
    return svg
      ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
      : undefined;
  }, []);
  const exportVisual = useCallback(
    (id: string, format: "json" | "svg" | "html") => {
      const instance = instanceRef.current.find((item) => item.id === id);
      if (!instance) return;
      const title = instance.title ?? visualTitle(instance.block),
        safeName = title.replace(/[^\w-]+/g, "-").slice(0, 70) || "visual";
      if (format === "json") {
        download(
          JSON.stringify(
            { schema: "learning-studio/visual-instance-v2", instance },
            null,
            2,
          ),
          safeName + ".json",
          "application/json",
        );
        return;
      }
      const svg = svgFromHost(hosts.current.get(id));
      if (format === "svg") {
        if (!svg) {
          setNotice(
            "This visual has no SVG scene. Use its renderer export or export reusable JSON.",
          );
          return;
        }
        download(svg, safeName + ".svg", "image/svg+xml");
        return;
      }
      const snapshot = preview(id);
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{max-width:1000px;margin:40px auto;padding:20px;font:18px "Segoe UI",Arial,sans-serif;color:#303b2e;background:#f5f2e8}img{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}</style></head><body><h1>${escapeHtml(title)}</h1>${snapshot ? `<img alt="Saved visual scene" src="${escapeHtml(snapshot)}">` : ""}<p>Annotations: ${escapeHtml(instance.annotations.map((a) => a.text).join(" · "))}</p><h2>Reusable visual specification and state</h2><pre>${escapeHtml(JSON.stringify(instance, null, 2))}</pre></body></html>`;
      download(html, safeName + ".html", "text/html");
    },
    [preview],
  );
  const loadAsset = useCallback(
    (id: string) => {
      if (!assetCache.current.has(id))
        assetCache.current.set(
          id,
          invoke<SubjectRecord | null>("subject:record-get", {
            subjectId,
            id,
            recordType: "asset",
          }).then((record) => {
            if (!record)
              throw new Error("A saved molecular source asset is unavailable.");
            return (record.data as { value: unknown }).value;
          }),
        );
      return assetCache.current.get(id)!;
    },
    [subjectId],
  );
  const storeAsset = useCallback(
    async (value: unknown) => {
      const id = await assetIdentifier(subjectId, value);
      if (!assetCache.current.has(id)) {
        const task = (async () => {
          const existing = await invoke<SubjectRecord | null>(
            "subject:record-get",
            { subjectId, id, recordType: "asset" },
          );
          if (!existing)
            await invoke("subject:record-put", {
              subjectId,
              recordType: "asset",
              id,
              title: "Immutable visual source",
              data: { kind: "visual-source", value },
            });
          return value;
        })();
        assetCache.current.set(id, task);
      }
      await assetCache.current.get(id);
      return id;
    },
    [subjectId],
  );
  const context = useMemo<Workspace>(
    () => ({
      ready,
      subjectId,
      instances,
      preference,
      notice,
      register,
      registerAnchor,
      registerDock,
      update,
      move,
      activate,
      duplicate,
      remove,
      create,
      exportVisual,
      preview,
      status: setNotice,
      setExplain: (id, callback) => {
        if (callback) explain.current.set(id, callback);
        else explain.current.delete(id);
      },
    }),
    [
      ready,
      subjectId,
      instances,
      preference,
      notice,
      register,
      registerAnchor,
      registerDock,
      update,
      move,
      activate,
      duplicate,
      remove,
      create,
      exportVisual,
      preview,
    ],
  );
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      for (const instance of instanceRef.current)
        if (instance.placement === "fullscreen")
          move(
            instance.id,
            lastPlacements.current.get(instance.id) ?? "inline",
          );
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [move]);
  const fallbackRef = useCallback(
    (placement: DockPlacement) => (element: HTMLDivElement | null) => {
      if (element) {
        fallbacks.current.set(placement, element);
        setVersion((value) => value + 1);
      } else fallbacks.current.delete(placement);
    },
    [],
  );
  const fallbackFullRef = useMemo(
    () => fallbackRef("fullscreen"),
    [fallbackRef],
  );
  const activeFull = instances.some(
    (instance) =>
      active.has(instance.id) &&
      inlinePlacement(instance, preference) === "fullscreen",
  );
  useEffect(() => {
    if (!activeFull) return;
    const full = instances.find(
      (instance) =>
        active.has(instance.id) &&
        inlinePlacement(instance, preference) === "fullscreen",
    );
    const host = full ? hosts.current.get(full.id) : undefined;
    if (!host) return;
    const focusable = () =>
      Array.from(
        host.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]',
        ),
      ).filter((element) => element.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => {
      if (!host.contains(document.activeElement)) focusable()[0]?.focus();
    });
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = focusable(),
        first = controls[0],
        last = controls.at(-1);
      if (!first) return;
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !host.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !host.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", trap);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", trap);
    };
  }, [activeFull, version]);
  return (
    <WorkspaceContext.Provider value={context}>
      <VisualCreatorContext.Provider
        value={subjectId === "general" || !ready ? null : create}
      >
        <VisualCatalogContext.Provider value={{ subjectId, instances }}>
          <VisualSlotContext.Provider value={VisualInstanceView}>
            {children}
            <div className="visual-parking" ref={parking} aria-hidden="true" />
            <div
              className="visual-fullscreen-root"
              ref={fallbackFullRef}
              hidden={!activeFull || docks.current.has("fullscreen")}
              role={activeFull ? "dialog" : undefined}
              aria-modal={activeFull || undefined}
              aria-label={
                instances.find(
                  (instance) =>
                    active.has(instance.id) &&
                    inlinePlacement(instance, preference) === "fullscreen",
                )?.title ?? "Fullscreen visual workspace"
              }
            />
            {instances
              .filter((instance) => active.has(instance.id))
              .map((instance) => {
                const placement = inlinePlacement(instance, preference),
                  target =
                    placement === "collapsed"
                      ? parking.current
                      : placement === "inline"
                        ? (anchors.current.get(instance.id) ?? parking.current)
                        : (docks.current.get(placement as DockPlacement) ??
                          fallbacks.current.get(placement as DockPlacement));
                return (
                  <InstancePortal
                    key={instance.id}
                    instance={instance}
                    target={target ?? null}
                    version={version}
                    preference={preference}
                    originVisible={
                      !visibleMessageIds ||
                      !instance.originMessageId ||
                      visibleMessageIds.has(instance.originMessageId) ||
                      placement === "fullscreen"
                    }
                    onHost={(host) => {
                      if (host) hosts.current.set(instance.id, host);
                      else hosts.current.delete(instance.id);
                    }}
                    patch={(patch) =>
                      update(instance.id, {
                        state: {
                          ...instanceRef.current.find(
                            (value) => value.id === instance.id,
                          )?.state,
                          ...patch,
                        },
                      })
                    }
                    move={(value) => move(instance.id, value)}
                    storeAsset={storeAsset}
                    loadAsset={loadAsset}
                    registerCheckpoint={(key, reader) => {
                      if (!checkpoints.current.has(instance.id))
                        checkpoints.current.set(instance.id, new Map());
                      checkpoints.current.get(instance.id)!.set(key, reader);
                      return () =>
                        checkpoints.current.get(instance.id)?.delete(key);
                    }}
                    onExplain={(text) =>
                      (explain.current.get(instance.id) ?? onExplain)?.(text)
                    }
                  />
                );
              })}
            {notice && (
              <div className="visual-workspace-status" role="status">
                <span>{notice}</span>
                <button
                  aria-label="Dismiss visual status"
                  onClick={() => setNotice("")}
                >
                  ×
                </button>
              </div>
            )}
          </VisualSlotContext.Provider>
        </VisualCatalogContext.Provider>
      </VisualCreatorContext.Provider>
    </WorkspaceContext.Provider>
  );
}
function InstancePortal({
  instance,
  target,
  version,
  preference,
  originVisible = true,
  onHost,
  patch,
  move,
  storeAsset,
  loadAsset,
  registerCheckpoint,
  onExplain,
}: {
  instance: VisualInstance;
  target: HTMLElement | null;
  version: number;
  preference: VisualizationPlacement;
  originVisible?: boolean;
  onHost: (host: HTMLElement | null) => void;
  patch: (value: Record<string, unknown>) => void;
  move: (placement: VisualizationPlacement) => void;
  storeAsset: (value: unknown) => Promise<string>;
  loadAsset: (id: string) => Promise<unknown>;
  registerCheckpoint: (key: string, reader: () => unknown) => () => void;
  onExplain: (text: string) => void;
}) {
  const [host] = useState(() => {
      const element = document.createElement("div");
      element.dataset.visualHost = instance.id;
      element.className = "visual-instance-host";
      return element;
    }),
    workspace = useVisualWorkspace();
  const placement = inlinePlacement(instance, preference),
    visible =
      !!target &&
      originVisible &&
      !target.classList.contains("visual-parking") &&
      placement !== "collapsed";
  const callbackRef = useRef(onHost);
  callbackRef.current = onHost;
  useLayoutEffect(() => {
    callbackRef.current(host);
    return () => {
      callbackRef.current(null);
      host.remove();
    };
  }, [host]);
  useLayoutEffect(() => {
    if (target) reparentVisualHost(host, target);
    host.dataset.placement = placement;
    host.setAttribute(
      "aria-label",
      instance.title ?? visualTitle(instance.block),
    );
  }, [host, target, version, placement, instance.title, instance.block]);
  const runtime = useMemo(
    () => ({
      id: instance.id,
      subjectId: instance.subjectId,
      state: instance.state,
      placement,
      visible,
      patch,
      move,
      storeAsset,
      loadAsset,
      registerCheckpoint,
      reportError: workspace.status,
    }),
    [
      instance.id,
      instance.subjectId,
      instance.state,
      placement,
      visible,
      patch,
      move,
      storeAsset,
      loadAsset,
      registerCheckpoint,
      workspace.status,
    ],
  );
  return createPortal(
    <VisualRuntimeContext.Provider value={runtime}>
      <div className="visual-instance-shell">
        <div
          className="visual-instance-toolbar"
          role="toolbar"
          aria-label="Visual placement and saving"
        >
          <span title={instance.id}>
            {instance.title ?? visualTitle(instance.block)}
          </span>
          {(
            [
              ["inline", "Inline"],
              ["fullscreen", "Fullscreen"],
              ["collapsed", "Collapsed"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-label={`Move visual ${value}`}
              aria-pressed={placement === value}
              onClick={() => move(value)}
            >
              {label}
            </button>
          ))}
          <button
            aria-label="Copy reusable visual"
            onClick={() => {
              void navigator.clipboard
                .writeText(JSON.stringify(instance, null, 2))
                .then(() => workspace.status("Reusable visual JSON copied."))
                .catch(() =>
                  workspace.status(
                    "Clipboard access failed. Export JSON to keep a reusable copy.",
                  ),
                );
            }}
          >
            Copy
          </button>
          <button
            aria-label="Save visual to notebook"
            onClick={() => {
              workspace.update(instance.id, {
                tags: [...new Set([...instance.tags, "saved"])],
              });
              workspace.status("Visual saved to your notebook.");
            }}
          >
            Save
          </button>
          <details className="visual-export-menu">
            <summary>Export</summary>
            <div>
              {(["json", "svg", "html"] as const).map((format) => (
                <button
                  key={format}
                  onClick={() => workspace.exportVisual(instance.id, format)}
                >
                  {format.toUpperCase()}
                </button>
              ))}
            </div>
          </details>
        </div>
        <VisualBlock block={instance.block} onExplain={onExplain} />
      </div>
    </VisualRuntimeContext.Provider>,
    host,
    instance.id,
  );
}
export function VisualInstanceView({
  id,
  block,
  originMessageId,
  onExplain,
}: {
  id: string;
  block: ContentBlock;
  originMessageId?: string;
  onExplain?: (text: string) => void;
}) {
  const workspace = useVisualWorkspace(),
    existing = workspace.instances.find((instance) => instance.id === id),
    serialized = JSON.stringify(block);
  useEffect(() => {
    if (!workspace.ready) return;
    if (!workspace.instances.some((instance) => instance.id === id))
      workspace.register(
        makeVisualInstance(workspace.subjectId, block, { id, originMessageId }),
      );
    workspace.activate(id);
    workspace.setExplain(id, onExplain);
    return () => workspace.setExplain(id, undefined);
  }, [
    workspace.ready,
    id,
    serialized,
    workspace.register,
    workspace.activate,
    workspace.setExplain,
  ]);
  const anchor = useCallback(
    (element: HTMLDivElement | null) => workspace.registerAnchor(id, element),
    [id, workspace.registerAnchor],
  );
  const placement = existing
    ? inlinePlacement(existing, workspace.preference)
    : "inline";
  return (
    <section className="visual-inline-slot" data-visual-instance={id}>
      <div ref={anchor} className="visual-inline-anchor" />
      {existing && placement !== "inline" && (
        <div className="visual-inline-placeholder">
          <span>
            {existing.title ?? visualTitle(existing.block)} ·{" "}
            {placement === "collapsed" ? "collapsed" : placement + " view"}
          </span>
          <button onClick={() => workspace.move(id, "inline")}>
            Show inline
          </button>
        </div>
      )}
    </section>
  );
}
export function VisualDockRoot({
  placement,
  className = "",
}: {
  placement: DockPlacement;
  className?: string;
}) {
  const workspace = useVisualWorkspace();
  const ref = useCallback(
    (element: HTMLDivElement | null) =>
      workspace.registerDock(placement, element),
    [placement, workspace.registerDock],
  );
  const fullscreen = workspace.instances.filter(
      (instance) =>
        inlinePlacement(instance, workspace.preference) === "fullscreen",
    ),
    full = placement === "fullscreen" && fullscreen.length > 0;
  return (
    <div
      ref={ref}
      className={`visual-dock-root visual-dock-${placement} ${className}`}
      data-visual-dock={placement}
      role={full ? "dialog" : undefined}
      aria-modal={full || undefined}
      aria-label={
        full
          ? fullscreen.length === 1
            ? (fullscreen[0].title ?? visualTitle(fullscreen[0].block))
            : "Fullscreen visual workspace"
          : undefined
      }
    />
  );
}
