import { createHash, randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { statSync } from "node:fs";
import { StudioStore } from "./storage";
import type { StudioData } from "../src/types";

export type RestorePreview = {
  token: string;
  filename: string;
  schemaVersion: number;
  expiresAt: string;
  counts: {
    lessons: number;
    subjects: number;
    concepts: number;
    curriculumItems: number;
    libraryItems: number;
    chapters: number;
    highlights: number;
  };
};

/** Preview validation never touches the active database. The pending token is
 * bound to one source fingerprint; neither a renderer-supplied path nor a changed
 * backup can be committed. Only non-content counts leave this service. */
export class RestorePreviewService {
  private pending?: {
    token: string;
    path: string;
    fingerprint: string;
    expires: number;
  };
  private committedToken?: string;
  constructor(
    private store: StudioStore,
    private now = Date.now,
  ) {}
  /** Process-local guard. It deliberately survives a renderer failure, but resets
   * on app restart, where SQLite's committed state is loaded authoritatively. */
  get awaitingAcknowledgment() {
    return !!this.committedToken;
  }
  private fingerprint(path: string) {
    if (statSync(path).size > 1_000_000_000)
      throw new Error("Backup exceeds 1 GB limit.");
    const source = new StudioStore(path, { readonly: true });
    try {
      const bytes = source.db.serialize();
      if (bytes.length > 1_000_000_000)
        throw new Error("Backup exceeds 1 GB limit.");
      return createHash("sha256").update(bytes).digest("hex");
    } finally {
      source.close();
    }
  }
  preview(path: string): RestorePreview {
    if (this.awaitingAcknowledgment)
      throw new Error(
        "Finish reopening the restored library, or restart Learning Studio before previewing another backup.",
      );
    this.pending = undefined;
    if (
      this.store.db.name !== ":memory:" &&
      resolve(path).toLowerCase() === resolve(this.store.db.name).toLowerCase()
    )
      throw new Error("Choose a backup different from the active library.");
    const fingerprint = this.fingerprint(path);
    const validated = new StudioStore(":memory:");
    try {
      const data = validated.restoreBackup(path);
      if (this.fingerprint(path) !== fingerprint)
        throw new Error(
          "The backup changed during validation. Preview it again before restoring.",
        );
      const count = (table: string, clause = "") =>
        (
          validated.db
            .prepare(`SELECT COUNT(*) AS count FROM ${table} ${clause}`)
            .get() as { count: number }
        ).count;
      const token = randomUUID(),
        expires = this.now() + 10 * 60_000;
      this.pending = { token, path, fingerprint, expires };
      return {
        token,
        filename: basename(path),
        schemaVersion: 4,
        expiresAt: new Date(expires).toISOString(),
        counts: {
          lessons: data.lessons.length,
          subjects: count("subjects"),
          concepts: count("subject_concepts"),
          curriculumItems: count("curriculum_nodes"),
          libraryItems: data.library.length,
          chapters: count("subject_records", "WHERE kind='chapter'"),
          highlights: count("annotation_highlights"),
        },
      };
    } finally {
      validated.close();
    }
  }
  cancel(token: string) {
    if (this.pending?.token === token) this.pending = undefined;
  }
  confirm(token: string, beforeCommit: () => void = () => {}): StudioData {
    const pending = this.pending;
    if (!pending || pending.token !== token || pending.expires < this.now())
      throw new Error(
        "This backup preview expired or is no longer available. Choose the backup again.",
      );
    if (this.awaitingAcknowledgment)
      throw new Error(
        "The restored library is still reopening. Restart the app if it cannot finish.",
      );
    this.pending = undefined;
    if (this.fingerprint(pending.path) !== pending.fingerprint)
      throw new Error(
        "The backup changed since your preview. Choose it again to review the updated contents.",
      );
    beforeCommit();
    this.committedToken = token;
    try {
      return this.store.restoreBackup(pending.path);
    } catch (error) {
      this.committedToken = undefined;
      throw error;
    }
  }
  acknowledge(token: string) {
    if (!this.committedToken) return;
    if (this.committedToken !== token)
      throw new Error(
        "The restored library acknowledgment does not match its confirmed preview.",
      );
    this.committedToken = undefined;
  }
}
