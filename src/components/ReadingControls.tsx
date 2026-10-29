import type { Appearance } from "../lib/themes";
import { useEffect, useRef, type ReactNode } from "react";

/** Native disclosure with the dismissal behavior expected of a toolbar menu. */
export function ReadingMenu({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const details = host.current;
      if (details?.open && !details.contains(event.target as Node))
        details.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      const details = host.current;
      if (event.key === "Escape" && details?.open) {
        details.open = false;
        details.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <details className="folio-reading-menu" ref={host}>
      <summary>Reading</summary>
      {children}
    </details>
  );
}

export default function ReadingControls({
  appearance,
  systemScheme,
  onChange,
  onSettings,
}: {
  appearance: Appearance;
  systemScheme: "light" | "dark";
  onChange: (appearance: Appearance) => void;
  onSettings: () => void;
}) {
  const scheme = appearance.mode === "system" ? systemScheme : appearance.mode;
  const size = appearance[scheme].typography.size;
  const update = (value: number) =>
    onChange({
      ...appearance,
      [scheme]: {
        ...appearance[scheme],
        typography: {
          ...appearance[scheme].typography,
          size: Math.max(13, Math.min(28, value)),
        },
      },
    });
  return (
    <div
      className="reading-controls"
      role="group"
      aria-label="Lesson typography"
    >
      <button
        title="Decrease lesson text size"
        disabled={size <= 13}
        onClick={() => update(size - 1)}
      >
        A− Smaller
      </button>
      <button
        title="Reset reading size to 18 pixels"
        onClick={() => update(18)}
      >
        {size}px Reset
      </button>
      <button
        title="Increase lesson text size"
        disabled={size >= 28}
        onClick={() => update(size + 1)}
      >
        A+ Larger
      </button>
      <button aria-label="Open typography settings" onClick={onSettings}>
        Typography
      </button>
    </div>
  );
}
