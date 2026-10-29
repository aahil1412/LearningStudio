import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./science-popover.css";
/** A transient explanation beside the object that was actually selected. It is
 * never baked into the SVG and never changes its scientific geometry. */
export default function SciencePopover({
  anchor,
  title,
  children,
  onClose,
}: {
  anchor: Element | null;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({
    visibility: "hidden",
  });
  useEffect(() => {
    if (!anchor) return;
    const place = () => {
      if (!anchor.isConnected) {
        onClose();
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const drawing = anchor.closest("svg")?.getBoundingClientRect() || rect;
      const width = Math.min(340, window.innerWidth - 32),
        height = Math.min(host.current?.offsetHeight || 180, 280);
      const left =
        drawing.right + width + 24 < window.innerWidth
          ? drawing.right + 12
          : drawing.left - width - 12 > 16
            ? drawing.left - width - 12
            : Math.min(Math.max(16, rect.left), window.innerWidth - width - 16);
      let top = rect.top + rect.height / 2 - height / 2;
      if (left < drawing.right && left + width > drawing.left)
        top =
          drawing.top - height - 12 > 16
            ? drawing.top - height - 12
            : drawing.bottom + height + 16 < window.innerHeight
              ? drawing.bottom + 12
              : rect.bottom + height + 16 < window.innerHeight
                ? rect.bottom + 12
                : rect.top - height - 12;
      top = Math.max(16, Math.min(window.innerHeight - height - 16, top));
      // Inspection must not cover the playback/parameter controls. In a narrow
      // viewport a temporary popup may share drawing space, but controls remain
      // reachable and dismissing it must not move a button during pointer down.
      const figure = anchor.closest(
        ".scientific-illustration,.scientific-scene,.scientific-model",
      );
      for (const control of figure?.querySelectorAll("button,input,select") ||
        []) {
        const box = control.getBoundingClientRect();
        if (
          left < box.right &&
          left + width > box.left &&
          top < box.bottom &&
          top + height > box.top
        ) {
          if (box.top - height - 12 >= 16) top = box.top - height - 12;
          else if (box.bottom + height + 28 < window.innerHeight)
            top = box.bottom + 12;
        }
      }
      setPosition({
        left,
        top: Math.max(16, Math.min(window.innerHeight - height - 16, top)),
        width,
        visibility: "visible",
      });
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };
    const outside = (event: MouseEvent) => {
      if (
        !host.current?.contains(event.target as Node) &&
        !anchor.contains(event.target as Node)
      )
        onClose();
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("keydown", key, true);
    document.addEventListener("click", outside, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("keydown", key, true);
      document.removeEventListener("click", outside, true);
    };
  }, [anchor, onClose]);
  if (!anchor || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={host}
      className="science-popover"
      role="dialog"
      aria-label={title}
      style={position}
    >
      <div className="science-popover-heading">
        <strong>{title}</strong>
        <button aria-label="Close figure explanation" onClick={onClose}>
          ×
        </button>
      </div>
      <div>{children}</div>
    </div>,
    document.body,
  );
}
