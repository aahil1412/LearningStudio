import { useMemo, useState, useEffect, useRef } from "react";
import type { VisualInstance } from "../../v2types";
import { visualTitle, resetVisualState } from "../../lib/visualState";
import { validateContentBlock } from "../../lib/visualSpecs";
import { useVisualWorkspace, VisualInstanceView } from "./VisualWorkspace";
import { VisualLab } from "../visuals/VisualBlock";
export default function VisualNotebook({
  onInsert,
  onSelect,
  onLocateMessage,
  onOpenCanvas,
  initialSelectedId,
}: {
  onInsert?: (instance: VisualInstance) => void;
  onSelect?: (instance: VisualInstance) => void;
  onLocateMessage?: (messageId: string) => void;
  onOpenCanvas?: () => void;
  initialSelectedId?: string;
}) {
  const workspace = useVisualWorkspace(),
    [search, setSearch] = useState(""),
    [tag, setTag] = useState(""),
    [onlySaved, setOnlySaved] = useState(false),
    [authoring, setAuthoring] = useState(false),
    [liveId, setLiveId] = useState<string | null>(null),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [annotation, setAnnotation] = useState(""),
    [specDraft, setSpecDraft] = useState(""),
    [resetState, setResetState] = useState(true),
    [editError, setEditError] = useState("");
  const tags = [
    ...new Set(workspace.instances.flatMap((instance) => instance.tags)),
  ].sort();
  const matches = useMemo(
    () =>
      workspace.instances
        .filter(
          (instance) =>
            (!onlySaved || instance.tags.includes("saved")) &&
            (!tag || instance.tags.includes(tag)) &&
            `${instance.title ?? visualTitle(instance.block)} ${instance.tags.join(" ")} ${instance.annotations.map((value) => value.text).join(" ")} ${instance.block.type}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [workspace.instances, search, tag, onlySaved],
  );
  const handled = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!initialSelectedId || handled.current === initialSelectedId) return;
    const instance = workspace.instances.find(
      (item) => item.id === initialSelectedId,
    );
    if (instance) {
      handled.current = initialSelectedId;
      setSelectedId(instance.id);
    }
  }, [initialSelectedId, workspace.instances]);
  const selected = workspace.instances.find(
    (instance) => instance.id === selectedId,
  );
  const choose = (instance: VisualInstance) => {
    setSelectedId(instance.id);
    setAnnotation("");
    setSpecDraft(JSON.stringify(instance.block, null, 2));
    setEditError("");
    onSelect?.(instance);
  };
  return (
    <section
      className={`visual-notebook ${authoring || liveId ? "visual-notebook-expanded" : ""}`}
    >
      <header className="v2-visual-page-header">
        <div>
          <span className="eyebrow">
            A LIBRARY OF EXPLANATIONS YOU CAN REVISIT
          </span>
          <h1>Visual notebook</h1>
          <p>
            Diagrams, plots, structures and simulations retain their authored
            content and your working state.
          </p>
        </div>
        <div className="visual-notebook-actions">
          <button
            onClick={() => {
              setLiveId(null);
              setAuthoring((open) => !open);
            }}
            aria-expanded={authoring}
          >
            {authoring ? "Close figure authoring" : "Author a figure"}
          </button>
          {onOpenCanvas && (
            <button onClick={onOpenCanvas}>Open learning canvas</button>
          )}
        </div>
      </header>
      {authoring && (
        <section
          className="visual-notebook-authoring"
          aria-label="Figure authoring tools"
        >
          <h2>Build a figure for this subject</h2>
          <p>
            Choose a tool and a model. These tools run only when you open them.
          </p>
          <VisualLab />
        </section>
      )}
      {liveId &&
        workspace.instances.find((instance) => instance.id === liveId) && (
          <section
            className="visual-notebook-live"
            aria-label="Live saved figure"
          >
            <button onClick={() => setLiveId(null)}>Close live preview</button>
            <VisualInstanceView
              id={liveId}
              block={
                workspace.instances.find((instance) => instance.id === liveId)!
                  .block
              }
            />
          </section>
        )}
      <div className="visual-notebook-controls">
        <input
          aria-label="Search visual notebook"
          placeholder="Search visuals, annotations or tags"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Filter visual tags"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
        >
          <option value="">All tags</option>
          {tags.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={onlySaved}
            onChange={(event) => setOnlySaved(event.target.checked)}
          />
          Saved only
        </label>
        <span>{matches.length} visuals</span>
      </div>
      <div className="visual-notebook-layout">
        <div className="visual-gallery">
          {matches.map((instance) => {
            const thumbnail = workspace.preview(instance.id);
            return (
              <article
                key={instance.id}
                className={`visual-gallery-card ${selectedId === instance.id ? "selected" : ""}`}
              >
                <button
                  className="visual-gallery-open"
                  onClick={() => choose(instance)}
                >
                  {thumbnail ? (
                    <img
                      src={thumbnail}
                      alt={`Snapshot of ${instance.title ?? visualTitle(instance.block)}`}
                    />
                  ) : (
                    <div className="visual-gallery-type">
                      <span>
                        {
                          (
                            {
                              plot: "∿",
                              molecule: "◉",
                              diagram: "⇢",
                              "knowledge-graph": "⌘",
                              chemical: "⬡",
                              equation: "∑",
                              image: "▧",
                              exercise: "?",
                              text: "¶",
                            } as Record<string, string>
                          )[instance.block.type]
                        }
                      </span>
                      <small>{instance.block.type}</small>
                    </div>
                  )}
                  <strong>
                    {instance.title ?? visualTitle(instance.block)}
                  </strong>
                  <small>
                    {instance.tags.join(" · ") || "Untitled collection"} ·{" "}
                    {instance.annotations.length} annotations
                  </small>
                </button>
                <div className="visual-gallery-actions">
                  <button
                    onClick={() => {
                      workspace.activate(instance.id);
                      workspace.move(instance.id, "inline");
                      setAuthoring(false);
                      setLiveId(instance.id);
                      choose(instance);
                    }}
                  >
                    Open live
                  </button>
                  {onInsert && (
                    <button onClick={() => onInsert(instance)}>
                      Insert in lesson
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const copy = workspace.duplicate(instance.id);
                      if (copy) choose(copy);
                    }}
                  >
                    Duplicate
                  </button>
                </div>
              </article>
            );
          })}
          {!matches.length && (
            <div className="visual-notebook-empty">
              <h2>
                {search || tag
                  ? "No matching visuals"
                  : "Make a visual worth keeping."}
              </h2>
              <p>
                {search || tag
                  ? "Try another phrase or remove a filter."
                  : "Figures from your lessons appear here automatically. Save a figure, add tags, or choose Author a figure to build your own."}
              </p>
            </div>
          )}
        </div>
        <aside className="visual-notebook-inspector">
          {selected ? (
            <>
              <span className="visual-tag">{selected.block.type}</span>
              <label>
                Title
                <input
                  aria-label="Saved visual title"
                  value={selected.title ?? visualTitle(selected.block)}
                  onChange={(event) =>
                    workspace.update(selected.id, {
                      title: event.target.value.slice(0, 200),
                    })
                  }
                />
              </label>
              <label>
                Tags, separated by commas
                <input
                  aria-label="Saved visual tags"
                  value={selected.tags.join(", ")}
                  onChange={(event) =>
                    workspace.update(selected.id, {
                      tags: [
                        ...new Set(
                          event.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        ),
                      ].slice(0, 30),
                    })
                  }
                />
              </label>
              <div className="visual-notebook-metadata">
                <span>
                  Updated {new Date(selected.updatedAt).toLocaleString()}
                </span>
                <span>
                  {Object.keys(selected.state).length} saved state fields
                </span>
              </div>
              <h3>Annotations</h3>
              {selected.annotations.map((item) => (
                <div className="visual-annotation" key={item.id}>
                  <p>{item.text}</p>
                  <button
                    aria-label="Remove visual annotation"
                    onClick={() =>
                      workspace.update(selected.id, {
                        annotations: selected.annotations.filter(
                          (value) => value.id !== item.id,
                        ),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <textarea
                aria-label="Visual annotation"
                value={annotation}
                onChange={(event) => setAnnotation(event.target.value)}
                placeholder="An observation, interpretation, or question…"
                maxLength={10000}
              />
              <button
                disabled={!annotation.trim()}
                onClick={() => {
                  workspace.update(selected.id, {
                    annotations: [
                      ...selected.annotations,
                      {
                        id: crypto.randomUUID(),
                        text: annotation.trim(),
                        createdAt: new Date().toISOString(),
                      },
                    ],
                  });
                  setAnnotation("");
                }}
              >
                Add annotation
              </button>
              <div className="visual-notebook-actions">
                <button
                  onClick={() => {
                    setAuthoring(false);
                    setLiveId(selected.id);
                    workspace.move(selected.id, "fullscreen");
                  }}
                >
                  Inspect fullscreen
                </button>
                {onInsert && (
                  <button onClick={() => onInsert(selected)}>
                    Reuse in lesson
                  </button>
                )}
                {onLocateMessage && selected.originMessageId && (
                  <button
                    onClick={() => onLocateMessage(selected.originMessageId!)}
                  >
                    Open original explanation
                  </button>
                )}
                {(["json", "svg", "html"] as const).map((format) => (
                  <button
                    key={format}
                    onClick={() => workspace.exportVisual(selected.id, format)}
                  >
                    Export {format.toUpperCase()}
                  </button>
                ))}
              </div>
              <details>
                <summary>Edit authored visual specification</summary>
                <p className="visual-caption">
                  Only validated visual data is accepted. Source code cannot
                  run.
                </p>
                <textarea
                  aria-label="Edit visual specification"
                  value={specDraft}
                  onChange={(event) => setSpecDraft(event.target.value)}
                  maxLength={250000}
                />
                <label className="visual-spec-reset">
                  <input
                    type="checkbox"
                    checked={resetState}
                    onChange={(event) => setResetState(event.target.checked)}
                  />
                  Reset parameters and camera for the revised specification
                </label>
                {editError && (
                  <p className="notice error" role="alert">
                    {editError}
                  </p>
                )}
                <button
                  onClick={() => {
                    try {
                      const block = validateContentBlock(JSON.parse(specDraft));
                      if (!block)
                        throw new Error(
                          "The visual specification is invalid. Your saved visual has not changed.",
                        );
                      workspace.update(selected.id, {
                        block,
                        ...(resetState
                          ? {
                              state: resetVisualState(
                                selected.block,
                                block,
                                selected.state,
                              ),
                            }
                          : {}),
                      });
                      setEditError("");
                      workspace.status("Revised visual specification saved.");
                    } catch (error) {
                      setEditError(
                        error instanceof Error
                          ? error.message
                          : "This specification could not be read.",
                      );
                    }
                  }}
                >
                  Save visual specification
                </button>
              </details>
            </>
          ) : (
            <div className="visual-notebook-empty">
              <h3>Select a visual</h3>
              <p>
                Review its annotations, tag it, duplicate it, or open the same
                live instance.
              </p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
