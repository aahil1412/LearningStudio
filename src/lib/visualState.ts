import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { VisualInstance, VisualizationPlacement } from "../v2types";
import type { ContentBlock } from "../types";
import { validateContentBlock } from "./visualSpecs";
export type JsonVisualState = Record<string, unknown>;
export type VisualRuntime = {
  id: string;
  subjectId: string;
  state: JsonVisualState;
  placement: VisualizationPlacement;
  visible: boolean;
  patch: (patch: JsonVisualState) => void;
  move: (placement: VisualizationPlacement) => void;
  storeAsset: (value: unknown) => Promise<string>;
  loadAsset: (id: string) => Promise<unknown>;
  reportError?: (message: string) => void;
  registerCheckpoint?: (key: string, reader: () => unknown) => () => void;
};
export const VisualRuntimeContext = createContext<VisualRuntime | null>(null);
export const VisualCreatorContext = createContext<
  | ((block: ContentBlock, options?: Partial<VisualInstance>) => VisualInstance)
  | null
>(null);
export function useVisualCreator() {
  return useContext(VisualCreatorContext);
}
export const VisualCatalogContext = createContext<{
  subjectId: string;
  instances: VisualInstance[];
} | null>(null);
export const VisualSlotContext = createContext<ComponentType<{
  id: string;
  block: ContentBlock;
  originMessageId?: string;
  onExplain?: (text: string) => void;
}> | null>(null);
export function useVisualCatalog() {
  return useContext(VisualCatalogContext);
}
export function useVisualSlot() {
  return useContext(VisualSlotContext);
}
export function useVisualRuntime() {
  return useContext(VisualRuntimeContext);
}
/** Saving an unrelated record may reapply identical CSS variables. SDK scenes
 * must redraw for an actual theme change, never for an identical attribute write. */
export function createVisualThemeObserver(onChange: () => void) {
  const stamp = () =>
    `${document.documentElement.getAttribute("style")}|${document.documentElement.getAttribute("class")}|${document.documentElement.dataset.theme}`;
  let previous = stamp();
  return new MutationObserver(() => {
    const next = stamp();
    if (next !== previous) {
      previous = next;
      onChange();
    }
  });
}
const pendingVisualSources = new Set<Promise<unknown>>();
export async function flushVisualSources() {
  await Promise.allSettled([...pendingVisualSources]);
}
export function useVisualCheckpoint(key: string, reader: () => unknown) {
  const runtime = useVisualRuntime(),
    ref = useRef(reader);
  ref.current = reader;
  useEffect(
    () => runtime?.registerCheckpoint?.(key, () => ref.current()),
    [runtime?.id, key],
  );
}
export function jsonValue<T>(value: T, maxBytes = 24_000_000): T {
  const serialized = JSON.stringify(value, (_key, item) => {
    if (typeof item === "number" && !Number.isFinite(item))
      throw new Error("Visual state must contain finite numeric values.");
    if (
      typeof item === "function" ||
      typeof item === "symbol" ||
      typeof item === "bigint"
    )
      throw new Error("Visual state must be JSON data.");
    return item;
  });
  if (serialized === undefined || serialized.length > maxBytes)
    throw new Error("Visual state exceeds the supported JSON size.");
  return JSON.parse(serialized) as T;
}
function equal(a: unknown, b: unknown) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
/** Retains native renderer state locally and writes only JSON into the instance controller. */
export function useVisualState<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const runtime = useVisualRuntime(),
    initialRef = useRef<{ value: T } | null>(null);
  if (!initialRef.current)
    initialRef.current = {
      value: typeof initial === "function" ? (initial as () => T)() : initial,
    };
  const [value, setValue] = useState<T>(() =>
    runtime && Object.hasOwn(runtime.state, key)
      ? (jsonValue(runtime.state[key]) as T)
      : initialRef.current!.value,
  );
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const current = useRef(value);
  current.current = value;
  // Initial state is hydrated before this instance mounts. Subsequent context checkpoints
  // are outputs of this live component, not competing inputs; echoing an older checkpoint
  // back into local state can otherwise oscillate an animation's initial/current time.
  useEffect(() => {
    const active = runtimeRef.current;
    if (active && !equal(active.state[key], value))
      active.patch({ [key]: jsonValue(value) });
  }, [key, value]);
  return [value, setValue];
}
/** Large immutable source buffers are saved once, independently of frequent camera checkpoints. */
export function useVisualSource<T>(
  key: string,
  initial: T | null = null,
): [T | null, Dispatch<SetStateAction<T | null>>, boolean] {
  const runtime = useVisualRuntime(),
    [value, setLocal] = useState<T | null>(initial),
    [loading, setLoading] = useState(false),
    sequence = useRef(0),
    ref = useRef(value);
  ref.current = value;
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  useEffect(() => {
    const reference = runtime?.state[key] as { assetId?: string } | null;
    if (!reference?.assetId || !runtime) return;
    let alive = true;
    setLoading(true);
    void runtime
      .loadAsset(reference.assetId)
      .then((data) => {
        if (alive) setLocal(data as T);
      })
      .catch((error) =>
        runtime.reportError?.(
          error instanceof Error
            ? error.message
            : "A saved visual source could not be restored.",
        ),
      )
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [
    runtime?.id,
    (runtime?.state[key] as { assetId?: string } | undefined)?.assetId,
  ]);
  const setter: Dispatch<SetStateAction<T | null>> = (next) => {
    const result =
      typeof next === "function"
        ? (next as (previous: T | null) => T | null)(ref.current)
        : next;
    ref.current = result;
    setLocal(result);
    const active = runtimeRef.current;
    if (!active) return;
    const request = ++sequence.current;
    if (result === null) {
      active.patch({ [key]: null });
      return;
    }
    const task = active
      .storeAsset(jsonValue(result))
      .then((assetId) => {
        if (sequence.current === request) active.patch({ [key]: { assetId } });
      })
      .catch((error) =>
        active.reportError?.(
          error instanceof Error
            ? error.message
            : "The visual source could not be saved.",
        ),
      );
    pendingVisualSources.add(task);
    void task.finally(() => pendingVisualSources.delete(task));
  };
  return [value, setter, loading];
}
export function visualTitle(block: ContentBlock) {
  if ("spec" in block) return block.spec.title;
  if (block.type === "molecule")
    return block.caption || `${block.source.toUpperCase()} ${block.id}`;
  if (block.type === "chemical") return block.caption || "Chemical structure";
  if (block.type === "image") return block.query;
  if (block.type === "equation") return block.latex.slice(0, 100);
  if (block.type === "exercise") return block.question.slice(0, 100);
  if (block.type === "mcq") return block.question.slice(0, 100);
  if (block.type === "concept") return block.title;
  if (block.type === "terms") return "Key terms: " + block.items.map(t => t.term).join(", ").slice(0, 100);
  return block.text.slice(0, 100) || "Saved explanation";
}
export function makeVisualInstance(
  subjectId: string,
  block: ContentBlock,
  options: Partial<VisualInstance> = {},
): VisualInstance {
  const safe = validateContentBlock(block);
  if (!safe) throw new Error("This visual specification is invalid.");
  const now = new Date().toISOString();
  return {
    ...options,
    id: options.id ?? crypto.randomUUID(),
    subjectId,
    block: safe,
    state: jsonValue(options.state ?? {}),
    placement: options.placement ?? "auto",
    tags: [...(options.tags ?? [])],
    annotations: jsonValue(options.annotations ?? []),
    createdAt: options.createdAt ?? now,
    updatedAt: options.updatedAt ?? now,
    title: options.title ?? visualTitle(safe),
  };
}
export function updateVisualInstance(
  instance: VisualInstance,
  patch: Partial<VisualInstance>,
): VisualInstance {
  return {
    ...instance,
    ...patch,
    id: instance.id,
    subjectId: instance.subjectId,
    state: jsonValue(patch.state ?? instance.state),
    updatedAt: new Date(
      Math.max(Date.now(), Date.parse(instance.updatedAt) + 1),
    ).toISOString(),
  };
}
export function duplicateVisualInstance(
  instance: VisualInstance,
): VisualInstance {
  return makeVisualInstance(instance.subjectId, instance.block, {
    state: instance.state,
    tags: instance.tags.slice(),
    annotations: instance.annotations.map((annotation) => ({
      ...annotation,
      id: crypto.randomUUID(),
    })),
    title: (instance.title ?? visualTitle(instance.block)) + " · copy",
    placement: "collapsed",
  });
}
export function resetVisualState(
  previous: ContentBlock,
  next: ContentBlock,
  state: JsonVisualState,
) {
  const sameSource =
    JSON.stringify(previous) === JSON.stringify(next) ||
    (previous.type === "molecule" &&
      next.type === "molecule" &&
      previous.id === next.id &&
      previous.source === next.source);
  return {
    ...(sameSource
      ? Object.fromEntries(
          Object.entries(state).filter(
            ([, value]) =>
              value &&
              typeof value === "object" &&
              typeof (value as { assetId?: unknown }).assetId === "string",
          ),
        )
      : {}),
    __epoch: Number(state.__epoch ?? 0) + 1,
  };
}
export function resolvePlacement(
  instance: VisualInstance,
  preference: VisualizationPlacement,
): VisualizationPlacement {
  return instance.placement === "auto"
    ? preference === "auto"
      ? "inline"
      : preference
    : instance.placement;
}
export function reparentVisualHost(host: HTMLElement, target: HTMLElement) {
  if (host.parentElement !== target) target.appendChild(host);
}
export async function assetIdentifier(subjectId: string, value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(jsonValue(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return (
    subjectId +
    ":asset:" +
    Array.from(new Uint8Array(digest), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("")
  );
}
/** Only source-buffer references are traversed; executable values cannot enter a bundle. */
export function visualAssetIds(value: unknown): string[] {
  const result = new Set<string>();
  const visit = (item: unknown, depth: number) => {
    if (depth > 40) throw new Error("Visual state is nested too deeply.");
    if (!item || typeof item !== "object") return;
    if (
      !Array.isArray(item) &&
      typeof (item as { assetId?: unknown }).assetId === "string"
    )
      result.add((item as { assetId: string }).assetId);
    for (const child of Object.values(item)) visit(child, depth + 1);
  };
  visit(jsonValue(value), 0);
  return [...result];
}
export function replaceVisualAssetIds<T>(
  value: T,
  replacements: Map<string, string>,
): T {
  const visit = (item: unknown): unknown => {
    if (!item || typeof item !== "object") return item;
    if (Array.isArray(item)) return item.map(visit);
    return Object.fromEntries(
      Object.entries(item).map(([key, child]) => [
        key,
        key === "assetId" &&
        typeof child === "string" &&
        replacements.has(child)
          ? replacements.get(child)
          : visit(child),
      ]),
    );
  };
  return visit(jsonValue(value)) as T;
}
