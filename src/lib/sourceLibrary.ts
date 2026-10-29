import type { LibraryItem } from "../types";

/** Merge the server's source-import result with edits made while it was running.
 * An unchanged renderer snapshot cannot undo a canonical update or deletion.
 * Locally changed fields, new resources and explicit deletions remain intact.
 * Canonical order is retained; new local IDs follow it without duplicates. */
export function mergeStudyLibrary(
  baseline: LibraryItem[],
  local: LibraryItem[],
  canonical: LibraryItem[],
): LibraryItem[] {
  const before = new Map(baseline.map((item) => [item.id, item]));
  const current = new Map(local.map((item) => [item.id, item]));
  const merged = new Map(canonical.map((item) => [item.id, item]));
  for (const id of before.keys()) if (!current.has(id)) merged.delete(id);
  for (const [id, item] of current) {
    const previous = before.get(id);
    if (!previous) {
      merged.set(id, { ...item });
      continue;
    }
    if (item === previous) continue;
    const oldFields = previous as unknown as Record<string, unknown>;
    const fields = item as unknown as Record<string, unknown>;
    const changed = [
      ...new Set([...Object.keys(oldFields), ...Object.keys(fields)]),
    ].filter(
      (key) => JSON.stringify(oldFields[key]) !== JSON.stringify(fields[key]),
    );
    if (!changed.length) continue;
    const next = { ...(merged.get(id) || item) } as unknown as Record<
      string,
      unknown
    >;
    for (const key of changed) {
      if (
        Object.prototype.hasOwnProperty.call(fields, key) &&
        fields[key] !== undefined
      )
        next[key] = fields[key];
      else delete next[key];
    }
    merged.set(id, next as unknown as LibraryItem);
  }
  return [...merged.values()];
}
