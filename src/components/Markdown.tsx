import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { invoke } from "../lib/bridge";
import { lazy, Suspense } from "react";
import { useGlossaryMarkup } from "./visuals/LessonTerms";
const InlineVisual = lazy(() => import("./visuals/VisualBlock"));
// Stable component identities preserve text selections and definition anchors
// while autosave, scroll position, or the glossary context updates.
const markdownComponents: Components = {
  p: function GlossaryParagraph({ children }) {
    const decorate = useGlossaryMarkup();
    return <p>{decorate(children)}</p>;
  },
  li: function GlossaryItem({ children }) {
    const decorate = useGlossaryMarkup();
    return <li>{decorate(children)}</li>;
  },
  td: function GlossaryCell({ children }) {
    const decorate = useGlossaryMarkup();
    return <td>{decorate(children)}</td>;
  },
  th: function GlossaryHeading({ children }) {
    const decorate = useGlossaryMarkup();
    return <th>{decorate(children)}</th>;
  },
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        if (href?.startsWith("https://")) void invoke("external:open", href);
      }}
    >
      {children}
    </a>
  ),
  img: ({ alt }) => (
    <span className="muted">[Image search: {alt || "image"}]</span>
  ),
};
export default function Markdown({ text }: { text: string }) {
  const images = [...text.matchAll(/!\[([^\]]*)\]\([^)]+\)/g)];
  if (images.length) {
    let cursor = 0;
    const parts = images.flatMap((match, i) => {
      const before = text.slice(cursor, match.index);
      cursor = (match.index || 0) + match[0].length;
      return [
        <Markdown key={"text-" + i} text={before} />,
        <Suspense
          key={"image-" + i}
          fallback={<p role="status">Opening licensed image search…</p>}
        >
          <InlineVisual
            block={{
              type: "image",
              query: match[1] || "educational scientific illustration",
            }}
          />
        </Suspense>,
      ];
    });
    return (
      <div className="markdown-with-figures">
        {parts}
        <Markdown text={text.slice(cursor)} />
      </div>
    );
  }
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            {
              strict: "ignore",
              throwOnError: false,
              trust: false,
              maxExpand: 1000,
              maxSize: 20,
            },
          ],
        ]}
        components={markdownComponents}
      >
        {text
          .replace(
            /\\\[([\s\S]*?)\\\]/g,
            (_match, body: string) => "$$" + body + "$$",
          )
          .replace(
            /\\\((.*?)\\\)/g,
            (_match, body: string) => "$" + body + "$",
          )}
      </ReactMarkdown>
    </div>
  );
}
