import {
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
  type PointerEvent,
} from "react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Compass,
  FolderOpen,
  Layers,
  Library,
  Menu,
  MoreHorizontal,
  Network,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react";
import type { Lesson } from "../../types";
import UsageStatus from "../UsageStatus";

type Destination = {
  id: string;
  label: string;
  title: string;
  icon: typeof BookOpen;
};
const destinations: Destination[] = [
  {
    id: "subjects",
    label: "My learning",
    title: "Subject workspaces",
    icon: Layers,
  },
  {
    id: "workspace",
    label: "Lesson",
    title: "Learning workspace",
    icon: BookOpen,
  },
  { id: "library", label: "Library", title: "Your library", icon: Library },
  { id: "graph", label: "Connections", title: "Knowledge graph", icon: Network },
  { id: "review", label: "Review", title: "Practice & review", icon: Check },
];
const tools = [
  ["annotations", "Highlights & annotations"],
  ["research", "Research & sources"],
  ["textbook", "Living textbook"],
  ["visuals", "Visual notebook"],
  ["documents", "Document study"],
  ["canvas", "Learning canvas"],
];

export function StudioTopbar({
  view,
  onNavigate,
  onBrowse,
  onSearch,
  onNew,
  onSettings,
  accountLabel,
  saveStatus,
  background,
  hasSubject,
}: {
  view: string;
  onNavigate: (view: string) => void;
  onBrowse: () => void;
  onSearch: () => void;
  onNew: () => void;
  onSettings: (tab: string) => void;
  accountLabel: string;
  saveStatus: string;
  background?: ReactNode;
  hasSubject: boolean;
}) {
  const more = useRef<HTMLDetailsElement>(null);
  return (
    <header className="studio-topbar titlebar">
      <div className="studio-wordmark brand">
        <span className="studio-symbol" aria-hidden="true">
          <Layers size={22} />
        </span>
        <span>Learning Studio</span>
      </div>
      <nav className="studio-global-nav main-nav" aria-label="Main navigation">
        {destinations.map(({ id, label, title, icon: Icon }) => (
          <button
            type="button"
            key={id}
            title={title}
            aria-label={
              title.toLowerCase().includes(label.toLowerCase())
                ? title
                : `${title}: ${label}`
            }
            aria-current={
              view === id || (id === "subjects" && view === "subject")
                ? "page"
                : undefined
            }
            onClick={() => onNavigate(id)}
          >
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
        <details className="studio-tools-menu" ref={more}>
          <summary aria-label="More learning tools" title="More learning tools">
            <MoreHorizontal size={19} />
          </summary>
          <div className="studio-tools-popover" role="menu">
            {tools.map(([id, label]) => (
              <button
                type="button"
                role="menuitem"
                key={id}
                disabled={!hasSubject && id !== "research"}
                onClick={() => {
                  onNavigate(id);
                  if (more.current) more.current.open = false;
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </details>
      </nav>
      <div className="studio-account-actions sidebar-bottom">
        <button
          className="studio-command-button"
          type="button"
          aria-label="Search learning conversations Ctrl K"
          title="Search conversations (Ctrl K)"
          onClick={onSearch}
        >
          <Search size={19} />
          <kbd aria-hidden="true">Ctrl K</kbd>
        </button>
        {background}
        <UsageStatus compact />
        <button
          type="button"
          className="account-pill studio-connection"
          onClick={() => onSettings("Account & models")}
        >
          <span className="status-dot" />
          {accountLabel}
          <ArrowUpRight size={13} />
        </button>
        <button
          type="button"
          className="studio-icon-button"
          title="Settings"
          aria-label="Settings"
          onClick={() => onSettings("Appearance")}
        >
          <Settings size={19} />
        </button>
      </div>
      <div className="studio-local-state titlebar-center" aria-live="polite">
        {saveStatus}
      </div>
      <div className="studio-mobile-actions">
        <button aria-label="Browse conversations" onClick={onBrowse}>
          <Menu size={19} />
        </button>
        <button aria-label="New learning session" onClick={onNew}>
          <Plus size={19} />
        </button>
      </div>
    </header>
  );
}

export function ConversationTabs({
  lessons,
  activeId,
  subjectId,
  subjectName,
  onOpen,
  onBrowse,
  onNew,
}: {
  lessons: Lesson[];
  activeId?: string;
  subjectId?: string;
  subjectName?: string;
  onOpen: (id: string) => void;
  onBrowse: () => void;
  onNew: () => void;
}) {
  const relevant = lessons
    .filter((item) => item.subjectId === subjectId || item.id === activeId)
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const tabs = relevant.slice(0, 5);
  const selected = relevant.find((lesson) => lesson.id === activeId);
  if (selected && !tabs.some((lesson) => lesson.id === activeId))
    tabs.splice(4, 1, selected);
  return (
    <div className="studio-conversation-tabs">
      <button
        type="button"
        className="studio-browser-trigger"
        aria-label="Browse conversations"
        title="Browse subjects and conversations"
        onClick={onBrowse}
      >
        <FolderOpen size={18} />
        <span>{subjectName || "Your space"}</span>
        <ChevronDown size={14} />
      </button>
      <div className="studio-tab-list" aria-label="Open conversations">
        {tabs.map((lesson) => (
          <button
            type="button"
            key={lesson.id}
            className={`studio-conversation-tab ${lesson.id === activeId ? "is-active" : ""}`}
            aria-current={lesson.id === activeId ? "page" : undefined}
            title={lesson.title}
            onClick={() => onOpen(lesson.id)}
          >
            <BookOpen size={15} />
            <span>{lesson.title}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="studio-new-tab"
        aria-label="New learning session"
        title="New conversation (Ctrl N)"
        onClick={onNew}
      >
        <Plus size={19} />
      </button>
    </div>
  );
}

export function WorkspaceDrawer({
  open,
  onClose,
  subjects,
  subjectId,
  onSubject,
  lessons,
  activeId,
  onOpen,
  onNew,
  search,
  onSearch,
  searchRef,
  width,
  onResize,
}: {
  open: boolean;
  onClose: () => void;
  subjects: { id: string; name: string; archived?: boolean }[];
  subjectId?: string;
  onSubject: (id: string) => void;
  lessons: Lesson[];
  activeId?: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  search: string;
  onSearch: (value: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  width: number;
  onResize: (event: PointerEvent) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", close);
    };
  }, [open, onClose, searchRef]);
  if (!open) return null;
  const query = search.trim().toLocaleLowerCase();
  const matches = lessons.filter((lesson) => {
    if (
      !query &&
      subjectId &&
      lesson.subjectId &&
      lesson.subjectId !== subjectId
    )
      return false;
    if (!query) return true;
    return [
      lesson.title,
      lesson.subject,
      ...lesson.messages.map((message) =>
        [
          message.text,
          ...(message.content || message.blocks || []).flatMap((block) =>
            block.type === "text" ? [block.text] : [],
          ),
        ].join(" "),
      ),
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query);
  });
  return (
    <div
      className="studio-drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="studio-workspace-drawer sidebar"
        role="dialog"
        aria-modal="true"
        aria-label="Conversation browser"
        style={{ width: Math.max(360, width) }}
      >
        <header>
          <div>
            <h2>Your space</h2>
            <p>Subjects and saved learning sessions</p>
          </div>
          <button
            type="button"
            aria-label="Collapse navigation"
            title="Close browser"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <button
          type="button"
          className="primary new-button"
          aria-label="New learning session"
          onClick={() => {
            onClose();
            onNew();
          }}
        >
          <Plus size={18} />
          New learning session
        </button>
        <div className="search-field">
          <Search size={18} />
          <input
            ref={searchRef}
            aria-label="Search sessions"
            placeholder="Search your learning sessions"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>
        <label className="subject-switcher">
          Subject
          <select
            aria-label="Current subject workspace"
            value={subjectId || ""}
            onChange={(event) => {
              onSubject(event.target.value);
              onClose();
            }}
          >
            <option value="" disabled>
              Choose a subject
            </option>
            {subjects
              .filter(
                (subject) => !subject.archived || subject.id === subjectId,
              )
              .map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
          </select>
        </label>
        <div className="studio-browser-results session-list">
          <h3>
            {query
              ? `${matches.length} matching conversations`
              : "Conversations"}
          </h3>
          {matches.map((lesson) => (
            <button
              type="button"
              key={lesson.id}
              className={`session-item ${activeId === lesson.id ? "active" : ""}`}
              onClick={() => {
                onClose();
                onOpen(lesson.id);
              }}
            >
              <BookOpen size={18} />
              <span>
                <strong>{lesson.title}</strong>
                <small>
                  {lesson.subject} · {lesson.mode}
                </small>
              </span>
            </button>
          ))}
          {!matches.length && (
            <p className="sidebar-empty">
              {query
                ? "No conversations match this search."
                : "Start a conversation to begin building this subject."}
            </p>
          )}
        </div>
        <footer>
          <Compass size={16} />
          Saved on this computer. Your learning stays with you.
        </footer>
        <div
          role="separator"
          aria-label="Resize navigation"
          aria-orientation="vertical"
          className="studio-drawer-resizer"
          onPointerDown={onResize}
        />
      </aside>
    </div>
  );
}
