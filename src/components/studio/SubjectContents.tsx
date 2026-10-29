import {
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  BookOpen,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleDashed,
  CircleDot,
  Library,
  MessageSquare,
  NotebookPen,
  PanelLeftClose,
  Plus,
  RotateCcw,
  SkipForward,
} from "lucide-react";
import type { Lesson } from "../../types";
import type {
  CurriculumNode,
  CurriculumStatus,
  SubjectSnapshot,
} from "../../v2types";

export type SubjectContentsProps = {
  snapshot: SubjectSnapshot | null;
  lessons: Lesson[];
  activeLesson?: Lesson;
  onOpenLesson: (id: string) => void;
  onOpenTopic: (node: CurriculumNode) => void;
  onDashboard: () => void;
  onMemory: () => void;
  onSources: () => void;
  onNew: () => void;
  onCollapse: () => void;
  width: number;
  onResize: (event: PointerEvent) => void;
};

const statusInfo: Record<
  CurriculumStatus,
  { label: string; description: string; icon: typeof Circle }
> = {
  "not-started": {
    label: "Not started",
    description: "Not discussed yet",
    icon: Circle,
  },
  introduced: {
    label: "Introduced",
    description:
      "Introduced in conversation; understanding not yet demonstrated",
    icon: CircleDot,
  },
  covered: {
    label: "Covered",
    description: "Covered in conversation; understanding not yet demonstrated",
    icon: BookOpenCheck,
  },
  partial: {
    label: "Partial understanding",
    description: "Some understanding demonstrated; more evidence is needed",
    icon: CircleDashed,
  },
  demonstrated: {
    label: "Demonstrated",
    description: "Understanding recorded as demonstrated",
    icon: CheckCircle2,
  },
  review: {
    label: "Review",
    description: "Marked for review",
    icon: RotateCcw,
  },
  gap: {
    label: "Open gap",
    description: "A gap or unresolved difficulty is recorded",
    icon: CircleAlert,
  },
};

function makePathway(nodes: CurriculumNode[]) {
  const ordered = [...nodes].sort(
    (a, b) => a.position - b.position || a.title.localeCompare(b.title),
  );
  const byId = new Map<string, CurriculumNode>();
  for (const node of ordered) {
    if (!byId.has(node.id)) byId.set(node.id, node);
  }
  const children = new Map<string, CurriculumNode[]>();
  const roots: CurriculumNode[] = [];
  for (const node of byId.values()) {
    if (
      !node.parentId ||
      !byId.has(node.parentId) ||
      node.parentId === node.id
    ) {
      roots.push(node);
    } else {
      const siblings = children.get(node.parentId) ?? [];
      siblings.push(node);
      children.set(node.parentId, siblings);
    }
  }

  // Old or imported pathways can contain a cycle or an orphan. Keep every real
  // node reachable without recursing through an unbounded parent chain.
  const reached = new Set<string>();
  const markBranch = (root: CurriculumNode) => {
    const pending = [root];
    while (pending.length) {
      const node = pending.pop()!;
      if (reached.has(node.id)) continue;
      reached.add(node.id);
      pending.push(...(children.get(node.id) ?? []));
    }
  };
  roots.forEach(markBranch);
  for (const node of byId.values()) {
    if (reached.has(node.id)) continue;
    roots.push(node);
    markBranch(node);
  }
  return { byId, children, roots };
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function SubjectContents({
  snapshot,
  lessons,
  activeLesson,
  onOpenLesson,
  onOpenTopic,
  onDashboard,
  onMemory,
  onSources,
  onNew,
  onCollapse,
  width = 276,
  onResize,
}: SubjectContentsProps) {
  const subjectId = snapshot?.subject.id ?? "";
  const currentId =
    activeLesson?.curriculumNodeId ?? snapshot?.subject.currentNodeId;
  const pathway = useMemo(
    () =>
      makePathway(
        snapshot?.curriculum.filter((node) => node.subjectId === subjectId) ??
          [],
      ),
    [snapshot?.curriculum, subjectId],
  );
  const initialExpanded = useMemo(() => {
    const expanded = new Set<string>();
    const visited = new Set<string>();
    let node = currentId ? pathway.byId.get(currentId) : undefined;
    while (node && !visited.has(node.id)) {
      visited.add(node.id);
      if (node.parentId) expanded.add(node.parentId);
      node = node.parentId ? pathway.byId.get(node.parentId) : undefined;
    }
    return expanded;
  }, [currentId, pathway]);
  const scope = `${subjectId}:${currentId ?? ""}`;
  const [navigation, setNavigation] = useState<{
    scope: string;
    expanded: Set<string>;
    limit: number;
  }>({ scope: "", expanded: new Set(), limit: 60 });
  const expanded =
    navigation.scope === scope ? navigation.expanded : initialExpanded;
  const visibleLimit = navigation.scope === scope ? navigation.limit : 60;
  const rows = useMemo(() => {
    const result: { node: CurriculumNode; depth: number }[] = [];
    const visited = new Set<string>();
    const pending = pathway.roots.map((node) => ({ node, depth: 0 })).reverse();
    while (pending.length) {
      const entry = pending.pop()!;
      if (visited.has(entry.node.id)) continue;
      visited.add(entry.node.id);
      result.push(entry);
      if (!expanded.has(entry.node.id)) continue;
      const children = pathway.children.get(entry.node.id) ?? [];
      for (let index = children.length - 1; index >= 0; index -= 1) {
        pending.push({ node: children[index], depth: entry.depth + 1 });
      }
    }
    return result;
  }, [expanded, pathway]);
  // A late current topic must stay findable without mounting every earlier
  // sibling. Keep its branch in view alongside the bounded first page.
  const shownRows = useMemo(() => {
    const firstPage = rows.slice(0, visibleLimit);
    const included = new Set(firstPage.map(({ node }) => node.id));
    const currentBranch = rows
      .filter(
        ({ node }) => initialExpanded.has(node.id) || node.id === currentId,
      )
      .slice(-12);
    return [
      ...firstPage,
      ...currentBranch.filter(({ node }) => !included.has(node.id)),
    ];
  }, [rows, visibleLimit, initialExpanded, currentId]);
  const hiddenRows = rows.length - shownRows.length;
  const hasExpandedBranches = expanded.size > 0;
  const hasBranches = pathway.children.size > 0;
  const recent = useMemo(() => {
    if (!snapshot) return [];
    const conversations = new Set(
      snapshot.conversations
        .filter((item) => !item.archived)
        .map((item) => item.id),
    );
    const archived = new Set(
      snapshot.conversations
        .filter((item) => item.archived)
        .map((item) => item.id),
    );
    return lessons
      .filter(
        (lesson) =>
          !archived.has(lesson.id) &&
          (lesson.subjectId === subjectId ||
            (!lesson.subjectId &&
              (conversations.has(lesson.id) ||
                lesson.subject === snapshot.subject.name))),
      )
      .sort((a, b) => {
        const updatedA =
          Date.parse(a.updatedAt) || Date.parse(a.createdAt) || 0;
        const updatedB =
          Date.parse(b.updatedAt) || Date.parse(b.createdAt) || 0;
        return updatedB - updatedA;
      });
  }, [lessons, snapshot, subjectId]);
  const questionConversations = useMemo(
    () =>
      new Set(
        snapshot?.memory
          .filter((item) => item.kind === "question" && item.conversationId)
          .map((item) => item.conversationId) ?? [],
      ),
    [snapshot?.memory],
  );
  const findings =
    snapshot?.memory.filter((item) => item.kind === "finding").length ?? 0;
  const subjectName = snapshot?.subject.name ?? activeLesson?.subject;
  const objective = snapshot?.subject.objective ?? activeLesson?.objective;

  const toggleBranch = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setNavigation({ scope, expanded: next, limit: visibleLimit });
  };

  return (
    <aside
      className="folio-contents"
      aria-label="Subject contents"
      style={{ width: Number.isFinite(width) ? width : 276 }}
    >
      <header className="folio-contents__header">
        <div className="folio-contents__subject-heading">
          <button
            type="button"
            className="folio-contents__subject-button"
            onClick={onDashboard}
            title={
              subjectName ? `Open ${subjectName} dashboard` : "Open subjects"
            }
          >
            <BookOpen size={19} aria-hidden="true" />
            <span>{subjectName || "Subject contents"}</span>
          </button>
          <button
            type="button"
            className="folio-contents__collapse"
            onClick={onCollapse}
            aria-label="Collapse subject contents"
            title="Collapse subject contents"
          >
            <PanelLeftClose size={17} aria-hidden="true" />
          </button>
        </div>
        {objective &&
          (objective.length > 145 ? (
            <details className="folio-contents__objective">
              <summary>
                <span>{objective.slice(0, 142).trimEnd()}…</span>
                <span className="folio-contents__text-button">Read more</span>
              </summary>
              <p>{objective}</p>
            </details>
          ) : (
            <p className="folio-contents__objective">{objective}</p>
          ))}
      </header>

      <div className="folio-contents__scroll">
        <section
          className="folio-contents__section"
          aria-labelledby="folio-pathway-heading"
        >
          <div className="folio-contents__section-heading">
            <h2 id="folio-pathway-heading">Learning pathway</h2>
            {hasBranches && (
              <button
                type="button"
                className="folio-contents__text-button"
                title={
                  hasExpandedBranches
                    ? "Collapse pathway branches"
                    : "Expand pathway branches"
                }
                onClick={() =>
                  setNavigation({
                    scope,
                    expanded: hasExpandedBranches
                      ? new Set()
                      : new Set(pathway.children.keys()),
                    limit: 60,
                  })
                }
              >
                {hasExpandedBranches ? "Collapse all" : "Expand all"}
              </button>
            )}
          </div>
          {pathway.byId.size ? (
            <>
              <ul
                className="folio-contents__tree"
                aria-label="Learning pathway topics"
              >
                {shownRows.map(({ node, depth }) => {
                  const children = pathway.children.get(node.id) ?? [];
                  const isExpanded = expanded.has(node.id);
                  const isCurrent = node.id === currentId;
                  const status =
                    statusInfo[node.status] ?? statusInfo["not-started"];
                  const StatusIcon = node.skipped ? SkipForward : status.icon;
                  const label = node.skipped ? "Skipped" : status.label;
                  return (
                    <li
                      key={node.id}
                      className="folio-contents__tree-item"
                      data-kind={node.kind}
                      style={
                        {
                          "--contents-depth": Math.min(depth, 5),
                        } as CSSProperties
                      }
                    >
                      <div
                        className="folio-contents__tree-row"
                        data-current={isCurrent || undefined}
                      >
                        {children.length ? (
                          <button
                            type="button"
                            className="folio-contents__tree-toggle"
                            onClick={() => toggleBranch(node.id)}
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.title}`}
                            title={`${isExpanded ? "Collapse" : "Expand"} ${node.title}`}
                          >
                            {isExpanded ? (
                              <ChevronDown size={14} aria-hidden="true" />
                            ) : (
                              <ChevronRight size={14} aria-hidden="true" />
                            )}
                          </button>
                        ) : (
                          <span
                            className="folio-contents__tree-toggle"
                            aria-hidden="true"
                          />
                        )}
                        <button
                          type="button"
                          className="folio-contents__node"
                          aria-current={isCurrent ? "location" : undefined}
                          aria-label={`${node.title}${isCurrent ? " Current" : ""}. ${label}${isCurrent ? ". Current topic" : ""}`}
                          title={`${node.title} — ${node.skipped ? "Marked as skipped" : status.description}`}
                          onClick={() => onOpenTopic(node)}
                        >
                          <StatusIcon
                            className="folio-contents__node-status"
                            data-status={node.skipped ? "skipped" : node.status}
                            size={14}
                            aria-hidden="true"
                          />
                          <span className="folio-contents__node-copy">
                            <span className="folio-contents__node-title">
                              {node.title}
                            </span>{" "}
                            {isCurrent && (
                              <span className="folio-contents__current-label">
                                Current
                              </span>
                            )}
                          </span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {hiddenRows > 0 && (
                <button
                  type="button"
                  className="folio-contents__text-button"
                  onClick={() =>
                    setNavigation({ scope, expanded, limit: visibleLimit + 60 })
                  }
                >
                  Show more topics ({hiddenRows} remaining)
                </button>
              )}
              <p className="folio-contents__legend">
                <BookOpenCheck size={12} aria-hidden="true" /> Covered
                <CheckCircle2 size={12} aria-hidden="true" /> Demonstrated
                <span>
                  Discussion and demonstrated understanding are tracked
                  separately.
                </span>
              </p>
            </>
          ) : (
            <div className="folio-contents__empty">
              <p>No pathway yet.</p>
              <p>
                Build a pathway from the subject dashboard, or follow a question
                in a new session.
              </p>
              <button
                type="button"
                className="folio-contents__text-button"
                onClick={onDashboard}
              >
                Open dashboard
              </button>
            </div>
          )}
        </section>

        <section
          className="folio-contents__section"
          aria-labelledby="folio-conversations-heading"
        >
          <div className="folio-contents__section-heading">
            <h2 id="folio-conversations-heading">Study sessions</h2>
            {recent.length > 8 && (
              <button
                type="button"
                className="folio-contents__text-button"
                onClick={onDashboard}
                title="Show all subject conversations on the dashboard"
              >
                Show all
              </button>
            )}
          </div>
          {recent.length ? (
            <ol className="folio-contents__recent">
              {recent.slice(0, 8).map((lesson) => (
                <li key={lesson.id}>
                  <button
                    type="button"
                    className="folio-contents__recent-button"
                    aria-current={
                      lesson.id === activeLesson?.id ? "page" : undefined
                    }
                    title={`Open ${lesson.title}`}
                    onClick={() => onOpenLesson(lesson.id)}
                  >
                    <MessageSquare size={14} aria-hidden="true" />
                    <span className="folio-contents__node-copy">
                      <span className="folio-contents__recent-title">
                        {lesson.title}
                      </span>
                      <span className="folio-contents__recent-meta">
                        <span>{lesson.mode}</span>
                        <time dateTime={lesson.updatedAt}>
                          {formatDate(lesson.updatedAt)}
                        </time>
                        {questionConversations.has(lesson.id) && (
                          <span
                            className="folio-contents__question-tag"
                            title="A question is saved in this conversation’s shared memory"
                          >
                            Question
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="folio-contents__empty">
              Your conversations in this subject will appear here.
            </p>
          )}
        </section>
      </div>

      <footer className="folio-contents__footer">
        <button
          type="button"
          className="folio-contents__footer-button"
          disabled={!snapshot}
          onClick={onMemory}
          title={`Open shared memory · ${findings} saved ${findings === 1 ? "finding" : "findings"}`}
        >
          <NotebookPen size={16} aria-hidden="true" />
          <span>Shared memory</span>
          <span
            className="folio-contents__count"
            aria-label={`${findings} findings`}
          >
            {findings}
          </span>
        </button>
        <button
          type="button"
          className="folio-contents__footer-button"
          disabled={!snapshot}
          onClick={onSources}
          title="Open sources for this subject"
        >
          <Library size={16} aria-hidden="true" />
          <span>Sources</span>
        </button>
        <button
          type="button"
          className="folio-contents__new-session"
          aria-label="New learning session"
          onClick={onNew}
          title="Start a new conversation"
        >
          <Plus size={16} aria-hidden="true" />
          <span>New learning session</span>
        </button>
      </footer>
      <div
        className="folio-contents-resizer"
        role="separator"
        aria-label="Resize subject contents"
        aria-orientation="vertical"
        onPointerDown={onResize}
      />
    </aside>
  );
}
