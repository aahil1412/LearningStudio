import { defaultData } from "./defaults";
import type { StudioData } from "../types";
export const isDesktop = !!window.studio;
export async function invoke<T = unknown>(
  action: string,
  payload?: unknown,
): Promise<T> {
  if (window.studio) return window.studio.invoke<T>(action, payload);
  // A browser preview can edit a local library; protected services remain desktop-only.
  if (action === "data:load") {
    const saved = localStorage.getItem("studio-preview");
    return (saved ? JSON.parse(saved) : defaultData()) as T;
  }
  if (action === "data:save") {
    localStorage.setItem(
      "studio-preview",
      JSON.stringify(payload as StudioData),
    );
    return { savedAt: new Date().toISOString() } as T;
  }
  if (action === "data:concepts") {
    const saved = localStorage.getItem("studio-preview");
    return (saved ? JSON.parse(saved).concepts || [] : []) as T;
  }
  if (action === "auth:status") return { connected: false } as T;
  if (action === "auth:models") return [] as T;
  if (action === "external:open") {
    window.open(String(payload), "_blank", "noopener,noreferrer");
    return true as T;
  }
  throw new Error("Open the Windows desktop app to use this feature.");
}
