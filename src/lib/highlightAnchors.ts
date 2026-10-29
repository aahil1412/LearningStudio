import type { ReadingHighlight } from "../annotationTypes";

/** Resolve against a read-only text projection. Ambiguous quotes are never guessed. */
export function resolveHighlightAnchor(
  text: string,
  anchor: Pick<
    ReadingHighlight,
    "quote" | "prefix" | "suffix" | "start" | "end"
  >,
): { start: number; end: number } | null {
  if (!anchor.quote) return null;
  const candidates: { start: number; end: number; score: number }[] = [];
  let offset = 0;
  while (offset <= text.length) {
    const start = text.indexOf(anchor.quote, offset);
    if (start < 0) break;
    const end = start + anchor.quote.length;
    const before = text.slice(Math.max(0, start - anchor.prefix.length), start);
    const after = text.slice(end, end + anchor.suffix.length);
    const score =
      (anchor.prefix && before === anchor.prefix ? 2 : 0) +
      (anchor.suffix && after === anchor.suffix ? 2 : 0);
    candidates.push({ start, end, score });
    offset = start + 1;
  }
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  if (candidates[0].score > candidates[1].score) return candidates[0];
  // Exact offsets alone are unsafe after a passage is duplicated or edited.
  return null;
}

const excluded =
  "button:not(.lesson-term),textarea,input,select,script,style,svg,canvas,.katex-mathml,.lesson-term-definition,.offline-source-notes,.offline-personal-notes,.offline-citations,.offline-origin,.offline-provenance,[aria-hidden='true'],[data-annotation-ignore]";
export function readableNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    if (!text.parentElement?.closest(excluded)) nodes.push(text);
  }
  return nodes;
}
export function textProjection(root: HTMLElement) {
  return readableNodes(root)
    .map((node) => node.data)
    .join("");
}
export function rangeForOffsets(
  root: HTMLElement,
  start: number,
  end: number,
): Range | null {
  const nodes = readableNodes(root);
  const range = document.createRange();
  let position = 0,
    started = false;
  for (const node of nodes) {
    const next = position + node.length;
    if (!started && start >= position && start <= next) {
      range.setStart(node, start - position);
      started = true;
    }
    if (started && end >= position && end <= next) {
      range.setEnd(node, end - position);
      return range;
    }
    position = next;
  }
  return null;
}
export function selectionAnchor(selection: Selection, root: HTMLElement) {
  if (!selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  const nodes = readableNodes(root);
  const boundary = (container: Node, offset: number) => {
    let position = 0;
    for (const node of nodes) {
      if (node === container) return position + offset;
      position += node.length;
    }
    // Element-boundary selections are resolved by exact quote plus context later.
    return -1;
  };
  let start = boundary(range.startContainer, range.startOffset),
    end = boundary(range.endContainer, range.endOffset);
  const text = nodes.map((node) => node.data).join("");
  const quote = selection.toString();
  if (start < 0 || end < 0) {
    const resolved = resolveHighlightAnchor(text, {
      quote,
      prefix: "",
      suffix: "",
    });
    if (!resolved) return null;
    ({ start, end } = resolved);
  }
  if (end <= start || end - start > 20000) return null;
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - 64), start),
    suffix: text.slice(end, end + 64),
    start,
    end,
  };
}
