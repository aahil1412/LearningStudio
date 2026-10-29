import { useEffect } from "react";
export function useDialogFocus() {
  useEffect(() => {
    let current: HTMLElement | null = null;
    const previous = new WeakMap<HTMLElement, HTMLElement>();
    const controls = (modal: HTMLElement) =>
      [
        ...modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length > 0);
    const top = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[role="dialog"][aria-modal="true"]',
        ),
      ]
        .filter((el) => el.getClientRects().length > 0)
        .at(-1) || null;
    const refresh = () => {
      const modal = top();
      if (modal === current) return;
      const old = current;
      current = modal;
      if (modal) {
        const active = document.activeElement;
        if (active instanceof HTMLElement && !modal.contains(active))
          previous.set(modal, active);
        if (!modal.contains(document.activeElement))
          setTimeout(() => {
            if (current === modal && !modal.contains(document.activeElement))
              (controls(modal)[0] || modal).focus();
          }, 0);
      } else if (old) {
        const target = previous.get(old);
        if (target?.isConnected) target.focus();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const modal = top();
      if (!modal) return;
      const list = controls(modal);
      if (!list.length) {
        event.preventDefault();
        modal.tabIndex = -1;
        modal.focus();
        return;
      }
      const first = list[0],
        last = list[list.length - 1];
      if (!modal.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", key, true);
    refresh();
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", key, true);
    };
  }, []);
}
