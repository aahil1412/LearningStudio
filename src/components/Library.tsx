import { useMemo, useState, useEffect, useRef, type DragEvent } from "react";
import {
  ArrowUpRight,
  BookOpen,
  BookOpenCheck,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  FolderOpen,
  GraduationCap,
  LibraryBig,
  Link2,
  Plus,
  Search,
  Shapes,
  StickyNote,
  Trash2,
  Upload,
  X,
  FolderTree,
} from "lucide-react";
import type { Lesson, LibraryItem } from "../types";
import {
  libraryHierarchyProblems,
  libraryPath,
  reparentLibraryItem,
  removeLibraryItem,
} from "../lib/learning";
import "./Library.css";

type Props = {
  items: LibraryItem[];
  lessons: Lesson[];
  onChange: (items: LibraryItem[]) => void;
  onOpenLesson: (id: string) => void;
  onLearn: (goal: string) => void;
  onStudyDocument?: (id: string) => void;
  workspaceSubject?: { id: string; name: string };
  initialItemId?: string;
};
type Kind = LibraryItem["kind"];
type DocumentImport = {
  title: string;
  content: string;
  source: string;
  sourceAssetId?: string;
  pages?: LibraryItem["pages"];
  figures?: LibraryItem["figures"];
  warnings?: string[];
  citations?: { text: string; doi?: string; url?: string }[];
};
const kinds: Kind[] = [
  "subject",
  "course",
  "topic",
  "note",
  "document",
  "reference",
  "practice",
];
const catalogs = [
  {
    name: "Mathematics",
    description: "Patterns, structures & proof",
    topics: ["Algebra", "Calculus", "Statistics", "Geometry"],
    symbol: "∑",
  },
  {
    name: "Natural sciences",
    description: "Understand the physical world",
    topics: ["Physics", "Chemistry", "Biology", "Earth science"],
    symbol: "✳",
  },
  {
    name: "Computing",
    description: "Ideas that make things work",
    topics: [
      "Computer science",
      "Machine learning",
      "Programming",
      "Data science",
    ],
    symbol: "⌘",
  },
  {
    name: "Engineering",
    description: "From principles to possibilities",
    topics: ["Mechanical engineering", "Electronics", "Materials", "Systems"],
    symbol: "⌁",
  },
  {
    name: "Humanities",
    description: "People, thought & expression",
    topics: ["History", "Philosophy", "Literature", "Linguistics"],
    symbol: "¶",
  },
  {
    name: "Social sciences",
    description: "Individuals, societies & decisions",
    topics: ["Psychology", "Sociology", "Economics", "Anthropology"],
    symbol: "◎",
  },
  {
    name: "Arts & design",
    description: "Practice seeing differently",
    topics: ["Visual arts", "Music", "Architecture", "Design"],
    symbol: "◈",
  },
  {
    name: "Languages",
    description: "New ways to connect",
    topics: ["Language learning", "Writing", "Grammar", "Translation"],
    symbol: "Aa",
  },
  {
    name: "Everyday life",
    description: "Curiosity beyond the classroom",
    topics: [
      "Practical skills",
      "Personal projects",
      "Communication",
      "Learning how to learn",
    ],
    symbol: "↗",
  },
];
const kindLabel = (kind: Kind) =>
  kind === "practice"
    ? "Practice collection"
    : kind[0].toUpperCase() + kind.slice(1);
const ItemIcon = ({ kind, size = 19 }: { kind: Kind; size?: number }) => {
  const Icon = {
    subject: FolderOpen,
    course: GraduationCap,
    topic: Shapes,
    note: StickyNote,
    document: FileText,
    reference: Link2,
    practice: BookOpenCheck,
  }[kind];
  return <Icon size={size} />;
};
const safeUrl = (source: string | undefined) => {
  try {
    const url = new URL(source || "");
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
};
const dateLabel = (date: string) => {
  const d = new Date(date);
  return Number.isNaN(d.getTime())
    ? "Saved locally"
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export default function Library({
  items,
  lessons,
  onChange,
  onOpenLesson,
  onLearn,
  onStudyDocument,
  workspaceSubject,
  initialItemId,
}: Props) {
  const handledItem = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!initialItemId || handledItem.current === initialItemId) return;
    const item = items.find((item) => item.id === initialItemId);
    if (item) {
      handledItem.current = initialItemId;
      openItem(item);
      setTab("collection");
    }
  }, [initialItemId, items]);
  const [tab, setTab] = useState<
    "collection" | "sessions" | "discover" | "hierarchy"
  >("collection");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Kind>("note");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [source, setSource] = useState("");
  const [parentId, setParentId] = useState("");
  const [linkedLessons, setLinkedLessons] = useState<string[]>([]);
  const [verified, setVerified] = useState(false);
  const [documentQuery, setDocumentQuery] = useState("");
  const [documentHits, setDocumentHits] = useState<
    {
      documentId: string;
      title: string;
      chunkId: string;
      text: string;
      page?: number;
      score: number;
      citation: string;
    }[]
  >([]);
  const [documentSearching, setDocumentSearching] = useState(false);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selected = items.find((item) => item.id === selectedId);
  const subjectNames = useMemo(
    () =>
      [
        ...new Set([
          ...catalogs.map((c) => c.name),
          ...items.filter((i) => i.kind === "subject").map((i) => i.title),
          ...items.map((i) => i.subject).filter(Boolean),
        ]),
      ].sort(),
    [items],
  );
  const query = search.trim().toLowerCase();
  const treeAllowed = useMemo(
    () =>
      new Set(
        items
          .filter(
            (item) =>
              !query ||
              `${item.title} ${item.content} ${item.subject}`
                .toLowerCase()
                .includes(query) ||
              (item.lessonIds || []).some((id) =>
                lessons
                  .find((l) => l.id === id)
                  ?.title.toLowerCase()
                  .includes(query),
              ),
          )
          .flatMap((item) =>
            libraryPath(items, item.id).map((ancestor) => ancestor.id),
          ),
      ),
    [items, query, lessons],
  );
  const filteredItems = useMemo(
    () =>
      items
        .filter(
          (item) =>
            (filter === "all" || item.kind === filter) &&
            `${item.title} ${item.subject} ${item.content} ${item.source || ""}`
              .toLowerCase()
              .includes(query),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [items, filter, query],
  );
  const filteredLessons = useMemo(
    () =>
      lessons
        .filter((lesson) =>
          `${lesson.title} ${lesson.subject} ${lesson.objective} ${lesson.notes}`
            .toLowerCase()
            .includes(query),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [lessons, query],
  );
  const filteredCatalog = catalogs.filter((c) =>
    `${c.name} ${c.description} ${c.topics.join(" ")}`
      .toLowerCase()
      .includes(query),
  );
  const openItem = (item: LibraryItem) => {
    setSelectedId(item.id);
    setCreating(false);
    setEditing(false);
    setTitle(item.title);
    setKind(item.kind);
    setSubject(item.subject);
    setContent(item.content);
    setSource(item.source || "");
    setParentId(item.parentId || "");
    setLinkedLessons(item.lessonIds || []);
    setVerified(item.verified === true);
    setDocumentHits([]);
    setDocumentQuery("");
    setError("");
    setConfirmDelete(false);
  };
  const add = (newKind: Kind = "note") => {
    setCreating(true);
    setEditing(true);
    setSelectedId(null);
    setTitle("");
    setKind(newKind);
    setSubject(workspaceSubject?.name || "");
    setContent("");
    setSource("");
    setParentId(
      selected &&
        ["subject", "course", "topic", "practice"].includes(selected.kind)
        ? selected.id
        : "",
    );
    setLinkedLessons([]);
    setVerified(false);
    setError("");
    setConfirmDelete(false);
  };
  const close = () => {
    setSelectedId(null);
    setCreating(false);
    setEditing(false);
    setConfirmDelete(false);
    setError("");
  };
  const save = () => {
    if (!title.trim()) {
      setError("Add a title before saving.");
      return;
    }
    if (kind === "reference" && source.trim() && !safeUrl(source.trim())) {
      setError("Use a valid http or https reference URL.");
      return;
    }
    const record: LibraryItem = {
      ...(selected || {}),
      id: creating ? crypto.randomUUID() : selectedId!,
      title: title.trim(),
      kind,
      subject: kind === "subject" ? title.trim() : subject.trim(),
      subjectId:
        workspaceSubject && subject.trim() === workspaceSubject.name
          ? workspaceSubject.id
          : selected?.subjectId,
      content: content.trim(),
      createdAt: creating ? new Date().toISOString() : selected!.createdAt,
      source: source.trim() || undefined,
      parentId: parentId || undefined,
      lessonIds: linkedLessons,
      verified,
    };
    let next = creating
      ? [...items, record]
      : items.map((i) => (i.id === record.id ? record : i));
    const problems = libraryHierarchyProblems(
      next,
      new Set(lessons.map((l) => l.id)),
    );
    if (problems.length) {
      setError(problems[0]);
      return;
    }
    next = reparentLibraryItem(next, record.id, record.parentId);
    onChange(next);
    setCreating(false);
    setSelectedId(record.id);
    setEditing(false);
    setError("");
  };
  const importFile = async () => {
    if (!window.studio) {
      setError("Document import is available in the desktop application.");
      return;
    }
    setImporting(true);
    setError("");
    try {
      const imported = await window.studio.invoke<DocumentImport | null>(
        "library:import",
      );
      if (!imported) return;
      const record: LibraryItem = {
        id: crypto.randomUUID(),
        title: imported.title,
        kind: "document",
        subject: workspaceSubject?.name || "",
        subjectId: workspaceSubject?.id,
        content: imported.content,
        source: imported.source,
        sourceAssetId: imported.sourceAssetId,
        createdAt: new Date().toISOString(),
        verified: false,
        pages: imported.pages,
        figures: imported.figures,
        citations: imported.citations,
        warnings: imported.warnings,
      };
      setImportWarnings(imported.warnings || []);
      onChange([...items, record]);
      openItem(record);
      setTab("collection");
      setFilter("all");
      setSearch("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The document could not be imported. Your library is unchanged.",
      );
    } finally {
      setImporting(false);
    }
  };
  const moveItem = (id: string, parent?: string) => {
    try {
      onChange(reparentLibraryItem(items, id, parent));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "This move is not valid.");
    }
  };
  const dropFiles = async (
    event: DragEvent<HTMLElement>,
    targetParent?: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const moved = event.dataTransfer.getData("application/x-studio-library");
    if (moved) {
      moveItem(moved);
      return;
    }
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    const bridge = window.studio as unknown as
      | { importDroppedFiles?: (files: File[]) => Promise<DocumentImport[]> }
      | undefined;
    if (!bridge?.importDroppedFiles) {
      setError(
        "Open the updated desktop app to import dropped files, or use Import document.",
      );
      return;
    }
    setImporting(true);
    try {
      const documents = await bridge.importDroppedFiles(files);
      const records: LibraryItem[] = documents.map((doc) => ({
        id: crypto.randomUUID(),
        title: doc.title,
        kind: "document",
        subject: targetParent
          ? libraryPath(items, targetParent).find((i) => i.kind === "subject")
              ?.title || ""
          : workspaceSubject?.name || "",
        subjectId: targetParent ? undefined : workspaceSubject?.id,
        parentId: targetParent,
        content: doc.content,
        source: doc.source,
        sourceAssetId: doc.sourceAssetId,
        createdAt: new Date().toISOString(),
        verified: false,
        pages: doc.pages,
        figures: doc.figures,
        citations: doc.citations,
        warnings: doc.warnings,
      }));
      const next = [...items, ...records];
      const problems = libraryHierarchyProblems(next);
      if (problems.length) throw new Error(problems[0]);
      onChange(next);
      setImportWarnings(documents.flatMap((doc) => doc.warnings || []));
      if (records[0]) openItem(records[0]);
      setTab("collection");
      setError("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The dropped files could not be imported.",
      );
    } finally {
      setImporting(false);
    }
  };
  const tree = (parent?: string, depth = 0): React.ReactNode => {
    if (depth > 30) return null;
    const children = items.filter(
      (item) =>
        (item.parentId || undefined) === parent && treeAllowed.has(item.id),
    );
    return (
      <ul role={depth ? "group" : "tree"}>
        {children.map((item) => (
          <li key={item.id} role="treeitem">
            <div
              className="lib-tree-row"
              draggable
              onDragStart={(e) =>
                e.dataTransfer.setData("application/x-studio-library", item.id)
              }
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                const id = e.dataTransfer.getData(
                  "application/x-studio-library",
                );
                if (id) {
                  e.preventDefault();
                  e.stopPropagation();
                  moveItem(id, item.id);
                } else if (e.dataTransfer.files.length) {
                  void dropFiles(e, item.id);
                }
              }}
            >
              <button
                onClick={() => openItem(item)}
                className={selectedId === item.id ? "active" : ""}
              >
                <ItemIcon kind={item.kind} size={15} />
                <strong>{item.title}</strong>
                <small>{kindLabel(item.kind)}</small>
              </button>
              <button
                aria-label={"Add inside " + item.title}
                onClick={() => {
                  add(
                    item.kind === "subject"
                      ? "course"
                      : item.kind === "course"
                        ? "topic"
                        : "note",
                  );
                  setParentId(item.id);
                }}
                disabled={
                  !["subject", "course", "topic", "practice"].includes(
                    item.kind,
                  )
                }
              >
                <Plus size={13} />
              </button>
            </div>
            {(item.lessonIds || []).map((id) => {
              const lesson = lessons.find((l) => l.id === id);
              return lesson ? (
                <button
                  key={id}
                  className="lib-tree-lesson"
                  onClick={() => onOpenLesson(id)}
                >
                  <BookOpen size={13} />
                  {lesson.title}
                  <ArrowUpRight size={11} />
                </button>
              ) : null;
            })}
            {tree(item.id, depth + 1)}
          </li>
        ))}
      </ul>
    );
  };
  const searchDocument = async () => {
    if (!selected || !documentQuery.trim()) return;
    setDocumentSearching(true);
    try {
      const result = await window.studio?.invoke<typeof documentHits>(
        "documents:search",
        { query: documentQuery, documentIds: [selected.id], limit: 6 },
      );
      setDocumentHits(result || []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Document search failed.");
    } finally {
      setDocumentSearching(false);
    }
  };

  return (
    <section
      className="lib-workspace"
      aria-label="Learning library"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={dropFiles}
    >
      <header className="lib-header">
        <div>
          <span className="lib-eyebrow">A HOME FOR YOUR CURIOSITY</span>
          <h1>
            <LibraryBig size={26} />
            Learning library
          </h1>
          <p>Lessons, notes, and ideas worth coming back to.</p>
        </div>
        <div className="lib-header-actions">
          <button onClick={importFile} disabled={importing}>
            <Upload size={15} />
            {importing ? "Importing…" : "Import document"}
          </button>
          <button className="lib-primary" onClick={() => add()}>
            <Plus size={16} />
            Add to library
          </button>
        </div>
      </header>
      <div className="lib-summary">
        <div>
          <span>{items.length}</span>saved resources
        </div>
        <div>
          <span>{lessons.length}</span>learning sessions
        </div>
        <div>
          <span>
            {
              new Set(
                [
                  ...items.map((i) => i.subject),
                  ...lessons.map((l) => l.subject),
                ].filter(Boolean),
              ).size
            }
          </span>
          subject areas
        </div>
        <p>Your library grows at your own pace.</p>
      </div>
      {importWarnings.length > 0 && (
        <div className="lib-import-warnings" role="status">
          <strong>Import notes</strong>
          {importWarnings.map((warning, i) => (
            <p key={i}>{warning}</p>
          ))}
          <button onClick={() => setImportWarnings([])}>
            Dismiss import notes
          </button>
        </div>
      )}
      <div className="lib-controls">
        <nav aria-label="Library sections">
          <button
            className={tab === "hierarchy" ? "lib-tab-active" : ""}
            onClick={() => setTab("hierarchy")}
          >
            <FolderTree size={13} />
            Hierarchy
          </button>
          <button
            className={tab === "collection" ? "lib-tab-active" : ""}
            onClick={() => setTab("collection")}
          >
            My collection <small>{items.length}</small>
          </button>
          <button
            className={tab === "sessions" ? "lib-tab-active" : ""}
            onClick={() => setTab("sessions")}
          >
            Saved sessions <small>{lessons.length}</small>
          </button>
          <button
            className={tab === "discover" ? "lib-tab-active" : ""}
            onClick={() => setTab("discover")}
          >
            Discover subjects
          </button>
        </nav>
        <label className="lib-search">
          <Search size={15} />
          <input
            aria-label="Search library"
            placeholder="Search your library…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {error && !selected && !creating && (
        <div role="alert" className="lib-error">
          {error}
          <button
            aria-label="Dismiss library error"
            onClick={() => setError("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div
        className={`lib-body ${selected || creating ? "lib-with-details" : ""}`}
      >
        <div className="lib-main">
          {tab === "hierarchy" && (
            <>
              <div className="lib-section-intro">
                <h2>A place for every connection</h2>
                <p>
                  Subjects contain courses, courses contain topics, and topics
                  connect lessons and resources. Drag a resource to move it, or
                  edit its parent.
                </p>
              </div>
              <div
                className="lib-tree-root"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData(
                    "application/x-studio-library",
                  );
                  if (id) {
                    e.preventDefault();
                    e.stopPropagation();
                    moveItem(id);
                  }
                }}
              >
                Drop here to move to the library root
              </div>
              <div className="lib-tree">{tree()}</div>
              {!items.length && (
                <button className="lib-primary" onClick={() => add("subject")}>
                  Create your first subject
                </button>
              )}
            </>
          )}
          {tab === "collection" && (
            <>
              <div className="lib-filters" aria-label="Resource types">
                <button
                  className={filter === "all" ? "active" : ""}
                  onClick={() => setFilter("all")}
                >
                  Everything
                </button>
                {kinds.map((k) => (
                  <button
                    key={k}
                    className={filter === k ? "active" : ""}
                    onClick={() => setFilter(k)}
                  >
                    <ItemIcon kind={k} size={12} />
                    {kindLabel(k)}
                  </button>
                ))}
              </div>
              {filteredItems.length ? (
                <div className="lib-resource-grid">
                  {filteredItems.map((item) => (
                    <button
                      key={item.id}
                      className={`lib-resource ${selectedId === item.id ? "lib-resource-selected" : ""}`}
                      onClick={() => openItem(item)}
                    >
                      <span
                        className={`lib-resource-icon lib-icon-${item.kind}`}
                      >
                        <ItemIcon kind={item.kind} />
                      </span>
                      <span className="lib-resource-type">
                        {kindLabel(item.kind)}
                      </span>
                      <h2>{item.title}</h2>
                      <p>
                        {item.content.slice(0, 160) ||
                          "Add notes, references, or a learning goal to make this your own."}
                      </p>
                      <footer>
                        <span>{item.subject || "Uncategorized"}</span>
                        <span>{dateLabel(item.createdAt)}</span>
                      </footer>
                      {item.kind === "document" && (
                        <span className="lib-unverified">
                          {item.verified
                            ? "Source checked by you"
                            : "Imported · unverified"}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="lib-empty">
                  <div className="lib-empty-icon">
                    <BookOpen size={36} />
                  </div>
                  <span className="lib-eyebrow">ROOM FOR SOMETHING NEW</span>
                  <h2>
                    {query || filter !== "all"
                      ? "No resources found"
                      : "Make room for your next idea"}
                  </h2>
                  <p>
                    {query || filter !== "all"
                      ? "Try a different search or resource type."
                      : "Save a note, bring in a document, or find a subject that catches your curiosity. Everything stays in your local library."}
                  </p>
                  <div>
                    <button className="lib-primary" onClick={() => add()}>
                      <Plus size={15} />
                      Create a note
                    </button>
                    <button onClick={() => setTab("discover")}>
                      Discover subjects
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <span className="lib-import-note">
                    Import Markdown, plain text, or PDF documents
                  </span>
                </div>
              )}
            </>
          )}
          {tab === "sessions" && (
            <>
              <div className="lib-section-intro">
                <h2>Pick up where you left off</h2>
                <p>Your objective, conversation, and notes stay together.</p>
              </div>
              {filteredLessons.length ? (
                <div className="lib-sessions">
                  {filteredLessons.map((lesson) => (
                    <button
                      className="lib-session"
                      key={lesson.id}
                      onClick={() => onOpenLesson(lesson.id)}
                    >
                      <span className="lib-resource-icon">
                        <BookOpen size={20} />
                      </span>
                      <span className="lib-session-content">
                        <small>
                          {lesson.subject || "Open learning"} · {lesson.mode}
                          {lesson.example ? " · Example lesson" : ""}
                        </small>
                        <strong>{lesson.title}</strong>
                        <p>{lesson.objective}</p>
                        <span>
                          <Clock3 size={11} />
                          {dateLabel(lesson.updatedAt)} ·{" "}
                          {lesson.messages.length} messages
                        </span>
                      </span>
                      <ChevronRight size={17} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="lib-empty lib-empty-small">
                  <BookOpen size={36} />
                  <h2>
                    {query
                      ? "No matching sessions"
                      : "Your first lesson is waiting"}
                  </h2>
                  <p>
                    Start with any question or broad subject. Each session is
                    saved automatically.
                  </p>
                  <button className="lib-primary" onClick={() => onLearn("")}>
                    Start learning
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              )}
            </>
          )}
          {tab === "discover" && (
            <>
              <div className="lib-section-intro">
                <h2>Follow your curiosity</h2>
                <p>
                  A starting point, never a boundary. Create any subject you
                  like.
                </p>
              </div>
              <div className="lib-catalog-grid">
                {filteredCatalog.map((c) => (
                  <article className="lib-subject" key={c.name}>
                    <span className="lib-subject-symbol">{c.symbol}</span>
                    <h2>{c.name}</h2>
                    <p>{c.description}</p>
                    <div>
                      {c.topics.map((topic) => (
                        <button key={topic} onClick={() => onLearn(topic)}>
                          {topic}
                        </button>
                      ))}
                    </div>
                    <button
                      className="lib-subject-start"
                      onClick={() => onLearn(c.name)}
                    >
                      Explore {c.name.toLowerCase()}
                      <ArrowUpRight size={14} />
                    </button>
                  </article>
                ))}
                {!query && (
                  <button
                    className="lib-custom-subject"
                    onClick={() => add("subject")}
                  >
                    <Plus size={27} />
                    <h2>Something else entirely</h2>
                    <p>Your interests do not need to fit a category.</p>
                    <span>
                      Create a subject
                      <ArrowUpRight size={14} />
                    </span>
                  </button>
                )}
              </div>
              {!filteredCatalog.length && (
                <div className="lib-empty lib-empty-small">
                  <Search size={30} />
                  <h2>Your curiosity is welcome here</h2>
                  <p>
                    Start a lesson on “{search}” or create your own subject
                    area.
                  </p>
                  <button
                    className="lib-primary"
                    onClick={() => onLearn(search)}
                  >
                    Learn about {search}
                    <ArrowUpRight size={14} />
                  </button>
                  <button onClick={() => add("subject")}>
                    Create a subject
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        {(selected || creating) && (
          <aside
            className="lib-details"
            aria-label={
              creating ? "New library resource" : "Library resource details"
            }
          >
            <header>
              <span className="lib-eyebrow">
                {creating
                  ? "NEW RESOURCE"
                  : kindLabel(selected!.kind).toUpperCase()}
              </span>
              <button aria-label="Close library details" onClick={close}>
                <X size={17} />
              </button>
            </header>
            {editing ? (
              <>
                <label>
                  Title
                  <input
                    aria-label="Resource title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Give this idea a home"
                  />
                </label>
                <label>
                  Resource type
                  <select
                    aria-label="Resource type"
                    value={kind}
                    onChange={(e) => {
                      setKind(e.target.value as Kind);
                      if (e.target.value === "subject") setParentId("");
                    }}
                  >
                    {kinds.map((k) => (
                      <option key={k} value={k}>
                        {kindLabel(k)}
                      </option>
                    ))}
                  </select>
                </label>
                {kind !== "subject" && (
                  <label>
                    Subject
                    <input
                      list="library-subjects"
                      aria-label="Resource subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Choose or create a subject"
                    />
                    <datalist id="library-subjects">
                      {subjectNames.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </label>
                )}
                {kind !== "subject" && (
                  <label>
                    Parent collection
                    <select
                      aria-label="Resource parent"
                      value={parentId}
                      onChange={(e) => setParentId(e.target.value)}
                    >
                      <option value="">Library root · unfiled</option>
                      {items
                        .filter(
                          (item) =>
                            ["subject", "course", "topic", "practice"].includes(
                              item.kind,
                            ) &&
                            item.id !== selectedId &&
                            !libraryPath(items, item.id).some(
                              (ancestor) => ancestor.id === selectedId,
                            ) &&
                            (kind !== "course" || item.kind === "subject") &&
                            (kind !== "topic" || item.kind !== "practice"),
                        )
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {libraryPath(items, item.id)
                              .map((i) => i.title)
                              .join(" / ")}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label>
                  Linked lessons
                  <select
                    multiple
                    aria-label="Linked library lessons"
                    value={linkedLessons}
                    onChange={(e) =>
                      setLinkedLessons(
                        [...e.currentTarget.selectedOptions].map(
                          (option) => option.value,
                        ),
                      )
                    }
                  >
                    {lessons.map((lesson) => (
                      <option key={lesson.id} value={lesson.id}>
                        {lesson.title}
                      </option>
                    ))}
                  </select>
                  <small>Use Ctrl to select multiple lessons.</small>
                </label>
                {(kind === "document" || kind === "reference") && (
                  <label className="lib-verify-source">
                    <input
                      type="checkbox"
                      checked={verified}
                      onChange={(e) => setVerified(e.target.checked)}
                    />
                    I checked the source content. This does not assess my
                    understanding.
                  </label>
                )}
                <label>
                  {kind === "reference" ? "Notes" : "Content"}
                  <textarea
                    aria-label="Resource content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={13}
                    placeholder="Write a note, outline a course, collect questions, or save an exercise…"
                  />
                </label>
                <label>
                  Source or reference
                  <input
                    aria-label="Resource source"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="https://… (optional)"
                  />
                </label>
                {error && (
                  <p role="alert" className="lib-error">
                    {error}
                  </p>
                )}
                <button className="lib-primary" onClick={save}>
                  <Check size={14} />
                  Save resource
                </button>
                {!creating && (
                  <button
                    onClick={() => {
                      openItem(selected!);
                    }}
                  >
                    Cancel editing
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="lib-resource-icon">
                  <ItemIcon kind={selected!.kind} size={22} />
                </span>
                <h2>{selected!.title}</h2>
                {selected!.parentId && (
                  <nav
                    className="lib-breadcrumbs"
                    aria-label="Resource location"
                  >
                    {libraryPath(items, selected!.id)
                      .slice(0, -1)
                      .map((item) => (
                        <button key={item.id} onClick={() => openItem(item)}>
                          {item.title}
                          <ChevronRight size={10} />
                        </button>
                      ))}
                  </nav>
                )}
                <div className="lib-detail-meta">
                  {selected!.subject || "Uncategorized"} ·{" "}
                  {dateLabel(selected!.createdAt)}
                </div>
                {selected!.kind === "document" && (
                  <p className="lib-unverified-notice">
                    {selected!.verified
                      ? "You marked this source checked."
                      : "Imported source material is unverified."}{" "}
                    Importing does not assess your understanding or mark any
                    concept mastered.
                  </p>
                )}
                {error && (
                  <p role="alert" className="lib-error">
                    {error}
                  </p>
                )}
                {(selected!.lessonIds || []).map((id) => {
                  const lesson = lessons.find((l) => l.id === id);
                  return lesson ? (
                    <button key={id} onClick={() => onOpenLesson(id)}>
                      <BookOpen size={13} />
                      {lesson.title}
                      <ArrowUpRight size={12} />
                    </button>
                  ) : null;
                })}
                {selected!.kind === "document" && (
                  <section className="lib-document-search">
                    <h3>Search inside this document</h3>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void searchDocument();
                      }}
                    >
                      <input
                        aria-label="Search this document"
                        value={documentQuery}
                        onChange={(e) => setDocumentQuery(e.target.value)}
                        placeholder="Ask for a term or idea…"
                      />
                      <button
                        disabled={documentSearching || !documentQuery.trim()}
                      >
                        {documentSearching ? "Searching…" : "Find passages"}
                      </button>
                    </form>
                    {documentHits.map((hit) => (
                      <article key={hit.chunkId}>
                        <small>{hit.citation}</small>
                        <p>{hit.text}</p>
                        <button
                          onClick={() =>
                            onLearn(
                              `Explain this user-supplied, unverified excerpt from ${hit.citation}. Distinguish source claims from established knowledge.\n\n${hit.text.slice(0, 6000)}`,
                            )
                          }
                        >
                          Learn from this passage
                          <ArrowUpRight size={12} />
                        </button>
                      </article>
                    ))}
                  </section>
                )}
                <div className="lib-detail-content">
                  {selected!.content ||
                    "No content yet. Add your notes or learning goals with Edit resource."}
                </div>
                {selected?.kind === "document" && onStudyDocument && (
                  <button onClick={() => onStudyDocument(selected.id)}>
                    Study beside a conversation
                  </button>
                )}
                {!!selected!.figures?.length && (
                  <div className="lib-document-figures">
                    <h3>Extracted document figures</h3>
                    {selected!.figures.map((figure) => (
                      <figure key={figure.id}>
                        <img
                          src={figure.dataUrl}
                          alt={
                            figure.caption ||
                            `Imported figure from page ${figure.page}`
                          }
                        />
                        <figcaption>
                          {figure.caption || "Extracted figure"} · page{" "}
                          {figure.page} · supplied document; redistribution
                          rights are not inferred.
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
                {!!selected!.pages?.length && (
                  <details className="lib-document-pages">
                    <summary>
                      Page text & provenance ({selected!.pages.length} pages)
                    </summary>
                    {selected!.pages.map((p) => (
                      <section key={p.page}>
                        <h3>Page {p.page}</h3>
                        <p>{p.text}</p>
                      </section>
                    ))}
                  </details>
                )}
                {!!selected!.citations?.length && (
                  <section className="lib-document-citations">
                    <h3>Extracted references · verify against source</h3>
                    {selected!.citations.map((citation, i) => (
                      <article key={i}>
                        <p>{citation.text}</p>
                        {(citation.url || citation.doi) && (
                          <button
                            onClick={() => {
                              const url =
                                citation.url ||
                                (citation.doi
                                  ? "https://doi.org/" +
                                    encodeURIComponent(citation.doi)
                                  : "");
                              if (safeUrl(url))
                                void window.studio
                                  ?.invoke("external:open", url)
                                  .catch((err) => setError(String(err)));
                            }}
                          >
                            Open reference
                            <ArrowUpRight size={12} />
                          </button>
                        )}
                      </article>
                    ))}
                  </section>
                )}
                {!!selected!.warnings?.length && (
                  <details className="lib-import-warnings">
                    <summary>
                      Extraction notes ({selected!.warnings.length})
                    </summary>
                    {selected!.warnings.map((warning, i) => (
                      <p key={i}>{warning}</p>
                    ))}
                  </details>
                )}
                {selected!.source && (
                  <div className="lib-detail-source">
                    <span>SOURCE</span>
                    {safeUrl(selected!.source) ? (
                      <a
                        href={safeUrl(selected!.source)!}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => {
                          e.preventDefault();
                          void window.studio
                            ?.invoke("external:open", safeUrl(selected!.source))
                            .catch((err) => setError(String(err)));
                        }}
                      >
                        {selected!.source}
                        <ArrowUpRight size={13} />
                      </a>
                    ) : (
                      <p>{selected!.source}</p>
                    )}
                  </div>
                )}
                <button
                  className="lib-primary"
                  onClick={() =>
                    onLearn(
                      selected!.kind === "document"
                        ? `Learn from ${selected!.title}. Treat the following supplied source as unverified context; cite it separately and identify uncertainty.\n\n${selected!.content.slice(0, 6000)}`
                        : selected!.title,
                    )
                  }
                >
                  <BookOpen size={14} />
                  Start a lesson on this
                </button>
                <button onClick={() => setEditing(true)}>Edit resource</button>
                <button
                  className="lib-delete"
                  onClick={() => {
                    if (!confirmDelete) {
                      setConfirmDelete(true);
                      return;
                    }
                    onChange(removeLibraryItem(items, selected!.id));
                    close();
                  }}
                >
                  <Trash2 size={14} />
                  {confirmDelete ? "Confirm removal" : "Remove from library"}
                </button>
                {confirmDelete && (
                  <button onClick={() => setConfirmDelete(false)}>
                    Keep resource
                  </button>
                )}
              </>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
