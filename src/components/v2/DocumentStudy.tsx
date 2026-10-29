import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileText,
  MessageCircle,
  StickyNote,
  X,
} from "lucide-react";
import type { LibraryItem } from "../../types";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { BundledCMaps, BundledPdfFonts } from "./pdfAssets";
import "./v2-reading.css";
GlobalWorkerOptions.workerSrc = pdfWorker;
function OriginalPdfPage({ url, page }: { url: string; page: number }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    host = useRef<HTMLDivElement>(null),
    [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [zoom, setZoom] = useState(1),
    [width, setWidth] = useState(600),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setError("");
    setPdf(null);
    setLoading(true);
    if (!/^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/.test(url)) {
      setError("Only retained PDF bytes can be displayed.");
      return;
    }
    const raw = atob(url.split(",")[1]),
      data = Uint8Array.from(raw, (char) => char.charCodeAt(0));
    const task = getDocument({
      data,
      isEvalSupported: false,
      enableXfa: false,
      useSystemFonts: true,
      disableFontFace: true,
      useWorkerFetch: false,
      CMapReaderFactory: BundledCMaps,
      StandardFontDataFactory: BundledPdfFonts,
    });
    void task.promise
      .then((value) => {
        if (alive) setPdf(value);
        else void value.destroy();
      })
      .catch((e) => {
        if (alive) {
          setError(
            e instanceof Error
              ? e.message
              : "The source PDF could not be opened.",
          );
          setLoading(false);
        }
      });
    return () => {
      alive = false;
      void task.destroy();
    };
  }, [url]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(200, entries[0].contentRect.width - 24)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let alive = true,
      render: RenderTask | undefined;
    setLoading(true);
    setError("");
    void pdf
      .getPage(Math.min(Math.max(page, 1), pdf.numPages))
      .then(async (source) => {
        if (!alive || !canvas.current) return;
        const natural = source.getViewport({ scale: 1 }),
          scale = Math.min(width / natural.width, 2) * zoom,
          ratio = Math.min(devicePixelRatio || 1, 2),
          viewport = source.getViewport({ scale: scale * ratio }),
          element = canvas.current;
        element.width = Math.ceil(viewport.width);
        element.height = Math.ceil(viewport.height);
        element.style.width = viewport.width / ratio + "px";
        element.style.height = viewport.height / ratio + "px";
        render = source.render({ canvas: element, viewport });
        await render.promise;
        if (alive) setLoading(false);
      })
      .catch((e) => {
        if (alive && e?.name !== "RenderingCancelledException") {
          setError(
            e instanceof Error
              ? e.message
              : "This PDF page could not be rendered.",
          );
          setLoading(false);
        }
      });
    return () => {
      alive = false;
      render?.cancel();
    };
  }, [pdf, page, zoom, width]);
  return (
    <section className="v2-original-pdf" aria-label="Original PDF document">
      <div className="v2-pdf-toolbar">
        <button
          aria-label="Zoom out PDF"
          disabled={zoom <= 0.5}
          onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
        >
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          aria-label="Zoom in PDF"
          disabled={zoom >= 3}
          onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
        >
          +
        </button>
        <button onClick={() => setZoom(1)}>Fit page width</button>
        {pdf && (
          <small>
            Page {page} of {pdf.numPages}
          </small>
        )}
      </div>
      {loading && <p role="status">Rendering original source page…</p>}
      {error && (
        <p role="alert" className="notice error">
          {error} Extracted page text remains available.
        </p>
      )}
      <div className="v2-pdf-page" ref={host}>
        <canvas
          ref={canvas}
          aria-label={"Original PDF page " + page}
          role="img"
        />
      </div>
    </section>
  );
}
export type CitedExcerpt = {
  documentId: string;
  title: string;
  page?: number;
  text: string;
  citation: string;
  question?: string;
};
export default function DocumentStudy({
  document: resource,
  pdfUrl,
  initialPage,
  onUseExcerpt,
  onClose,
}: {
  document: LibraryItem & { sourceAssetId?: string };
  pdfUrl?: string;
  initialPage?: number;
  onUseExcerpt: (
    excerpt: CitedExcerpt,
    action: "explain" | "question" | "note",
  ) => void;
  onClose?: () => void;
}) {
  const pages = resource.pages?.length
      ? resource.pages
      : [{ page: 1, text: resource.content }],
    host = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(pages[0]?.page || 1),
    [tab, setTab] = useState<"text" | "pdf" | "figures">("text"),
    [selection, setSelection] = useState(""),
    [question, setQuestion] = useState(""),
    [sourceUrl, setSourceUrl] = useState(pdfUrl || ""),
    [error, setError] = useState("");
  const current = pages.find((item) => item.page === page) || pages[0],
    figures = (resource.figures || []).filter((figure) => figure.page === page);
  useEffect(() => {
    setPage(
      pages.some((item) => item.page === initialPage)
        ? initialPage!
        : pages[0]?.page || 1,
    );
    setSelection("");
    setQuestion("");
    setSourceUrl(pdfUrl || "");
    if (!pdfUrl && resource.sourceAssetId && window.studio)
      void window.studio
        .invoke<string | null>("documents:pdf-url", { resourceId: resource.id })
        .then((url) => {
          if (url?.startsWith("data:application/pdf;base64,"))
            setSourceUrl(url);
          else setError("The retained source is not a valid PDF asset.");
        })
        .catch((e) => setError(String(e)));
  }, [resource.id, pdfUrl, resource.sourceAssetId, initialPage]);
  const index = pages.findIndex((item) => item.page === page),
    normalized = (text: string) => text.trim().replace(/\s+/g, " "),
    isExact =
      !!selection.trim() &&
      normalized(current?.text || "").includes(normalized(selection));
  const excerpt = (): CitedExcerpt => ({
    documentId: resource.id,
    title: resource.title,
    page: current?.page,
    text: selection.trim(),
    citation: resource.title + (current?.page ? " · page " + current.page : ""),
    ...(question.trim() ? { question: question.trim() } : {}),
  });
  const capture = () => {
    const selected = window.getSelection();
    if (
      selected &&
      host.current?.contains(selected.anchorNode) &&
      host.current.contains(selected.focusNode)
    ) {
      const text = selected.toString().trim();
      if (text) setSelection(text.slice(0, 20000));
    }
  };
  return (
    <section className="v2-document-study" aria-label="Document study">
      <header>
        <div>
          <span className="v2-eyebrow">READ WITH YOUR SOURCE BESIDE YOU</span>
          <h2>
            <FileText size={20} />
            {resource.title}
          </h2>
          <p>
            Source material remains distinct from established knowledge and
            learner understanding.
          </p>
        </div>
        {onClose && (
          <button aria-label="Close document study" onClick={onClose}>
            <X size={17} />
          </button>
        )}
      </header>
      <div className="v2-document-controls">
        <button
          aria-label="Previous document page"
          disabled={index <= 0}
          onClick={() => {
            setPage(pages[index - 1].page);
            setSelection("");
          }}
        >
          <ChevronLeft size={16} />
        </button>
        <label>
          Page
          <select
            aria-label="Document page"
            value={page}
            onChange={(e) => {
              setPage(Number(e.target.value));
              setSelection("");
            }}
          >
            {pages.map((item) => (
              <option value={item.page} key={item.page}>
                {item.page}
              </option>
            ))}
          </select>
        </label>
        <button
          aria-label="Next document page"
          disabled={index >= pages.length - 1}
          onClick={() => {
            setPage(pages[index + 1].page);
            setSelection("");
          }}
        >
          <ChevronRight size={16} />
        </button>
        <nav>
          <button
            className={tab === "text" ? "active" : ""}
            onClick={() => setTab("text")}
          >
            Page text
          </button>
          {sourceUrl && (
            <button
              className={tab === "pdf" ? "active" : ""}
              onClick={() => setTab("pdf")}
            >
              Original PDF
            </button>
          )}
          <button
            className={tab === "figures" ? "active" : ""}
            onClick={() => setTab("figures")}
          >
            Figures ({figures.length})
          </button>
        </nav>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="v2-document-body">
        <div className="v2-document-reader" ref={host} onMouseUp={capture}>
          {tab === "pdf" && sourceUrl ? (
            <OriginalPdfPage url={sourceUrl} page={page} />
          ) : tab === "figures" ? (
            <>
              {figures.map((figure) => (
                <figure key={figure.id}>
                  <img
                    src={figure.dataUrl}
                    alt={
                      figure.caption || `Source figure on page ${figure.page}`
                    }
                  />
                  <figcaption>
                    {figure.caption || "Imported source figure"} ·{" "}
                    {resource.title} · page {figure.page}
                  </figcaption>
                </figure>
              ))}
              {!figures.length && (
                <p>No extracted figures were retained for this page.</p>
              )}
            </>
          ) : (
            <>
              <span className="v2-page-source">
                {resource.title} · page {current?.page} · extracted source text
              </span>
              <div
                className="v2-document-page-text document-page-text"
                data-annotation-kind="document"
                data-annotation-id={resource.id}
                data-annotation-page={current?.page}
                data-annotation-subject={resource.subjectId}
              >
                {current?.text ||
                  "No readable page text was retained. Use the original PDF when available."}
              </div>
            </>
          )}
        </div>
        <aside className="v2-excerpt-tools">
          <h3>
            <BookOpen size={16} />
            Work with a cited passage
          </h3>
          <p>
            Select page text to preserve its actual location. OCR may contain
            errors; verify mathematical symbols against the original.
          </p>
          <label>
            Selected excerpt
            <textarea
              aria-label="Selected document excerpt"
              value={selection}
              onChange={(e) => setSelection(e.target.value)}
              rows={9}
            />
          </label>
          <small>
            {isExact
              ? resource.title + " · page " + current?.page
              : "Select an exact passage from this page before citing it."}
          </small>
          <button
            disabled={!isExact}
            onClick={() => onUseExcerpt(excerpt(), "explain")}
          >
            Explain this excerpt
          </button>
          <label>
            Your question
            <input
              aria-label="Question about document excerpt"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <button
            disabled={!isExact || !question.trim()}
            onClick={() => onUseExcerpt(excerpt(), "question")}
          >
            <MessageCircle size={14} />
            Ask with page context
          </button>
          <button
            disabled={!isExact}
            onClick={() => onUseExcerpt(excerpt(), "note")}
          >
            <StickyNote size={14} />
            Save cited excerpt
          </button>
          <p>
            Excerpt actions keep the active lesson objective and reading
            position. No citation is generated for text that does not appear on
            the selected page.
          </p>
        </aside>
      </div>
    </section>
  );
}
