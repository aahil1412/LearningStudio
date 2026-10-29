import "../studio-fonts.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Markdown from "../components/Markdown";
import VisualBlock from "../components/visuals/VisualBlock";
import { applyTheme, sanitizeAppearance } from "../lib/themes";
import type { OfflineBook } from "./contracts";
import type { ExportVisualState } from "./contracts";
import type { StudioBridge } from "../types";
import type { ContentBlock } from "../types";
import { VisualRuntimeContext, type VisualRuntime } from "../lib/visualState";
import "katex/dist/katex.min.css";
import "./style.css";
import { paintReadingHighlights } from "../components/v21/Annotations";
import type { ExportChapter, ExportReadingSource } from "./contracts";
import { LessonTermsProvider } from "../components/visuals/LessonTerms";

const raw = document.getElementById("studio-book-data")?.textContent || "{}";
const book = JSON.parse(raw) as OfflineBook;
const bookAppearance = sanitizeAppearance(book.appearance);
const initialTheme =
  bookAppearance.mode === "system"
    ? matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : bookAppearance.mode;
const unavailable = () =>
  Promise.reject(
    new Error(
      "This standalone textbook uses only its embedded resources. Open Learning Studio to retrieve additional material.",
    ),
  );
// This is an authored, read-only resource adapter. No credentials, provider
// requests, hidden memory, filesystem methods, or model execution exist here.
window.studio = {
  platform: "offline-export",
  onStream: () => () => {},
  invoke: async <T,>(action: string, payload?: unknown): Promise<T> => {
    const p = payload as {
      query?: string;
      source?: string;
      id?: string;
      input?: string;
      format?: string;
    };
    if (action === "images:search")
      return (book.assets.images[p?.query || ""] || []) as T;
    if (action === "structure:fetch") {
      const structure = book.assets.structures[`${p?.source}:${p?.id}`];
      if (!structure)
        throw new Error(
          "This structure was not bundled. Its lesson and source identifier remain available.",
        );
      return structure as T;
    }
    if (action === "chemistry:render") {
      const value = book.assets.chemicals[`${p?.format}:${p?.input}`];
      if (!value) throw new Error("This chemical depiction was not bundled.");
      return value[
        document.documentElement.dataset.theme === "dark" ? "dark" : "light"
      ] as T;
    }
    if (action === "external:open") {
      const url = new URL(String(payload));
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error("Only HTTPS source links can be opened.");
      window.open(url.href, "_blank", "noopener,noreferrer");
      return true as T;
    }
    return unavailable();
  },
} satisfies StudioBridge;

function ExportVisual({
  block,
  instance,
}: {
  block: ContentBlock;
  instance?: ExportVisualState;
}) {
  const [state, setState] = useState(instance?.state || {});
  if (!instance) return <VisualBlock block={block} />;
  const runtime: VisualRuntime = {
    id: instance.id,
    subjectId: instance.subjectId,
    state,
    placement: "inline",
    visible: true,
    patch: (patch) => setState((previous) => ({ ...previous, ...patch })),
    move: () => {},
    storeAsset: async (value) => {
      const id = "local-" + crypto.randomUUID();
      book.assets.sources[id] = value as (typeof book.assets.sources)[string];
      return id;
    },
    loadAsset: async (id) => {
      const asset = book.assets.sources[id];
      if (!asset)
        throw new Error(
          "The referenced visual source was not included in this export.",
        );
      return asset;
    },
  };
  return (
    <VisualRuntimeContext.Provider value={runtime}>
      <VisualBlock block={block} />
      {instance.annotations.map((annotation) => (
        <p className="offline-visual-annotation" key={annotation.id}>
          {annotation.text}
        </p>
      ))}
    </VisualRuntimeContext.Provider>
  );
}

function ReadingBlocks({ chapter }: { chapter: ExportChapter }) {
  const groups: { source?: ExportReadingSource; indices: number[] }[] = [];
  chapter.blocks.forEach((_, index) => {
    const source = chapter.blockSources?.[index],
      previous = groups.at(-1);
    if (previous && JSON.stringify(previous.source) === JSON.stringify(source))
      previous.indices.push(index);
    else groups.push({ source, indices: [index] });
  });
  return (
    <>
      {groups.map((group, index) => (
        <section
          key={chapter.id + ":" + index}
          data-annotation-kind={group.source?.kind}
          data-annotation-id={group.source?.id}
          data-annotation-conversation={group.source?.conversationId}
          data-annotation-page={group.source?.page}
        >
          {group.indices.map((i) => (
            <ExportVisual
              key={chapter.id + ":" + i}
              block={chapter.blocks[i]}
              instance={chapter.visualStates?.[i]}
            />
          ))}
        </section>
      ))}
    </>
  );
}

function App() {
  const [search, setSearch] = useState(""),
    [active, setActive] = useState(book.chapters[0]?.id || ""),
    [theme, setTheme] = useState<"light" | "dark">(initialTheme),
    [notes, setNotes] = useState<Record<string, string>>({});
  const matches = book.chapters.filter((chapter) =>
    `${chapter.title} ${chapter.markdown} ${JSON.stringify(chapter.blocks)}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const chapter =
    book.chapters.find((item) => item.id === active) || book.chapters[0];
  useEffect(() => {
    const timer = requestAnimationFrame(() =>
      paintReadingHighlights(chapter?.highlights || [], "offline"),
    );
    return () => cancelAnimationFrame(timer);
  }, [chapter]);
  useEffect(() => {
    applyTheme(bookAppearance[theme], theme);
  }, [theme]);
  useEffect(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem("studio-export-notes:" + book.exportedAt) || "{}",
      );
      if (value && typeof value === "object") setNotes(value);
    } catch {
      /* File origins may disable local storage; in-memory notes remain usable. */
    }
  }, []);
  const saveNote = (text: string) => {
    if (!chapter) return;
    const next = { ...notes, [chapter.id]: text };
    setNotes(next);
    try {
      localStorage.setItem(
        "studio-export-notes:" + book.exportedAt,
        JSON.stringify(next),
      );
    } catch {
      /* Notes remain available until this page is closed. */
    }
  };
  const downloadNotes = () => {
    const file = new Blob(
        [JSON.stringify({ title: book.title, notes }, null, 2)],
        { type: "application/json" },
      ),
      url = URL.createObjectURL(file),
      a = document.createElement("a");
    a.href = url;
    a.download = "textbook-annotations.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="offline-book">
      <aside className="offline-nav">
        <span className="offline-eyebrow">
          LEARNING STUDIO · PORTABLE TEXTBOOK
        </span>
        <h1>{book.title}</h1>
        <p>{book.subjectName || "Your selected learning material"}</p>
        <label>
          Search chapters
          <input
            aria-label="Search chapters"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find an idea or equation…"
          />
        </label>
        <nav aria-label="Textbook chapters">
          {matches.map((item, index) => (
            <button
              key={item.id}
              className={chapter?.id === item.id ? "active" : ""}
              onClick={() => {
                setActive(item.id);
                document.querySelector(".offline-main")?.scrollTo(0, 0);
              }}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {item.title}
            </button>
          ))}
        </nav>
        {!matches.length && <p>No matching chapters.</p>}
        <div className="offline-nav-bottom">
          <button
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            {theme === "light" ? "Dark appearance" : "Light appearance"}
          </button>
          <button onClick={downloadNotes}>Download annotations</button>
          <small>Works offline. No account or model is required.</small>
        </div>
      </aside>
      <main className="offline-main">
        <header>
          <span>YOUR LEARNING, WITH YOU</span>
          <button onClick={() => window.print()}>Print chapter</button>
        </header>
        <article
          className="reading"
          data-annotation-kind={chapter?.source?.kind}
          data-annotation-id={chapter?.source?.id}
          data-annotation-page={chapter?.source?.page}
        >
          <div className="offline-provenance">
            <span>OFFLINE EDITION</span>
            <span>{new Date(book.exportedAt).toLocaleDateString()}</span>
          </div>
          {chapter ? (
            <LessonTermsProvider content={chapter.blocks}>
              <h2 className="offline-chapter-title">{chapter.title}</h2>
              <Markdown text={chapter.markdown} />
              <ReadingBlocks chapter={chapter} />
              {!!chapter.highlights?.length && (
                <section className="offline-source-notes">
                  <h3>Saved highlights</h3>
                  {chapter.highlights.map((item) => (
                    <article
                      className={"annotation-card color-" + item.color}
                      key={item.id}
                    >
                      <blockquote>{item.quote}</blockquote>
                      {item.note && <p>{item.note}</p>}
                      {!!item.tags.length && (
                        <p>{item.tags.map((tag) => "#" + tag).join(" ")}</p>
                      )}
                      <small>
                        {item.sourceKind}
                        {item.page ? " · page " + item.page : ""}
                        {item.anchorState === "orphaned"
                          ? " · original source changed; verify this passage"
                          : ""}
                      </small>
                    </article>
                  ))}
                </section>
              )}
              {chapter.notes && (
                <section className="offline-source-notes">
                  <h3>Saved lesson notes</h3>
                  <Markdown text={chapter.notes} />
                </section>
              )}
              {chapter.citations.length > 0 && (
                <section className="offline-citations">
                  <h3>Sources & provenance</h3>
                  <ol>
                    {chapter.citations.map((citation, index) => (
                      <li key={index}>
                        {citation.url ? (
                          <a
                            href={citation.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {citation.label}
                          </a>
                        ) : (
                          citation.label
                        )}
                        {citation.page ? " · page " + citation.page : ""}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {chapter.originMessageIds.length > 0 && (
                <details className="offline-origin">
                  <summary>Original message references</summary>
                  <p>{chapter.originMessageIds.join(", ")}</p>
                </details>
              )}
              <section className="offline-personal-notes">
                <h3>Your annotations</h3>
                <textarea
                  aria-label="Chapter annotations"
                  value={notes[chapter.id] || ""}
                  onChange={(e) => saveNote(e.target.value)}
                  rows={4}
                  placeholder="Write a connection, a question, or something to revisit…"
                />
                <small>
                  Stored in this browser when permitted. Download annotations to
                  keep a portable copy.
                </small>
              </section>
            </LessonTermsProvider>
          ) : (
            <h2>No selected material</h2>
          )}
          <footer>
            Exported from Learning Studio. Coverage and source presence do not
            imply demonstrated understanding.
          </footer>
        </article>
        {book.warnings.length > 0 && (
          <details className="offline-warnings">
            <summary>Export resource notes ({book.warnings.length})</summary>
            {book.warnings.map((warning, index) => (
              <p key={index}>{warning}</p>
            ))}
          </details>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
