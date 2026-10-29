import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  FileUp,
  GraduationCap,
  Link2,
  Plus,
  RotateCcw,
  Trash2,
  X,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import type { LibraryItem, StudioData } from "../../types";
import type { CurriculumNode, SubjectSnapshot } from "../../v2types";
import type {
  StudySource,
  StudySourceAdoption,
  StudySourceEntry,
  StudySourceKind,
  StudySourcePreview,
  StudySourceSave,
} from "../../sourceStudyTypes";
import type { SubjectAction } from "../v2/SubjectWorkspace";
import { invoke } from "../../lib/bridge";
import "./source-study.css";

export type SourceStudyPanelProps = {
  snapshot: SubjectSnapshot;
  data: StudioData;
  action: SubjectAction;
  onCreateChat: (node?: CurriculumNode) => Promise<void>;
  onOpenChat: (id: string) => void;
  onImportStudyDocument?: () => Promise<LibraryItem | null>;
  onImportStudyUrl?: (url: string) => Promise<LibraryItem | null>;
  onStudySourcesChanged?: () => Promise<void>;
  onStudySourceDocument?: (resourceId: string, page?: number) => void;
  initialKind?: StudySourceKind;
  onInitialKindConsumed?: () => void;
  compact?: boolean;
};

function issue(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(
    /^.*Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
    "",
  );
}
function pageLabel(entry: StudySourceEntry) {
  if (!entry.startPage) return "Source heading";
  return entry.endPage && entry.endPage !== entry.startPage
    ? `PDF pages ${entry.startPage}–${entry.endPage}`
    : `PDF page ${entry.startPage}`;
}

/** A supplied book or syllabus is a study guide, never evidence of mastery. */
export default function SourceStudyPanel({
  snapshot,
  data,
  action,
  onCreateChat,
  onOpenChat,
  onImportStudyDocument,
  onImportStudyUrl,
  onStudySourcesChanged,
  onStudySourceDocument,
  initialKind,
  onInitialKindConsumed,
  compact = false,
}: SourceStudyPanelProps) {
  const subjectId = snapshot.subject.id;
  const actionRef = useRef(action);
  actionRef.current = action;
  const changedRef = useRef(onStudySourcesChanged);
  changedRef.current = onStudySourcesChanged;
  const sequence = useRef(0);
  const [sources, setSources] = useState<StudySource[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(!compact);
  const [kind, setKind] = useState<StudySourceKind>(
    initialKind || "curriculum",
  );
  const [editing, setEditing] = useState(Boolean(initialKind));
  const [inputMode, setInputMode] = useState<"document" | "paste" | "url">(
    "document",
  );
  const [resourceId, setResourceId] = useState("");
  const [imported, setImported] = useState<LibraryItem[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<StudySourcePreview | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useCallback(
    <T,>(name: string, payload: Record<string, unknown>) =>
      actionRef.current(name, payload) as Promise<T>,
    [],
  );
  const refresh = useCallback(async () => {
    const token = ++sequence.current;
    try {
      const result = await request<StudySource[]>("study-sources:list", {
        subjectId,
      });
      if (token === sequence.current) {
        setSources(result);
        setError("");
      }
    } catch (failure) {
      if (token === sequence.current) setError(issue(failure));
    } finally {
      if (token === sequence.current) setLoading(false);
    }
  }, [request, subjectId]);
  useEffect(() => {
    setPreview(null);
    setEditing(false);
    setImported([]);
    setLoading(true);
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  useEffect(() => {
    void refresh();
  }, [refresh, snapshot.subject.revision]);
  useEffect(() => {
    if (!initialKind) return;
    setKind(initialKind);
    setEditing(true);
    setExpanded(true);
    setPreview(null);
    onInitialKindConsumed?.();
  }, [initialKind, onInitialKindConsumed]);

  const documents = [...data.library, ...imported].filter(
    (item, index, list) =>
      item.kind === "document" &&
      (item.subjectId === subjectId ||
        (!item.subjectId && item.subject === snapshot.subject.name)) &&
      list.findIndex((other) => other.id === item.id) === index,
  );
  const currentResource = documents.find(
    (item) => item.id === (preview?.resourceId || resourceId),
  );
  const pageCount = Math.max(
    0,
    ...(currentResource?.pages || []).map((page) => page.page),
  );
  const active = sources.find((source) => source.active);
  const selectedCount =
    preview?.entries.filter((entry) => entry.selected).length || 0;
  const validPreview = Boolean(
    preview &&
    selectedCount &&
    preview.title.trim() &&
    preview.entries.every((entry) => entry.title.trim()),
  );

  const run = async (label: string, operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (failure) {
      setError(issue(failure));
    } finally {
      setBusy("");
    }
  };
  const chooseKind = (next: StudySourceKind) => {
    setKind(next);
    setEditing(true);
    setExpanded(true);
    setPreview(null);
    setTitle("");
    setResourceId("");
    setText("");
    setUrl("");
    setError("");
  };
  const retainImport = (resource: LibraryItem) => {
    setImported((items) => [
      ...items.filter((item) => item.id !== resource.id),
      resource,
    ]);
    setResourceId(resource.id);
    setTitle(resource.title);
    setInputMode("document");
  };
  const prepare = async (resourceOverride?: LibraryItem) => {
    const chosen = resourceOverride?.id || resourceId;
    const result = await request<StudySourcePreview>("study-sources:prepare", {
      subjectId,
      kind,
      title: title.trim() || resourceOverride?.title || undefined,
      ...(inputMode === "paste" && !resourceOverride
        ? { text: text.trim() }
        : { resourceId: chosen }),
      ...(url.trim() ? { sourceUrl: url.trim() } : {}),
    });
    setPreview(result);
    setTitle(result.title);
  };
  const editEntry = (id: string, patch: Partial<StudySourceEntry>) =>
    setPreview(
      (value) =>
        value && {
          ...value,
          entries: value.entries.map((entry) =>
            entry.id === id ? { ...entry, ...patch } : entry,
          ),
        },
    );
  const removeEntry = (id: string) =>
    setPreview((value) => {
      if (!value) return value;
      const removed = new Set([id]);
      for (let pass = 0; pass < value.entries.length; pass++) {
        const before = removed.size;
        for (const entry of value.entries)
          if (entry.parentId && removed.has(entry.parentId))
            removed.add(entry.id);
        if (before === removed.size) break;
      }
      return {
        ...value,
        entries: value.entries.filter((entry) => !removed.has(entry.id)),
      };
    });
  const moveEntry = (id: string, direction: -1 | 1) =>
    setPreview((value) => {
      if (!value) return value;
      const index = value.entries.findIndex((entry) => entry.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= value.entries.length)
        return value;
      const entries = [...value.entries];
      const [entry] = entries.splice(index, 1);
      entries.splice(target, 0, entry);
      return {
        ...value,
        entries: entries.map((item, order) => ({ ...item, order })),
      };
    });
  const begin = async (source: StudySource, adoption?: StudySourceAdoption) => {
    const current = await request<SubjectSnapshot>("subject:get", {
      subjectId,
    });
    const mappings = adoption?.mappings || source.mappings;
    const mappedIds = new Set(
      mappings.map((mapping) => mapping.curriculumNodeId),
    );
    const position = current.curriculum.find(
      (node) =>
        node.id === current.subject.currentNodeId && mappedIds.has(node.id),
    );
    const entry = [...source.entries]
      .sort((a, b) => a.order - b.order)
      .find(
        (item) =>
          item.selected &&
          mappings.some((mapping) => mapping.entryId === item.id),
      );
    const firstId = mappings.find(
      (mapping) => mapping.entryId === entry?.id,
    )?.curriculumNodeId;
    const node =
      position || current.curriculum.find((item) => item.id === firstId);
    if (!node)
      throw new Error(
        "Apply the reviewed outline to the pathway before starting this source.",
      );
    const previous = current.conversations
      .filter((chat) => !chat.archived && chat.curriculumNodeId === node.id)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    if (previous) onOpenChat(previous.id);
    else await onCreateChat(node);
  };
  const save = async (adopt: boolean, start: boolean) => {
    if (!preview) return;
    const input: StudySourceSave = {
      subjectId,
      sourceId: preview.id,
      kind: preview.kind,
      title: preview.title.trim(),
      resourceId: preview.resourceId,
      sourceUrl: preview.sourceUrl,
      text: preview.text,
      structure: preview.structure,
      active: true,
      expectedRevision: preview.revision,
      fingerprint: preview.fingerprint,
      warnings: preview.warnings,
      entries: preview.entries.map((entry, order) => ({
        ...entry,
        order,
        title: entry.title.trim(),
      })),
    };
    const saved = await request<StudySource>(
      "study-sources:save",
      input as unknown as Record<string, unknown>,
    );
    await changedRef.current?.();
    let adopted: StudySourceAdoption | undefined;
    if (adopt) {
      adopted = await request<StudySourceAdoption>("study-sources:adopt", {
        subjectId,
        sourceId: saved.id,
        entryIds: saved.entries
          .filter((entry) => entry.selected)
          .map((entry) => entry.id),
      });
      await changedRef.current?.();
    }
    setPreview(null);
    setEditing(false);
    await refresh();
    setNotice(
      adopt
        ? "The selected sections are now linked to this subject’s pathway. Existing learning evidence is unchanged."
        : "Source saved. You can apply its outline when you are ready.",
    );
    if (start) await begin(adopted?.source || saved, adopted);
  };

  return (
    <section
      className={`source-study-panel ${compact ? "source-study-compact" : ""}`}
      aria-label="Curriculum and textbook study"
    >
      <header className="source-study-heading">
        <div>
          <h2>Learn from your material</h2>
          <p>
            Follow a university curriculum or work through a textbook in order.
          </p>
        </div>
        <div className="source-study-entry-actions">
          <button
            type="button"
            onClick={() => chooseKind("curriculum")}
            disabled={Boolean(busy) || snapshot.subject.archived}
          >
            <GraduationCap size={18} />
            Use a curriculum
          </button>
          <button
            type="button"
            onClick={() => chooseKind("textbook")}
            disabled={Boolean(busy) || snapshot.subject.archived}
          >
            <BookOpen size={18} />
            Study a textbook
          </button>
        </div>
      </header>
      {active && !editing && (
        <div className="source-study-active">
          <Check size={17} />
          <span>
            Following <strong>{active.title}</strong>
            <small>
              {active.kind === "textbook" ? "Textbook" : "Curriculum"} ·{" "}
              {active.entries.filter((entry) => entry.selected).length} selected
              sections
            </small>
          </span>
          <button
            disabled={Boolean(busy)}
            onClick={() => {
              if (active.mappings.length)
                void run("Opening your place…", () => begin(active));
              else {
                setPreview({ ...active });
                setKind(active.kind);
                setEditing(true);
                setExpanded(true);
              }
            }}
          >
            {active.mappings.length ? "Continue" : "Review and begin"}
            <ArrowRight size={16} />
          </button>
        </div>
      )}
      {!editing && sources.length > 0 && (
        <button
          className="source-study-manage"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown size={16} />
          {expanded
            ? "Hide source details"
            : `Manage ${sources.length} ${sources.length === 1 ? "source" : "sources"}`}
        </button>
      )}
      {loading && <p role="status">Loading subject sources…</p>}
      {busy && (
        <p className="source-study-status" role="status">
          <span className="source-study-busy" />
          {busy}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="source-study-notice" role="status">
          {notice}
        </p>
      )}
      {!editing && expanded && (
        <div className="source-study-list">
          {sources.map((source) => (
            <article key={source.id}>
              <div className="source-study-source-title">
                {source.kind === "textbook" ? (
                  <BookOpen size={20} />
                ) : (
                  <GraduationCap size={20} />
                )}
                <div>
                  <h3>{source.title}</h3>
                  <p>
                    {source.kind === "textbook" ? "Textbook" : "Curriculum"} ·{" "}
                    {source.entries.length} sections
                    {source.active ? " · Active study guide" : ""}
                  </p>
                  {source.sourceUrl && (
                    <a
                      href={source.sourceUrl}
                      onClick={(event) => {
                        event.preventDefault();
                        void invoke("external:open", source.sourceUrl).catch(
                          (failure) => setError(issue(failure)),
                        );
                      }}
                    >
                      <Link2 size={13} />
                      Original source
                    </a>
                  )}
                </div>
              </div>
              <div className="source-study-source-actions">
                <button
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setPreview({ ...source });
                    setKind(source.kind);
                    setEditing(true);
                    setExpanded(true);
                  }}
                >
                  Review outline
                </button>
                {!source.active && (
                  <button
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run("Selecting source…", async () => {
                        await request("study-sources:select", {
                          subjectId,
                          sourceId: source.id,
                        });
                        await changedRef.current?.();
                        await refresh();
                      })
                    }
                  >
                    Use for teaching
                  </button>
                )}
                {source.resourceId && onStudySourceDocument && (
                  <button
                    onClick={() =>
                      onStudySourceDocument(
                        source.resourceId!,
                        source.entries.find((entry) => entry.selected)
                          ?.startPage,
                      )
                    }
                  >
                    Open document
                  </button>
                )}
                <button
                  aria-label={`Remove source ${source.title}`}
                  title="Remove this study guide; keep the original document and existing pathway"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run("Removing study guide…", async () => {
                      await request("study-sources:remove", {
                        subjectId,
                        sourceId: source.id,
                      });
                      await changedRef.current?.();
                      await refresh();
                    })
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {editing && (
        <fieldset
          className="source-study-editor"
          disabled={Boolean(busy) || snapshot.subject.archived}
        >
          <div className="source-study-editor-heading">
            <div>
              <h3>
                {preview
                  ? "Review your study outline"
                  : kind === "textbook"
                    ? "Choose the textbook to study"
                    : "Bring your curriculum"}
              </h3>
              <p>
                {preview
                  ? "Choose the sections, check their order and page locations, then apply them to your pathway."
                  : "Use your own document, an existing subject resource, or pasted source text. No assessment is required."}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close source setup"
              disabled={Boolean(busy)}
              onClick={() => {
                setEditing(false);
                setPreview(null);
              }}
            >
              <X size={19} />
            </button>
          </div>
          {!preview ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run("Reading the source outline…", () => prepare());
              }}
            >
              <div
                className="source-study-input-modes"
                role="group"
                aria-label="Source content method"
              >
                <button
                  type="button"
                  aria-pressed={inputMode === "document"}
                  className={inputMode === "document" ? "active" : ""}
                  onClick={() => setInputMode("document")}
                >
                  Subject document
                </button>
                <button
                  type="button"
                  aria-pressed={inputMode === "paste"}
                  className={inputMode === "paste" ? "active" : ""}
                  onClick={() => setInputMode("paste")}
                >
                  Paste source text
                </button>
                {onImportStudyUrl && (
                  <button
                    type="button"
                    aria-pressed={inputMode === "url"}
                    className={inputMode === "url" ? "active" : ""}
                    onClick={() => setInputMode("url")}
                  >
                    Public source link
                  </button>
                )}
              </div>
              <label>
                Source title
                <input
                  aria-label="Study source title"
                  value={title}
                  maxLength={500}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={
                    kind === "textbook"
                      ? "Textbook title and edition"
                      : "Course or curriculum title"
                  }
                />
              </label>
              {inputMode === "document" ? (
                <div className="source-study-document-input">
                  <label>
                    Subject document
                    <select
                      aria-label="Choose study source document"
                      value={resourceId}
                      onChange={(event) => {
                        setResourceId(event.target.value);
                        const resource = documents.find(
                          (item) => item.id === event.target.value,
                        );
                        if (resource) setTitle(resource.title);
                      }}
                    >
                      <option value="">Choose an imported document</option>
                      {documents.map((resource) => (
                        <option key={resource.id} value={resource.id}>
                          {resource.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {onImportStudyDocument && (
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void run("Importing document…", async () => {
                          const resource = await onImportStudyDocument();
                          if (resource) {
                            retainImport(resource);
                            await changedRef.current?.();
                          }
                        })
                      }
                    >
                      <FileUp size={17} />
                      Import PDF, Markdown or text
                    </button>
                  )}
                  {!documents.length && (
                    <p>
                      Import a document to keep its text and original PDF with
                      this subject.
                    </p>
                  )}
                </div>
              ) : inputMode === "paste" ? (
                <label>
                  {kind === "textbook"
                    ? "Textbook outline or source excerpt"
                    : "Curriculum, syllabus or course outline"}
                  <textarea
                    aria-label="Study source text"
                    rows={9}
                    value={text}
                    maxLength={2_000_000}
                    onChange={(event) => setText(event.target.value)}
                    placeholder={
                      kind === "textbook"
                        ? "Paste the book’s actual table of contents or chapter text."
                        : "Paste the actual modules, weekly topics, prerequisites and learning objectives."
                    }
                  />
                </label>
              ) : (
                <div className="source-study-url-input">
                  <label>
                    Public curriculum or textbook URL
                    <input
                      type="url"
                      aria-label="Public study source URL"
                      value={url}
                      maxLength={2048}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://…"
                    />
                  </label>
                  <p>
                    The public page or PDF is imported as source material.
                    Sign-in pages and private addresses are not supported.
                  </p>
                  <button
                    type="button"
                    disabled={Boolean(busy) || !/^https:\/\//i.test(url)}
                    onClick={() =>
                      void run("Importing public source…", async () => {
                        const resource = await onImportStudyUrl!(url.trim());
                        if (resource) {
                          retainImport(resource);
                          await changedRef.current?.();
                          await prepare(resource);
                        }
                      })
                    }
                  >
                    <Link2 size={17} />
                    Import and review outline
                  </button>
                </div>
              )}
              {inputMode !== "url" && (
                <label>
                  Original source link{" "}
                  <span className="source-study-optional">optional</span>
                  <input
                    type="url"
                    aria-label="Original study source link"
                    value={url}
                    maxLength={2048}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="Retain a university or publisher reference"
                  />
                </label>
              )}
              {inputMode !== "url" && (
                <div className="source-study-form-actions">
                  <button
                    className="primary"
                    disabled={
                      Boolean(busy) ||
                      (inputMode === "paste" ? !text.trim() : !resourceId)
                    }
                  >
                    Review outline
                    <ArrowRight size={16} />
                  </button>
                  <span>
                    Nothing is added to your pathway until you review it.
                  </span>
                </div>
              )}
            </form>
          ) : (
            <div className="source-study-outline">
              <label>
                Guide title
                <input
                  aria-label="Reviewed study source title"
                  value={preview.title}
                  maxLength={500}
                  onChange={(event) =>
                    setPreview({ ...preview, title: event.target.value })
                  }
                />
              </label>
              {preview.warnings.length > 0 && (
                <div className="source-study-warnings">
                  {preview.warnings.map((warning, index) => (
                    <p key={index}>{warning}</p>
                  ))}
                </div>
              )}
              {!preview.entries.length && (
                <p className="source-study-empty-outline">
                  No reliable section headings were found. Add the actual
                  chapter or topic headings below. Page locations are optional;
                  only real source locations become citations.
                </p>
              )}
              <div className="source-study-outline-heading">
                <h4>
                  {selectedCount} of {preview.entries.length} sections selected
                </h4>
                <div>
                  <button
                    disabled={Boolean(busy)}
                    onClick={() =>
                      setPreview({
                        ...preview,
                        entries: preview.entries.map((entry) => ({
                          ...entry,
                          selected: true,
                        })),
                      })
                    }
                  >
                    Select all
                  </button>
                  <button
                    disabled={Boolean(busy)}
                    onClick={() =>
                      setPreview({
                        ...preview,
                        entries: preview.entries.map((entry) => ({
                          ...entry,
                          selected: false,
                        })),
                      })
                    }
                  >
                    Clear selection
                  </button>
                </div>
              </div>
              <ol className="source-study-entries">
                {preview.entries.map((entry, index) => (
                  <li
                    key={entry.id}
                    style={
                      {
                        "--source-level": Math.min(4, entry.level - 1),
                      } as CSSProperties
                    }
                  >
                    <label className="source-study-entry-select">
                      <input
                        type="checkbox"
                        aria-label={`Include ${entry.title || `section ${index + 1}`}`}
                        checked={entry.selected}
                        onChange={(event) =>
                          editEntry(entry.id, {
                            selected: event.target.checked,
                          })
                        }
                      />
                      <span>{index + 1}</span>
                    </label>
                    <div className="source-study-entry-body">
                      <input
                        aria-label={`Section title ${index + 1}`}
                        value={entry.title}
                        maxLength={500}
                        onChange={(event) =>
                          editEntry(entry.id, { title: event.target.value })
                        }
                        placeholder="An actual chapter or topic heading"
                      />
                      <div className="source-study-entry-provenance">
                        <select
                          aria-label={`Section ${index + 1} structure`}
                          value={entry.kind}
                          onChange={(event) =>
                            editEntry(entry.id, {
                              kind: event.target
                                .value as StudySourceEntry["kind"],
                            })
                          }
                        >
                          {[
                            "part",
                            "chapter",
                            "module",
                            "week",
                            "topic",
                            "section",
                          ].map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                        <span>{pageLabel(entry)}</span>
                        {entry.sourceHeading &&
                          entry.sourceHeading !== entry.title && (
                            <span title={entry.sourceHeading}>
                              Original: {entry.sourceHeading}
                            </span>
                          )}
                      </div>
                      {pageCount > 0 && (
                        <div className="source-study-entry-pages">
                          <label>
                            PDF page from
                            <input
                              type="number"
                              min={1}
                              max={pageCount}
                              aria-label={`Section ${index + 1} start page`}
                              value={entry.startPage || ""}
                              onChange={(event) =>
                                editEntry(entry.id, {
                                  startPage: event.target.value
                                    ? Number(event.target.value)
                                    : undefined,
                                })
                              }
                            />
                          </label>
                          <label>
                            to
                            <input
                              type="number"
                              min={entry.startPage || 1}
                              max={pageCount}
                              aria-label={`Section ${index + 1} end page`}
                              value={entry.endPage || ""}
                              onChange={(event) =>
                                editEntry(entry.id, {
                                  endPage: event.target.value
                                    ? Number(event.target.value)
                                    : undefined,
                                })
                              }
                            />
                          </label>
                        </div>
                      )}
                    </div>
                    <div className="source-study-entry-actions">
                      <button
                        aria-label={`Move section ${index + 1} up`}
                        disabled={Boolean(busy) || index === 0}
                        onClick={() => moveEntry(entry.id, -1)}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        aria-label={`Move section ${index + 1} down`}
                        disabled={
                          Boolean(busy) || index === preview.entries.length - 1
                        }
                        onClick={() => moveEntry(entry.id, 1)}
                      >
                        <ArrowDown size={15} />
                      </button>
                      <button
                        aria-label={`Remove section ${index + 1}`}
                        title="Remove this section and its nested headings from the draft"
                        disabled={Boolean(busy)}
                        onClick={() => removeEntry(entry.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              <button
                className="source-study-add-section"
                onClick={() =>
                  setPreview({
                    ...preview,
                    structure: "manual",
                    entries: [
                      ...preview.entries,
                      {
                        id: crypto.randomUUID(),
                        title: "",
                        order: preview.entries.length,
                        level: 1,
                        kind: kind === "textbook" ? "chapter" : "topic",
                        selected: true,
                      },
                    ],
                  })
                }
              >
                <Plus size={16} />
                Add a section
              </button>
              <div className="source-study-review-footer">
                <p>
                  Imported coverage is not demonstrated understanding. Your
                  original document, existing lessons and edited topics stay
                  intact.
                </p>
                <div className="source-study-review-actions">
                  <button
                    disabled={Boolean(busy)}
                    onClick={() => {
                      setPreview(null);
                    }}
                  >
                    <RotateCcw size={15} />
                    Choose another source
                  </button>
                  <button
                    disabled={Boolean(busy) || !validPreview}
                    onClick={() =>
                      void run("Saving study guide…", () => save(false, false))
                    }
                  >
                    Save guide
                  </button>
                  <button
                    disabled={Boolean(busy) || !validPreview}
                    onClick={() =>
                      void run("Linking source to your pathway…", () =>
                        save(true, false),
                      )
                    }
                  >
                    Apply to pathway
                  </button>
                  <button
                    className="primary"
                    disabled={Boolean(busy) || !validPreview}
                    onClick={() =>
                      void run("Preparing the first section…", () =>
                        save(true, true),
                      )
                    }
                  >
                    Apply and begin
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </fieldset>
      )}
    </section>
  );
}
