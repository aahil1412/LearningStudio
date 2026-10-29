import { useCallback, useEffect, useRef, useState } from "react";
import {
  Highlighter,
  Search,
  StickyNote,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { invoke, isDesktop } from "../../lib/bridge";
import type {
  HighlightColor,
  HighlightDraft,
  ReadingHighlight,
} from "../../annotationTypes";
import {
  rangeForOffsets,
  resolveHighlightAnchor,
  selectionAnchor,
  textProjection,
} from "../../lib/highlightAnchors";
import "./annotations.css";

export const highlightColors: HighlightColor[] = [
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
];
type HighlightRegistry = Map<string, unknown>;
const registry = () =>
  (globalThis.CSS as unknown as { highlights?: HighlightRegistry })?.highlights;
const sources = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-annotation-kind][data-annotation-id]",
    ),
  );
const matchingSource = (item: ReadingHighlight) =>
  sources().find(
    (element) =>
      element.dataset.annotationKind === item.sourceKind &&
      element.dataset.annotationId === item.sourceId &&
      (!item.page ||
        !element.dataset.annotationPage ||
        Number(element.dataset.annotationPage) === item.page),
  );

/** Native Highlight ranges paint the original React text without rewriting its content. */
export function paintReadingHighlights(
  items: ReadingHighlight[],
  prefix = "studio",
  report?: (item: ReadingHighlight, anchored: boolean) => void,
) {
  const active = registry();
  const HighlightConstructor = (
    globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }
  ).Highlight;
  if (!active || !HighlightConstructor) return;
  for (const color of highlightColors) active.delete(prefix + "-" + color);
  const ranges = Object.fromEntries(
    highlightColors.map((color) => [color, [] as Range[]]),
  ) as Record<HighlightColor, Range[]>;
  for (const item of items) {
    const root = matchingSource(item);
    if (!root) continue;
    const resolved = resolveHighlightAnchor(textProjection(root), item);
    const range =
      resolved && rangeForOffsets(root, resolved.start, resolved.end);
    if (range) ranges[item.color].push(range);
    report?.(item, !!range);
  }
  for (const color of highlightColors)
    active.set(
      prefix + "-" + color,
      new HighlightConstructor(...ranges[color]),
    );
}
export function getSelectedHighlightDraft(
  subjectId: string,
  color: HighlightColor,
  note = "",
): HighlightDraft | null {
  const selected = window.getSelection();
  const element = selected?.anchorNode?.parentElement;
  const root = element?.closest<HTMLElement>(
    "[data-annotation-kind][data-annotation-id]",
  );
  if (!selected || !root || !root.dataset.annotationId) return null;
  const anchor = selectionAnchor(selected, root);
  if (!anchor) return null;
  return {
    subjectId,
    sourceKind: root.dataset.annotationKind as HighlightDraft["sourceKind"],
    sourceId: root.dataset.annotationId,
    conversationId: root.dataset.annotationConversation,
    page: root.dataset.annotationPage
      ? Number(root.dataset.annotationPage)
      : undefined,
    ...anchor,
    color,
    note,
    tags: [],
  };
}
export function AnnotationLayer({
  subjectId,
  sourceKey,
}: {
  subjectId?: string;
  sourceKey?: string;
}) {
  const [items, setItems] = useState<ReadingHighlight[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const generation = useRef(0),
    pending = useRef(new Set<string>());
  const load = useCallback(async () => {
    const current = ++generation.current;
    if (!subjectId || !isDesktop) {
      setItems([]);
      return;
    }
    try {
      const result = await invoke<ReadingHighlight[]>("annotations:list", {
        subjectId,
      });
      if (current === generation.current) setItems(result);
    } catch (e) {
      if (current === generation.current)
        setError(
          e instanceof Error ? e.message : "Highlights could not be loaded.",
        );
    }
  }, [subjectId]);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  useEffect(() => {
    const changed = () => void load();
    document.addEventListener("studio:annotations-changed", changed);
    return () =>
      document.removeEventListener("studio:annotations-changed", changed);
  }, [load]);
  useEffect(() => {
    const create = async (event: Event) => {
      const draft = (event as CustomEvent<HighlightDraft>).detail;
      if (!subjectId || draft.subjectId !== subjectId) return;
      try {
        await invoke("annotations:create", draft);
        setError("");
        setSaved(true);
        await load();
        document.dispatchEvent(new Event("studio:annotations-changed"));
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "This highlight could not be saved.",
        );
      }
    };
    document.addEventListener("studio:highlight-create", create);
    return () =>
      document.removeEventListener("studio:highlight-create", create);
  }, [subjectId, load]);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 3500);
    return () => clearTimeout(timer);
  }, [saved]);
  useEffect(() => {
    let frame = 0;
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        paintReadingHighlights(items, "studio", (item, anchored) => {
          const state = anchored ? "anchored" : "orphaned";
          if (item.anchorState === state || pending.current.has(item.id))
            return;
          pending.current.add(item.id);
          void invoke<ReadingHighlight>("annotations:update", {
            subjectId: item.subjectId,
            id: item.id,
            expectedRevision: item.revision,
            patch: { anchorState: state },
          })
            .then((updated) =>
              setItems((previous) =>
                previous.map((value) =>
                  value.id === item.id ? updated : value,
                ),
              ),
            )
            .catch(() => {
              /* A later reload reconciles concurrent annotation edits. */
            })
            .finally(() => pending.current.delete(item.id));
        }),
      );
    };
    paint();
    const observer = new MutationObserver(paint);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const color of highlightColors)
        registry()?.delete("studio-" + color);
    };
  }, [items, sourceKey]);
  return (
    <>
      {saved && (
        <div className="annotation-toast" role="status">
          <Highlighter size={16} />
          Highlight saved to this subject
        </div>
      )}
      {error && (
        <div className="annotation-toast error" role="alert">
          {error}
          <button
            onClick={() => setError("")}
            aria-label="Dismiss annotation error"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
export function AnnotationLibrary({
  subjectId,
  onJump,
  onClose,
}: {
  subjectId: string;
  onJump: (annotation: ReadingHighlight) => void;
  onClose?: () => void;
}) {
  const [items, setItems] = useState<ReadingHighlight[]>([]),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<string | null>(null),
    [note, setNote] = useState(""),
    [tags, setTags] = useState(""),
    [removed, setRemoved] = useState<ReadingHighlight | null>(null);
  const load = useCallback(async () => {
    try {
      setItems(
        await invoke<ReadingHighlight[]>("annotations:list", { subjectId }),
      );
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, [subjectId]);
  useEffect(() => {
    void load();
    const changed = () => void load();
    document.addEventListener("studio:annotations-changed", changed);
    return () =>
      document.removeEventListener("studio:annotations-changed", changed);
  }, [load]);
  const changed = () =>
    document.dispatchEvent(new Event("studio:annotations-changed"));
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
      changed();
    } catch (e) {
      await load();
      setError(
        e instanceof Error ? e.message : "The annotation could not be updated.",
      );
    }
  };
  const visible = items.filter(
    (item) =>
      (filter === "all" ||
        item.color === filter ||
        (filter === "orphaned" && item.anchorState === "orphaned")) &&
      [item.quote, item.note, ...item.tags]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  return (
    <section
      className="annotations-library"
      aria-label="Subject highlights and annotations"
    >
      <header>
        <div>
          <span className="v2-eyebrow">CONNECTED READING</span>
          <h2>Highlights & annotations</h2>
          <p>
            Passages keep their original source. Your notes and colors remain
            separate from the lesson.
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close highlights">
            <X size={18} />
          </button>
        )}
      </header>
      <div className="annotation-filters">
        <label>
          <Search size={16} />
          <input
            aria-label="Search subject highlights"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Quote, note, or tag"
          />
        </label>
        <select
          aria-label="Filter highlights"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All colors</option>
          {highlightColors.map((color) => (
            <option key={color} value={color}>
              {color}
            </option>
          ))}
          <option value="orphaned">Needs reanchoring</option>
        </select>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {removed && (
        <p className="notice">
          Highlight removed.{" "}
          <button
            onClick={() =>
              void run(async () => {
                await invoke("annotations:restore", {
                  subjectId,
                  id: removed.id,
                  revision: removed.revision - 1,
                  expectedRevision: removed.revision,
                });
                setRemoved(null);
              })
            }
          >
            <Undo2 size={14} />
            Undo
          </button>
        </p>
      )}
      <p className="annotation-count">
        {visible.length} saved passage{visible.length === 1 ? "" : "s"}
      </p>
      {!visible.length && (
        <p className="annotation-empty">
          Select text in a lesson, document, or textbook and choose a highlight
          color. Notes and tags are searchable here.
        </p>
      )}
      {visible.map((item) => (
        <article
          key={item.id}
          className={"annotation-card color-" + item.color}
        >
          <div className="annotation-meta">
            <span>
              {item.sourceKind}
              {item.page ? " · page " + item.page : ""}
            </span>
            <span>{new Date(item.createdAt).toLocaleDateString()}</span>
            {item.anchorState === "orphaned" && (
              <strong>Source changed. Review anchor.</strong>
            )}
          </div>
          <blockquote>{item.quote}</blockquote>
          {item.note && (
            <p className="annotation-note">
              <StickyNote size={15} />
              {item.note}
            </p>
          )}
          {item.tags.length > 0 && (
            <p className="annotation-tags">
              {item.tags.map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </p>
          )}
          {editing === item.id ? (
            <div className="annotation-edit">
              <label>
                Note
                <textarea
                  aria-label="Highlight note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                />
              </label>
              <label>
                Tags, separated by commas
                <input
                  aria-label="Highlight tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                />
              </label>
              <button
                onClick={() =>
                  void run(async () => {
                    await invoke("annotations:update", {
                      subjectId,
                      id: item.id,
                      expectedRevision: item.revision,
                      patch: {
                        note,
                        tags: tags
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean),
                      },
                    });
                    setEditing(null);
                  })
                }
              >
                Save annotation
              </button>
              <button onClick={() => setEditing(null)}>Cancel</button>
            </div>
          ) : (
            <div className="annotation-actions">
              <button onClick={() => onJump(item)}>Jump to source</button>
              <button
                onClick={() => {
                  setEditing(item.id);
                  setNote(item.note);
                  setTags(item.tags.join(", "));
                }}
              >
                Edit note & tags
              </button>
              {highlightColors.map((color) => (
                <button
                  key={color}
                  className={"annotation-swatch color-" + color}
                  aria-label={"Change highlight to " + color}
                  aria-pressed={item.color === color}
                  onClick={() =>
                    void run(() =>
                      invoke("annotations:update", {
                        subjectId,
                        id: item.id,
                        expectedRevision: item.revision,
                        patch: { color },
                      }),
                    )
                  }
                />
              ))}
              <button
                aria-label="Delete highlight"
                onClick={() =>
                  void run(async () => {
                    const result = await invoke<ReadingHighlight>(
                      "annotations:delete",
                      {
                        subjectId,
                        id: item.id,
                        expectedRevision: item.revision,
                      },
                    );
                    setRemoved(result);
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
