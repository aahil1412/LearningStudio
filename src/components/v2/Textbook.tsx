import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  Download,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  ChapterProposal,
  TextbookChapter,
  ExportSelection,
} from "../../v2types";
import type { ContentBlock, Lesson } from "../../types";
import { validateContentBlock } from "../../lib/visualSpecs";
import Markdown from "../Markdown";
import VisualBlock from "../visuals/VisualBlock";
import "./v2-reading.css";
export type TextbookProps = {
  subjectId: string;
  subjectTitle: string;
  chapters: TextbookChapter[];
  lessons: Lesson[];
  initialChapterId?: string;
  onSave: (
    chapter: TextbookChapter,
    expectedRevision: number,
  ) => Promise<TextbookChapter>;
  onDelete?: (id: string, expectedRevision: number) => Promise<void>;
  onPropose: (request: {
    subjectId: string;
    lessonIds: string[];
    instruction: string;
    chapterId?: string;
  }) => Promise<ChapterProposal>;
  onExport?: (selection: ExportSelection) => void;
};
export default function Textbook({
  subjectId,
  subjectTitle,
  chapters,
  lessons,
  initialChapterId,
  onSave,
  onDelete,
  onPropose,
  onExport,
}: TextbookProps) {
  const [search, setSearch] = useState(""),
    [draft, setDraft] = useState<TextbookChapter | null>(null),
    [baseRevision, setBaseRevision] = useState(0),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [instruction, setInstruction] = useState(
      "Create a coherent chapter that explains the ideas, preserves source references, and includes useful examples.",
    ),
    [selectedLessons, setSelectedLessons] = useState<string[]>([]),
    [proposal, setProposal] = useState<ChapterProposal | null>(null),
    [showComposer, setShowComposer] = useState(false),
    [blockSource, setBlockSource] = useState(""),
    [annotation, setAnnotation] = useState("");
  const ordered = chapters
    .slice()
    .sort((a, b) => (a.position || 0) - (b.position || 0));
  const visible = ordered.filter((c) =>
    `${c.title} ${c.markdown} ${JSON.stringify(c.blocks)}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const saved = chapters.find((c) => c.id === draft?.id);
  const handledInitial = useRef("");
  const dirty =
    !!draft &&
    (!saved ||
      draft.title !== saved.title ||
      draft.markdown !== saved.markdown ||
      JSON.stringify(draft.blocks) !== JSON.stringify(saved.blocks) ||
      JSON.stringify(draft.citations) !== JSON.stringify(saved.citations));
  const choose = (chapter: TextbookChapter) => {
    setDraft(structuredClone(chapter));
    setBaseRevision(chapter.revision);
    setEditing(false);
    setBlockSource(JSON.stringify(chapter.blocks, null, 2));
    setError("");
    setProposal(null);
  };
  useEffect(() => {
    const key = subjectId + ":" + initialChapterId;
    if (initialChapterId && handledInitial.current !== key) {
      const chapter = chapters.find((item) => item.id === initialChapterId);
      if (chapter) {
        handledInitial.current = key;
        choose(chapter);
      }
    }
  }, [initialChapterId, chapters, subjectId]);
  const create = () => {
    const now = new Date().toISOString();
    const chapter: TextbookChapter = {
      id: crypto.randomUUID(),
      subjectId,
      title: "Untitled chapter",
      markdown: "",
      blocks: [],
      citations: [],
      originMessageIds: [],
      revision: 0,
      createdAt: now,
      updatedAt: now,
      position: ordered.length,
      userEdited: true,
    };
    setDraft(chapter);
    setBaseRevision(0);
    setEditing(true);
    setBlockSource("[]");
    setError("");
    setProposal(null);
  };
  const save = async () => {
    if (!draft || !draft.title.trim()) return;
    setBusy(true);
    setError("");
    try {
      const value = await onSave(
        {
          ...draft,
          title: draft.title.trim(),
          userEdited: true,
          updatedAt: new Date().toISOString(),
        },
        baseRevision,
      );
      setDraft(value);
      setBaseRevision(value.revision);
      setEditing(false);
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : "The chapter could not be saved.") +
          " Your draft is still here. Reload the current chapter before replacing a newer revision.",
      );
    } finally {
      setBusy(false);
    }
  };
  const propose = async () => {
    if (!selectedLessons.length) {
      setError("Select at least one source lesson.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setProposal(
        await onPropose({
          subjectId,
          lessonIds: selectedLessons,
          instruction,
          chapterId: draft?.id,
        }),
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The chapter proposal failed. Existing chapters are unchanged.",
      );
    } finally {
      setBusy(false);
    }
  };
  const accept = async () => {
    if (!proposal) return;
    if (dirty) {
      setError(
        "Save or reload your current draft before accepting a proposal. Your unsaved edits will not be overwritten.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const value = await onSave(
        { ...proposal.chapter, subjectId, userEdited: true },
        proposal.baseRevision,
      );
      setDraft(value);
      setBaseRevision(value.revision);
      setBlockSource(JSON.stringify(value.blocks, null, 2));
      setProposal(null);
      setShowComposer(false);
    } catch (e) {
      setError(
        (e instanceof Error
          ? e.message
          : "The proposal could not be applied.") +
          " The saved chapter and this proposal are preserved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="v2-textbook" aria-label="Living textbook">
      <header className="v2-reading-heading">
        <div>
          <span className="v2-eyebrow">YOUR IDEAS, MADE COHERENT</span>
          <h1>
            <BookOpen size={25} />
            {subjectTitle} textbook
          </h1>
          <p>
            Editable chapters. Clear sources. A living record of understanding.
          </p>
        </div>
        <div className="v2-actions">
          <button onClick={() => setShowComposer(!showComposer)}>
            <Sparkles size={14} />
            Propose from lessons
          </button>
          <button onClick={create}>
            <Plus size={14} />
            New chapter
          </button>
          {onExport && (
            <button
              onClick={() =>
                onExport({
                  title: subjectTitle + " textbook",
                  subjectId,
                  scope: "subject",
                  lessonIds: [],
                  chapterIds: chapters.map((c) => c.id),
                  includeNotes: false,
                  includeUserMessages: false,
                  embedCachedResources: true,
                })
              }
            >
              <Download size={14} />
              Export textbook
            </button>
          )}
        </div>
      </header>
      <div className="v2-textbook-layout">
        <aside className="v2-chapter-list">
          <label>
            <Search size={14} />
            <input
              aria-label="Search textbook chapters"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a chapter…"
            />
          </label>
          {visible.map((chapter, index) => (
            <button
              className={draft?.id === chapter.id ? "active" : ""}
              key={chapter.id}
              onClick={() => choose(chapter)}
            >
              <small>{String(index + 1).padStart(2, "0")}</small>
              <span>
                {chapter.title}
                <em>
                  Revision {chapter.revision}
                  {chapter.userEdited ? " · edited by you" : ""}
                </em>
              </span>
            </button>
          ))}
          {!visible.length && (
            <p>
              No chapters yet. Compose one or propose a chapter from selected
              lessons.
            </p>
          )}
        </aside>
        <div className="v2-chapter-main">
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {showComposer && (
            <section className="v2-chapter-proposer">
              <h2>Compose with your source lessons</h2>
              <p>
                The proposal is reviewed before saving. It never replaces a
                newer revision or unsaved draft.
              </p>
              <label>
                Source lessons
                <select
                  multiple
                  aria-label="Chapter source lessons"
                  value={selectedLessons}
                  onChange={(e) =>
                    setSelectedLessons(
                      [...e.currentTarget.selectedOptions].map((o) => o.value),
                    )
                  }
                >
                  {lessons.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Chapter direction
                <textarea
                  aria-label="Chapter proposal instructions"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  rows={3}
                />
              </label>
              <button
                disabled={busy || !selectedLessons.length}
                onClick={propose}
              >
                {busy ? "Preparing proposal…" : "Generate reviewable proposal"}
              </button>
            </section>
          )}
          {proposal && (
            <section className="v2-proposal" aria-label="Chapter proposal">
              <span className="v2-eyebrow">PROPOSAL · NOT YET SAVED</span>
              <h2>{proposal.chapter.title}</h2>
              <p>{proposal.reason}</p>
              <Markdown text={proposal.chapter.markdown} />
              {proposal.chapter.blocks.map((block, index) => (
                <VisualBlock key={index} block={block} />
              ))}
              <div className="v2-actions">
                <button disabled={busy} onClick={accept}>
                  <Check size={14} />
                  Accept chapter proposal
                </button>
                <button onClick={() => setProposal(null)}>
                  Dismiss proposal
                </button>
              </div>
            </section>
          )}
          {draft ? (
            <>
              <div className="v2-chapter-toolbar">
                <span>
                  Revision {baseRevision}
                  {dirty ? " · unsaved draft" : ""}
                </span>
                <div className="v2-actions">
                  <button onClick={() => setEditing(!editing)}>
                    {editing ? "Read preview" : "Edit chapter"}
                  </button>
                  {saved && (
                    <button onClick={() => choose(saved)}>
                      Reload saved chapter
                    </button>
                  )}
                  <button disabled={busy || !draft.title.trim()} onClick={save}>
                    Save chapter
                  </button>
                  {onDelete && saved && (
                    <button
                      aria-label="Delete chapter"
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await onDelete(saved.id, saved.revision);
                          setDraft(null);
                        } catch (e) {
                          setError(String(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
              {editing ? (
                <div className="v2-chapter-editor">
                  <label>
                    Chapter title
                    <input
                      aria-label="Chapter title"
                      value={draft.title}
                      onChange={(e) =>
                        setDraft({ ...draft, title: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Chapter text · Markdown and mathematical notation
                    <textarea
                      aria-label="Chapter Markdown"
                      value={draft.markdown}
                      onChange={(e) =>
                        setDraft({ ...draft, markdown: e.target.value })
                      }
                      rows={18}
                    />
                  </label>
                  <details>
                    <summary>Edit validated visual and exercise blocks</summary>
                    <p>
                      Only typed content is accepted. Executable scripts are
                      never run.
                    </p>
                    <textarea
                      aria-label="Chapter content blocks"
                      value={blockSource}
                      onChange={(e) => setBlockSource(e.target.value)}
                      rows={10}
                    />
                    <button
                      onClick={() => {
                        try {
                          const raw = JSON.parse(blockSource);
                          if (!Array.isArray(raw))
                            throw new Error("Use a list of content blocks.");
                          const blocks = raw.map(validateContentBlock);
                          if (blocks.some((b) => !b))
                            throw new Error(
                              "A content block is malformed. Existing visuals have not changed.",
                            );
                          setDraft({
                            ...draft,
                            blocks: blocks as ContentBlock[],
                          });
                          setError("");
                        } catch (e) {
                          setError(String(e));
                        }
                      }}
                    >
                      Apply content blocks
                    </button>
                  </details>
                  <label>
                    Source references, one label and optional HTTPS URL per line
                    <textarea
                      aria-label="Chapter citations"
                      rows={4}
                      value={draft.citations
                        .map((c) => c.label + (c.url ? " | " + c.url : ""))
                        .join("\n")}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          citations: e.target.value
                            .split("\n")
                            .filter(Boolean)
                            .map((line) => {
                              const [label, url] = line.split(" | ");
                              const retained = draft.citations.find(
                                (citation) =>
                                  citation.label === label &&
                                  (citation.url || "") === (url || ""),
                              );
                              return {
                                ...retained,
                                label,
                                ...(url?.startsWith("https://") ? { url } : {}),
                              };
                            }),
                        })
                      }
                    />
                  </label>
                </div>
              ) : (
                <article className="reading v2-chapter-preview"
                  data-annotation-kind="chapter" data-annotation-id={draft.id}
                  data-annotation-subject={subjectId}>
                  <h1>{draft.title}</h1>
                  <Markdown text={draft.markdown} />
                  {draft.blocks.map((block, index) => (
                    <VisualBlock key={draft.id + ":" + index} block={block} />
                  ))}
                  {draft.citations.length > 0 && (
                    <section>
                      <h3>Sources</h3>
                      <ol>
                        {draft.citations.map((c, index) => (
                          <li key={index}>
                            {c.url ? (
                              <a
                                href={c.url}
                                onClick={(e) => {
                                  e.preventDefault();
                                  void window.studio?.invoke(
                                    "external:open",
                                    c.url,
                                  );
                                }}
                              >
                                {c.label}
                              </a>
                            ) : (
                              c.label
                            )}
                            {c.page ? " · page " + c.page : ""}
                          </li>
                        ))}
                      </ol>
                    </section>
                  )}
                  {draft.originMessageIds.length > 0 && (
                    <details>
                      <summary>Source message provenance</summary>
                      <p>{draft.originMessageIds.join(", ")}</p>
                    </details>
                  )}
                  <label>
                    Personal annotation
                    <textarea
                      aria-label="Chapter annotation"
                      value={annotation}
                      onChange={(e) => setAnnotation(e.target.value)}
                      rows={3}
                    />
                  </label>
                  <button
                    disabled={!annotation.trim()}
                    onClick={() => {
                      setDraft({
                        ...draft,
                        markdown:
                          draft.markdown +
                          "\n\n### Annotation\n\n" +
                          annotation.trim(),
                      });
                      setAnnotation("");
                      setEditing(true);
                    }}
                  >
                    Add annotation to draft
                  </button>
                </article>
              )}
            </>
          ) : (
            !showComposer &&
            !proposal && (
              <div className="v2-reading-empty">
                <BookOpen size={40} />
                <h2>A textbook that can grow with you</h2>
                <p>
                  Choose a chapter, create one in your own words, or turn
                  selected lessons into a reviewable proposal.
                </p>
                <button onClick={create}>Create your first chapter</button>
              </div>
            )
          )}
        </div>
      </div>
    </section>
  );
}
