import { useState } from "react";
import type { Lesson } from "../../types";
import VisualBlock from "../visuals/VisualBlock";
import { messageContent } from "../../lib/messageContent";
import { LessonTermsProvider } from "../visuals/LessonTerms";
export default function ComparisonPane({
  lessons,
  initialLessonId,
  messageId,
  onClose,
}: {
  lessons: Lesson[];
  initialLessonId: string;
  messageId?: string;
  onClose: () => void;
}) {
  const [id, setId] = useState(initialLessonId),
    [filter, setFilter] = useState("");
  const lesson = lessons.find((lesson) => lesson.id === id),
    messages =
      lesson?.messages.filter(
        (message) =>
          (!messageId || id !== initialLessonId || message.id === messageId) &&
          (!filter ||
            (message.text + JSON.stringify(message.blocks))
              .toLocaleLowerCase()
              .includes(filter.toLocaleLowerCase())),
      ) || [];
  return (
    <aside className="v2-comparison-pane" aria-label="Explanation comparison">
      <header>
        <h2>Compare & connect</h2>
        <button aria-label="Close comparison" onClick={onClose}>
          ×
        </button>
      </header>
      <label>
        Comparison conversation
        <select
          aria-label="Comparison conversation"
          value={id}
          onChange={(e) => setId(e.target.value)}
        >
          {lessons.map((lesson) => (
            <option key={lesson.id} value={lesson.id}>
              {lesson.title}
            </option>
          ))}
        </select>
      </label>
      <input
        aria-label="Find in comparison"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Find an explanation or equation…"
      />
      <div className="reading">
        <h2>{lesson?.title}</h2>
        {messages.map((message) => (
          <article key={message.id}>
            <small>
              {message.role === "user" ? "Question" : "Explanation"}
            </small>
            <LessonTermsProvider
              content={message.content || message.blocks || []}
            >
              {messageContent(message)
                .filter(({ block }) =>
                  ["text", "equation", "terms", "concept"].includes(block.type),
                )
                .map(({ block, key }) => (
                  <VisualBlock key={key} block={block} />
                ))}
            </LessonTermsProvider>
          </article>
        ))}
      </div>
    </aside>
  );
}
