import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  NodeResizer,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import katex from "katex";
import type {
  CanvasNode,
  LearningCanvasData,
  SubjectRecord,
  VisualInstance,
} from "../../v2types";
import { invoke } from "../../lib/bridge";
import { validateContentBlock } from "../../lib/visualSpecs";
import {
  visualTitle,
  visualAssetIds,
  replaceVisualAssetIds,
  assetIdentifier,
  jsonValue,
} from "../../lib/visualState";
import { useVisualWorkspace, VisualInstanceView } from "./VisualWorkspace";
type Props = {
  id?: string;
  canvasId?: string;
  initialData?: LearningCanvasData;
  data?: LearningCanvasData;
  onChange?: (data: LearningCanvasData, id?: string) => void;
  onInsertVisual?: (visualId: string) => void;
};
const pendingCanvasWrites = new Set<Promise<unknown>>();
export async function flushCanvasWrites() {
  await Promise.allSettled([...pendingCanvasWrites]);
}
const empty = (): LearningCanvasData => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  annotations: [],
});
const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export function canvasSvg(
  data: LearningCanvasData,
  visuals: { id: string; title?: string }[] = [],
  previews: Record<string, string> = {},
) {
  const bounds = {
    x: Math.min(0, ...data.nodes.map((node) => node.x)) - 35,
    y: Math.min(0, ...data.nodes.map((node) => node.y)) - 35,
    right: Math.max(700, ...data.nodes.map((node) => node.x + node.width)) + 35,
    bottom:
      Math.max(500, ...data.nodes.map((node) => node.y + node.height)) + 35,
  };
  const nodes = data.nodes
    .map((node) => {
      const title =
        node.kind === "visual"
          ? (visuals.find((instance) => instance.id === node.visualId)?.title ??
            "Authored visual")
          : node.kind;
      const preview = node.visualId ? previews[node.visualId] : undefined;
      const text = (node.text ?? (node.block ? JSON.stringify(node.block) : ""))
        .split("\n")
        .flatMap((line) => line.match(/.{1,55}/g) ?? [""])
        .slice(0, Math.max(1, Math.floor((node.height - 65) / 18)));
      return `<g transform="translate(${node.x} ${node.y})"><rect width="${node.width}" height="${node.height}" rx="9" fill="#f5f2e8" stroke="#7e8e76"/><text x="12" y="24" fill="#303b2e" font-size="13" font-weight="bold">${escapeXml(title.slice(0, 70))}</text>${preview ? `<image href="${escapeXml(preview)}" x="8" y="38" width="${node.width - 16}" height="${node.height - 46}" preserveAspectRatio="xMidYMid meet"/>` : text.map((line, i) => `<text x="12" y="${55 + i * 18}" fill="#303b2e" font-size="12">${escapeXml(line)}</text>`).join("")}</g>`;
    })
    .join("");
  const edges = data.edges
    .map((edge) => {
      const a = data.nodes.find((node) => node.id === edge.source),
        b = data.nodes.find((node) => node.id === edge.target);
      return a && b
        ? `<path d="M${a.x + a.width} ${a.y + a.height / 2} L${b.x} ${b.y + b.height / 2}" fill="none" stroke="#536e45" stroke-width="2" marker-end="url(#arrow)"/>`
        : "";
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${bounds.right - bounds.x} ${bounds.bottom - bounds.y}" width="${bounds.right - bounds.x}" height="${bounds.bottom - bounds.y}"><title>Learning canvas</title><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10Z" fill="#536e45"/></marker></defs><rect x="${bounds.x}" y="${bounds.y}" width="100%" height="100%" fill="#e8e9de"/>${edges}${nodes}<metadata>${escapeXml(JSON.stringify(data))}</metadata></svg>`;
}
function downloadCanvas(content: string, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime })),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function validateLearningCanvas(value: unknown): LearningCanvasData {
  if (!value || typeof value !== "object")
    throw new Error("Canvas data must be an object.");
  const source = value as LearningCanvasData;
  if (
    !Array.isArray(source.nodes) ||
    source.nodes.length > 500 ||
    !Array.isArray(source.edges) ||
    source.edges.length > 2000
  )
    throw new Error("Canvas limits are 500 nodes and 2000 connections.");
  const ids = new Set<string>();
  for (const node of source.nodes) {
    if (
      !node ||
      typeof node.id !== "string" ||
      !node.id ||
      ids.has(node.id) ||
      !["text", "equation", "visual", "excerpt"].includes(node.kind) ||
      ![node.x, node.y, node.width, node.height].every(Number.isFinite) ||
      node.width < 150 ||
      node.width > 3000 ||
      node.height < 80 ||
      node.height > 3000 ||
      Math.abs(node.x) > 1e7 ||
      Math.abs(node.y) > 1e7
    )
      throw new Error("Invalid or duplicate canvas node.");
    ids.add(node.id);
    if (node.kind === "visual" && !validateContentBlock(node.block))
      throw new Error(
        "Canvas visual specifications must be validated authored data.",
      );
    if (node.text && node.text.length > 100000)
      throw new Error("Canvas text is too large.");
  }
  if (
    source.edges.some(
      (edge) =>
        !ids.has(edge.source) ||
        !ids.has(edge.target) ||
        typeof edge.id !== "string",
    )
  )
    throw new Error("Canvas connections must reference existing nodes.");
  if (
    !source.viewport ||
    ![source.viewport.x, source.viewport.y, source.viewport.zoom].every(
      Number.isFinite,
    ) ||
    source.viewport.zoom < 0.1 ||
    source.viewport.zoom > 4
  )
    throw new Error("Invalid canvas viewport.");
  return JSON.parse(JSON.stringify(source));
}
function CanvasItem({
  id,
  data,
  selected,
}: {
  id: string;
  data: any;
  selected: boolean;
}) {
  const node = data.node as CanvasNode;
  return (
    <div className={"canvas-authored-node canvas-" + node.kind}>
      <NodeResizer
        minWidth={node.kind === "visual" ? 300 : 180}
        minHeight={node.kind === "visual" ? 240 : 100}
        maxWidth={3000}
        maxHeight={3000}
        isVisible={selected}
        onResizeEnd={(_event, size) =>
          data.update(id, {
            x: size.x,
            y: size.y,
            width: size.width,
            height: size.height,
          })
        }
      />
      <Handle type="target" position={Position.Left} />
      <header className="canvas-node-handle">
        <span>
          {node.kind === "visual" && node.block
            ? visualTitle(node.block)
            : node.kind === "excerpt"
              ? "Source excerpt"
              : node.kind === "equation"
                ? "Equation"
                : "Note"}
        </span>
        <button
          className="nodrag"
          aria-label="Delete canvas node"
          onClick={() => data.remove(id)}
        >
          ×
        </button>
      </header>
      <div className="canvas-node-content nodrag nowheel">
        {node.kind === "visual" && node.block ? (
          <VisualInstanceView
            id={node.visualId ?? "canvas:" + id}
            block={node.block}
          />
        ) : node.kind === "equation" ? (
          <>
            <input
              aria-label="Canvas equation source"
              value={node.text ?? ""}
              onChange={(event) =>
                data.update(id, { text: event.target.value.slice(0, 6000) })
              }
            />
            <div
              className="canvas-equation"
              dangerouslySetInnerHTML={{
                __html: katex.renderToString(node.text || " ", {
                  throwOnError: false,
                  trust: false,
                  displayMode: true,
                  maxExpand: 500,
                  maxSize: 20,
                }),
              }}
            />
          </>
        ) : (
          <>
            <textarea
              aria-label={
                node.kind === "excerpt"
                  ? "Canvas source excerpt"
                  : "Canvas note"
              }
              placeholder={
                node.kind === "excerpt"
                  ? "Paste a passage and record its source…"
                  : "Write an idea or explanation…"
              }
              value={node.text ?? ""}
              onChange={(event) =>
                data.update(id, { text: event.target.value.slice(0, 100000) })
              }
            />
            {node.kind === "excerpt" && (
              <label>
                Source
                <input
                  aria-label="Canvas excerpt source"
                  placeholder="Document, page, or source title"
                  value={node.source?.title ?? ""}
                  onChange={(event) =>
                    data.update(id, {
                      source: {
                        ...node.source,
                        title: event.target.value.slice(0, 500),
                      },
                    })
                  }
                />
              </label>
            )}
          </>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { authored: CanvasItem };
function LearningCanvasInner({
  id,
  canvasId,
  initialData,
  data: controlled,
  onChange,
}: Props) {
  const flow = useReactFlow();
  const workspace = useVisualWorkspace(),
    recordId = id ?? canvasId ?? `${workspace.subjectId}:canvas:main`,
    [document, setDocument] = useState<LearningCanvasData>(
      () => initialData ?? controlled ?? empty(),
    ),
    [loaded, setLoaded] = useState(!!(initialData ?? controlled)),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [choice, setChoice] = useState(""),
    [flowNodes, setFlowNodes] = useState<Node[]>([]),
    [flowEdges, setFlowEdges] = useState<Edge[]>([]);
  const current = useRef(document);
  current.current = document;
  const callback = useRef(onChange);
  callback.current = onChange;
  const revision = useRef<number | undefined>(undefined),
    queue = useRef(Promise.resolve()),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (initialData || controlled) {
      setDocument(validateLearningCanvas(initialData ?? controlled));
      setLoaded(true);
      return;
    }
    let alive = true;
    void invoke<SubjectRecord | null>("subject:record-get", {
      subjectId: workspace.subjectId,
      id: recordId,
      recordType: "canvas",
    })
      .then((record) => {
        if (alive && record) {
          revision.current = record.revision;
          setDocument(validateLearningCanvas(record.data));
        }
      })
      .catch((error) => {
        if (alive) setError(String(error));
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [workspace.subjectId, recordId]);
  const persist = useCallback(
    (value: LearningCanvasData) => {
      if (callback.current) {
        callback.current(value, recordId);
        return;
      }
      queue.current = queue.current
        .catch(() => {})
        .then(async () => {
          const saved = await invoke<SubjectRecord>("subject:record-put", {
            subjectId: workspace.subjectId,
            recordType: "canvas",
            id: recordId,
            title: "Learning canvas",
            data: value,
            expectedRevision: revision.current,
          });
          revision.current = saved.revision;
        })
        .catch((error) =>
          setError(
            error instanceof Error
              ? error.message
              : "The canvas could not be saved.",
          ),
        );
      const task = queue.current;
      pendingCanvasWrites.add(task);
      void task.finally(() => pendingCanvasWrites.delete(task));
    },
    [recordId, workspace.subjectId],
  );
  useEffect(() => {
    if (!loaded) return;
    const handle = setTimeout(() => persist(document), 400);
    return () => clearTimeout(handle);
  }, [document, loaded, persist]);
  useEffect(() => {
    const flush = () => {
      if (loaded) persist(current.current);
    };
    window.addEventListener("studio:flush-visuals", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      flush();
      window.removeEventListener("studio:flush-visuals", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, [loaded, persist]);
  useEffect(() => {
    if (loaded) void flow.setViewport(current.current.viewport);
  }, [loaded]);
  const update = useCallback(
      (nodeId: string, patch: Partial<CanvasNode>) =>
        setDocument((value) => ({
          ...value,
          nodes: value.nodes.map((node) =>
            node.id === nodeId ? { ...node, ...patch, id: node.id } : node,
          ),
        })),
      [],
    ),
    remove = useCallback(
      (nodeId: string) =>
        setDocument((value) => ({
          ...value,
          nodes: value.nodes.filter((node) => node.id !== nodeId),
          edges: value.edges.filter(
            (edge) => edge.source !== nodeId && edge.target !== nodeId,
          ),
        })),
      [],
    );
  useEffect(() => {
    setFlowNodes((previous) =>
      document.nodes.map((node) => ({
        ...previous.find((value) => value.id === node.id),
        id: node.id,
        type: "authored",
        position: { x: node.x, y: node.y },
        style: { width: node.width, height: node.height },
        dragHandle: ".canvas-node-handle",
        data: { node, update, remove },
      })),
    );
    setFlowEdges(
      document.edges.map((edge) => ({
        ...edge,
        style: { stroke: "var(--accent)" },
        labelStyle: { fill: "var(--text)" },
        markerEnd: { type: "arrowclosed" as any, color: "var(--accent)" },
      })),
    );
  }, [document.nodes, document.edges, update, remove]);
  const add = (kind: CanvasNode["kind"]) => {
    const count = current.current.nodes.length,
      node: CanvasNode = {
        id: crypto.randomUUID(),
        kind,
        x: 60 + (count % 3) * 570,
        y: 60 + Math.floor(count / 3) * 680,
        width: kind === "visual" ? 520 : 340,
        height: kind === "visual" ? 600 : kind === "equation" ? 200 : 220,
        text: kind === "equation" ? "y = f(x)" : "",
      };
    if (kind === "visual") {
      const source = workspace.instances.find(
        (instance) => instance.id === choice,
      );
      if (!source) {
        setNotice("Select a saved visual first.");
        return;
      }
      const copy = workspace.create(source.block, {
        state: source.state,
        title: source.title,
        placement: "inline",
        tags: [...source.tags, "canvas"],
      });
      node.visualId = copy.id;
      node.block = copy.block;
    }
    setDocument((value) => ({ ...value, nodes: [...value.nodes, node] }));
    setTimeout(
      () => void flow.fitView({ padding: 0.22, maxZoom: 1, duration: 150 }),
      80,
    );
  };
  const nodesChange = (changes: NodeChange[]) => {
    setFlowNodes((nodes) => applyNodeChanges(changes, nodes));
    const edits = changes.filter(
      (change) =>
        change.type === "position" ||
        change.type === "dimensions" ||
        change.type === "remove",
    );
    if (!edits.length) return;
    setDocument((value) => {
      let nodes = value.nodes.slice();
      for (const change of edits) {
        if (change.type === "remove")
          nodes = nodes.filter((node) => node.id !== change.id);
        if (change.type === "position" && change.position)
          nodes = nodes.map((node) =>
            node.id === change.id
              ? { ...node, x: change.position!.x, y: change.position!.y }
              : node,
          );
        if (change.type === "dimensions" && change.dimensions)
          nodes = nodes.map((node) =>
            node.id === change.id
              ? {
                  ...node,
                  width: Math.max(180, change.dimensions!.width),
                  height: Math.max(100, change.dimensions!.height),
                }
              : node,
          );
      }
      const ids = new Set(nodes.map((node) => node.id));
      const next = {
        ...value,
        nodes,
        edges: value.edges.filter(
          (edge) => ids.has(edge.source) && ids.has(edge.target),
        ),
      };
      return JSON.stringify(next) === JSON.stringify(value) ? value : next;
    });
  };
  const edgesChange = (changes: EdgeChange[]) => {
    setFlowEdges((edges) => applyEdgeChanges(changes, edges));
    const removed = new Set(
      changes
        .filter((change) => change.type === "remove")
        .map((change) => change.id),
    );
    if (removed.size)
      setDocument((value) => ({
        ...value,
        edges: value.edges.filter((edge) => !removed.has(edge.id)),
      }));
  };
  const connect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    setDocument((value) => ({
      ...value,
      edges: [
        ...value.edges,
        {
          id: crypto.randomUUID(),
          source: connection.source!,
          target: connection.target!,
        },
      ],
    }));
  };
  const exportCanvas = async (format: "json" | "svg" | "html") => {
    try {
      const value = validateLearningCanvas(current.current),
        visuals = workspace.instances.filter((instance) =>
          value.nodes.some((node) => node.visualId === instance.id),
        ),
        previews = Object.fromEntries(
          visuals
            .map((instance) => [instance.id, workspace.preview(instance.id)])
            .filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
        ),
        svg = canvasSvg(value, visuals, previews);
      const assets: Record<string, unknown> = {};
      if (format !== "svg")
        for (const assetId of visualAssetIds(
          visuals.map((visual) => visual.state),
        )) {
          const record = await invoke<SubjectRecord<{
            kind: string;
            value: unknown;
          }> | null>("subject:record-get", {
            subjectId: workspace.subjectId,
            id: assetId,
            recordType: "asset",
          });
          if (!record || record.data.kind !== "visual-source")
            throw new Error(
              "A source asset is unavailable. Restore it before exporting this canvas.",
            );
          assets[assetId] = record.data.value;
        }
      if (format === "json")
        downloadCanvas(
          JSON.stringify(
            {
              schema: "learning-studio/canvas-v2",
              data: value,
              visuals,
              assets,
            },
            null,
            2,
          ),
          "learning-canvas.json",
          "application/json",
        );
      else if (format === "svg")
        downloadCanvas(svg, "learning-canvas.svg", "image/svg+xml");
      else
        downloadCanvas(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Learning canvas</title><style>body{margin:20px;background:#f5f2e8;color:#303b2e;font:16px "Segoe UI",Arial,sans-serif}svg{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><h1>Learning canvas</h1>${svg}<details><summary>Reusable authored canvas data</summary><pre>${escapeXml(JSON.stringify({ data: value, visuals, assets }, null, 2))}</pre></details></body></html>`,
          "learning-canvas.html",
          "text/html",
        );
      setNotice("Canvas exported with its authored data.");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The canvas export could not be completed.",
      );
    }
  };
  const importCanvas = async (value: unknown) => {
    const bundle = value as {
        data?: unknown;
        visuals?: unknown;
        assets?: unknown;
      },
      document = validateLearningCanvas(bundle.data ?? value);
    const sourceVisuals = bundle.visuals === undefined ? [] : bundle.visuals;
    if (!Array.isArray(sourceVisuals) || sourceVisuals.length > 500)
      throw new Error("A canvas bundle supports at most 500 authored visuals.");
    const referenced = new Set(
      document.nodes.map((node) => node.visualId).filter(Boolean),
    );
    const visuals = sourceVisuals
      .filter(
        (item) =>
          item && typeof item.id === "string" && referenced.has(item.id),
      )
      .map((item) => {
        if (
          !validateContentBlock(item.block) ||
          !item.state ||
          typeof item.state !== "object" ||
          Array.isArray(item.state)
        )
          throw new Error(
            "An imported visual has an invalid specification or state.",
          );
        return jsonValue(item) as VisualInstance;
      });
    const assets =
      bundle.assets &&
      typeof bundle.assets === "object" &&
      !Array.isArray(bundle.assets)
        ? (bundle.assets as Record<string, unknown>)
        : {};
    const replacements = new Map<string, string>();
    for (const originalId of visualAssetIds(
      visuals.map((visual) => visual.state),
    )) {
      let source: unknown;
      if (Object.hasOwn(assets, originalId)) source = assets[originalId];
      else {
        const existing = await invoke<SubjectRecord<{
          kind: string;
          value: unknown;
        }> | null>("subject:record-get", {
          subjectId: workspace.subjectId,
          id: originalId,
          recordType: "asset",
        });
        if (existing?.data.kind !== "visual-source")
          throw new Error(
            "This canvas is missing a molecular source asset. Export it again with its source data.",
          );
        source = existing.data.value;
      }
      const assetId = await assetIdentifier(workspace.subjectId, source);
      await invoke("subject:record-put", {
        subjectId: workspace.subjectId,
        recordType: "asset",
        id: assetId,
        title: "Imported visual source",
        data: { kind: "visual-source", value: jsonValue(source) },
      });
      replacements.set(originalId, assetId);
    }
    const ids = new Map<string, string>();
    for (const visual of visuals) {
      const copy = workspace.create(visual.block, {
        state: replaceVisualAssetIds(visual.state, replacements),
        title:
          typeof visual.title === "string"
            ? visual.title.slice(0, 200)
            : undefined,
        tags: Array.isArray(visual.tags)
          ? visual.tags
              .filter((tag: unknown) => typeof tag === "string")
              .slice(0, 30)
          : [],
        annotations: Array.isArray(visual.annotations)
          ? visual.annotations
              .filter(
                (annotation) =>
                  annotation &&
                  typeof annotation.text === "string" &&
                  typeof annotation.id === "string" &&
                  typeof annotation.createdAt === "string",
              )
              .slice(0, 500)
          : [],
        placement: "inline",
      });
      ids.set(visual.id, copy.id);
    }
    const restored = {
      ...document,
      nodes: document.nodes.map((node) =>
        node.visualId && ids.has(node.visualId)
          ? { ...node, visualId: ids.get(node.visualId) }
          : node,
      ),
    };
    setDocument(restored);
    void flow.setViewport(restored.viewport);
    setError("");
    setNotice(
      "Canvas imported with its authored visual specifications and working state.",
    );
  };
  const selectable = useMemo(
    () =>
      workspace.instances.filter(
        (instance) => !instance.tags.includes("canvas"),
      ),
    [workspace.instances],
  );
  return (
    <section className="learning-canvas-workspace">
      <header className="v2-visual-page-header">
        <div>
          <span className="eyebrow">THINK IN CONNECTIONS</span>
          <h1>Learning canvas</h1>
          <p>
            Arrange reusable visuals, equations, notes, and source excerpts.
            Drag a header to move a node; select it to resize.
          </p>
        </div>
      </header>
      <div className="learning-canvas-toolbar">
        <button onClick={() => add("text")}>Add note</button>
        <button onClick={() => add("equation")}>Add equation</button>
        <button onClick={() => add("excerpt")}>Add source excerpt</button>
        <select
          aria-label="Saved visual for canvas"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
        >
          <option value="">Choose saved visual</option>
          {selectable.map((instance) => (
            <option value={instance.id} key={instance.id}>
              {instance.title ?? visualTitle(instance.block)}
            </option>
          ))}
        </select>
        <button disabled={!choice} onClick={() => add("visual")}>
          Add visual
        </button>
        <details>
          <summary>Export</summary>
          {(["json", "svg", "html"] as const).map((format) => (
            <button key={format} onClick={() => void exportCanvas(format)}>
              {format.toUpperCase()}
            </button>
          ))}
        </details>
        <button onClick={() => input.current?.click()}>Import JSON</button>
        <input
          hidden
          ref={input}
          type="file"
          accept=".json"
          onChange={async (event) => {
            try {
              const file = event.target.files?.[0];
              if (file) {
                if (file.size > 50_000_000)
                  throw new Error("Choose a canvas smaller than 50 MB.");
                const value = JSON.parse(await file.text());
                await importCanvas(value);
              }
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "The canvas could not be imported.",
              );
            }
            event.target.value = "";
          }}
        />
      </div>
      {(error || notice) && (
        <div className={error ? "notice error" : "notice"} role="status">
          {error || notice}
          <button
            aria-label="Dismiss canvas status"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            ×
          </button>
        </div>
      )}
      <div className="learning-canvas-flow">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={nodesChange}
          onEdgesChange={edgesChange}
          onConnect={connect}
          defaultViewport={document.viewport}
          onInit={(instance) =>
            void instance.setViewport(current.current.viewport)
          }
          onMoveEnd={(_event, viewport) =>
            setDocument((value) => ({ ...value, viewport }))
          }
          minZoom={0.1}
          maxZoom={4}
          fitView={false}
          deleteKeyCode={["Backspace", "Delete"]}
        >
          <Background color="var(--border)" gap={22} />
          <Controls />
          <MiniMap
            nodeColor="var(--accent)"
            maskColor="color-mix(in srgb,var(--bg) 75%,transparent)"
          />
        </ReactFlow>
        {loaded && !document.nodes.length && (
          <div className="learning-canvas-empty">
            <h2>Room for the whole idea.</h2>
            <p>
              Add a note, connect equations, or bring a saved visual onto the
              canvas.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
export default function LearningCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <LearningCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
