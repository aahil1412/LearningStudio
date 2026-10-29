import { describe, expect, it } from "vitest";
import { buildLearningSequence } from "../src/lib/learningSequence";
import type { ContentBlock, Lesson, Message } from "../src/types";

const createdAt = "2026-10-28T12:00:00Z";
const message = (
  id: string,
  role: Message["role"],
  text = "",
  content?: ContentBlock[],
): Message => ({ id, role, text, content, createdAt, status: "complete" });
const lesson = (messages: Message[] = []): Lesson => ({
  id: "lesson",
  title: "Learning a broad subject",
  subject: "General",
  objective: "Understand a subject",
  position: "Current saved position",
  mode: "Learn",
  messages,
  notes: "",
  createdAt,
  updatedAt: createdAt,
});

describe("learning-first section navigation over original saved messages", () => {
  it("derives actual conceptual units without changing or copying content", () => {
    const assistant = message("a", "assistant", "", [
      { type: "concept", title: "Why a gradient points uphill" },
      { type: "text", text: "An actual explanation." },
    ]);
    const data = lesson([
      message("q", "user", "Why subtract the gradient?"),
      assistant,
    ]);
    const before = JSON.stringify(data);
    const units = buildLearningSequence(data);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      id: "a",
      messageId: "a",
      index: 0,
      title: "Why a gradient points uphill",
      question: "Why subtract the gradient?",
      questionMessageId: "q",
      status: "ready",
      inherited: false,
    });
    expect(units[0].message).toBe(assistant);
    expect(JSON.stringify(data)).toBe(before);
    expect(units[0].stages).toEqual([
      {
        id: "understand",
        label: "Understand",
        blockIndices: [0, 1],
        firstBlockIndex: 0,
      },
    ]);
    expect(units[0]).not.toHaveProperty("mastery");
    expect(units[0]).not.toHaveProperty("completed");
  });

  it("uses real content types and order for exploration and optional checks", () => {
    const content: ContentBlock[] = [
      {
        type: "plot",
        spec: {
          title: "A calculated bowl",
          kind: "function",
          expressions: ["x^2"],
        },
      },
      { type: "text", text: "Compare the computed curves." },
      { type: "equation", latex: "y=x^2" },
      { type: "exercise", question: "An optional problem" },
      { type: "text", text: "A final explanation." },
    ];
    const units = buildLearningSequence(
      lesson([message("a", "assistant", "", content)]),
    );
    expect(units[0].title).toBe("A calculated bowl");
    expect(units[0].stages).toEqual([
      {
        id: "explore",
        label: "Explore",
        blockIndices: [0],
        firstBlockIndex: 0,
      },
      {
        id: "understand",
        label: "Understand",
        blockIndices: [1, 2, 4],
        firstBlockIndex: 1,
      },
      {
        id: "check",
        label: "Optional check",
        blockIndices: [3],
        firstBlockIndex: 3,
      },
    ]);
    expect(
      buildLearningSequence(
        lesson([message("plain", "assistant", "Just an explanation.")]),
      )[0].stages.map((stage) => stage.id),
    ).toEqual(["understand"]);
  });

  it("keeps old top-level text and original legacy block indices without duplication", () => {
    const prior: Message = {
      ...message("legacy", "assistant", "# Energy and work"),
      blocks: [
        { type: "equation", latex: "W=F d" },
        { type: "text", text: "An actual continuation." },
      ],
    };
    const units = buildLearningSequence(lesson([prior]));
    expect(units[0].title).toBe("Energy and work");
    expect(units[0].stages[0].blockIndices).toEqual([-1, 0, 1]);
    const duplicate: Message = {
      ...prior,
      blocks: [
        { type: "text", text: "# Energy and work" },
        { type: "equation", latex: "W=F d" },
      ],
    };
    expect(
      buildLearningSequence(lesson([duplicate]))[0].stages[0].blockIndices,
    ).toEqual([0, 1]);
    const ordered = {
      ...prior,
      content: [
        { type: "text" as const, text: "# Authoritative ordered stream" },
      ],
    };
    expect(buildLearningSequence(lesson([ordered]))[0].title).toBe(
      "Authoritative ordered stream",
    );
  });

  it("preserves ancestor provenance and stable IDs while canonical local messages win overlap", () => {
    const parent = message("parent", "assistant", "# Original concept");
    const old = message("same", "assistant", "Old partial text");
    const local = {
      ...message("same", "assistant", "# Updated saved explanation"),
      status: "partial" as const,
    };
    const data = lesson([
      local,
      message("new-question", "user", "Now show an application."),
      message("new", "assistant", "# An application"),
    ]);
    const units = buildLearningSequence(data, [
      message("ancestor-question", "user", "Where does this come from?"),
      parent,
      old,
    ]);
    expect(units.map((unit) => unit.id)).toEqual(["parent", "same", "new"]);
    expect(units[0].inherited).toBe(true);
    expect(units[1].inherited).toBe(false);
    expect(units[1].message).toBe(local);
    expect(units[1].title).toBe("Updated saved explanation");
    expect(units[2].questionMessageId).toBe("new-question");
    expect(
      buildLearningSequence(
        {
          ...data,
          messages: [
            ...data.messages,
            message("later", "assistant", "# A later section"),
          ],
        },
        [parent, old],
      )
        .map((unit) => unit.id)
        .slice(0, 3),
    ).toEqual(["parent", "same", "new"]);
  });

  it("keeps failed and partial saved work available instead of treating it as completed learning", () => {
    const failed = {
      ...message("failed", "assistant"),
      status: "failed" as const,
      error: "Provider unavailable",
    };
    const partial = {
      ...message("partial", "assistant", "A saved portion of the explanation."),
      status: "partial" as const,
    };
    const pending = {
      ...message("pending", "assistant", " ", [
        { type: "text" as const, text: "" },
      ]),
      status: "partial" as const,
    };
    const units = buildLearningSequence(lesson([failed, partial, pending]));
    expect(units.map((unit) => unit.status)).toEqual([
      "failed",
      "partial",
      "pending",
    ]);
    expect(units[0].message.error).toBe("Provider unavailable");
    expect(units[0].stages).toEqual([]);
    expect(units[2].hasContent).toBe(false);
    expect(units[2].stages).toEqual([]);
  });

  it("finds real Markdown headings outside code without erasing variable names", () => {
    const prose =
      "```python\n# This is a code comment, not a lesson heading\n```\n\n### How `gene_expression` is regulated ###\nAn explanation.";
    expect(
      buildLearningSequence(lesson([message("a", "assistant", prose)]))[0]
        .title,
    ).toBe("How gene_expression is regulated");
  });

  it("does not assign the latest saved learning position retroactively to older sections", () => {
    const units = buildLearningSequence(
      lesson([
        message("q1", "user", "How does this process begin?"),
        message("a1", "assistant", "A first explanation."),
        message("q2", "user", "Continue"),
        message("a2", "assistant", "A later explanation."),
      ]),
    );
    expect(units[0].title).toBe("How does this process begin?");
    expect(units[1].title).toBe("Current saved position");
    expect(
      buildLearningSequence(
        lesson([message("only-user", "user", "A question without a reply")]),
      ),
    ).toEqual([]);
  });

  it("bounds the navigation label while preserving the entire original question", () => {
    const question = "Why does this happen? ".repeat(200);
    const units = buildLearningSequence(
      lesson([
        message("q", "user", question),
        message("a", "assistant", "An answer without a heading."),
      ]),
    );
    expect(units[0].title.length).toBeLessThanOrEqual(111);
    expect(units[0].title.endsWith("…")).toBe(true);
    expect(units[0].question).toBe(question.trim());
  });
});
