import type Database from "better-sqlite3";

export function zoomFactor(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.max(0.65, Math.min(2, Math.round(n * 100) / 100))
    : 1;
}
export function zoomShortcut(input: {
  control?: boolean;
  meta?: boolean;
  alt?: boolean;
  key: string;
  type: string;
}) {
  if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt)
    return;
  if (["+", "=", "Add"].includes(input.key)) return "in" as const;
  if (["-", "Subtract"].includes(input.key)) return "out" as const;
  if (input.key === "0") return "reset" as const;
}
export function readZoom(db: Database.Database) {
  const row = db
    .prepare("SELECT value FROM settings WHERE id='installation:zoom'")
    .get() as { value: string } | undefined;
  return row ? zoomFactor(row.value) : 1;
}
export function saveZoom(db: Database.Database, value: number) {
  const factor = zoomFactor(value);
  db.prepare(
    "INSERT OR REPLACE INTO settings(id,value) VALUES('installation:zoom',?)",
  ).run(String(factor));
  return factor;
}
