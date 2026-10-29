import type { ContentBlock, Message } from "../types";

/** Read legacy messages without rewriting their transcript or figure identities. */
export function messageContent(
  message: Message,
): { block: ContentBlock; key: string; blockIndex: number }[] {
  if (message.content?.length)
    return message.content.map((block, i) => ({
      block,
      key: message.visualInstanceIds?.[i] || message.id + ":" + i,
      blockIndex: i,
    }));
  const entries = (message.blocks || []).map((block, i) => ({
    block,
    key: message.visualInstanceIds?.[i] || message.id + ":" + i,
    blockIndex: i,
  }));
  const text = message.text.trim();
  const duplicate = entries.some(
    ({ block }) => block.type === "text" && block.text.trim() === text,
  );
  return text && !duplicate
    ? [
        {
          block: { type: "text", text: message.text },
          key: message.id + ":legacy-text",
          blockIndex: -1,
        },
        ...entries,
      ]
    : entries;
}

export function requestedImageQuery(text: string): string | undefined {
  const request = text.trim();
  const command = request.replace(
    /^(?:(?:please|can you|could you|would you)\s+)+/i,
    "",
  );
  const visualNoun =
    /\b(?:images?|pictures?|photos?|photographs?|micrographs?|figures?|diagrams?)\b/i;
  if (
    !visualNoun.test(request) ||
    /\b(?:do not|don't|never|without|avoid)\s+(?:\w+\s+){0,2}(?:search|find|retriev\w*|look|source)|\bno\s+(?:(?:web|internet|online|image)\s+)?search(?:ing)?\b/i.test(
      request,
    )
  )
    return undefined;
  // Finding an answer inside an existing figure is analysis, not image lookup.
  if (
    /^(?:find|retrieve|look\s+(?:up|for))\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:value|answer|result|slope|equation|number|difference)\b/i.test(
      command,
    )
  )
    return undefined;
  const explicitLookup =
    /^(?:search|find|retrieve|look\s+(?:up|for)|source)\b[\s\S]{0,100}\b(?:images?|pictures?|photos?|photographs?|micrographs?|figures?|diagrams?)\b|^image\s+search\b/i.test(
      command,
    );
  const realPhoto =
    /^(?:show|display|see|get|(?:I\s+)?(?:need|want))\b[\s\S]{0,70}\b(?:real|actual|microscopy|microscope)\s+(?:\w+\s+){0,2}(?:photos?|photographs?|micrographs?)\b/i.test(
      command,
    );
  const sourcedImage =
    /^(?:show|display|get|(?:I\s+)?(?:need|want))\b[\s\S]{0,70}\b(?:sourced|licensed|attributed)\s+(?:images?|pictures?|photos?|figures?|diagrams?)\b/i.test(
      command,
    );
  const namedSource =
    /^(?:show|display|get|(?:I\s+)?(?:need|want))\b[\s\S]{0,70}\b(?:images?|pictures?|photos?|figures?|diagrams?)\s+from\s+(?:Wikimedia(?:\s+Commons)?|Openverse|PubMed\s+Central|PMC)\b/i.test(
      command,
    );
  if (!explicitLookup && !realPhoto && !sourcedImage && !namedSource)
    return undefined;
  const afterNoun = request.replace(
    /^.*?\b(?:images?|pictures?|photos?|photographs?|micrographs?|figures?|diagrams?)\b\s*(?:of|for|about|showing|on)?\s*/i,
    "",
  );
  return (
    (afterNoun || request)
      .replace(
        /^from\s+(?:Wikimedia(?:\s+Commons)?|Openverse|PubMed\s+Central|PMC)\s+(?:of|for|about|showing|on)\s+/i,
        "",
      )
      .replace(/[?!.]+$/, "")
      .trim()
      .slice(0, 200) || undefined
  );
}
