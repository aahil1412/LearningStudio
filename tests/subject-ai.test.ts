import { it, expect } from "vitest";
import {
  boundedConversation,
  parsePathway,
  parseSubjectUpdates,
  parseCurriculumUpdates,
} from "../src/lib/subjectAi";
import type { Message } from "../src/types";
import type { SubjectSnapshot } from "../src/v2types";
const snapshot = {
  subject: { id: "subject", revision: 2 },
  curriculum: [
    {
      id: "preserved",
      title: "Learner-edited prerequisite",
      position: 4,
      userEdited: true,
      status: "not-started",
    },
  ],
} as SubjectSnapshot;
it("subject pathways accept hundreds of concepts independently of lesson roadmap limits and preserve existing identifiers", () => {
  const raw = JSON.stringify({
    nodes: [
      {
        id: "module",
        kind: "module",
        title: "Foundations",
        description: "A broad discipline",
        prerequisites: [],
      },
      ...Array.from({ length: 300 }, (_, index) => ({
        id: "concept-" + index,
        parentId: "module",
        kind: "concept",
        title: "Concept " + index,
        description: "",
        prerequisites: index === 0 ? ["preserved"] : ["concept-" + (index - 1)],
      })),
    ],
  });
  const operations = parsePathway(raw, snapshot);
  expect(
    operations.filter((operation) => operation.entity === "curriculum"),
  ).toHaveLength(301);
  expect(operations.some((operation) => operation.op === "delete")).toBe(false);
  expect(
    operations.find((operation) => operation.entity === "edge")?.value
      ?.prerequisiteId,
  ).toBe("preserved");
  expect(snapshot.curriculum[0].title).toBe("Learner-edited prerequisite");
});
it("current conversation context stays bounded and excludes incomplete or failed work", () => {
  const messages = Array.from({ length: 1000 }, (_, index) => ({
    id: String(index),
    role: index % 2 ? "assistant" : "user",
    text: "x".repeat(10000),
    createdAt: "2026-10-28",
    status: index === 999 ? "failed" : "complete",
  })) as Message[];
  const context = boundedConversation(messages, 12000);
  expect(context.length).toBeLessThanOrEqual(14);
  expect(
    context.reduce((size, message) => size + message.content.length, 0),
  ).toBeLessThanOrEqual(12000);
  expect(context.at(-1)?.role).toBe("user");
});
it("memory and curriculum proposals preserve source provenance and cannot silently propose mastery", () => {
  const raw = JSON.stringify({
    subjectUpdates: [
      {
        kind: "question",
        title: "Boundary uncertainty",
        content: "Which exchanges are included?",
        conceptIds: [],
      },
    ],
    curriculumUpdates: [
      {
        id: "preserved",
        kind: "topic",
        title: "Learner-edited prerequisite",
        description: "Add a worked example",
        prerequisites: [],
        status: "introduced",
      },
    ],
  });
  const memory = parseSubjectUpdates(raw, "conversation", "message");
  expect(memory[0].value?.messageId).toBe("message");
  expect(memory[0].value?.conversationId).toBe("conversation");
  const nodes = parseCurriculumUpdates(raw, snapshot, "message");
  expect(nodes[0].id).toBe("preserved");
  expect(nodes[0].value?.userEdited).toBe(true);
  expect(nodes[0].value?.position).toBe(4);
  expect(
    parseCurriculumUpdates(
      JSON.stringify({
        curriculumUpdates: [
          {
            kind: "concept",
            title: "Unsupported mastery",
            description: "Mentioned",
            status: "demonstrated",
          },
        ],
      }),
      snapshot,
      "message",
    ),
  ).toEqual([]);
  expect(parseSubjectUpdates("{malformed", "conversation", "message")).toEqual(
    [],
  );
});

it("does not send a canonical assistant explanation twice in model history", () => {
  const context = boundedConversation([
    {
      id: "canonical",
      role: "assistant",
      text: "A field assigns a value to each point.",
      content: [
        { type: "text", text: "A field assigns a value to each point." },
      ],
      blocks: [
        { type: "text", text: "A field assigns a value to each point." },
      ],
      createdAt: "2026-10-28",
      status: "complete",
    },
  ]);
  expect(
    context[0].content.match(/A field assigns a value to each point/g),
  ).toHaveLength(1);
});
