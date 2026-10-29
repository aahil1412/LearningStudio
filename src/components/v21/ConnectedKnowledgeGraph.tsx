import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import {
  BookOpen,
  Focus,
  Network,
  Search,
  X,
  Filter,
  Pin,
  RefreshCw,
  ArrowUpRight,
  ChevronDown,
  Link2,
} from "lucide-react";
import KnowledgeGraph from "../KnowledgeGraph";
import type {
  Concept,
  Lesson,
  LibraryItem,
  Relation,
  StudioData,
} from "../../types";
import type {
  ConnectedGraph,
  ConnectedGraphLink,
  ConnectedGraphNode,
} from "../../annotationTypes";
import { invoke, isDesktop } from "../../lib/bridge";
import {
  graphDegrees,
  connectedGraphViewport,
  layoutConnectedGraph,
  sortGraphNodes,
  type GraphSort,
} from "../../lib/connectedGraph";
import "./connected-graph.css";

type Props = {
  concepts: Concept[];
  relations: Relation[];
  lessons: Lesson[];
  library?: LibraryItem[];
  subjectId?: string;
  onChange: (concepts: Concept[], relations: Relation[]) => void;
  onDeleteConcept?: (concept: Concept) => Promise<void>;
  onOpenLesson: (id: string) => void;
  onOpenSource?: (id: string, messageId?: string) => void;
  onLearn: (goal: string) => void;
  history?: NonNullable<StudioData["graphHistory"]>;
  onHistoryChange?: (history: NonNullable<StudioData["graphHistory"]>) => void;
};
const colors = {
  concept: "var(--graph-concept, var(--accent))",
  lesson: "var(--graph-lesson, var(--success))",
  note: "var(--graph-note, var(--warning))",
};
const empty: ConnectedGraph = {
  nodes: [],
  links: [],
  positions: {},
  totalNodes: 0,
  truncated: false,
};
type DotData = {
  label: string;
  kind: ConnectedGraphNode["kind"];
  degree: number;
  pinned: boolean;
  showLabel: boolean;
  active: boolean;
  dimmed: boolean;
};
const DotNode = memo(function DotNode({
  data,
  selected,
}: NodeProps<Node<DotData>>) {
  return (
    <div
      className={`connected-dot-node node-${data.kind} ${data.showLabel ? "show-label" : ""} ${selected || data.active ? "is-active" : ""} ${data.dimmed ? "is-dimmed" : ""}`}
      style={
        {
          "--node-color": colors[data.kind],
          "--node-size": `${Math.min(29, 14 + Math.sqrt(data.degree) * 2)}px`,
        } as React.CSSProperties
      }
    >
      <Handle type="target" position={Position.Left} />
      <span className="connected-dot" aria-hidden="true" />
      <span className="connected-dot-caption">
        <strong>{data.label}</strong>
        {data.pinned && <Pin size={10} aria-label="Pinned" />}
      </span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
const nodeTypes = { knowledge: DotNode };
const kinds: ConnectedGraphNode["kind"][] = ["concept", "lesson", "note"];
const kindLabels = { concept: "Concepts", lesson: "Lessons", note: "Notes" };
const relationLabel = (kind: string) => kind.replaceAll("-", " ");
const nodePositionKey = (
  entries: { id: string; position: { x: number; y: number } }[],
) =>
  entries
    .map((node) => `${node.id}:${node.position.x},${node.position.y}`)
    .join("|");

function GraphViewport({
  positions,
  revision,
  showLabels,
}: {
  positions: Record<string, { x: number; y: number }>;
  revision: string;
  showLabels: boolean;
}) {
  const { setViewport, viewportInitialized } = useReactFlow();
  const initialized = useNodesInitialized(),
    width = useStore((state) => state.width),
    height = useStore((state) => state.height),
    adoptedPositions = useStore((state) => nodePositionKey(state.nodes));
  const expectedPositions = useMemo(
    () =>
      nodePositionKey(
        Object.entries(positions).map(([id, position]) => ({ id, position })),
      ),
    [positions],
  );
  const fitted = useRef("");
  useEffect(() => {
    // The parent replaces controlled nodes after a query/layout change. Wait
    // for that exact set to reach React Flow, not an arbitrary timer or the
    // preceding graph's already-initialized nodes.
    if (
      !initialized ||
      !viewportInitialized ||
      adoptedPositions !== expectedPositions
    )
      return;
    const key = `${revision}:${width}:${height}:${showLabels}`;
    if (fitted.current === key) return;
    const viewport = connectedGraphViewport(
      positions,
      width,
      height,
      showLabels,
    );
    if (!viewport) return;
    const frame = requestAnimationFrame(() => {
      const duration = fitted.current ? 180 : 0;
      fitted.current = key;
      void setViewport(viewport, { duration });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    initialized,
    viewportInitialized,
    adoptedPositions,
    expectedPositions,
    positions,
    revision,
    width,
    height,
    showLabels,
    setViewport,
  ]);
  return null;
}
export default function ConnectedKnowledgeGraph(props: Props) {
  const [view, setView] = useState<"connected" | "edit">("connected"),
    [startAdding, setStartAdding] = useState(false);
  const [scope, setScope] = useState<"subject" | "all">(
    props.subjectId ? "subject" : "all",
  );
  const [query, setQuery] = useState(""),
    [keywords, setKeywords] = useState<string[]>([]),
    [newKeyword, setNewKeyword] = useState("");
  const [keywordMode, setKeywordMode] = useState<"any" | "all">("any"),
    [nodeKinds, setNodeKinds] = useState([...kinds]);
  const [linkKinds, setLinkKinds] = useState<string[]>([]),
    [suggested, setSuggested] = useState(true),
    [hideIsolated, setHideIsolated] = useState(false);
  const [sort, setSort] = useState<GraphSort>("connections"),
    [limit, setLimit] = useState(120),
    [hops, setHops] = useState<1 | 2>(1);
  const [focus, setFocus] = useState<string>(),
    [selectedId, setSelectedId] = useState<string>(),
    [selectedEdge, setSelectedEdge] = useState<string>();
  const [graph, setGraph] = useState(empty),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [nodes, setNodes] = useState<Node<DotData>[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(true),
    [labels, setLabels] = useState<"auto" | "all" | "focus">("auto"),
    [edgeLabels, setEdgeLabels] = useState(false),
    [layoutRevision, setLayoutRevision] = useState(0);
  const lastFittedRequest = useRef("");
  const [fitRevision, setFitRevision] = useState(0);
  const [tracking, setTracking] = useState(false);
  const positionWrites = useRef(new Map<string, Promise<void>>());
  const sequence = useRef(0),
    subjectId = scope === "subject" ? props.subjectId : undefined;
  const selected = graph.nodes.find((node) => node.id === selectedId) || null;
  const degree = useMemo(() => graphDegrees(graph), [graph]);
  const refresh = useCallback(async () => {
    if (!isDesktop) return;
    const request = ++sequence.current;
    setLoading(true);
    try {
      const value = await invoke<ConnectedGraph>("graph:get", {
        subjectId,
        query,
        keywords,
        keywordMode,
        nodeKinds,
        linkKinds,
        includeSuggested: suggested,
        sort,
        focusId: focus,
        limit,
        hops,
        hideIsolated,
      });
      if (request !== sequence.current) return;
      setGraph(value);
      const stamp = JSON.stringify({
        subjectId,
        query,
        keywords,
        keywordMode,
        nodeKinds,
        linkKinds,
        suggested,
        sort,
        focus,
        limit,
        hops,
        hideIsolated,
      });
      if (stamp !== lastFittedRequest.current) {
        lastFittedRequest.current = stamp;
        setFitRevision((value) => value + 1);
      }
      setSelectedId((current) =>
        value.nodes.some((node) => node.id === current) ? current : undefined,
      );
      setSelectedEdge((current) =>
        value.links.some((link) => link.id === current) ? current : undefined,
      );
      setError("");
    } catch (e) {
      if (request === sequence.current)
        setError(
          e instanceof Error ? e.message : "The graph could not be loaded.",
        );
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [
    subjectId,
    query,
    keywords,
    keywordMode,
    nodeKinds,
    linkKinds,
    suggested,
    sort,
    focus,
    limit,
    hops,
    hideIsolated,
  ]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    // Expose the pending view immediately. Otherwise the preceding, already
    // fitted subgraph appears ready during the debounce/IPC interval and can
    // move under a pointer when the requested layout finally arrives.
    setLoading(true);
    const timer = setTimeout(() => void refresh(), 180);
    return () => clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    if (!isDesktop) return;
    const timer = setTimeout(
      () =>
        void invoke("graph:suggest", { subjectId })
          .then(() => refreshRef.current())
          .catch(() => {}),
      160,
    );
    return () => clearTimeout(timer);
  }, [subjectId, props.library, props.concepts, props.lessons]);
  useEffect(() => {
    setSelectedId(undefined);
    setSelectedEdge(undefined);
    setFocus(undefined);
  }, [props.subjectId]);
  const positions = useMemo(
    () => layoutConnectedGraph(graph),
    [graph, layoutRevision],
  );
  const neighborhood = useMemo(() => {
    if (!selectedId) return null;
    const ids = new Set([selectedId]);
    for (const edge of graph.links) {
      if (edge.source === selectedId) ids.add(edge.target);
      if (edge.target === selectedId) ids.add(edge.source);
    }
    return ids;
  }, [selectedId, graph]);
  useEffect(
    () =>
      setNodes(
        graph.nodes.map((node) => ({
          id: node.id,
          type: "knowledge",
          position: positions[node.id] || { x: 0, y: 0 },
          initialWidth: 40,
          initialHeight: 40,
          ariaLabel: `${node.kind}: ${node.label}`,
          data: {
            label: node.label,
            kind: node.kind,
            degree: degree.get(node.id) || 0,
            pinned: !!graph.positions[node.id]?.pinned,
            showLabel:
              labels === "all" ||
              (labels === "auto" && graph.nodes.length <= 55),
            active: node.id === selectedId,
            dimmed: !!neighborhood && !neighborhood.has(node.id),
          },
          className: node.id === selectedId ? "knowledge-node-selected" : "",
          style: {
            width: 40,
            height: 40,
            background: "transparent",
            border: "none",
            padding: 0,
          },
        })),
      ),
    [graph, positions, degree, labels, selectedId, neighborhood],
  );
  const edges = useMemo<Edge[]>(
    () =>
      graph.links.map((link) => ({
        id: link.id,
        source: link.source,
        target: link.target,
        label: edgeLabels ? relationLabel(link.kind) : undefined,
        type: "straight",
        className: `knowledge-link ${link.state === "suggested" ? "is-suggested" : ""}`,
        style: {
          stroke:
            link.id === selectedEdge ? "var(--accent)" : "var(--secondary)",
          strokeWidth:
            link.id === selectedEdge
              ? 2.7
              : link.kind === "co-mentioned"
                ? 1.1
                : 1.5,
          strokeDasharray: link.state === "suggested" ? "5 6" : undefined,
          opacity: selectedId
            ? link.source === selectedId || link.target === selectedId
              ? 0.9
              : 0.12
            : link.state === "suggested"
              ? 0.45
              : 0.5,
        },
        labelStyle: { fill: "var(--secondary)", fontSize: 12 },
        labelBgStyle: { fill: "var(--surface)" },
        interactionWidth: 15,
      })),
    [graph, edgeLabels, selectedEdge, selectedId],
  );
  const listed = useMemo(
    () => sortGraphNodes(graph.nodes, graph, sort, query),
    [graph, sort, query],
  );
  const selectedBacklinks = selected
    ? graph.backlinks?.[selected.id] ||
      graph.links
        .filter(
          (link) => link.source === selected.id || link.target === selected.id,
        )
        .flatMap((link) => {
          const node = graph.nodes.find(
            (node) =>
              node.id ===
              (link.source === selected.id ? link.target : link.source),
          );
          return node ? [{ node, link }] : [];
        })
    : [];
  const selectedLinks = selectedBacklinks.map((entry) => entry.link);
  const openSource = (node: ConnectedGraphNode, messageId?: string) => {
    const lesson = node.kind === "lesson" ? node.sourceId : node.conversationId;
    if (lesson) {
      if (props.onOpenSource)
        props.onOpenSource(lesson, messageId || node.messageId);
      else props.onOpenLesson(lesson);
    } else if (node.kind === "note")
      document.dispatchEvent(
        new CustomEvent("studio:open-library-item", {
          detail: { id: node.sourceId },
        }),
      );
  };
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const savePosition = (
    nodeId: string,
    position: { x: number; y: number },
    pinned = true,
  ) => {
    const source = graph.nodes.find((item) => item.id === nodeId);
    if (!source?.subjectId) return;
    const key = `${nodeId}:${position.x}:${position.y}:${pinned}`;
    if (positionWrites.current.has(key)) return;
    const write = act(() =>
      invoke("graph:position", {
        subjectId: source.subjectId,
        nodeId,
        x: position.x,
        y: position.y,
        pinned,
      }),
    ).finally(() => positionWrites.current.delete(key));
    positionWrites.current.set(key, write);
  };
  const choose = (id: string) => {
    setSelectedId(id);
    setSelectedEdge(undefined);
  };
  const focusOn = (id: string) => {
    setQuery("");
    setKeywords([]);
    setFocus(id);
  };
  const toggleKeyword = (value: string) =>
    setKeywords((previous) =>
      previous.includes(value)
        ? previous.filter((item) => item !== value)
        : previous.length < 12
          ? [...previous, value]
          : previous,
    );
  const resetFilters = () => {
    setQuery("");
    setKeywords([]);
    setNodeKinds([...kinds]);
    setLinkKinds([]);
    setFocus(undefined);
    setHideIsolated(false);
    setSuggested(true);
  };
  const trackSelected = async () => {
    if (!selected?.derived || !selected.subjectId || tracking) return;
    setTracking(true);
    try {
      const current = await invoke<{
        subject: { revision: number };
        concepts: { id: string; label: string }[];
      }>("subject:get", { subjectId: selected.subjectId });
      const alreadyTracked = current.concepts.some(
        (concept) =>
          concept.id === selected.sourceId ||
          concept.label.normalize("NFKC").trim().toLocaleLowerCase() ===
            selected.label.normalize("NFKC").trim().toLocaleLowerCase(),
      );
      if (alreadyTracked) {
        await refresh();
        return;
      }
      await invoke("subject:apply", {
        subjectId: selected.subjectId,
        baseRevision: current.subject.revision,
        origin: "learner",
        label: "Track encountered concept",
        operations: [
          {
            entity: "concept",
            op: "put",
            id: selected.sourceId,
            value: {
              label: selected.label,
              notes: selected.definition,
              status: "unassessed",
              coverage: "introduced",
              evidence:
                "Encountered in a saved explanation. No learner assessment is recorded.",
              lessonId: selected.conversationId,
            },
          },
        ],
      });
      const canonical = await invoke<StudioData>("data:load");
      props.onChange(
        canonical.concepts.map((concept) =>
          concept.id === selected.sourceId
            ? { ...concept, notes: selected.definition }
            : concept,
        ),
        canonical.relations,
      );
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setTracking(false);
    }
  };
  const review = (link: ConnectedGraphLink, state: "accepted" | "rejected") =>
    void act(() =>
      invoke("graph:review", {
        subjectId: link.ownerSubjectId || selected?.subjectId,
        id: link.id,
        state,
      }),
    );
  return (
    <section className="connected-graph" aria-label="Connected knowledge graph">
      <header className="connected-toolbar">
        <div className="connected-title">
          <Network size={22} />
          <div>
            <h2>Knowledge connections</h2>
            <p>Your subjects, sources and ideas in one connected map.</p>
          </div>
        </div>
        <nav aria-label="Graph views">
          <button
            className={view === "connected" ? "active" : ""}
            onClick={() => setView("connected")}
          >
            Connected view
          </button>
          {view === "connected" && (
            <button
              onClick={() => {
                setStartAdding(true);
                setView("edit");
              }}
            >
              Add concept
            </button>
          )}
          <button
            className={view === "edit" ? "active" : ""}
            onClick={() => {
              setStartAdding(false);
              setView("edit");
            }}
          >
            Edit concepts & relations
          </button>
        </nav>
      </header>
      {view === "edit" || !isDesktop ? (
        <KnowledgeGraph
          {...props}
          startAdding={startAdding}
          defaultSubjectId={scope === "subject" ? props.subjectId : undefined}
        />
      ) : (
        <>
          <div className="connected-searchbar">
            <button
              aria-label="Toggle graph filters"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <Filter size={16} />
              Filters
            </button>
            <label className="connected-search">
              <Search size={17} />
              <input
                aria-label="Search connected graph"
                placeholder="Search concepts, lessons and notes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  aria-label="Clear graph search"
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
                </button>
              )}
            </label>
            <select
              aria-label="Graph scope"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as typeof scope);
                setSelectedId(undefined);
                setFocus(undefined);
              }}
            >
              {props.subjectId && (
                <option value="subject">Current subject</option>
              )}
              <option value="all">All subjects</option>
            </select>
            <button
              className="connected-icon-button"
              title="Refresh connections"
              aria-label="Refresh connections"
              onClick={() => void refresh()}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          <div className="connected-status">
            <span aria-live="polite">
              {loading
                ? "Updating map…"
                : `${graph.nodes.length} shown · ${graph.availableNodes ?? graph.totalNodes} items in scope`}
              {graph.matchedNodes !== undefined
                ? ` · ${graph.matchedNodes} direct matches`
                : ""}
            </span>
            <span>
              {graph.links.length} connections
              {graph.truncated ? " · Focus or filter to reveal more" : ""}
            </span>
          </div>
          {(focus || keywords.length > 0) && (
            <div className="connected-active-filters">
              {focus && (
                <button onClick={() => setFocus(undefined)}>
                  Focused neighborhood <X size={12} />
                </button>
              )}
              {keywords.map((keyword) => (
                <button key={keyword} onClick={() => toggleKeyword(keyword)}>
                  {keyword}
                  <X size={12} />
                </button>
              ))}
              <button className="text-button" onClick={resetFilters}>
                Clear filters
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="notice error">
              {error}
              <button onClick={() => void refresh()}>Retry graph</button>
            </p>
          )}
          <div className="connected-body">
            {filtersOpen && (
              <aside
                className="connected-filter-panel"
                aria-label="Graph filters and results"
              >
                <div className="connected-panel-section">
                  <h3>Explore</h3>
                  <label className="connected-select-label">
                    Sort items
                    <select
                      aria-label="Sort graph items"
                      value={sort}
                      onChange={(e) => setSort(e.target.value as GraphSort)}
                    >
                      <option value="connections">Most connected</option>
                      <option value="alphabetical">Alphabetical</option>
                      <option value="recent">Recently changed</option>
                      <option value="subject">Subject</option>
                      <option value="type">Item type</option>
                      <option value="relevance">Search relevance</option>
                    </select>
                  </label>
                  <div className="connected-kind-filters">
                    {kinds.map((kind) => (
                      <label key={kind} className={`kind-${kind}`}>
                        <input
                          type="checkbox"
                          checked={nodeKinds.includes(kind)}
                          disabled={
                            nodeKinds.length === 1 && nodeKinds.includes(kind)
                          }
                          onChange={() =>
                            setNodeKinds((previous) =>
                              previous.includes(kind)
                                ? previous.filter((item) => item !== kind)
                                : [...previous, kind],
                            )
                          }
                        />
                        <span
                          className="connected-kind-dot"
                          style={{ background: colors[kind] }}
                        />
                        {kindLabels[kind]}
                      </label>
                    ))}
                  </div>
                </div>
                <details className="connected-panel-section" open>
                  <summary>
                    Keywords <ChevronDown size={14} />
                  </summary>
                  <p>Select several terms to narrow the map.</p>
                  <div className="connected-keywords">
                    {(graph.keywords || []).slice(0, 20).map((item) => (
                      <button
                        key={item.keyword}
                        aria-pressed={keywords.includes(item.keyword)}
                        onClick={() => toggleKeyword(item.keyword)}
                      >
                        {item.keyword}
                        <span>{item.count}</span>
                      </button>
                    ))}
                  </div>
                  <form
                    className="connected-keyword-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const value = newKeyword
                        .trim()
                        .slice(0, 80)
                        .toLocaleLowerCase();
                      if (value) {
                        toggleKeyword(value);
                        setNewKeyword("");
                      }
                    }}
                  >
                    <input
                      aria-label="Add graph keyword"
                      placeholder="Add a keyword"
                      value={newKeyword}
                      onChange={(e) => setNewKeyword(e.target.value)}
                      maxLength={80}
                    />
                    <button
                      disabled={!newKeyword.trim() || keywords.length >= 12}
                    >
                      Add
                    </button>
                  </form>
                  <select
                    aria-label="Match selected keywords"
                    value={keywordMode}
                    onChange={(e) =>
                      setKeywordMode(e.target.value as typeof keywordMode)
                    }
                  >
                    <option value="any">Any keyword</option>
                    <option value="all">All keywords</option>
                  </select>
                </details>
                <details className="connected-panel-section">
                  <summary>
                    Map settings <ChevronDown size={14} />
                  </summary>
                  <label>
                    Visible nodes
                    <select
                      aria-label="Maximum visible graph nodes"
                      value={limit}
                      onChange={(e) => setLimit(Number(e.target.value))}
                    >
                      {[60, 120, 240, 400].map((value) => (
                        <option key={value} value={value}>
                          {value} nodes
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Node labels
                    <select
                      aria-label="Graph node labels"
                      value={labels}
                      onChange={(e) =>
                        setLabels(e.target.value as typeof labels)
                      }
                    >
                      <option value="auto">Automatic</option>
                      <option value="all">Show all</option>
                      <option value="focus">On hover or selection</option>
                    </select>
                  </label>
                  <label>
                    Focus radius
                    <select
                      aria-label="Graph focus radius"
                      value={hops}
                      onChange={(e) => setHops(Number(e.target.value) as 1 | 2)}
                    >
                      <option value={1}>Direct connections</option>
                      <option value={2}>Two connections away</option>
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={suggested}
                      onChange={(e) => setSuggested(e.target.checked)}
                    />
                    Show suggested links
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={hideIsolated}
                      onChange={(e) => setHideIsolated(e.target.checked)}
                    />
                    Hide unconnected items
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={edgeLabels}
                      onChange={(e) => setEdgeLabels(e.target.checked)}
                    />
                    Show relationship labels
                  </label>
                  <button
                    onClick={() => setLayoutRevision((value) => value + 1)}
                  >
                    Reflow unpinned nodes
                  </button>
                  <div className="connected-relations">
                    <h4>Connection types</h4>
                    {(graph.relationTypes || []).map((item) => (
                      <label key={item.kind}>
                        <input
                          type="checkbox"
                          checked={
                            !linkKinds.length || linkKinds.includes(item.kind)
                          }
                          onChange={() =>
                            setLinkKinds((previous) => {
                              const all = (graph.relationTypes || []).map(
                                  (item) => item.kind,
                                ),
                                current = previous.length ? previous : all;
                              const next = current.includes(item.kind)
                                ? current.filter((kind) => kind !== item.kind)
                                : [...current, item.kind];
                              return next.length === all.length
                                ? []
                                : next.length
                                  ? next
                                  : previous;
                            })
                          }
                        />
                        {relationLabel(item.kind)}
                        <span>{item.count}</span>
                      </label>
                    ))}
                  </div>
                </details>
                <div
                  className="connected-node-list"
                  role="group"
                  aria-label="Graph items"
                >
                  {listed.map((node) => (
                    <button
                      key={node.id}
                      className={selectedId === node.id ? "selected" : ""}
                      aria-pressed={selectedId === node.id}
                      onClick={() => choose(node.id)}
                    >
                      <span
                        className="connected-kind-dot"
                        style={{ background: colors[node.kind] }}
                      />
                      <span>
                        <strong>{node.label}</strong>
                        <small>{node.subjectName || node.kind}</small>
                      </span>
                      <span className="connected-degree" title="Connections">
                        {degree.get(node.id) || 0}
                      </span>
                    </button>
                  ))}
                </div>
              </aside>
            )}
            <div className="connected-flow">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={(changes) => {
                  setNodes((previous) => applyNodeChanges(changes, previous));
                  for (const change of changes)
                    if (
                      change.type === "position" &&
                      change.position &&
                      change.dragging === false
                    )
                      savePosition(change.id, change.position);
                }}
                onNodeClick={(_, node) => choose(node.id)}
                onNodeDoubleClick={(_, node) => focusOn(node.id)}
                onPaneClick={() => {
                  setSelectedId(undefined);
                  setSelectedEdge(undefined);
                }}
                onEdgeClick={(_, edge) => {
                  setSelectedEdge(edge.id);
                  const source = graph.links.find(
                    (item) => item.id === edge.id,
                  )?.source;
                  if (source) setSelectedId(source);
                }}
                onNodeDragStop={(_, node) => {
                  savePosition(node.id, node.position);
                }}
                minZoom={0.001}
                maxZoom={2.5}
                nodesConnectable={false}
                onlyRenderVisibleElements={graph.nodes.length > 80}
              >
                <GraphViewport
                  positions={positions}
                  revision={`${fitRevision}:${layoutRevision}`}
                  showLabels={
                    labels === "all" ||
                    (labels === "auto" && graph.nodes.length <= 55)
                  }
                />
                <Background color="var(--border)" gap={30} size={1} />
                <Controls
                  fitViewOptions={{
                    padding: 0.28,
                    minZoom: 0.001,
                    maxZoom: 1.25,
                  }}
                />
                <MiniMap
                  nodeColor={(node) =>
                    colors[(node.data as DotData).kind] || colors.concept
                  }
                  maskColor="color-mix(in srgb,var(--surface) 75%,transparent)"
                  pannable
                  zoomable
                />
              </ReactFlow>
              <div className="connected-map-legend">
                {kinds.map((kind) => (
                  <span key={kind}>
                    <i style={{ background: colors[kind] }} />
                    {kindLabels[kind]}
                  </span>
                ))}
                <span className="connected-suggestion-key">Suggested link</span>
              </div>
              {!nodes.length && !loading && (
                <div className="connected-empty">
                  <Network size={38} />
                  <h3>
                    {query || keywords.length
                      ? "No matching connections"
                      : "Your connected learning library"}
                  </h3>
                  <p>
                    {query || keywords.length
                      ? "Try fewer keywords or a broader scope. Your records are unchanged."
                      : "Concepts, saved notes and source lessons connect automatically where the source provides a real association."}
                  </p>
                  {(query || keywords.length > 0) && (
                    <button onClick={resetFilters}>Clear filters</button>
                  )}
                </div>
              )}
            </div>
            {selected && (
              <aside
                className="connected-inspector"
                aria-label="Graph node details"
              >
                <button
                  className="connected-close"
                  aria-label="Close node details"
                  onClick={() => setSelectedId(undefined)}
                >
                  <X size={16} />
                </button>
                <span className={`connected-type-badge kind-${selected.kind}`}>
                  {selected.kind}
                </span>
                <h3>{selected.label}</h3>
                <p className="connected-subject-name">
                  {selected.subjectName || "General"}
                  {selected.status
                    ? ` · ${selected.status.replaceAll("-", " ")}`
                    : ""}
                </p>
                {selected.derived && (
                  <p className="connected-derived-note">
                    From saved teaching. This encountered topic is not an
                    assessment or a tracked knowledge claim.{" "}
                    <button
                      disabled={tracking}
                      onClick={() => void trackSelected()}
                    >
                      {tracking ? "Saving concept…" : "Track concept"}
                    </button>
                  </p>
                )}
                {selected.definition && (
                  <p className="connected-definition">{selected.definition}</p>
                )}
                <div className="connected-node-actions">
                  <button onClick={() => focusOn(selected.id)}>
                    <Focus size={15} />
                    Focus neighborhood
                  </button>
                  {(selected.conversationId || selected.kind !== "concept") && (
                    <button onClick={() => openSource(selected)}>
                      <BookOpen size={15} />
                      Open original source
                    </button>
                  )}
                  {selected.subjectId && (
                    <button
                      onClick={() => {
                        const node = nodes.find(
                          (node) => node.id === selected.id,
                        );
                        if (node)
                          savePosition(
                            selected.id,
                            node.position,
                            !graph.positions[selected.id]?.pinned,
                          );
                      }}
                    >
                      <Pin size={14} />
                      {graph.positions[selected.id]?.pinned
                        ? "Unpin position"
                        : "Pin position"}
                    </button>
                  )}
                </div>
                {selected.evidence && (
                  <section className="connected-evidence">
                    <h4>Learning evidence</h4>
                    <p>{selected.evidence}</p>
                  </section>
                )}
                <h4>
                  Backlinks & nearby concepts{" "}
                  <span>
                    {graph.backlinkCounts?.[selected.id] ??
                      selectedLinks.length}
                  </span>
                </h4>
                {(graph.backlinkCounts?.[selected.id] || 0) >
                  selectedLinks.length && (
                  <p className="connected-backlink-limit">
                    Showing the first {selectedLinks.length} sources and
                    neighbors. Focus a node or narrow by type to inspect more.
                  </p>
                )}
                {!selectedLinks.length && (
                  <p>
                    No source links are recorded yet. Add a reviewed relation or
                    connect a source lesson.
                  </p>
                )}
                {selectedLinks.map((link) => {
                  const neighbor = selectedBacklinks.find(
                    (entry) => entry.link.id === link.id,
                  )?.node;
                  return (
                    <article
                      key={link.id}
                      className={`connected-backlink ${link.id === selectedEdge ? "is-selected" : ""}`}
                    >
                      <div>
                        <Link2 size={14} />
                        <button
                          onClick={() => {
                            if (neighbor) {
                              if (
                                !graph.nodes.some(
                                  (node) => node.id === neighbor.id,
                                )
                              )
                                focusOn(neighbor.id);
                              choose(neighbor.id);
                            }
                          }}
                        >
                          {neighbor?.label || "Source unavailable"}
                        </button>
                      </div>
                      <small>
                        {relationLabel(link.kind)}
                        {link.state === "suggested" ? " · suggested" : ""}
                      </small>
                      <p>{link.reason}</p>
                      {link.sourceReferences?.map((reference) => (
                        <button
                          className="connected-source-reference"
                          key={
                            reference.conversationId + ":" + reference.messageId
                          }
                          onClick={() =>
                            props.onOpenSource
                              ? props.onOpenSource(
                                  reference.conversationId,
                                  reference.messageId,
                                )
                              : props.onOpenLesson(reference.conversationId)
                          }
                        >
                          Open source passage
                          <ArrowUpRight size={12} />
                        </button>
                      ))}
                      {neighbor &&
                        (neighbor.conversationId ||
                          neighbor.kind !== "concept") && (
                          <button
                            onClick={() =>
                              openSource(neighbor, link.sourceMessageId)
                            }
                          >
                            Jump to source
                          </button>
                        )}
                      {link.state === "suggested" && (
                        <div className="connected-review-actions">
                          <button onClick={() => review(link, "accepted")}>
                            Accept connection
                          </button>
                          <button onClick={() => review(link, "rejected")}>
                            Dismiss
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </aside>
            )}
          </div>
          <footer className="connected-help">
            Select a node to inspect sources. Double-click to focus. Drag to pin
            a position. Associations do not establish understanding.
          </footer>
        </>
      )}
    </section>
  );
}
