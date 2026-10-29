import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  BookOpen,
  ArrowRight,
  Archive,
  RotateCcw,
  Search,
  Check,
  ChevronDown,
  Trash2,
  Merge,
  ArrowUp,
  ArrowDown,
  Brain,
  Download,
  Edit3,
  MessageSquare,
  Files,
  Layers3,
  ArrowUpRight,
  ChevronRight,
  Image,
  GraduationCap,
} from "lucide-react";
import type {
  Subject,
  SubjectSnapshot,
  CurriculumNode,
  SubjectOperation,
  SubjectSearchResult,
  SubjectDepth,
  SubjectRevision,
} from "../../v2types";
import type {
  LibraryItem,
  Lesson,
  StudioData,
  TaskSettings,
} from "../../types";
import type { StudySourceKind } from "../../sourceStudyTypes";
import { invoke } from "../../lib/bridge";
import "./subjects.css";
import "../studio/subject-surfaces.css";
import "../studio/learning-center-home.css";
import SubjectAnalytics from "./SubjectAnalytics";
import LearningSetup, { type IntakeDraft } from "../v21/LearningSetup";
import PathwayProgress, { usePlanningJobs } from "../v21/PathwayProgress";
import type { SubjectIntake } from "../../v21types";
import SourceStudyPanel from "../studio/SourceStudyPanel";
export type SubjectAction = (
  action: string,
  payload: Record<string, unknown>,
) => Promise<any>;
type HubProps = {
  subjects: Subject[];
  onCreate: (value: {
    name: string;
    objective: string;
    depth: SubjectDepth;
  }) => Promise<void>;
  onOpen: (id: string) => void;
  onRestore: () => Promise<void>;
  onReorder?: (ids: string[]) => void;
  onSourceIntent?: (kind: StudySourceKind | undefined) => void;
  lessons?: Lesson[];
  onResume?: (lessonId: string) => void;
  onExploreExample?: (kind: "gene" | "optimization" | "equilibrium") => void;
};
export function SubjectsHome({
  subjects,
  onCreate,
  onOpen,
  onRestore,
  onReorder,
  onSourceIntent,
  lessons = [],
  onResume,
  onExploreExample,
}: HubProps) {
  const [sourceIntent, setSourceIntent] = useState<StudySourceKind>();
  const [adding, setAdding] = useState(false),
    [name, setName] = useState(""),
    [goal, setGoal] = useState(""),
    [depth, setDepth] = useState<SubjectDepth>("comprehensive"),
    [archived, setArchived] = useState(false),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("order"),
    [creating, setCreating] = useState(false);
  const list = subjects.filter(
    (item) =>
      item.archived === archived &&
      `${item.name} ${item.objective}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const ordered =
    sort === "name"
      ? [...list].sort((a, b) => a.name.localeCompare(b.name))
      : sort === "recent"
        ? [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        : list;
  const recentLessons = [...lessons]
    .filter(
      (lesson) =>
        !lesson.subjectId ||
        subjects.some((item) => item.id === lesson.subjectId && !item.archived),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const resumeLesson = recentLessons[0];
  const resumeSubject = subjects.find(
    (item) => item.id === resumeLesson?.subjectId,
  );
  const beginSubject = (kind?: StudySourceKind) => {
    setSourceIntent(kind);
    setAdding(true);
  };
  const reorder = (source: string, target: string) => {
    const ids = subjects.map((item) => item.id),
      from = ids.indexOf(source),
      to = ids.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, source);
    onReorder?.(ids);
  };
  return (
    <div className="v2-page subject-studio-v3 subject-home-v3 learning-center-home">
      <header className="subject-home-heading">
        <div>
          <h1>Your learning</h1>
          <p>Pick up a lesson, follow a pathway, or start with a book.</p>
        </div>
        <button
          className="primary subject-create-action"
          onClick={() => setAdding(true)}
        >
          <Plus size={18} />
          New subject
        </button>
      </header>
      {adding && (
        <form
          className="subject-create subject-create-v3"
          onSubmit={(event) => {
            event.preventDefault();
            if (creating) return;
            setCreating(true);
            setError("");
            void onCreate({
              name: name.trim(),
              objective:
                goal.trim() ||
                (sourceIntent === "textbook"
                  ? `Study ${name.trim()} through the supplied textbook.`
                  : `Follow the supplied curriculum for ${name.trim()}.`),
              depth,
            })
              .then(() => {
                onSourceIntent?.(sourceIntent);
                setAdding(false);
                setName("");
                setGoal("");
                setSourceIntent(undefined);
              })
              .catch((e) => setError(String(e)))
              .finally(() => setCreating(false));
          }}
        >
          <div className="subject-create-title">
            <h2>What would you like to understand?</h2>
            <p>Start broadly. Your pathway can take shape as you learn.</p>
          </div>
          <div className="subject-create-fields">
            <label>
              Subject name
              <input
                aria-label="Subject workspace name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                placeholder="A discipline, a question, or a long-term project"
              />
            </label>
            <label>
              Shared learning objective{sourceIntent ? " (optional)" : ""}
              <textarea
                aria-label="Subject learning objective"
                required={!sourceIntent}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                maxLength={10000}
                placeholder="What would you like to be able to understand or do?"
              />
            </label>
            <label>
              Learning depth
              <select
                aria-label="Subject depth"
                value={depth}
                onChange={(e) => setDepth(e.target.value as SubjectDepth)}
              >
                <option value="overview">Overview</option>
                <option value="comprehensive">Comprehensive</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
            <fieldset className="source-study-create-choice">
              <legend>How would you like to start?</legend>
              <div>
                <button
                  type="button"
                  aria-pressed={!sourceIntent}
                  onClick={() => setSourceIntent(undefined)}
                >
                  Build around my goal
                </button>
                <button
                  type="button"
                  aria-pressed={sourceIntent === "curriculum"}
                  onClick={() => setSourceIntent("curriculum")}
                >
                  <GraduationCap size={17} />
                  Use a curriculum
                </button>
                <button
                  type="button"
                  aria-pressed={sourceIntent === "textbook"}
                  onClick={() => setSourceIntent("textbook")}
                >
                  <BookOpen size={17} />
                  Study a textbook
                </button>
              </div>
              <p>
                {sourceIntent === "curriculum"
                  ? "Next, import or paste the actual curriculum and review its topics before creating your learning pathway."
                  : sourceIntent === "textbook"
                    ? "Next, choose a book and review its chapters. Lessons will follow the source, with page references where available."
                    : "Start with your own learning goal. You can bring a curriculum or textbook at any time."}
              </p>
            </fieldset>
            <div className="button-row">
              <button
                className="primary"
                disabled={
                  creating || !name.trim() || (!goal.trim() && !sourceIntent)
                }
              >
                {creating ? "Creating subject…" : "Create subject"}
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}
      {!adding && !archived && !query && (
        <section
          className="learning-launchpad"
          aria-label="Continue your learning"
        >
          <div className="learning-launchpad-main">
            <h2>
              {resumeLesson && onResume
                ? resumeLesson.title
                : "Begin with something you want to understand."}
            </h2>
            <p>
              {resumeLesson && onResume
                ? resumeLesson.position || resumeLesson.objective
                : "A whole subject, a course outline, or a book can become your learning space. You choose the depth and the pace."}
            </p>
            <div className="learning-launchpad-actions">
              {resumeLesson && onResume ? (
                <>
                  <button
                    className="learning-launchpad-primary"
                    onClick={() => onResume(resumeLesson.id)}
                  >
                    Continue lesson <ArrowRight size={19} />
                  </button>
                  {resumeSubject && (
                    <button onClick={() => onOpen(resumeSubject.id)}>
                      Open subject <ChevronRight size={17} />
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    className="learning-launchpad-primary"
                    onClick={() => beginSubject()}
                  >
                    Create a learning path <ArrowRight size={19} />
                  </button>
                  <button onClick={() => beginSubject("curriculum")}>
                    Use a curriculum
                  </button>
                  <button onClick={() => beginSubject("textbook")}>
                    Study a textbook
                  </button>
                </>
              )}
            </div>
            {resumeLesson && (
              <span className="learning-launchpad-context">
                <BookOpen size={16} />
                {resumeSubject?.name || resumeLesson.subject} <span>·</span>{" "}
                Saved{" "}
                {new Date(resumeLesson.updatedAt).toLocaleDateString(
                  undefined,
                  { month: "short", day: "numeric" },
                )}
              </span>
            )}
          </div>
          <div className="learning-launchpad-aside">
            {recentLessons.length > 1 && onResume ? (
              <>
                <h3>Recently studied</h3>
                {recentLessons.slice(1, 4).map((lesson) => (
                  <button key={lesson.id} onClick={() => onResume(lesson.id)}>
                    <span>
                      <strong>{lesson.title}</strong>
                      <small>{lesson.subject}</small>
                    </span>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </>
            ) : (
              <>
                <h3>Make ideas your own</h3>
                <p>
                  Understand an idea. Try it for yourself. Ask a question. Keep
                  what helps.
                </p>
                <div className="learning-approach">
                  <span>
                    <BookOpen size={20} />
                    Learn
                  </span>
                  <span>
                    <Layers3 size={20} />
                    Explore
                  </span>
                  <span>
                    <Check size={20} />
                    Reflect
                  </span>
                </div>
              </>
            )}
          </div>
        </section>
      )}
      {!adding && !archived && !query && onExploreExample && (
        <section
          className="learning-starter-section"
          aria-label="Interactive learning examples"
        >
          <div>
            <h2>Try an interactive lesson</h2>
            <p>
              Change something. See what follows. These examples run locally.
            </p>
          </div>
          <div className="learning-starter-lessons">
            {(
              [
                [
                  "gene",
                  "Explore DNA, RNA and protein",
                  "Edit a base and follow the message.",
                ],
                [
                  "optimization",
                  "Explore gradient descent",
                  "Change a step. Compare the path.",
                ],
                [
                  "equilibrium",
                  "Explore a reversible reaction",
                  "Shift the balance between two species.",
                ],
              ] as const
            ).map(([kind, label, detail]) => (
              <button key={kind} onClick={() => onExploreExample(kind)}>
                <span>
                  <strong>{label}</strong> <small>{detail}</small>
                </span>
                <ArrowUpRight size={18} />
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="subject-collection" aria-label="Subject collection">
        <div className="subject-collection-toolbar">
          <div className="subject-collection-filter">
            <button
              aria-pressed={!archived}
              className={!archived ? "active" : ""}
              onClick={() => setArchived(false)}
            >
              Active subjects{" "}
              <span>{subjects.filter((item) => !item.archived).length}</span>
            </button>
            <button
              aria-pressed={archived}
              className={archived ? "active" : ""}
              onClick={() => setArchived(true)}
            >
              Archived subjects{" "}
              <span>{subjects.filter((item) => item.archived).length}</span>
            </button>
          </div>
          <div className="subject-collection-tools">
            <label className="subject-search-field">
              <Search size={17} />
              <input
                aria-label="Search subjects"
                placeholder="Find a subject"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Sort subjects"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="order">Your order</option>
              <option value="recent">Recently updated</option>
              <option value="name">Name</option>
            </select>
            <button
              onClick={() => void onRestore().catch((e) => setError(String(e)))}
            >
              <RotateCcw size={15} />
              Restore subject
            </button>
          </div>
        </div>
        <div className="subject-grid subject-workbench-list learning-course-index">
          {ordered.map((item) => {
            const sessions = recentLessons.filter(
              (lesson) => lesson.subjectId === item.id,
            );
            return (
              <button
                className="subject-tile subject-workbench-row"
                key={item.id}
                draggable
                onDragStart={(event) =>
                  event.dataTransfer.setData("text/plain", item.id)
                }
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  reorder(event.dataTransfer.getData("text/plain"), item.id);
                }}
                onKeyDown={(event) => {
                  if (
                    event.altKey &&
                    ["ArrowUp", "ArrowDown"].includes(event.key)
                  ) {
                    event.preventDefault();
                    const index = subjects.findIndex((s) => s.id === item.id),
                      target =
                        subjects[index + (event.key === "ArrowUp" ? -1 : 1)];
                    if (target) reorder(item.id, target.id);
                  }
                }}
                onClick={() => onOpen(item.id)}
              >
                <span className="subject-row-identity">
                  <span>
                    <h2>{item.name}</h2>
                    <p>{item.objective}</p>
                  </span>
                  <BookOpen size={25} />
                </span>
                <span className="learning-course-latest">
                  <span className="subject-depth-label">
                    {item.depth} depth
                  </span>
                  <span>
                    {sessions.length
                      ? `${sessions.length} saved ${sessions.length === 1 ? "lesson" : "lessons"}`
                      : "Ready for your first lesson"}
                  </span>
                </span>
                <span className="learning-course-footer">
                  <span>
                    {sessions[0]?.title || "Open your learning space"}
                  </span>
                  <ArrowUpRight size={18} />
                </span>
              </button>
            );
          })}
        </div>
        {!ordered.length && (
          <div className="subject-empty-v3">
            <Layers3 size={38} />
            <h2>
              {query
                ? "No subjects match your search"
                : archived
                  ? "Your archived subjects will be here"
                  : "Start with a subject that interests you"}
            </h2>
            <p>
              {query
                ? "Try a subject name or a word from its learning goal."
                : archived
                  ? "Archiving keeps your conversations and resources intact."
                  : "Create a workspace for a whole discipline or a question. Assessment is optional."}
            </p>
            {!archived && !query && (
              <button className="primary" onClick={() => setAdding(true)}>
                <Plus size={17} />
                Create your first subject
              </button>
            )}
          </div>
        )}
        {ordered.length > 1 && (
          <p className="subject-order-help">
            Drag to arrange subjects, or focus a subject and use Alt + Up /
            Down.
          </p>
        )}
      </section>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </div>
  );
}

type Props = {
  snapshot: SubjectSnapshot;
  data: StudioData;
  action: SubjectAction;
  onOpenChat: (id: string) => void;
  onCreateChat: (node?: CurriculumNode) => Promise<void>;
  onGeneratePathway: () => Promise<void>;
  planningPreference?: TaskSettings;
  onExport: () => void;
  onTool: (tool: "textbook" | "visuals" | "canvas" | "documents") => void;
  onNavigateSearch: (result: SubjectSearchResult) => void;
  onImportStudyDocument?: () => Promise<LibraryItem | null>;
  onImportStudyUrl?: (url: string) => Promise<LibraryItem | null>;
  onStudySourcesChanged?: () => Promise<void>;
  onStudySourceDocument?: (resourceId: string, page?: number) => void;
  initialSourceKind?: StudySourceKind;
  onSourceIntentConsumed?: () => void;
  initialFocus?: {
    kind: "curriculum" | "concept" | "memory";
    id: string;
    key: string;
  };
};
const statusLabels: Record<CurriculumNode["status"], string> = {
  "not-started": "Not started",
  introduced: "Introduced",
  covered: "Covered",
  partial: "Partially understood",
  demonstrated: "Demonstrated",
  review: "Needs review",
  gap: "Unresolved gap",
};
export default function SubjectWorkspace({
  snapshot,
  data,
  action,
  onOpenChat,
  onCreateChat,
  onGeneratePathway,
  planningPreference,
  onExport,
  onTool,
  onNavigateSearch,
  onImportStudyDocument,
  onImportStudyUrl,
  onStudySourcesChanged,
  onStudySourceDocument,
  initialSourceKind,
  onSourceIntentConsumed,
  initialFocus,
}: Props) {
  const { subject, curriculum, concepts, memory, revisions } = snapshot;
  const planning = usePlanningJobs(subject.id);
  const [setupOpen, setSetupOpen] = useState(false);
  const setupInitialized = useRef<string | null>(null);
  useEffect(() => {
    if (!planning.loading && setupInitialized.current !== subject.id) {
      setupInitialized.current = subject.id;
      setSetupOpen(
        !planning.intake || planning.intake.status === "in-progress",
      );
    }
  }, [planning.loading, planning.intake, subject.id]);
  const latestJob = planning.jobs[0];
  const [tab, setTab] = useState<
      | "overview"
      | "pathway"
      | "conversations"
      | "resources"
      | "memory"
      | "search"
    >("overview"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [name, setName] = useState(subject.name),
    [goal, setGoal] = useState(subject.objective),
    [depth, setDepth] = useState(subject.depth),
    [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [searchKind, setSearchKind] = useState("all"),
    [results, setResults] = useState<SubjectSearchResult[]>([]),
    [memoryFilter, setMemoryFilter] = useState("all"),
    [chatQuery, setChatQuery] = useState("");
  const [nodeTitle, setNodeTitle] = useState(""),
    [nodeKind, setNodeKind] = useState<CurriculumNode["kind"]>("topic"),
    [nodeParent, setNodeParent] = useState(""),
    [nodeDescription, setNodeDescription] = useState(""),
    [mergeTarget, setMergeTarget] = useState(""),
    [prerequisite, setPrerequisite] = useState("");
  const [noteTitle, setNoteTitle] = useState(""),
    [noteText, setNoteText] = useState(""),
    [noteKind, setNoteKind] = useState<
      "finding" | "question" | "misconception" | "explanation"
    >("finding"),
    [editedMemory, setEditedMemory] = useState<string | null>(null);
  useEffect(() => {
    setTab("overview");
    setSelected(null);
    setName(subject.name);
    setGoal(subject.objective);
    setDepth(subject.depth);
    setResults([]);
  }, [subject.id]);
  const [sourceKind, setSourceKind] = useState<StudySourceKind>();
  useEffect(() => {
    if (!initialSourceKind) return;
    setupInitialized.current = subject.id;
    setTab("resources");
    setSourceKind(initialSourceKind);
    setSetupOpen(false);
    onSourceIntentConsumed?.();
  }, [initialSourceKind, onSourceIntentConsumed, subject.id]);
  const studySourcePanel = (compact: boolean) => (
    <SourceStudyPanel
      key={subject.id}
      snapshot={snapshot}
      data={data}
      action={action}
      onCreateChat={onCreateChat}
      onOpenChat={onOpenChat}
      onImportStudyDocument={onImportStudyDocument}
      onImportStudyUrl={onImportStudyUrl}
      onStudySourcesChanged={onStudySourcesChanged}
      onStudySourceDocument={onStudySourceDocument}
      initialKind={sourceKind}
      onInitialKindConsumed={() => setSourceKind(undefined)}
      compact={compact}
    />
  );
  const saveSetup = async (draft: IntakeDraft) => {
    const saved = await invoke<SubjectIntake>("learning:intake-put", draft);
    if (
      saved.status !== "in-progress" &&
      (saved.goal !== subject.objective || saved.depth !== subject.depth)
    )
      await action("subject:update", {
        subjectId: subject.id,
        patch: { objective: saved.goal, depth: saved.depth },
      });
    await planning.refresh();
    return saved;
  };
  const startPlanning = async () => {
    if (!planning.intake || planning.intake.status === "in-progress") {
      setSetupOpen(true);
      return;
    }
    await onGeneratePathway();
    await planning.refresh();
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const apply = (label: string, operations: SubjectOperation[]) =>
    run(() =>
      action("subject:apply", {
        subjectId: subject.id,
        baseRevision: subject.revision,
        label,
        origin: "learner",
        operations,
      }),
    );
  const now = () => new Date().toISOString();
  const upsert = (
    node: CurriculumNode,
    patch: Partial<CurriculumNode>,
    label: string,
  ) =>
    apply(label, [
      {
        entity: "curriculum",
        op: "put",
        id: node.id,
        value: { ...node, ...patch, userEdited: true, updatedAt: now() },
      },
    ]);
  const selectedNode = curriculum.find((n) => n.id === selected);
  const inSubtree = (candidate: string, ancestor?: string) => {
    const visited = new Set<string>();
    let node = curriculum.find((n) => n.id === candidate);
    while (node?.parentId && !visited.has(node.parentId)) {
      if (node.parentId === ancestor) return true;
      visited.add(node.parentId);
      node = curriculum.find((n) => n.id === node!.parentId);
    }
    return false;
  };
  useEffect(() => {
    if (!initialFocus) return;
    if (initialFocus.kind === "curriculum") {
      setTab("pathway");
      const node = curriculum.find((node) => node.id === initialFocus.id);
      if (node) {
        setSelected(node.id);
        setNodeTitle(node.title);
        setNodeDescription(node.description);
        setNodeParent(node.parentId || "");
        setNodeKind(node.kind);
      }
    } else setTab("memory");
    const timer = setTimeout(() => {
      const attribute =
        initialFocus.kind === "curriculum"
          ? "data-curriculum-node"
          : initialFocus.kind === "concept"
            ? "data-concept-id"
            : "data-memory-id";
      const target = document.querySelector(
        "[" + attribute + '="' + CSS.escape(initialFocus.id) + '"]',
      );
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      target?.classList.add("message-anchor-highlight");
    }, 100);
    return () => clearTimeout(timer);
  }, [initialFocus]);
  const leaves = curriculum.filter(
    (n) => !curriculum.some((child) => child.parentId === n.id),
  );
  const total = leaves.length;
  const covered = leaves.filter((n) =>
      ["covered", "partial", "demonstrated", "review"].includes(n.status),
    ).length,
    demonstrated = leaves.filter((n) => n.status === "demonstrated").length;
  const current = curriculum.find((n) => n.id === subject.currentNodeId);
  const suggested = curriculum
    .filter(
      (n) =>
        !n.skipped &&
        !["covered", "demonstrated"].includes(n.status) &&
        snapshot.edges
          .filter((e) => e.nodeId === n.id)
          .every(
            (edge) =>
              curriculum.find((p) => p.id === edge.prerequisiteId)?.status ===
              "demonstrated",
          ),
    )
    .slice(0, 4);
  const chats = snapshot.conversations
    .filter((c) => !c.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const resumeChat = current
    ? chats.find((chat) => chat.curriculumNodeId === current.id)
    : chats[0];
  const resumeLesson = data.lessons.find(
    (lesson) => lesson.id === resumeChat?.id,
  );
  const resources = data.library.filter(
    (i) =>
      i.subjectId === subject.id ||
      (!i.subjectId && i.subject === subject.name),
  );
  const cards = (data.reviewCards || []).filter(
    (c) =>
      c.subjectId === subject.id ||
      (c.conceptId && concepts.some((k) => k.id === c.conceptId)) ||
      (c.lessonId && chats.some((chat) => chat.id === c.lessonId)),
  );
  const attempts = (data.reviewHistory || []).filter((a) =>
    cards.some((c) => c.id === a.cardId),
  );
  const nodes = useMemo(
    () =>
      [...curriculum].sort(
        (a, b) => a.position - b.position || a.title.localeCompare(b.title),
      ),
    [curriculum],
  );
  const pathwayPreview = nodes.filter((node) => !node.parentId).slice(0, 5);
  const inspectPathwayNode = (node: CurriculumNode) => {
    setTab("pathway");
    setSelected(node.id);
    setNodeTitle(node.title);
    setNodeDescription(node.description);
    setNodeParent(node.parentId || "");
    setNodeKind(node.kind);
  };
  const build = (
    parent?: string,
    level = 0,
    seen = new Set<string>(),
  ): React.ReactNode =>
    nodes
      .filter((n) => (n.parentId || undefined) === parent)
      .map((node) => {
        if (seen.has(node.id) || level > 20) return null;
        const childSeen = new Set(seen);
        childSeen.add(node.id);
        const descendants = nodes.filter((n) => n.parentId === node.id);
        return (
          <div key={node.id}>
            <button
              data-curriculum-node={node.id}
              className={
                "curriculum-row " + (selected === node.id ? "active" : "")
              }
              style={{ paddingLeft: 12 + level * 20 }}
              onClick={() => {
                setSelected(node.id);
                setNodeTitle(node.title);
                setNodeDescription(node.description);
                setNodeParent(node.parentId || "");
                setNodeKind(node.kind);
              }}
            >
              <span>
                {descendants.length ? (
                  <ChevronDown size={13} />
                ) : (
                  <span className="curriculum-dot" />
                )}
              </span>
              <span className="curriculum-kind">{node.kind}</span>
              <strong>{node.title}</strong>
              <span className={"curriculum-status status-" + node.status}>
                {node.skipped ? "Skipped by you" : statusLabels[node.status]}
              </span>
            </button>
            {node.kind === "module" && (
              <ModuleProgress module={node} nodes={nodes} />
            )}
            {build(node.id, level + 1, childSeen)}
          </div>
        );
      });
  const addNode = () => {
    const id = crypto.randomUUID();
    const value: CurriculumNode = {
      id,
      subjectId: subject.id,
      parentId: nodeParent || undefined,
      kind: nodeKind,
      title: nodeTitle.trim(),
      description: nodeDescription,
      position: nodes.length,
      status: "not-started",
      userEdited: true,
      revision: 0,
      createdAt: now(),
      updatedAt: now(),
    };
    return apply("Add " + value.kind, [
      { entity: "curriculum", op: "put", id, value },
    ]);
  };
  const rename = () =>
    run(async () => {
      await action("subject:update", {
        subjectId: subject.id,
        expectedRevision: subject.revision,
        patch: { name: name.trim(), objective: goal.trim(), depth },
      });
      setEditing(false);
    });
  return (
    <div className="v2-page subject-studio-v3 subject-workspace-v3 learning-center-subject">
      <header className="subject-workspace-heading">
        <div>
          <h1>{subject.name}</h1>
          <div className="subject-workspace-meta">
            <span>{subject.depth} learning</span>
            <span>
              {chats.length}{" "}
              {chats.length === 1 ? "conversation" : "conversations"}
            </span>
            <span>{concepts.length} tracked concepts</span>
          </div>
        </div>
        <div className="button-row subject-header-actions">
          <button
            aria-label="Edit subject"
            title="Edit subject"
            onClick={() => setEditing(!editing)}
          >
            <Edit3 size={17} />
          </button>
          <button onClick={onExport}>
            <Download size={16} />
            Export
          </button>
          <button onClick={() => setSetupOpen(!setupOpen)}>
            Learning setup
          </button>
          <button
            className="primary"
            disabled={busy || subject.archived}
            onClick={() => void run(() => onCreateChat())}
          >
            <Plus size={17} />
            Start a lesson
          </button>
        </div>
      </header>
      <div className="subject-objective-v3">
        <GraduationCap size={19} />
        <p>{subject.objective}</p>
        <button
          className="text-button"
          aria-label="Edit goal"
          onClick={() => setEditing(true)}
        >
          Edit goal
        </button>
      </div>
      {!latestJob && planningPreference && (
        <p className="muted">
          Pathway planning uses {planningPreference.model} ·{" "}
          {planningPreference.reasoning || "Provider default"} reasoning. Change
          Planning separately in Settings → Account &amp; models.
        </p>
      )}
      {setupOpen && !planning.loading && (
        <LearningSetup
          key={subject.id}
          subject={subject}
          initial={planning.intake}
          globalPreferences={data.settings.teaching}
          demonstrated={concepts
            .filter((concept) => concept.status === "demonstrated")
            .map((concept) => concept.label)}
          onSave={saveSetup}
          onPlan={async () => {
            await onGeneratePathway();
            await planning.refresh();
          }}
          onClose={() => setSetupOpen(false)}
        />
      )}
      {latestJob && (
        <PathwayProgress
          job={latestJob}
          retryPreference={planningPreference}
          onRefresh={planning.refresh}
          onApplySaved={async (proposalId) => {
            await action("subject:accept", {
              subjectId: subject.id,
              proposalId,
            });
          }}
          onReview={() => {
            setTab("pathway");
            setTimeout(
              () =>
                document
                  .querySelector(".revision-row")
                  ?.scrollIntoView({ behavior: "smooth", block: "center" }),
              100,
            );
          }}
          onApply={async () => {
            if (!latestJob.proposalId) return;
            await action("subject:accept", {
              subjectId: subject.id,
              proposalId: latestJob.proposalId,
            });
            await invoke("planning:mark-complete", { jobId: latestJob.id });
            await planning.refresh();
          }}
          onBegin={async () => {
            const first =
              snapshot.curriculum.find(
                (node) => node.kind === "lesson" || node.kind === "topic",
              ) || snapshot.curriculum[0];
            await onCreateChat(first);
          }}
        />
      )}
      {editing && (
        <form
          className="v2-card"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <div className="v2-form-grid">
            <label>
              Name
              <input
                aria-label="Rename subject"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
              />
            </label>
            <label>
              Depth
              <select
                value={depth}
                aria-label="Edit subject depth"
                onChange={(e) => setDepth(e.target.value as SubjectDepth)}
              >
                <option value="overview">Overview</option>
                <option value="comprehensive">Comprehensive</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
          </div>
          <label>
            Objective
            <textarea
              aria-label="Edit subject objective"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              maxLength={10000}
            />
          </label>
          <div className="button-row">
            <button className="primary" disabled={!name.trim() || !goal.trim()}>
              Save subject
            </button>
            <button
              type="button"
              onClick={() =>
                void run(() =>
                  action("subject:update", {
                    subjectId: subject.id,
                    expectedRevision: subject.revision,
                    patch: { archived: !subject.archived },
                  }),
                )
              }
            >
              <Archive size={14} />
              {subject.archived ? "Restore subject" : "Archive subject"}
            </button>
            <button
              type="button"
              onClick={() =>
                void run(() =>
                  action("subject:archive-export", { subjectId: subject.id }),
                )
              }
            >
              Export subject archive
            </button>
          </div>
        </form>
      )}
      <nav className="v2-tabs subject-navigation-v3" aria-label="Subject tools">
        {(
          [
            "overview",
            "pathway",
            "conversations",
            "resources",
            "memory",
            "search",
          ] as const
        ).map((item) => (
          <button
            key={item}
            aria-current={tab === item ? "page" : undefined}
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
          >
            {
              {
                overview: "Overview",
                pathway: "Your pathway",
                conversations: "Sessions",
                resources: "Study material",
                memory: "Learning record",
                search: "Search",
              }[item]
            }
          </button>
        ))}
      </nav>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {tab === "overview" && (
        <div className="learning-course-layout subject-overview-v3">
          <div className="learning-course-main subject-overview-main">
            <section
              className="learning-next-lesson subject-next-session"
              aria-label="Continue your subject"
            >
              <div className="learning-next-copy">
                <h2>
                  {current
                    ? current.title
                    : resumeChat?.title || "Your first lesson starts here"}
                </h2>
                <p>
                  {resumeLesson?.position ||
                    current?.description ||
                    resumeChat?.resumeSummary ||
                    "Start with a useful overview. Your questions, explanations and discoveries will stay connected to this subject."}
                </p>
                <div className="learning-next-actions">
                  {resumeChat ? (
                    <button
                      className="primary"
                      aria-label={
                        current
                          ? "Resume this topic"
                          : "Resume where you left off"
                      }
                      onClick={() => onOpenChat(resumeChat.id)}
                    >
                      Continue lesson <ArrowRight size={18} />
                    </button>
                  ) : (
                    <button
                      className="primary"
                      aria-label={
                        current ? "Start this topic" : "Start learning"
                      }
                      disabled={busy || subject.archived}
                      onClick={() => void run(() => onCreateChat(current))}
                    >
                      {current ? "Start this topic" : "Begin learning"}
                      <ArrowRight size={18} />
                    </button>
                  )}
                  <button onClick={() => setTab("pathway")}>
                    View learning path <ChevronRight size={17} />
                  </button>
                </div>
              </div>
              <div className="learning-next-note">
                <BookOpen size={27} />
                <span>
                  {subject.depth === "advanced"
                    ? "Work through the details"
                    : subject.depth === "overview"
                      ? "Build a clear overview"
                      : "Build a connected understanding"}
                </span>
                <p>
                  Read. Try an idea. Ask when you need to. Checks stay optional.
                </p>
              </div>
            </section>

            <section
              className="learning-route-section subject-section-v3"
              aria-label="Pathway overview"
            >
              <div className="subject-section-heading">
                <h2>Your learning path</h2>
                <button
                  className="text-button"
                  onClick={() => setTab("pathway")}
                >
                  Explore & edit <ArrowUpRight size={16} />
                </button>
              </div>
              {pathwayPreview.length ? (
                <ol className="learning-route-list">
                  {pathwayPreview.map((node, index) => (
                    <li key={node.id}>
                      <button
                        onClick={() => inspectPathwayNode(node)}
                        aria-label={
                          "Open pathway " + node.kind + ": " + node.title
                        }
                      >
                        <span
                          className={
                            "learning-route-position " +
                            (node.id === current?.id ||
                            inSubtree(current?.id || "", node.id)
                              ? "is-current"
                              : "")
                          }
                        >
                          {index + 1}
                        </span>
                        <span className="learning-route-copy">
                          <strong>{node.title}</strong>
                          <span>
                            {node.description || statusLabels[node.status]}
                          </span>
                        </span>
                        <span
                          className={"curriculum-status status-" + node.status}
                        >
                          {node.skipped
                            ? "Skipped by you"
                            : statusLabels[node.status]}
                        </span>
                        <ChevronRight size={18} />
                      </button>
                      {node.kind === "module" && (
                        <ModuleProgress module={node} nodes={nodes} />
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="learning-route-empty">
                  <h3>A broad goal can become a clear path.</h3>
                  <p>
                    Create a pathway around your goal, follow a curriculum, or
                    start learning and shape it as you go.
                  </p>
                  <button
                    disabled={
                      busy ||
                      latestJob?.status === "running" ||
                      subject.archived
                    }
                    onClick={() => void run(startPlanning)}
                  >
                    <Brain size={18} />
                    Construct a learning pathway
                    <ArrowRight size={17} />
                  </button>
                </div>
              )}
              {nodes.length > pathwayPreview.length && (
                <button
                  className="text-button learning-full-path"
                  onClick={() => setTab("pathway")}
                >
                  See the complete pathway <ArrowRight size={16} />
                </button>
              )}
            </section>

            {suggested.length > 0 && (
              <section className="learning-suggestions subject-section-v3">
                <div className="subject-section-heading">
                  <h2>Another direction to explore</h2>
                  <span>Based on your pathway</span>
                </div>
                <div>
                  {suggested.slice(0, 3).map((node) => (
                    <button
                      key={node.id}
                      disabled={busy || subject.archived}
                      onClick={() => void run(() => onCreateChat(node))}
                    >
                      <span>
                        <strong>{node.title}</strong>
                        <small>
                          {node.description || statusLabels[node.status]}
                        </small>
                      </span>
                      <ArrowRight size={18} />
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="learning-sessions subject-section-v3">
              <div className="subject-section-heading">
                <h2>Your study sessions</h2>
                <button
                  className="text-button"
                  aria-label="All conversations"
                  onClick={() => setTab("conversations")}
                >
                  All sessions
                  <ArrowUpRight size={16} />
                </button>
              </div>
              <div className="subject-chat-index">
                {chats.slice(0, 4).map((chat) => (
                  <button
                    className="v2-list-button"
                    key={chat.id}
                    onClick={() => onOpenChat(chat.id)}
                  >
                    <BookOpen size={20} />
                    <span>
                      <strong>{chat.title}</strong>
                      <small>
                        {chat.parentConversationId
                          ? "A connected branch"
                          : data.lessons.find((lesson) => lesson.id === chat.id)
                              ?.position || "Ready to continue"}
                      </small>
                    </span>
                    <time>
                      {new Date(chat.updatedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </div>
              {!chats.length && (
                <p className="subject-section-empty">
                  Your lessons and explorations will appear here. Start one when
                  you are ready.
                </p>
              )}
            </section>
            <section
              className="learning-material-section"
              aria-label="Learn from your material"
            >
              {studySourcePanel(true)}
            </section>
          </div>
          <aside className="learning-course-aside subject-overview-aside">
            <section
              className="learning-progress-board"
              aria-label="Subject learning progress"
            >
              <h2>Your progress</h2>
              <Progress
                title="Coverage"
                value={covered}
                total={total}
                description="Topics covered"
              />
              <Progress
                title="Demonstrated understanding"
                value={demonstrated}
                total={total}
                description="Topics with supporting evidence"
              />
              <p>
                Seeing an idea and demonstrating it are different. Your learning
                record keeps both.
              </p>
              <button className="text-button" onClick={() => setTab("memory")}>
                See the evidence
                <ArrowRight size={16} />
              </button>
            </section>
            <section className="learning-course-tools subject-section-v3">
              <h2>Keep useful things close</h2>
              <div className="subject-study-tools">
                <button onClick={() => onTool("textbook")}>
                  <BookOpen size={20} />
                  <span>
                    <strong>Subject textbook</strong>
                    <small>Chapters, examples & your annotations</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
                <button onClick={() => onTool("visuals")}>
                  <Image size={20} />
                  <span>
                    <strong>Visual notebook</strong>
                    <small>
                      {
                        snapshot.records.filter(
                          (record) => record.recordType === "visual",
                        ).length
                      }{" "}
                      saved figures
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </button>
                <button onClick={() => onTool("documents")}>
                  <Files size={20} />
                  <span>
                    <strong>Study a document</strong>
                    <small>Read, inspect and ask about a source</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
                <button onClick={() => onTool("canvas")}>
                  <Layers3 size={20} />
                  <span>
                    <strong>Learning canvas</strong>
                    <small>Connect ideas in your own arrangement</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              </div>
            </section>
            <section className="learning-attention subject-section-v3">
              <h2>Worth returning to</h2>
              {[
                ...concepts
                  .filter((c) => ["review", "misconception"].includes(c.status))
                  .slice(0, 3)
                  .map((c) => ({ id: c.id, title: c.label, kind: c.status })),
                ...memory
                  .filter((m) => ["question", "misconception"].includes(m.kind))
                  .slice(0, 3)
                  .map((m) => ({ id: m.id, title: m.title, kind: m.kind })),
              ].map((item) => (
                <button
                  className="subject-attention-link"
                  key={item.id}
                  onClick={() => {
                    setTab("memory");
                    setMemoryFilter("all");
                    setTimeout(
                      () =>
                        document
                          .querySelector(
                            '[data-concept-id="' +
                              CSS.escape(item.id) +
                              '"],[data-memory-id="' +
                              CSS.escape(item.id) +
                              '"]',
                          )
                          ?.scrollIntoView({
                            block: "center",
                            behavior: "smooth",
                          }),
                      100,
                    );
                  }}
                >
                  <span>{item.title}</span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
              {!concepts.some((c) =>
                ["review", "misconception"].includes(c.status),
              ) &&
                !memory.some((m) =>
                  ["question", "misconception"].includes(m.kind),
                ) && (
                  <p>
                    No review flags or open questions yet. You can save a
                    question from any lesson.
                  </p>
                )}
              <p className="learning-review-note">
                {
                  cards.filter((card) => Date.parse(card.dueAt) <= Date.now())
                    .length
                }{" "}
                review cards due · {attempts.length} recorded attempts. Review
                is optional.
              </p>
              <button className="text-button" onClick={() => setTab("memory")}>
                Inspect learning record
                <ArrowRight size={16} />
              </button>
            </section>
          </aside>
          <details className="learning-history-details subject-analytics-region">
            <summary>
              Learning history and review details
              <ChevronDown size={17} />
            </summary>
            <SubjectAnalytics
              snapshot={snapshot}
              attempts={attempts}
              onOpenChat={onOpenChat}
            />
          </details>
        </div>
      )}
      {tab === "conversations" && (
        <section className="subject-section-v3 subject-conversations-v3">
          <div className="subject-section-heading">
            <div>
              <h2>All conversations</h2>
              <p>
                Independent conversations, connected by the same subject
                knowledge.
              </p>
            </div>
            <button
              className="primary"
              disabled={busy || subject.archived}
              onClick={() => void run(() => onCreateChat())}
            >
              <Plus size={17} />
              Start a conversation
            </button>
          </div>
          <label className="subject-search-field">
            <Search size={17} />
            <input
              aria-label="Search subject conversations"
              placeholder="Find a conversation"
              value={chatQuery}
              onChange={(e) => setChatQuery(e.target.value)}
            />
          </label>
          <div className="subject-chat-index">
            {chats
              .filter((chat) =>
                `${chat.title} ${chat.resumeSummary || ""}`
                  .toLowerCase()
                  .includes(chatQuery.toLowerCase()),
              )
              .map((chat) => (
                <button
                  className="v2-list-button"
                  key={chat.id}
                  onClick={() => onOpenChat(chat.id)}
                >
                  <MessageSquare size={19} />
                  <span>
                    <strong>{chat.title}</strong>
                    <small>
                      {chat.resumeSummary ||
                        (chat.parentConversationId
                          ? "A conversation branch"
                          : "Subject conversation")}
                    </small>
                  </span>
                  <time>
                    {new Date(chat.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </time>
                  <ArrowUpRight size={17} />
                </button>
              ))}
          </div>
          {!chats.length && (
            <p className="subject-section-empty">
              Start your first conversation in this subject.
            </p>
          )}
        </section>
      )}
      {tab === "resources" && (
        <section className="subject-section-v3 subject-resources-v3">
          {studySourcePanel(false)}
          <div className="subject-section-heading">
            <div>
              <h2>Resources & figures</h2>
              <p>
                {resources.length} saved resources ·{" "}
                {
                  snapshot.records.filter((r) => r.recordType === "visual")
                    .length
                }{" "}
                visual artifacts
              </p>
            </div>
          </div>
          <div className="subject-resource-actions">
            <button onClick={() => onTool("textbook")}>
              <BookOpen size={21} />
              <strong>Textbook</strong>
              <span>Organized explanations, examples and references</span>
              <ArrowUpRight size={18} />
            </button>
            <button onClick={() => onTool("visuals")}>
              <Image size={21} />
              <strong>Visual notebook</strong>
              <span>Reopen saved figures with their interactive state</span>
              <ArrowUpRight size={18} />
            </button>
            <button onClick={() => onTool("documents")}>
              <Files size={21} />
              <strong>Study a document</strong>
              <span>Documents, page excerpts and grounded questions</span>
              <ArrowUpRight size={18} />
            </button>
            <button onClick={() => onTool("canvas")}>
              <Layers3 size={21} />
              <strong>Canvas</strong>
              <span>Connect ideas in a spatial workspace</span>
              <ArrowUpRight size={18} />
            </button>
          </div>
          <h3>Saved references and notes</h3>
          <div className="subject-resource-list">
            {resources.map((resource) => (
              <button
                key={resource.id}
                onClick={() =>
                  onNavigateSearch({
                    id: resource.id,
                    subjectId: subject.id,
                    kind:
                      resource.kind === "document"
                        ? "document"
                        : resource.kind === "note"
                          ? "note"
                          : "reference",
                    title: resource.title,
                    preview: resource.content || "",
                    resourceId: resource.id,
                  })
                }
              >
                <Files size={18} />
                <span>
                  <strong>{resource.title}</strong>
                  <small>{resource.kind}</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
          {!resources.length && (
            <p className="subject-section-empty">
              Notes, documents and references saved to this subject will appear
              here.
            </p>
          )}
        </section>
      )}
      {tab === "pathway" && (
        <>
          <div className="v2-card">
            <div className="button-row">
              <h2>Adaptive learning pathway</h2>
              <button
                disabled={busy || latestJob?.status === "running"}
                onClick={() => void run(startPlanning)}
              >
                Propose additions with AI
              </button>
              <button
                onClick={() => {
                  setSelected(null);
                  setNodeTitle("");
                  setNodeDescription("");
                }}
              >
                Add a topic
              </button>
            </div>
            <p>
              Keep your edits. Proposed AI changes are reviewed before they
              affect this pathway. Selecting a topic never requires an
              assessment.
            </p>
          </div>
          <div className="v2-pathway">
            <div className="curriculum-tree">
              {build()}
              {!nodes.length && (
                <p className="v2-empty">
                  Build a pathway with AI or add your own modules and topics.
                </p>
              )}
            </div>
            <section className="v2-card curriculum-editor">
              <h3>
                {selectedNode
                  ? "Edit " + selectedNode.kind
                  : "Add a stepping stone"}
              </h3>
              <label>
                Title
                <input
                  aria-label="Curriculum title"
                  value={nodeTitle}
                  onChange={(e) => setNodeTitle(e.target.value)}
                  maxLength={300}
                />
              </label>
              <label>
                Kind
                <select
                  aria-label="Curriculum kind"
                  value={nodeKind}
                  onChange={(e) =>
                    setNodeKind(e.target.value as CurriculumNode["kind"])
                  }
                >
                  {["module", "topic", "lesson", "concept"].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
              <label>
                Parent
                <select
                  aria-label="Curriculum parent"
                  value={nodeParent}
                  onChange={(e) => setNodeParent(e.target.value)}
                >
                  <option value="">Pathway root</option>
                  {nodes
                    .filter((n) => n.id !== selected)
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.title}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Description
                <textarea
                  aria-label="Curriculum description"
                  value={nodeDescription}
                  onChange={(e) => setNodeDescription(e.target.value)}
                />
              </label>
              <div className="button-row">
                <button
                  disabled={!nodeTitle.trim() || busy}
                  className="primary"
                  onClick={() =>
                    void (selectedNode
                      ? upsert(
                          selectedNode,
                          {
                            title: nodeTitle,
                            description: nodeDescription,
                            parentId: nodeParent || undefined,
                            kind: nodeKind,
                          },
                          "Edit topic",
                        )
                      : addNode())
                  }
                >
                  Save topic
                </button>
                {selectedNode && (
                  <button
                    onClick={() => {
                      setSelected(null);
                      setNodeTitle("");
                    }}
                  >
                    Add another
                  </button>
                )}
              </div>
              {selectedNode && (
                <>
                  <label>
                    Learning state
                    <select
                      aria-label="Curriculum progress"
                      value={selectedNode.status}
                      onChange={(e) => {
                        if (e.target.value === "demonstrated") {
                          setError(
                            "Demonstrated understanding needs a concept and evidence. Edit the concept in Shared memory or confirm an assessment result.",
                          );
                          return;
                        }
                        void upsert(
                          selectedNode,
                          {
                            status: e.target.value as CurriculumNode["status"],
                          },
                          "Update coverage",
                        );
                      }}
                    >
                      {Object.entries(statusLabels).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="button-row">
                    <button
                      onClick={() => void run(() => onCreateChat(selectedNode))}
                    >
                      Open topic in a chat
                    </button>
                    <button
                      aria-label="Move curriculum topic up"
                      onClick={() =>
                        void upsert(
                          selectedNode,
                          { position: selectedNode.position - 1.5 },
                          "Reorder topic",
                        )
                      }
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      aria-label="Move curriculum topic down"
                      onClick={() =>
                        void upsert(
                          selectedNode,
                          { position: selectedNode.position + 1.5 },
                          "Reorder topic",
                        )
                      }
                    >
                      <ArrowDown size={14} />
                    </button>
                  </div>
                  <button
                    onClick={() =>
                      void upsert(
                        selectedNode,
                        { skipped: !selectedNode.skipped },
                        selectedNode.skipped
                          ? "Return topic to pathway"
                          : "Skip topic without asserting coverage",
                      )
                    }
                  >
                    {selectedNode.skipped
                      ? "Return to pathway"
                      : "Skip for now"}
                  </button>
                  <label>
                    Linked subject concept
                    <select
                      aria-label="Curriculum linked concept"
                      value={selectedNode.conceptId || ""}
                      onChange={(e) =>
                        void upsert(
                          selectedNode,
                          { conceptId: e.target.value || undefined },
                          "Link curriculum concept",
                        )
                      }
                    >
                      <option value="">No concept link</option>
                      {concepts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Add prerequisite
                    <select
                      aria-label="Curriculum prerequisite"
                      value={prerequisite}
                      onChange={(e) => setPrerequisite(e.target.value)}
                    >
                      <option value="">Choose a prerequisite</option>
                      {nodes
                        .filter((n) => n.id !== selected)
                        .map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    disabled={!prerequisite}
                    onClick={() =>
                      void apply("Add prerequisite", [
                        {
                          entity: "edge",
                          op: "put",
                          id: crypto.randomUUID(),
                          value: {
                            subjectId: subject.id,
                            nodeId: selectedNode.id,
                            prerequisiteId: prerequisite,
                          },
                        },
                      ])
                    }
                  >
                    Connect prerequisite
                  </button>
                  <label>
                    Merge into
                    <select
                      aria-label="Merge curriculum topic"
                      value={mergeTarget}
                      onChange={(e) => setMergeTarget(e.target.value)}
                    >
                      <option value="">Choose a topic</option>
                      {nodes
                        .filter(
                          (n) =>
                            n.id !== selected &&
                            !inSubtree(n.id, selected || undefined),
                        )
                        .map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="button-row">
                    <button
                      disabled={!mergeTarget}
                      onClick={() => {
                        const target = nodes.find((n) => n.id === mergeTarget)!;
                        const operations: SubjectOperation[] = [
                          {
                            entity: "curriculum",
                            op: "put",
                            id: target.id,
                            value: {
                              ...target,
                              description: [
                                target.description,
                                selectedNode.description,
                              ]
                                .filter(Boolean)
                                .join("\n\n"),
                              userEdited: true,
                            },
                          },
                          {
                            entity: "curriculum",
                            op: "delete",
                            id: selectedNode.id,
                          },
                          ...nodes
                            .filter(
                              (n) =>
                                n.parentId === selectedNode.id &&
                                n.id !== target.id,
                            )
                            .map((n) => ({
                              entity: "curriculum" as const,
                              op: "put" as const,
                              id: n.id,
                              value: {
                                ...n,
                                parentId: target.id,
                                userEdited: true,
                              },
                            })),
                          ...snapshot.edges
                            .filter(
                              (edge) =>
                                edge.nodeId === selectedNode.id ||
                                edge.prerequisiteId === selectedNode.id,
                            )
                            .map((edge) => {
                              const nodeId =
                                  edge.nodeId === selectedNode.id
                                    ? target.id
                                    : edge.nodeId,
                                prerequisiteId =
                                  edge.prerequisiteId === selectedNode.id
                                    ? target.id
                                    : edge.prerequisiteId;
                              return nodeId === prerequisiteId ||
                                snapshot.edges.some(
                                  (other) =>
                                    other.id !== edge.id &&
                                    other.nodeId === nodeId &&
                                    other.prerequisiteId === prerequisiteId,
                                )
                                ? {
                                    entity: "edge" as const,
                                    op: "delete" as const,
                                    id: edge.id,
                                  }
                                : {
                                    entity: "edge" as const,
                                    op: "put" as const,
                                    id: edge.id,
                                    value: { nodeId, prerequisiteId },
                                  };
                            }),
                        ];
                        void apply("Merge topics", operations);
                        setSelected(target.id);
                      }}
                    >
                      <Merge size={14} />
                      Merge
                    </button>
                    <button
                      className="text-button"
                      onClick={() => {
                        void apply("Remove topic", [
                          {
                            entity: "curriculum",
                            op: "delete",
                            id: selectedNode.id,
                          },
                          ...nodes
                            .filter((n) => n.parentId === selectedNode.id)
                            .map((n) => ({
                              entity: "curriculum" as const,
                              op: "put" as const,
                              id: n.id,
                              value: { ...n, parentId: selectedNode.parentId },
                            })),
                        ]);
                        setSelected(null);
                      }}
                    >
                      <Trash2 size={14} />
                      Remove topic
                    </button>
                  </div>
                </>
              )}
            </section>
          </div>
          <RevisionList
            revisions={revisions}
            subjectId={subject.id}
            action={action}
            run={run}
          />
        </>
      )}
      {tab === "memory" && (
        <>
          <section className="v2-card">
            <h2>Inspect and correct shared memory</h2>
            <p>
              Review what the studio remembers, see the supporting sources, and
              correct any finding, question or knowledge assessment.
            </p>
            <select
              aria-label="Memory filter"
              value={memoryFilter}
              onChange={(e) => setMemoryFilter(e.target.value)}
            >
              <option value="all">All records</option>
              <option value="concepts">Concepts and evidence</option>
              <option value="question">Pending questions</option>
              <option value="misconception">Misconceptions</option>
              <option value="finding">Important findings</option>
            </select>
          </section>
          {(memoryFilter === "all" || memoryFilter === "concepts") &&
            [
              ...concepts.filter((c) => c.id === initialFocus?.id),
              ...concepts.filter((c) => c.id !== initialFocus?.id),
            ]
              .slice(0, 300)
              .map((c) => (
                <section data-concept-id={c.id} className="v2-card" key={c.id}>
                  <div className="button-row">
                    <h3>{c.label}</h3>
                    <span className="badge">
                      {c.coverage} · {c.status}
                    </span>
                  </div>
                  <p>
                    {c.evidence ||
                      "Encountered; no understanding evidence recorded."}
                  </p>
                  <label>
                    Knowledge state
                    <select
                      aria-label={"Knowledge state for " + c.label}
                      value={c.status}
                      onChange={(e) => {
                        const status = e.target.value;
                        if (status === "demonstrated" && !c.evidence.trim()) {
                          setError(
                            "Add evidence before marking demonstrated understanding.",
                          );
                          return;
                        }
                        void apply("Correct concept state", [
                          {
                            entity: "concept",
                            op: "put",
                            id: c.id,
                            value: { ...c, status },
                          },
                        ]);
                      }}
                    >
                      {[
                        "encountered",
                        "unassessed",
                        "partial",
                        "demonstrated",
                        "misconception",
                        "review",
                        "unresolved",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Evidence
                    <textarea
                      aria-label={"Evidence for " + c.label}
                      defaultValue={c.evidence}
                      key={c.updatedAt}
                      onBlur={(e) => {
                        if (e.target.value !== c.evidence)
                          void apply("Correct concept evidence", [
                            {
                              entity: "concept",
                              op: "put",
                              id: c.id,
                              value: { ...c, evidence: e.target.value },
                            },
                          ]);
                      }}
                    />
                  </label>
                  {snapshot.evidence
                    .filter((e) => e.conceptId === c.id)
                    .slice(-4)
                    .map((e) => (
                      <p className="muted" key={e.id}>
                        {e.kind}: {e.content}
                        {e.conversationId && (
                          <button
                            className="text-button"
                            onClick={() => onOpenChat(e.conversationId!)}
                          >
                            Open supporting conversation
                          </button>
                        )}
                      </p>
                    ))}
                </section>
              ))}
          {memory
            .filter((m) => memoryFilter === "all" || m.kind === memoryFilter)
            .sort(
              (a, b) =>
                Number(b.id === initialFocus?.id) -
                Number(a.id === initialFocus?.id),
            )
            .slice(0, 100)
            .map((m) => (
              <section data-memory-id={m.id} className="v2-card" key={m.id}>
                <span className="eyebrow">
                  {m.kind} · {new Date(m.updatedAt).toLocaleDateString()}
                </span>
                <h3>{m.title}</h3>
                <p>{m.content}</p>
                <div className="button-row">
                  {m.conversationId && (
                    <button onClick={() => onOpenChat(m.conversationId!)}>
                      Open source
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setEditedMemory(m.id);
                      setNoteTitle(m.title);
                      setNoteText(m.content);
                      if (
                        [
                          "finding",
                          "question",
                          "misconception",
                          "explanation",
                        ].includes(m.kind)
                      )
                        setNoteKind(m.kind as typeof noteKind);
                    }}
                  >
                    Correct this record
                  </button>
                  <button
                    onClick={() =>
                      void apply("Remove memory record", [
                        { entity: "memory", op: "delete", id: m.id },
                      ])
                    }
                  >
                    Remove
                  </button>
                </div>
              </section>
            ))}
          <form
            className="v2-card"
            onSubmit={(e) => {
              e.preventDefault();
              const id = editedMemory || crypto.randomUUID();
              void apply(
                editedMemory ? "Correct memory record" : "Save subject memory",
                [
                  {
                    entity: "memory",
                    op: "put",
                    id,
                    value: {
                      id,
                      subjectId: subject.id,
                      kind: noteKind,
                      title: noteTitle,
                      content: noteText,
                      conceptIds: [],
                      revision: 0,
                      createdAt: now(),
                      updatedAt: now(),
                    },
                  },
                ],
              ).then(() => {
                setEditedMemory(null);
                setNoteTitle("");
                setNoteText("");
              });
            }}
          >
            <h3>
              {editedMemory
                ? "Correct a record"
                : "Save a finding or open question"}
            </h3>
            <label>
              Type
              <select
                value={noteKind}
                onChange={(e) => setNoteKind(e.target.value as typeof noteKind)}
              >
                {["finding", "question", "misconception", "explanation"].map(
                  (k) => (
                    <option key={k}>{k}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              Title
              <input
                aria-label="Memory title"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                maxLength={300}
              />
            </label>
            <label>
              Record
              <textarea
                aria-label="Memory content"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                maxLength={10000}
              />
            </label>
            <button
              disabled={!noteTitle.trim() || !noteText.trim()}
              className="primary"
            >
              Save memory record
            </button>
          </form>
          <RevisionList
            revisions={revisions}
            subjectId={subject.id}
            action={action}
            run={run}
          />
        </>
      )}
      {tab === "search" && (
        <>
          <form
            className="v2-card v2-search"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () =>
                setResults(
                  await invoke("subject:search", {
                    subjectId: subject.id,
                    query,
                    kind: searchKind,
                    limit: 60,
                  }),
                ),
              );
            }}
          >
            <Search size={17} />
            <input
              aria-label="Search this subject"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Chats, concepts, equations, sources, figures…"
            />
            <select
              aria-label="Subject search type"
              value={searchKind}
              onChange={(e) => setSearchKind(e.target.value)}
            >
              {[
                "all",
                "message",
                "concept",
                "curriculum",
                "chapter",
                "visual",
                "note",
                "document",
                "reference",
                "equation",
                "figure",
              ].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <button className="primary" disabled={!query.trim()}>
              Search
            </button>
          </form>
          {results.map((r) => (
            <button
              className="v2-search-result"
              key={r.kind + ":" + r.id}
              onClick={() => onNavigateSearch(r)}
            >
              <span className="eyebrow">{r.kind}</span>
              <h3>{r.title}</h3>
              <p>{r.preview}</p>
              <span>
                Open this result
                <ArrowRight size={13} />
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
function Progress({
  title,
  value,
  total,
  description,
}: {
  title: string;
  value: number;
  total: number;
  description: string;
}) {
  return (
    <div className="subject-progress-item">
      <div>
        <span>{title}</span>
        <strong>
          {value}
          <small> / {total}</small>
        </strong>
      </div>
      <progress aria-label={title} value={value} max={Math.max(1, total)} />
      <p>{total ? description : "No pathway topics yet"}</p>
    </div>
  );
}
function RevisionList({
  revisions,
  subjectId,
  action,
  run,
}: {
  revisions: SubjectRevision[];
  subjectId: string;
  action: SubjectAction;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <section className="v2-card">
      <h2>Proposals & revision history</h2>
      {[...revisions]
        .sort(
          (a, b) =>
            Number(b.status === "proposed") - Number(a.status === "proposed") ||
            Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
            (b.revision || 0) - (a.revision || 0),
        )
        .slice(0, 40)
        .map((r) => (
          <div className="revision-row" key={r.id}>
            <div>
              <strong>{r.label}</strong>
              <small>
                {r.origin} · {r.status} · {r.operations.length} affected records
              </small>
              <details>
                <summary>Inspect changes and provenance</summary>
                <pre>{JSON.stringify(r.operations, null, 2)}</pre>
                <p>
                  Source conversation:{" "}
                  {r.sourceConversationId || "Explicit learner action"}
                </p>
              </details>
            </div>
            <div className="button-row">
              {r.status === "proposed" && (
                <>
                  <button
                    onClick={() =>
                      void run(() =>
                        action("subject:accept", {
                          subjectId,
                          proposalId: r.id,
                        }),
                      )
                    }
                  >
                    <Check size={13} />
                    Accept reviewed changes
                  </button>
                  <button
                    onClick={() =>
                      void run(() =>
                        action("subject:reject", {
                          subjectId,
                          proposalId: r.id,
                        }),
                      )
                    }
                  >
                    Reject
                  </button>
                </>
              )}
              {r.status === "applied" && r.origin !== "migration" && (
                <button
                  onClick={() =>
                    void run(() =>
                      action("subject:rollback", {
                        subjectId,
                        revisionId: r.id,
                      }),
                    )
                  }
                >
                  <RotateCcw size={13} />
                  Undo revision
                </button>
              )}
            </div>
          </div>
        ))}
      {!revisions.length && (
        <p className="muted">
          Changes and reviewed AI proposals will appear here.
        </p>
      )}
    </section>
  );
}

function ModuleProgress({
  module,
  nodes,
}: {
  module: CurriculumNode;
  nodes: CurriculumNode[];
}) {
  const descend = (id: string, seen = new Set<string>()): CurriculumNode[] => {
    if (seen.has(id)) return [];
    seen.add(id);
    return nodes
      .filter((node) => node.parentId === id)
      .flatMap((node) => {
        const children = descend(node.id, seen);
        return children.length ? children : [node];
      });
  };
  const leaves = descend(module.id);
  if (!leaves.length) return null;
  const covered = leaves.filter((node) =>
      ["covered", "partial", "demonstrated", "review"].includes(node.status),
    ).length,
    demonstrated = leaves.filter(
      (node) => node.status === "demonstrated",
    ).length;
  return (
    <div className="module-progress">
      <span>
        Coverage {covered}/{leaves.length}
      </span>
      <progress
        aria-label={module.title + " coverage"}
        value={covered}
        max={leaves.length}
      />
      <span>
        Demonstrated {demonstrated}/{leaves.length}
      </span>
      <progress
        aria-label={module.title + " demonstrated understanding"}
        value={demonstrated}
        max={leaves.length}
      />
    </div>
  );
}
