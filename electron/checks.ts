import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { StudioStore } from "./storage";
import type { SubjectStore } from "./subjects";
import type { ReviewCard, ReviewAttempt } from "../src/types";
import type { SubjectOperation } from "../src/v2types";
import { gradeMCQ, readMCQResponse } from "../src/lib/teachingController";
import { validateContentBlock } from "../src/lib/visualSpecs";
import { scheduleReview } from "../src/lib/learning";

const key = z.string().min(1).max(200);
const inputSchema = z.object({
  conversationId: key,
  messageId: key,
  blockIndex: z.number().int().min(0).max(100),
  selectedIds: z.array(z.string().min(1).max(50)).max(6).default([]),
  skipped: z.boolean().default(false),
  unknown: z.boolean().default(false),
  requestId: key.optional(),
});
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex").slice(0, 40);

/** Objective checkpoints are graded from the saved source, never a renderer's claimed answer. */
export class CheckpointService {
  constructor(
    private store: StudioStore,
    private subjects: SubjectStore,
  ) {}
  submit(input: unknown) {
    const value = inputSchema.parse(input);
    return this.store.db.transaction(() => {
      const owner = this.store.db
        .prepare(
          "SELECT subject_id,legacy_lesson_id FROM conversations WHERE id=? AND archived=0",
        )
        .get(value.conversationId) as
        { subject_id: string; legacy_lesson_id: string } | undefined;
      if (!owner)
        throw new Error(
          "This conversation is unavailable. Reopen its subject before submitting a checkpoint.",
        );
      const snapshot = this.subjects.snapshot(owner.subject_id);
      if (snapshot.subject.archived)
        throw new Error(
          "Restore this subject before recording a new checkpoint.",
        );
      const source = this.subjects
        .transcriptAll(value.conversationId)
        .find((m) => m.id === value.messageId);
      if (!source || source.role !== "assistant")
        throw new Error("The original checkpoint message is unavailable.");
      const candidate = (
        source.content?.length ? source.content : source.blocks
      )?.[value.blockIndex];
      const block = validateContentBlock(candidate);
      if (!block || block.type !== "mcq")
        throw new Error(
          "This checkpoint is incomplete. You can skip it and continue the lesson.",
        );
      const result = gradeMCQ(block, value.selectedIds, value.unknown);
      const data = this.store.load(),
        lesson = data.lessons.find((l) => l.id === owner.legacy_lesson_id);
      if (!lesson)
        throw new Error("The source conversation could not be loaded.");
      const responseKey = `${source.id}:${value.blockIndex}`;
      const previous = readMCQResponse(
        lesson.exerciseResponses?.[responseKey]?.answer,
      );
      const cardId = `mcq-card-${digest(`${owner.subject_id}:${source.id}:${value.blockIndex}`)}`;
      const attemptId = `mcq-attempt-${digest(`${cardId}:${value.requestId || randomUUID()}`)}`;
      const replay = data.reviewHistory?.find((a) => a.id === attemptId);
      if (replay)
        return {
          correct: replay.correct === true,
          feedback: replay.feedback,
          attempts: previous.attempts,
          mastery: false,
        };
      const attempts = previous.attempts + (value.skipped ? 0 : 1);
      if (block.purpose === "baseline") {
        const row = this.store.db
          .prepare(
            "SELECT revision,value FROM subject_intakes WHERE subject_id=?",
          )
          .get(owner.subject_id) as
          { revision: number; value: string } | undefined;
        if (row) {
          const intake = JSON.parse(row.value);
          if (intake.assessment === "requested") {
            const stamp = new Date().toISOString(),
              revision = row.revision + 1;
            const next = {
              ...intake,
              revision,
              assessment: value.skipped ? "skipped" : "completed",
              assessmentNotes:
                `${intake.assessmentNotes || ""}\n${value.skipped ? "Learner skipped the optional baseline." : `Baseline checkpoint answered. Result: ${result.correct ? "correct" : "needs review"}; not durable mastery.`}`
                  .trim()
                  .slice(0, 12000),
              updatedAt: stamp,
            };
            this.store.db
              .prepare(
                "UPDATE subject_intakes SET revision=?,value=?,updated_at=? WHERE subject_id=?",
              )
              .run(revision, JSON.stringify(next), stamp, owner.subject_id);
          }
        }
      }
      lesson.exerciseResponses = {
        ...lesson.exerciseResponses,
        [responseKey]: {
          answer: JSON.stringify({
            version: 1,
            selected: value.selectedIds,
            submitted: !value.skipped,
            unknown: value.unknown,
            attempts,
          }),
          skipped: value.skipped,
        },
      };
      lesson.updatedAt = new Date().toISOString();
      if (value.skipped) {
        this.store.save(data);
        return {
          correct: false,
          feedback: "Checkpoint skipped. Continue whenever you are ready.",
          attempts,
          mastery: false,
        };
      }
      const at = lesson.updatedAt;
      const nodeId = block.curriculumNodeId || lesson.curriculumNodeId;
      const node = snapshot.curriculum.find((n) => n.id === nodeId);
      const linked = [
        ...new Set([
          ...(block.conceptIds || []),
          ...(node?.conceptId ? [node.conceptId] : []),
        ]),
      ];
      const concepts = snapshot.concepts.filter((c) => linked.includes(c.id));
      const existingCard = data.reviewCards?.find((c) => c.id === cardId);
      const card: ReviewCard = existingCard || {
        id: cardId,
        subjectId: owner.subject_id,
        conceptId: concepts[0]?.id,
        lessonId: lesson.id,
        question: `${block.question}\n\n${block.choices.map((c) => `${c.id}. ${c.text}`).join("\n\n")}\n\nAnswer with ${block.multiple ? "the selected choice IDs, separated by commas" : "the choice ID"}.`,
        answer:
          block.correctChoiceIds
            .map((id) => block.choices.find((c) => c.id === id)!.text)
            .join("; ") +
          "\n\n" +
          (block.explanation || ""),
        grading: {
          kind: "exact",
          accepted: [block.correctChoiceIds.slice().sort().join(",")],
          caseSensitive: false,
        },
        dueAt: at,
        intervalDays: 0,
        repetitions: 0,
        easeFactor: 2.5,
        lapses: 0,
        createdAt: at,
      };
      const quality = value.unknown ? 0 : result.correct ? 3 : 1;
      const feedback =
        `${result.feedback}${block.explanation ? " " + block.explanation : ""}`.slice(
          0,
          10000,
        );
      const attempt: ReviewAttempt = {
        id: attemptId,
        subjectId: owner.subject_id,
        cardId,
        answer: value.unknown
          ? "I don't know"
          : value.selectedIds.slice().sort().join(","),
        grade: quality,
        correct: result.correct,
        feedback,
        method: "exact",
        createdAt: at,
      };
      data.reviewCards = [
        ...(data.reviewCards || []).filter((c) => c.id !== cardId),
        scheduleReview(card, quality, new Date(at)),
      ];
      data.reviewHistory = [...(data.reviewHistory || []), attempt];
      this.store.save(data);
      const operations: SubjectOperation[] = [];
      const outcomeClaim = `Question: ${block.question}\nSelected: ${value.unknown ? "I don't know" : value.selectedIds.map((id) => block.choices.find((c) => c.id === id)!.text).join("; ")}\nResult: ${result.correct ? "correct conceptual checkpoint" : "needs further explanation or review"}. Attempt ${attempts}. A single result does not demonstrate durable understanding.`;
      operations.push({
        entity: "memory",
        op: "put",
        id: `mcq-memory-${digest(cardId)}`,
        value: {
          kind: result.correct ? "finding" : "question",
          title:
            `${result.correct ? "Checkpoint evidence" : "Checkpoint to revisit"}: ${block.question}`.slice(
              0,
              500,
            ),
          content: outcomeClaim,
          conceptIds: concepts.map((c) => c.id),
          conversationId: value.conversationId,
          messageId: source.id,
        },
      });
      for (const concept of concepts) {
        const claim = outcomeClaim;
        operations.push({
          entity: "evidence",
          op: "put",
          id: `mcq-evidence-${digest(attemptId + concept.id)}`,
          value: {
            conceptId: concept.id,
            kind: "assessment",
            content: claim,
            conversationId: value.conversationId,
            messageId: source.id,
            reviewAttemptId: attempt.id,
          },
        });
        const status =
          result.correct &&
          ["encountered", "unassessed", "unresolved"].includes(concept.status)
            ? "partial"
            : !result.correct && concept.status === "demonstrated"
              ? "review"
              : concept.status;
        if (status !== concept.status)
          operations.push({
            entity: "concept",
            op: "put",
            id: concept.id,
            value: { ...concept, status, evidence: claim },
          });
      }
      if (node) {
        const status =
          result.correct &&
          ["not-started", "introduced", "covered", "gap"].includes(node.status)
            ? "partial"
            : !result.correct && node.status === "demonstrated"
              ? "review"
              : node.status;
        if (status !== node.status)
          operations.push({
            entity: "curriculum",
            op: "put",
            id: node.id,
            value: { ...node, status },
          });
      }
      if (operations.length)
        this.subjects.apply({
          subjectId: owner.subject_id,
          baseRevision: snapshot.subject.revision,
          origin: "learner",
          label: "Record optional conceptual checkpoint",
          sourceConversationId: value.conversationId,
          sourceMessageId: source.id,
          operations,
        });
      return {
        correct: result.correct,
        feedback,
        attempts,
        mastery: false,
        reviewCardId: cardId,
        evidenceCount: concepts.length,
      };
    })();
  }
}
