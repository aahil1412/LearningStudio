import { useState } from "react";
import { Download, Eye, X } from "lucide-react";
import type { Lesson, LibraryItem } from "../../types";
import type {
  ExportSelection,
  TextbookChapter,
  VisualInstance,
} from "../../v2types";
import "./v2-reading.css";
export default function ExportDialog({
  lessons,
  chapters,
  resources,
  visuals,
  subjectId,
  subjectTitle,
  initialScope = "selection",
  onClose,
}: {
  lessons: Lesson[];
  chapters: TextbookChapter[];
  resources?: LibraryItem[];
  visuals?: VisualInstance[];
  subjectId?: string;
  subjectTitle?: string;
  initialScope?: "selection" | "subject";
  onClose: () => void;
}) {
  const [selection, setSelection] = useState<ExportSelection>({
      title: (subjectTitle || "Learning Studio") + " textbook",
      subjectId,
      scope: initialScope,
      lessonIds:
        initialScope === "selection" || !chapters.length
          ? lessons.map((l) => l.id)
          : [],
      chapterIds: initialScope === "subject" ? chapters.map((c) => c.id) : [],
      ...(resources
        ? { resourceIds: resources.map((resource) => resource.id) }
        : {}),
      ...(visuals ? { visualIds: visuals.map((visual) => visual.id) } : {}),
      includeNotes: false,
      includeUserMessages: false,
      embedCachedResources: true,
    }),
    [selectedMessages, setSelectedMessages] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<{ url?: string; html?: string } | null>(
      null,
    ),
    [result, setResult] = useState<{
      path: string;
      format: string;
      bytes: number;
      chapters: number;
      warnings: string[];
    } | null>(null);
  const toggle = (
    key: "lessonIds" | "chapterIds" | "resourceIds" | "visualIds",
    id: string,
  ) => {
    setSelection({
      ...selection,
      [key]: selection[key]?.includes(id)
        ? selection[key]!.filter((value) => value !== id)
        : [...(selection[key] || []), id],
    });
    setPreview(null);
  };
  const ready =
    selection.lessonIds.length + selection.chapterIds.length > 0 ||
    selection.scope === "subject";
  const perform = async (kind: "preview" | "html") => {
    setBusy(true);
    setError("");
    try {
      const request = {
        ...selection,
        ...(!selectedMessages ? { messageIds: undefined } : {}),
      };
      if (!window.studio)
        throw new Error(
          "Open the desktop application to export a standalone textbook.",
        );
      if (kind === "preview") {
        const value = await window.studio.invoke<
          string | { url?: string; html?: string }
        >("export:preview", request);
        setPreview(typeof value === "string" ? { html: value } : value);
      } else {
        const value = await window.studio.invoke<typeof result>(
          "export:html",
          request,
        );
        if (value) setResult(value);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The export could not be completed. Your learning material is unchanged.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section
        className="v2-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Export interactive textbook"
      >
        <header>
          <div>
            <span className="v2-eyebrow">YOUR LEARNING, WITH YOU</span>
            <h2>Export an interactive textbook</h2>
            <p>
              Opens in an ordinary browser, offline, without an app or account.
            </p>
          </div>
          <button aria-label="Close export dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="v2-export-body">
          <div className="v2-export-selection">
            <label>
              Book title
              <input
                aria-label="Export book title"
                value={selection.title}
                onChange={(e) =>
                  setSelection({ ...selection, title: e.target.value })
                }
              />
            </label>
            {subjectId && (
              <label className="v2-check">
                <input
                  type="checkbox"
                  checked={selection.scope === "subject"}
                  onChange={(e) =>
                    setSelection({
                      ...selection,
                      scope: e.target.checked ? "subject" : "selection",
                    })
                  }
                />
                Complete subject, including its visible curriculum, sources, and
                visual notebook
              </label>
            )}
            <h3>Chapters</h3>
            {chapters.map((chapter) => (
              <label className="v2-check" key={chapter.id}>
                <input
                  type="checkbox"
                  checked={selection.chapterIds.includes(chapter.id)}
                  onChange={() => toggle("chapterIds", chapter.id)}
                />
                {chapter.title}
              </label>
            ))}
            {!chapters.length && (
              <p>
                No authored chapters yet. Selected chats become readable
                chapters.
              </p>
            )}
            <h3>Learning chats</h3>
            {lessons.map((lesson) => (
              <label className="v2-check" key={lesson.id}>
                <input
                  type="checkbox"
                  checked={selection.lessonIds.includes(lesson.id)}
                  onChange={() => toggle("lessonIds", lesson.id)}
                />
                {lesson.title}
              </label>
            ))}
            <label className="v2-check">
              <input
                type="checkbox"
                checked={selectedMessages}
                onChange={(e) => {
                  setSelectedMessages(e.target.checked);
                  setSelection({
                    ...selection,
                    messageIds: e.target.checked ? [] : undefined,
                  });
                }}
              />
              Choose individual message sections
            </label>
            {selectedMessages && (
              <div className="v2-message-selection">
                {lessons
                  .filter((l) => selection.lessonIds.includes(l.id))
                  .flatMap((l) =>
                    l.messages.map((message) => (
                      <label className="v2-check" key={message.id}>
                        <input
                          type="checkbox"
                          checked={
                            selection.messageIds?.includes(message.id) || false
                          }
                          onChange={() =>
                            setSelection({
                              ...selection,
                              messageIds: selection.messageIds?.includes(
                                message.id,
                              )
                                ? selection.messageIds.filter(
                                    (id) => id !== message.id,
                                  )
                                : [...(selection.messageIds || []), message.id],
                            })
                          }
                        />
                        <span>
                          {message.role === "user" ? "Question" : "Explanation"}{" "}
                          ·{" "}
                          {(
                            message.text ||
                            message.blocks?.find((b) => b.type === "text")
                              ?.text ||
                            "Scientific content"
                          ).slice(0, 150)}
                        </span>
                      </label>
                    )),
                  )}
              </div>
            )}
            {selection.scope === "subject" && (
              <>
                <h3>Resources & documents</h3>
                {resources?.map((resource) => (
                  <label className="v2-check" key={resource.id}>
                    <input
                      type="checkbox"
                      checked={
                        selection.resourceIds?.includes(resource.id) || false
                      }
                      onChange={() => toggle("resourceIds", resource.id)}
                    />
                    <span>
                      Resource · {resource.title}
                      <small className="v2-export-kind">
                        {resource.kind}
                        {resource.verified
                          ? " · marked checked"
                          : " · source status unchanged"}
                      </small>
                    </span>
                  </label>
                ))}
                {!resources?.length && <p>No resources in this subject.</p>}
                <h3>Scientific figures</h3>
                {visuals?.map((visual) => (
                  <label className="v2-check" key={visual.id}>
                    <input
                      type="checkbox"
                      checked={
                        selection.visualIds?.includes(visual.id) || false
                      }
                      onChange={() => toggle("visualIds", visual.id)}
                    />
                    <span>
                      Figure · {visual.title || visual.block.type}
                      <small className="v2-export-kind">
                        {visual.block.type}
                      </small>
                    </span>
                  </label>
                ))}
                {!visuals?.length && (
                  <p>No retained visual instances in this subject.</p>
                )}
              </>
            )}
            <h3>Include deliberately</h3>
            <label className="v2-check">
              <input
                type="checkbox"
                checked={selection.includeNotes}
                onChange={(e) =>
                  setSelection({ ...selection, includeNotes: e.target.checked })
                }
              />
              Saved personal notes
            </label>
            <label className="v2-check">
              <input
                type="checkbox"
                checked={selection.includeUserMessages}
                onChange={(e) =>
                  setSelection({
                    ...selection,
                    includeUserMessages: e.target.checked,
                  })
                }
              />
              Learner questions and messages
            </label>
            <label className="v2-check">
              <input
                type="checkbox"
                checked={selection.embedCachedResources}
                onChange={(e) =>
                  setSelection({
                    ...selection,
                    embedCachedResources: e.target.checked,
                  })
                }
              />
              Bundle permitted cached images and available scientific structures
            </label>
            <p className="v2-export-privacy">
              Only this selection is exported. Account credentials, hidden
              memory, unselected chats, and provider settings are excluded.
            </p>
          </div>
          <div className="v2-export-preview">
            {preview ? (
              <iframe
                title="Standalone textbook preview"
                sandbox="allow-scripts allow-downloads"
                src={preview.url}
                srcDoc={preview.url ? undefined : preview.html}
              />
            ) : (
              <div className="v2-reading-empty">
                <Eye size={35} />
                <h3>Review the portable edition</h3>
                <p>
                  Preview selected chapters and interactive figures before
                  saving. Large exports become a portable ZIP with index.html
                  and local assets.
                </p>
              </div>
            )}
          </div>
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <div className="notice" role="status">
            <strong>
              {result.format === "zip" ? "Portable ZIP" : "Standalone HTML"}{" "}
              saved
            </strong>
            <p>
              {result.path} · {result.chapters} chapters ·{" "}
              {(result.bytes / 1048576).toFixed(1)} MB
            </p>
            {result.warnings?.map((warning, index) => (
              <p key={index}>{warning}</p>
            ))}
          </div>
        )}
        <footer>
          <button
            disabled={
              busy ||
              !ready ||
              (selectedMessages && !selection.messageIds?.length)
            }
            onClick={() => void perform("preview")}
          >
            <Eye size={15} />
            {busy ? "Preparing…" : "Preview export"}
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              !ready ||
              !selection.title.trim() ||
              (selectedMessages && !selection.messageIds?.length)
            }
            onClick={() => void perform("html")}
          >
            <Download size={15} />
            Save offline textbook
          </button>
        </footer>
      </section>
    </div>
  );
}
