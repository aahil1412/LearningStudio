import type { ContentBlock } from "../types";
import { validateContentBlock } from "./visualSpecs";

export type TutorStreamItem = {
  /** Position in the source array, including malformed siblings. */
  index: number;
  block: ContentBlock;
  complete: boolean;
};
export type TutorStreamSnapshot = {
  content: ContentBlock[];
  items: TutorStreamItem[];
  structured: boolean;
  /** The content array ended; this does not assert provider completion. */
  complete: boolean;
  truncated: boolean;
  malformedBlocks: number;
};

const safeEnd = (value: string) => value.replace(/[\uD800-\uDBFF]$/, "");

/** Decode only a valid JSON-string prefix, holding unfinished escapes. */
function stringPrefix(raw: string, start: number) {
  let value = "",
    position = start + 1;
  for (; position < raw.length; position++) {
    const char = raw[position];
    if (char === '"')
      return { value: safeEnd(value), next: position + 1, closed: true };
    if (char.charCodeAt(0) < 0x20) break;
    if (char !== "\\") {
      value += char;
      continue;
    }
    const escaped = raw[++position];
    if (escaped === undefined) break;
    const escapes: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (escaped in escapes) value += escapes[escaped];
    else if (escaped === "u") {
      const code = raw.slice(position + 1, position + 5);
      if (!/^[0-9a-f]{4}$/i.test(code)) break;
      value += String.fromCharCode(parseInt(code, 16));
      position += 4;
    } else break;
  }
  return { value: safeEnd(value), next: position, closed: false };
}

function bodyOffset(raw: string): number | null {
  const first = raw.search(/\S/);
  if (first < 0) return null;
  if (raw[first] === "{") return first;
  const head = raw.slice(first);
  if (/^`{1,2}$/.test(head) || /^```(?:j(?:s(?:o(?:n)?)?)?)?\s*$/i.test(head))
    return null;
  const fence = /^```(?:json)?\s*/i.exec(head);
  return fence ? first + fence[0].length : first;
}

/** Root properties only. Text inside nested diagrams or quoted examples is data. */
function rootFields(raw: string, start: number) {
  const strings = new Map<string, { value: string; closed: boolean }>();
  let depth = 0,
    phase: "key" | "colon" | "value" | "after" = "key",
    key = "";
  for (let position = start; position < raw.length; position++) {
    const char = raw[position];
    if (char === '"') {
      const text = stringPrefix(raw, position);
      if (depth === 1 && phase === "key" && text.closed) {
        key = text.value;
        phase = "colon";
      } else if (depth === 1 && phase === "value") {
        strings.set(key, text);
        phase = "after";
      }
      if (!text.closed) break;
      position = text.next - 1;
    } else if (char === "[") {
      if (
        depth === 1 &&
        phase === "value" &&
        (key === "content" || key === "blocks")
      )
        return { strings, array: position + 1 };
      depth++;
    } else if (char === "{") depth++;
    else if (char === "}" || char === "]") depth--;
    else if (depth === 1 && char === ":" && phase === "colon") phase = "value";
    else if (depth === 1 && char === ",") phase = "key";
  }
  return { strings, array: null };
}

/** Incremental, bounded typed lesson stream. No generated source is evaluated.
 * A visual becomes available as soon as its own JSON object validates; we do not
 * wait for later prose, lessonState metadata, or the terminal provider event. */
export class TutorStreamDecoder {
  private value = "";
  private start: number | null = null;
  private cursor = 0;
  private itemStart = -1;
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private ended = false;
  private sourceIndex = 0;
  private invalid = 0;
  private limited = false;
  private records: TutorStreamItem[] = [];
  private maxChars: number;
  private maxBlocks: number;
  constructor(options: { maxChars?: number; maxBlocks?: number } = {}) {
    this.maxChars = Math.max(1, Math.min(250000, options.maxChars ?? 250000));
    this.maxBlocks = Math.max(1, Math.min(64, options.maxBlocks ?? 64));
  }
  get raw() {
    return this.value;
  }
  push(delta: string): TutorStreamSnapshot {
    if (delta.length > this.maxChars - this.value.length) this.limited = true;
    this.value += delta.slice(0, this.maxChars - this.value.length);
    if (this.start === null) {
      const offset = bodyOffset(this.value);
      if (offset !== null && this.value[offset] === "{") {
        const found = rootFields(this.value, offset).array;
        if (found !== null) this.start = this.cursor = found;
      }
    }
    if (this.start !== null && !this.ended) this.scan();
    return this.snapshot();
  }
  private finish(end: number) {
    const raw = this.value.slice(this.itemStart, end).trim();
    if (raw) {
      let block: ContentBlock | null = null;
      try {
        block = validateContentBlock(JSON.parse(raw));
      } catch {
        /* Invalid siblings cannot poison earlier valid output. */
      }
      if (block)
        this.records.push({ index: this.sourceIndex, block, complete: true });
      else this.invalid++;
      this.sourceIndex++;
    }
    this.itemStart = -1;
  }
  private scan() {
    for (; this.cursor < this.value.length; this.cursor++) {
      const char = this.value[this.cursor];
      if (this.itemStart < 0) {
        if (/\s|,/.test(char)) continue;
        if (char === "]") {
          this.ended = true;
          return;
        }
        if (this.sourceIndex >= this.maxBlocks) {
          this.limited = true;
          return;
        }
        this.itemStart = this.cursor;
      }
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (char === "\\") this.escaped = true;
        else if (char === '"') {
          this.quoted = false;
          if (!this.depth) this.finish(this.cursor + 1);
        }
      } else if (char === '"') this.quoted = true;
      else if (char === "{" || char === "[") this.depth++;
      else if (char === "]" && !this.depth) {
        this.finish(this.cursor);
        this.ended = true;
        return;
      } else if (char === "}" || char === "]") {
        this.depth--;
        if (!this.depth) this.finish(this.cursor + 1);
      } else if (char === "," && !this.depth) this.finish(this.cursor);
    }
  }
  snapshot(): TutorStreamSnapshot {
    const items = this.records.slice();
    const offset = bodyOffset(this.value);
    const structured = offset !== null && this.value[offset] === "{";
    if (this.itemStart >= 0 && this.sourceIndex < this.maxBlocks) {
      const fields = rootFields(this.value.slice(this.itemStart), 0).strings;
      const type = fields.get("type"),
        text = fields.get("text");
      if (type?.closed && type.value === "text" && text?.value)
        items.push({
          index: this.sourceIndex,
          block: { type: "text", text: safeEnd(text.value.slice(0, 60000)) },
          complete: false,
        });
    } else if (this.start === null && offset !== null) {
      if (structured) {
        const text = rootFields(this.value, offset).strings.get("text");
        if (text?.value)
          items.push({
            index: 0,
            block: { type: "text", text: safeEnd(text.value.slice(0, 60000)) },
            complete: text.closed,
          });
      } else {
        const text = safeEnd(this.value.slice(0, 60000));
        if (text)
          items.push({
            index: 0,
            block: { type: "text", text },
            complete: false,
          });
      }
    }
    return {
      content: items.map((item) => item.block),
      items,
      structured,
      complete: this.ended,
      truncated: this.limited,
      malformedBlocks: this.invalid,
    };
  }
}
