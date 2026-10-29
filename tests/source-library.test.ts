import { describe, expect, it } from "vitest";
import { mergeStudyLibrary } from "../src/lib/sourceLibrary";
import type { LibraryItem } from "../src/types";

function resource(id: string, patch: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id,
    title: id,
    kind: "note",
    subject: "Biology",
    content: `Original ${id}`,
    createdAt: "2026-10-28T00:00:00.000Z",
    ...patch,
  };
}
describe("source-import library reconciliation", () => {
  it("retains a canonical pasted textbook alongside notes added, edited and deleted while import runs", () => {
    const note = resource("note"),
      deleted = resource("deleted"),
      fresh = resource("fresh"),
      book = resource("pasted-book", {
        kind: "document",
        content: "Chapter 1\nActual source",
        verified: false,
      });
    const before = [note, deleted],
      local = [{ ...note, content: "My changed note" }, fresh],
      canonical = [note, deleted, book];
    const frozenInput = JSON.stringify([before, local, canonical]);
    const result = mergeStudyLibrary(before, local, canonical);
    expect(result.find((item) => item.id === note.id)?.content).toBe(
      "My changed note",
    );
    expect(result.find((item) => item.id === book.id)).toEqual(book);
    expect(result.find((item) => item.id === fresh.id)).toEqual(fresh);
    expect(result.some((item) => item.id === deleted.id)).toBe(false);
    expect(JSON.stringify([before, local, canonical])).toBe(frozenInput);
  });
  it("does not overwrite canonical updates or resurrect canonical deletions with an unchanged stale snapshot", () => {
    const note = resource("note"),
      removed = resource("removed"),
      addition = resource("server-book", { kind: "document" });
    const result = mergeStudyLibrary(
      [note, removed],
      [note, removed],
      [
        {
          ...note,
          title: "Server-corrected title",
          content: "Canonical updated text",
        },
        addition,
      ],
    );
    expect(result).toEqual([
      {
        ...note,
        title: "Server-corrected title",
        content: "Canonical updated text",
      },
      addition,
    ]);
  });
  it("merges an explicit local field edit with independent canonical fields and honors locally removed optional fields", () => {
    const note = resource("note", {
      source: "https://example.org/old",
      parentId: "old-folder",
    });
    const { source: _source, ...withoutSource } = note;
    const result = mergeStudyLibrary(
      [note],
      [{ ...withoutSource, title: "My title", parentId: undefined }],
      [{ ...note, content: "Server-grounded text", verified: false }],
    );
    expect(result[0]).toMatchObject({
      title: "My title",
      content: "Server-grounded text",
      verified: false,
    });
    expect(result[0]).not.toHaveProperty("source");
    expect(result[0]).not.toHaveProperty("parentId");
  });
  it("retains an explicit local edit after a canonical deletion and deduplicates stable IDs", () => {
    const note = resource("note"),
      added = resource("added");
    const result = mergeStudyLibrary(
      [note],
      [
        { ...note, content: "Keep my unsaved edit" },
        added,
        { ...added, title: "Latest local addition" },
      ],
      [added, added],
    );
    expect(new Set(result.map((item) => item.id)).size).toBe(result.length);
    expect(result.find((item) => item.id === note.id)?.content).toBe(
      "Keep my unsaved edit",
    );
    expect(result.find((item) => item.id === added.id)?.title).toBe(
      "Latest local addition",
    );
  });
});
