import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  MarkerType,
  type Connection,
  type Node,
  type Edge,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  BookOpen,
  Check,
  CircleHelp,
  Network,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  Redo2,
  X,
} from "lucide-react";
import type {
  Concept,
  KnowledgeStatus,
  Lesson,
  Relation,
  StudioData,
} from "../types";
import "@xyflow/react/dist/style.css";
import "./KnowledgeGraph.css";
import { conceptFromEditor } from "../lib/graphConcept";

type Props = {
  startAdding?: boolean;
  defaultSubjectId?: string;
  concepts: Concept[];
  relations: Relation[];
  lessons: Lesson[];
  onChange: (concepts: Concept[], relations: Relation[]) => void;
  onDeleteConcept?: (concept: Concept) => Promise<void>;
  onOpenLesson: (id: string) => void;
  onLearn: (goal: string) => void;
  history?: NonNullable<StudioData["graphHistory"]>;
  onHistoryChange?: (history: NonNullable<StudioData["graphHistory"]>) => void;
};
const statuses: KnowledgeStatus[] = [
  "encountered",
  "unassessed",
  "partial",
  "demonstrated",
  "misconception",
  "review",
  "unresolved",
];
const statusName = (status: KnowledgeStatus) =>
  ({
    encountered: "Encountered",
    unassessed: "Not assessed",
    partial: "Partial understanding",
    demonstrated: "Demonstrated",
    misconception: "Misconception",
    review: "Needs review",
    unresolved: "Unresolved question",
  })[status];
const relationKinds: Relation["kind"][] = [
  "prerequisite",
  "related",
  "application",
  "analogy",
  "cross-disciplinary",
];
const statusColor = (status: KnowledgeStatus) =>
  status === "demonstrated"
    ? "var(--success)"
    : status === "misconception"
      ? "var(--danger)"
      : status === "partial" || status === "review"
        ? "var(--accent)"
        : "var(--muted)";
const humanKind = (kind: string) => kind.replaceAll("-", " ");

export default function KnowledgeGraph({
  startAdding,
  defaultSubjectId,
  concepts,
  relations,
  lessons,
  onChange,
  onDeleteConcept,
  onOpenLesson,
  onLearn,
  history: providedHistory,
  onHistoryChange,
}: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRelation, setSelectedRelation] = useState<string | null>(null);
  const [adding, setAdding] = useState(!!startAdding);
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<KnowledgeStatus>("unassessed");
  const [evidence, setEvidence] = useState("");
  const [notes, setNotes] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [relationKind, setRelationKind] = useState<Relation["kind"]>("related");
  const [linkTarget, setLinkTarget] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const [nodes, setNodes] = useState<Node[]>([]);
  const flow = useRef<ReactFlowInstance | null>(null);
  const positions = useRef<Record<string, { x: number; y: number }>>({});
  const [localHistory, setLocalHistory] = useState<
    NonNullable<StudioData["graphHistory"]>
  >({ past: [], future: [] });
  const history = providedHistory || localHistory;
  const setHistory = (next: NonNullable<StudioData["graphHistory"]>) => {
    setLocalHistory(next);
    onHistoryChange?.(next);
  };
  const commit = useCallback(
    (nextConcepts: Concept[], nextRelations: Relation[]) => {
      const next = {
        past: [
          ...history.past,
          {
            concepts: structuredClone(concepts),
            relations: structuredClone(relations),
          },
        ].slice(-30),
        future: [],
      };
      setLocalHistory(next);
      onHistoryChange?.(next);
      onChange(nextConcepts, nextRelations);
    },
    [concepts, relations, history, onHistoryChange, onChange],
  );
  const restore = (snapshot: {
    concepts: Concept[];
    relations: Relation[];
  }) => {
    positions.current = {};
    setSelectedId(null);
    setSelectedRelation(null);
    setAdding(false);
    onChange(
      snapshot.concepts.map((c) =>
        c.lessonId && !lessons.some((l) => l.id === c.lessonId)
          ? { ...c, lessonId: undefined }
          : c,
      ),
      snapshot.relations,
    );
  };
  const undo = () => {
    const previous = history.past.at(-1);
    if (!previous) return;
    setHistory({
      past: history.past.slice(0, -1),
      future: [
        {
          concepts: structuredClone(concepts),
          relations: structuredClone(relations),
        },
        ...history.future,
      ].slice(0, 30),
    });
    restore(previous);
  };
  const redo = () => {
    const next = history.future[0];
    if (!next) return;
    setHistory({
      past: [
        ...history.past,
        {
          concepts: structuredClone(concepts),
          relations: structuredClone(relations),
        },
      ].slice(-30),
      future: history.future.slice(1),
    });
    restore(next);
  };
  const selected = concepts.find((c) => c.id === selectedId);
  const relation = relations.find((r) => r.id === selectedRelation);
  const matching = useMemo(
    () =>
      concepts.filter(
        (c) =>
          (filter === "all" || c.status === filter) &&
          `${c.label} ${c.notes || ""} ${c.evidence}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [concepts, filter, search],
  );
  const visible = useMemo(() => matching.slice(0, 80), [matching]);
  const visibleIds = useMemo(
    () => new Set(visible.map((c) => c.id)),
    [visible],
  );
  const edges: Edge[] = useMemo(
    () =>
      relations
        .filter((r) => visibleIds.has(r.source) && visibleIds.has(r.target))
        .map((r) => ({
          id: r.id,
          source: r.source,
          target: r.target,
          label: humanKind(r.kind),
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed },
          style: {
            stroke:
              r.id === selectedRelation ? "var(--accent)" : "var(--border)",
            strokeWidth: r.id === selectedRelation ? 3 : 1.5,
          },
          labelStyle: { fill: "var(--muted)", fontSize: 10 },
          labelBgStyle: { fill: "var(--surface)" },
          animated: false,
        })),
    [relations, visibleIds, selectedRelation],
  );

  useEffect(() => {
    const depths = new Map(visible.map((c) => [c.id, 0]));
    // Bounded layering: cycles in manually entered relations never lock layout.
    for (let pass = 0; pass < 5; pass++) {
      for (const r of relations)
        if (
          r.kind === "prerequisite" &&
          visibleIds.has(r.source) &&
          visibleIds.has(r.target)
        )
          depths.set(
            r.target,
            Math.min(
              5,
              Math.max(
                depths.get(r.target) || 0,
                (depths.get(r.source) || 0) + 1,
              ),
            ),
          );
    }
    const groups = new Map<string, Concept[]>();
    for (const concept of visible) {
      const subject =
        lessons.find((l) => l.id === concept.lessonId)?.subject ||
        "Your concepts";
      groups.set(subject, [...(groups.get(subject) || []), concept]);
    }
    const arranged: Node[] = [];
    let offset = 0;
    for (const [subject, members] of groups) {
      const rows: Record<number, number> = {};
      if (groups.size > 1)
        arranged.push({
          id: `cluster-label-${subject}`,
          className: "ks-cluster-label",
          data: { label: subject.toUpperCase() },
          position: { x: 0, y: offset - 37 },
          draggable: false,
          selectable: false,
          connectable: false,
          style: {
            background: "transparent",
            border: 0,
            color: "var(--muted)",
            fontSize: 11,
            letterSpacing: "0.12em",
            textAlign: "left",
            width: 500,
            padding: 0,
            pointerEvents: "none",
          },
          type: "output",
        });
      for (const c of members) {
        const depth = depths.get(c.id) || 0;
        const row = rows[depth] || 0;
        rows[depth] = row + 1;
        arranged.push({
          id: c.id,
          data: {
            label: (
              <span className="ks-node">
                <span
                  className="ks-status-dot"
                  style={{ background: statusColor(c.status) }}
                />
                <span>
                  <strong>{c.label}</strong>
                  <small>{statusName(c.status)}</small>
                </span>
              </span>
            ),
          },
          position: c.position ||
            positions.current[c.id] || {
              x: depth * 260,
              y: offset + row * 112,
            },
          style: {
            background: "var(--surface)",
            color: "var(--text)",
            border: `1px solid ${c.id === selectedId ? "var(--accent)" : "var(--border)"}`,
            borderRadius: 12,
            width: 210,
            padding: 14,
            boxShadow:
              c.id === selectedId
                ? "0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent)"
                : "0 3px 14px #0000000a",
          },
          selected: c.id === selectedId,
        });
      }
      offset += Math.max(1, ...Object.values(rows)) * 112 + 80;
    }
    setNodes(arranged);
  }, [visible, visibleIds, relations, selectedId, lessons]);
  useEffect(() => {
    if (!nodes.length) return;
    // Fit newly added/removed nodes after React Flow measures them. Editing
    // evidence, selecting details, or dragging leaves the learner's pan intact.
    const timer = setTimeout(() => {
      void flow.current?.fitView({
        padding: 0.25,
        maxZoom: 1.1,
        duration: 180,
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [nodes.length]);

  const edit = (concept: Concept) => {
    setSelectedId(concept.id);
    setSelectedRelation(null);
    setAdding(false);
    setLabel(concept.label);
    setStatus(concept.status);
    setEvidence(concept.evidence);
    setNotes(concept.notes || "");
    setLessonId(concept.lessonId || "");
    setError("");
    setLinkTarget("");
  };
  const addRelation = useCallback(
    (source: string, target: string) => {
      if (!source || !target || source === target) {
        setError("Choose two different concepts.");
        return;
      }
      if (
        !concepts.some((c) => c.id === source) ||
        !concepts.some((c) => c.id === target)
      ) {
        setError("Both concepts must exist.");
        return;
      }
      if (
        relations.some(
          (r) =>
            r.source === source &&
            r.target === target &&
            r.kind === relationKind,
        )
      ) {
        setError("This connection already exists.");
        return;
      }
      commit(concepts, [
        ...relations,
        { id: crypto.randomUUID(), source, target, kind: relationKind },
      ]);
      setError("");
      setLinkTarget("");
    },
    [concepts, relations, relationKind, commit],
  );
  const connect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target)
        addRelation(connection.source, connection.target);
    },
    [addRelation],
  );
  const changeNodes = useCallback(
    (changes: NodeChange[]) =>
      setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );
  const save = () => {
    if (!label.trim()) {
      setError("Give the concept a name.");
      return;
    }
    if (status === "demonstrated" && !evidence.trim()) {
      setError(
        "Add evidence of understanding before marking this concept demonstrated.",
      );
      return;
    }
    const record = conceptFromEditor({
      adding,
      id: adding ? crypto.randomUUID() : selectedId!,
      selected: selected || undefined,
      label,
      status,
      evidence,
      notes,
      lessonId,
      defaultSubjectId,
      lessons,
    });
    commit(
      adding
        ? [...concepts, record]
        : concepts.map((c) => (c.id === record.id ? record : c)),
      relations,
    );
    setAdding(false);
    setSelectedId(record.id);
    setError("");
  };
  const remove = async () => {
    if (!selected || removing) return;
    if (selected.subjectId) {
      if (!onDeleteConcept) {
        setError(
          "This subject concept must be removed through its subject knowledge controls to preserve related evidence and revision history.",
        );
        return;
      }
      setRemoving(true);
      setError("");
      try {
        await onDeleteConcept(selected);
        setSelectedId(null);
        setSelectedRelation(null);
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "This concept could not be removed. Existing evidence and relationships remain available.",
        );
      } finally {
        setRemoving(false);
      }
      return;
    }
    commit(
      concepts.filter((c) => c.id !== selected.id),
      relations.filter(
        (r) => r.source !== selected.id && r.target !== selected.id,
      ),
    );
    setSelectedId(null);
  };
  const beginAdd = () => {
    setAdding(true);
    setSelectedId(null);
    setSelectedRelation(null);
    setLabel("");
    setStatus("unassessed");
    setEvidence("");
    setNotes("");
    setLessonId("");
    setError("");
  };

  return (
    <section
      className="ks-workspace"
      aria-label="Knowledge graph"
      onKeyDown={(e) => {
        if (
          (e.ctrlKey || e.metaKey) &&
          e.key.toLowerCase() === "z" &&
          !(e.target as HTMLElement).closest(
            "input,textarea,select,[contenteditable]",
          )
        ) {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        }
      }}
    >
      <header className="ks-header">
        <div>
          <span className="ks-eyebrow">YOUR LEARNING, CONNECTED</span>
          <h1>
            <Network size={25} />
            Knowledge graph
          </h1>
          <p>Connect ideas. Keep the evidence behind your understanding.</p>
        </div>
        <button className="ks-primary" onClick={beginAdd}>
          <Plus size={16} />
          Add concept
        </button>
      </header>
      <div className="ks-toolbar">
        <label className="ks-search">
          <Search size={16} />
          <input
            aria-label="Search concepts"
            placeholder="Find a concept or connection…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter knowledge status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All knowledge states</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {statusName(s)}
            </option>
          ))}
        </select>
        <button
          aria-label="Undo graph change"
          title="Undo the last graph edit"
          disabled={!history.past.length}
          onClick={undo}
        >
          <Undo2 size={15} />
        </button>
        <button
          aria-label="Redo graph change"
          title="Redo the last undone graph edit"
          disabled={!history.future.length}
          onClick={redo}
        >
          <Redo2 size={15} />
        </button>
        <span className="ks-count">
          {visible.length} of {concepts.length} concepts
        </span>
      </div>
      {matching.length > 80 && (
        <p className="ks-notice">
          Showing 80 concepts for a readable view. Search or filter to explore
          the rest.
        </p>
      )}
      <div
        className={`ks-body ${selected || adding || relation ? "ks-with-details" : ""}`}
      >
        <div className="ks-canvas">
          {visible.length > 0 ? (
            <ReactFlow
              onInit={(instance) => {
                flow.current = instance;
              }}
              nodes={nodes}
              edges={edges}
              onNodesChange={changeNodes}
              onConnect={connect}
              onNodeClick={(_, node) => {
                const concept = concepts.find((c) => c.id === node.id);
                if (concept) edit(concept);
              }}
              onEdgeClick={(_, edge) => {
                setSelectedRelation(edge.id);
                setSelectedId(null);
                setAdding(false);
              }}
              onNodeDragStop={(_, node) => {
                positions.current[node.id] = node.position;
                commit(
                  concepts.map((c) =>
                    c.id === node.id
                      ? {
                          ...c,
                          position: { x: node.position.x, y: node.position.y },
                        }
                      : c,
                  ),
                  relations,
                );
              }}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
              minZoom={0.15}
              maxZoom={2.2}
              deleteKeyCode={null}
              nodesConnectable
              aria-label="Interactive concept graph"
            >
              <Background color="var(--border)" gap={24} />
              <Controls showInteractive={false} />
              <MiniMap
                nodeColor="var(--accent)"
                maskColor="color-mix(in srgb, var(--bg) 70%, transparent)"
                pannable
                zoomable
              />
            </ReactFlow>
          ) : (
            <div className="ks-empty">
              <div className="ks-empty-icon">
                <Network size={38} />
              </div>
              <h2>
                {concepts.length
                  ? "No matching concepts"
                  : "Ideas become a map"}
              </h2>
              <p>
                {concepts.length
                  ? "Try a different search or knowledge state."
                  : "Add concepts as you learn, then connect prerequisites, applications, and related ideas. A mention never implies mastery."}
              </p>
              <button className="ks-primary" onClick={beginAdd}>
                <Plus size={16} />
                Add your first concept
              </button>
            </div>
          )}
          <div className="ks-canvas-hint">
            Drag to arrange · Scroll to zoom · Connect node handles to link
            ideas
          </div>
        </div>
        {(selected || adding) && (
          <aside
            className="ks-details"
            aria-label={adding ? "New concept" : "Concept details"}
            aria-busy={removing}
          >
            <div className="ks-detail-heading">
              <span className="ks-eyebrow">
                {adding ? "NEW CONCEPT" : "CONCEPT DETAILS"}
              </span>
              <button
                aria-label="Close concept details"
                onClick={() => {
                  setSelectedId(null);
                  setAdding(false);
                }}
              >
                <X size={16} />
              </button>
            </div>
            <label>
              Concept name
              <input
                aria-label="Concept name"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Conservation of energy"
              />
            </label>
            <label>
              Understanding
              <select
                aria-label="Concept understanding"
                value={status}
                onChange={(e) => setStatus(e.target.value as KnowledgeStatus)}
              >
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {statusName(s)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Evidence
              <textarea
                aria-label="Evidence of understanding"
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                rows={4}
                placeholder="An explanation, solved problem, or observation that supports this state."
              />
            </label>
            <p className="ks-help">
              <CircleHelp size={13} />
              Encountering an idea and demonstrating understanding are recorded
              separately.
            </p>
            <label>
              Notes & unresolved questions
              <textarea
                aria-label="Concept notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="What would you like to revisit?"
              />
            </label>
            <label>
              Linked lesson
              <select
                aria-label="Linked lesson"
                value={lessonId}
                onChange={(e) => setLessonId(e.target.value)}
              >
                <option value="">No linked lesson</option>
                {lessons.map((l) => (
                  <option value={l.id} key={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <p role="alert" className="ks-error">
                {error}
              </p>
            )}
            {removing && (
              <p role="status">
                Removing this concept through its subject revision history…
              </p>
            )}
            <button
              className="ks-primary ks-full"
              onClick={save}
              disabled={removing}
            >
              <Check size={15} />
              {adding ? "Create concept" : "Save changes"}
            </button>
            {selected && (
              <>
                <div className="ks-detail-actions">
                  <button onClick={() => onLearn(selected.label)}>
                    <BookOpen size={14} />
                    Explore concept
                  </button>
                  {selected.lessonId &&
                    lessons.some((l) => l.id === selected.lessonId) && (
                      <button onClick={() => onOpenLesson(selected.lessonId!)}>
                        Open linked lesson
                      </button>
                    )}
                </div>
                <div className="ks-section-label">ADD A CONNECTION</div>
                <select
                  aria-label="Connection type"
                  value={relationKind}
                  onChange={(e) =>
                    setRelationKind(e.target.value as Relation["kind"])
                  }
                >
                  {relationKinds.map((k) => (
                    <option key={k} value={k}>
                      {humanKind(k)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Connect to concept"
                  value={linkTarget}
                  onChange={(e) => setLinkTarget(e.target.value)}
                >
                  <option value="">Choose another concept…</option>
                  {concepts
                    .filter((c) => c.id !== selected.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                </select>
                <button
                  disabled={!linkTarget}
                  onClick={() => addRelation(selected.id, linkTarget)}
                >
                  Connect concepts
                </button>
                <div className="ks-section-label">KNOWLEDGE CONTROLS</div>
                <button
                  onClick={() => {
                    commit(
                      concepts.map((c) =>
                        c.id === selected.id
                          ? { ...c, status: "unassessed", evidence: "" }
                          : c,
                      ),
                      relations,
                    );
                    setStatus("unassessed");
                    setEvidence("");
                    setError("");
                  }}
                >
                  <RotateCcw size={14} />
                  Reset understanding & evidence
                </button>
                <button
                  className="ks-danger"
                  onClick={() => void remove()}
                  disabled={removing}
                >
                  <Trash2 size={14} />
                  Remove concept and connections
                </button>
              </>
            )}
          </aside>
        )}
        {relation && (
          <aside className="ks-details" aria-label="Connection details">
            <div className="ks-detail-heading">
              <span className="ks-eyebrow">CONNECTION</span>
              <button
                aria-label="Close connection details"
                onClick={() => setSelectedRelation(null)}
              >
                <X size={16} />
              </button>
            </div>
            <h2>{concepts.find((c) => c.id === relation.source)?.label}</h2>
            <p className="ks-relationship">{humanKind(relation.kind)} →</p>
            <h2>{concepts.find((c) => c.id === relation.target)?.label}</h2>
            <p className="ks-help">
              A prerequisite points from the foundation to the concept that
              builds on it.
            </p>
            <label>
              Relationship
              <select
                value={relation.kind}
                aria-label="Edit connection type"
                onChange={(e) =>
                  commit(
                    concepts,
                    relations.map((r) =>
                      r.id === relation.id
                        ? { ...r, kind: e.target.value as Relation["kind"] }
                        : r,
                    ),
                  )
                }
              >
                {relationKinds.map((k) => (
                  <option key={k} value={k}>
                    {humanKind(k)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="ks-danger"
              onClick={() => {
                commit(
                  concepts,
                  relations.filter((r) => r.id !== relation.id),
                );
                setSelectedRelation(null);
              }}
            >
              <Trash2 size={14} />
              Remove connection
            </button>
          </aside>
        )}
      </div>
      <footer className="ks-legend">
        {statuses.map((s) => (
          <span key={s}>
            <i style={{ background: statusColor(s) }} />
            {statusName(s)}
          </span>
        ))}
      </footer>
    </section>
  );
}
