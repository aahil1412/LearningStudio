import {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  Children,
  cloneElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./lesson-terms.css";
import type { ContentBlock } from "../../types";

type Glossary = {
  items: { term: string; definition: string }[];
  open: (term: string, anchor: HTMLElement) => void;
};
const Context = createContext<Glossary | null>(null);
export function LessonTermsProvider({
  content,
  children,
}: {
  content: ContentBlock[];
  children: ReactNode;
}) {
  const items = useMemo(() => {
    const seen = new Set<string>();
    return content
      .flatMap((b) => (b.type === "terms" ? b.items : []))
      .filter((t) => {
        const key = t.term.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 48);
  }, [content]);
  const [active, setActive] = useState<{
    term: string;
    anchor: HTMLElement;
  } | null>(null);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const panel = useRef<HTMLElement>(null);
  const item = items.find((term) => term.term === active?.term);
  const value = useMemo(
    () => ({
      items,
      open: (term: string, anchor: HTMLElement) => setActive({ term, anchor }),
    }),
    [items],
  );
  const close = (restore = false) => {
    if (restore) active?.anchor.focus({ preventScroll: true });
    setActive(null);
  };
  useLayoutEffect(() => {
    if (!active || !item) return;
    const update = () => {
      if (!active.anchor.isConnected) {
        setActive(null);
        return;
      }
      const anchor = active.anchor.getBoundingClientRect();
      if (anchor.bottom < 0 || anchor.top > innerHeight) {
        setActive(null);
        return;
      }
      const width = Math.min(360, innerWidth - 32),
        height = panel.current?.offsetHeight || 180;
      setPosition({
        left: Math.max(16, Math.min(anchor.left, innerWidth - width - 16)),
        top:
          anchor.bottom + height + 12 < innerHeight
            ? anchor.bottom + 8
            : Math.max(16, anchor.top - height - 8),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [active, item]);
  useEffect(() => {
    if (!active) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !active.anchor.contains(event.target as Node)
      )
        setActive(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        active.anchor.focus({ preventScroll: true });
        setActive(null);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [active]);
  return (
    <Context.Provider value={value}>
      {children}
      {item &&
        createPortal(
          <aside
            ref={panel}
            className="term-popover"
            role="dialog"
            aria-label={`Definition of ${item.term}`}
            style={position}
          >
            <header>
              <strong>{item.term}</strong>
              <button
                type="button"
                onClick={() => close(true)}
                aria-label="Close term definition"
              >
                <X size={16} />
              </button>
            </header>
            <p>{item.definition}</p>
          </aside>,
          document.body,
        )}
    </Context.Provider>
  );
}

/** Mark rendered prose, never source Markdown, code, links or mathematical markup. */
export function useGlossaryMarkup() {
  const glossary = useContext(Context);
  return (nodes: ReactNode): ReactNode => {
    if (!glossary?.items.length) return nodes;
    const pattern = new RegExp(
      `\\b(${glossary.items
        .map((t) => t.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .sort((a, b) => b.length - a.length)
        .join("|")})\\b`,
      "gi",
    );
    const decorate = (children: ReactNode): ReactNode =>
      Children.map(children, (node) => {
        if (typeof node === "string") {
          return node.split(pattern).map((part, index) => {
            const term = glossary.items.find(
              (t) => t.term.toLowerCase() === part.toLowerCase(),
            );
            return term ? (
              <button
                key={index}
                type="button"
                className="lesson-term"
                aria-label={`Define ${term.term}`}
                onClick={(event) =>
                  glossary.open(term.term, event.currentTarget)
                }
              >
                {part}
              </button>
            ) : (
              part
            );
          });
        }
        if (!isValidElement(node)) return node;
        const el = node as ReactElement<{
          children?: ReactNode;
          className?: string;
          dangerouslySetInnerHTML?: unknown;
        }>;
        if (
          typeof el.type !== "string" ||
          ["code", "pre", "a", "button", "svg", "math"].includes(el.type) ||
          el.props.dangerouslySetInnerHTML ||
          /katex|math/.test(el.props.className || "")
        )
          return node;
        return cloneElement(el, undefined, decorate(el.props.children));
      });
    return decorate(nodes);
  };
}
