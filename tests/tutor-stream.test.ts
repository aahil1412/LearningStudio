import { describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { TutorStreamDecoder } from "../src/lib/tutorStream";
import {
  ModelRequestService,
  type RequestState,
} from "../electron/modelRequests";
vi.mock("electron", () => ({ safeStorage: {} }));
import { consumeResponseStream } from "../electron/auth";

describe("incremental typed tutor content", () => {
  it("shows prose and a validated plot before the response finishes without exposing JSON", () => {
    const stream = new TutorStreamDecoder();
    expect(
      stream.push('{"content":[{"type":"text","text":"A field assigns ')
        .content,
    ).toEqual([{ type: "text", text: "A field assigns " }]);
    const before = stream.push(
      'a value at every point."},{"type":"plot","spec":{"kind":"wave","title":"An example field"}},{"type":"text","text":"Now adjust',
    );
    expect(before.content.map((b) => b.type)).toEqual(["text", "plot", "text"]);
    expect(before.items.map((item) => [item.index, item.complete])).toEqual([
      [0, true],
      [1, true],
      [2, false],
    ]);
    expect(before.complete).toBe(false);
    const plot = before.content[1];
    const after = stream.push(
      ' the parameter."}],"lessonState":{"position":"First concept"}}',
    );
    expect(after.content[1]).toBe(plot);
    expect(after.complete).toBe(true);
    expect(after.items.every((item) => item.complete)).toBe(true);
  });
  it("handles every character boundary, escaped quotes/braces and split Unicode without changing content", () => {
    const text =
      'A "quote", {braces}, [array], backslash \\ and \n newline. ∫ 🧬';
    const raw = JSON.stringify({
      content: [
        { type: "text", text },
        { type: "equation", latex: "\\frac{a}{b}" },
      ],
    });
    const stream = new TutorStreamDecoder();
    for (const char of raw.split("")) {
      const state = stream.push(char);
      for (const block of state.content)
        if (block.type === "text")
          expect(block.text).not.toMatch(/[\uD800-\uDBFF]$/);
    }
    expect(stream.snapshot().content).toEqual([
      { type: "text", text },
      { type: "equation", latex: "\\frac{a}{b}" },
    ]);
  });
  it("holds incomplete JSON escapes and supports text before its type field", () => {
    const stream = new TutorStreamDecoder();
    expect(stream.push('{"content":[{"text":"Hello \\uD83').content).toEqual(
      [],
    );
    expect(stream.push('E\\uDDEC","type":"text",').content).toEqual([
      { type: "text", text: "Hello 🧬" },
    ]);
    expect(stream.push('"metadata":{"ignored":true}}]}').content).toEqual([
      { type: "text", text: "Hello 🧬" },
    ]);
    const escaped = new TutorStreamDecoder();
    expect(
      escaped.push('{"content":[{"type":"text","text":"Hello \\n \\u26')
        .content,
    ).toEqual([{ type: "text", text: "Hello \n " }]);
    expect(escaped.push('03"}]}').content).toEqual([
      { type: "text", text: "Hello \n ☃" },
    ]);
  });
  it("ignores nested content lookalikes and recognizes fragmented Markdown JSON fences", () => {
    const raw =
      '```json\n{"metadata":{"content":[{"type":"text","text":"Wrong nested content"}]},"content":[{"type":"text","text":"Actual lesson"}]}\n```';
    const stream = new TutorStreamDecoder();
    for (const char of raw) stream.push(char);
    expect(stream.snapshot().content).toEqual([
      { type: "text", text: "Actual lesson" },
    ]);
    expect(stream.snapshot().structured).toBe(true);
  });
  it("skips invalid complete siblings but retains stable source positions and does not execute code", () => {
    const stream = new TutorStreamDecoder();
    const result = stream.push(
      '{"content":[{"type":"text","text":"First"},{"type":"javascript","source":"throw new Error()"},{bad},{"type":"text","text":"Last"}]}',
    );
    expect(result.content).toEqual([
      { type: "text", text: "First" },
      { type: "text", text: "Last" },
    ]);
    expect(result.items.map((item) => item.index)).toEqual([0, 3]);
    expect(result.malformedBlocks).toBe(2);
  });
  it("never displays an incomplete visual specification or exercise answer as prose", () => {
    const stream = new TutorStreamDecoder();
    expect(
      stream.push(
        '{"content":[{"type":"text","text":"Saved concept"},{"type":"plot","spec":{"kind":"wave",',
      ).content,
    ).toEqual([{ type: "text", text: "Saved concept" }]);
    expect(
      stream
        .push(
          '"title":"Validated wave"}},{"type":"mcq","question":"Pick one","explanation":"Secret answer',
        )
        .content.map((b) => b.type),
    ).toEqual(["text", "plot"]);
  });
  it("bounds raw data and block count without wrongly truncating an exactly full array", () => {
    const stream = new TutorStreamDecoder({ maxChars: 80 });
    const result = stream.push(
      '{"content":[{"type":"text","text":"' + "x".repeat(1000),
    );
    expect(stream.raw).toHaveLength(80);
    expect(result.truncated).toBe(true);
    const limited = new TutorStreamDecoder({ maxBlocks: 2 });
    const raw = JSON.stringify({
      content: [
        { type: "text", text: "A" },
        { type: "text", text: "B" },
      ],
    });
    expect(limited.push(raw)).toMatchObject({
      complete: true,
      truncated: false,
    });
    const extra = new TutorStreamDecoder({ maxBlocks: 2 });
    expect(
      extra.push(
        JSON.stringify({
          content: [
            { type: "text", text: "A" },
            { type: "text", text: "B" },
            { type: "text", text: "C" },
          ],
        }),
      ),
    ).toMatchObject({ truncated: true });
    expect(extra.snapshot().content).toHaveLength(2);
  });
  it("supports readable legacy plain/text responses while never showing unfinished structured source", () => {
    const plain = new TutorStreamDecoder();
    expect(plain.push("A plain explanation").content).toEqual([
      { type: "text", text: "A plain explanation" },
    ]);
    const legacy = new TutorStreamDecoder();
    expect(legacy.push('{"text":"Legacy prose').content).toEqual([
      { type: "text", text: "Legacy prose" },
    ]);
    const broken = new TutorStreamDecoder();
    expect(broken.push('{"content":broken').content).toEqual([]);
    expect(broken.snapshot().structured).toBe(true);
  });
  it("receives validated lesson blocks through the actual SSE consumer before terminal completion", async () => {
    let transport!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          transport = controller;
        },
      }),
    );
    const decoder = new TutorStreamDecoder();
    let finished = false;
    const request = consumeResponseStream(
      response,
      (delta) => decoder.push(delta),
      new AbortController().signal,
    ).then((value) => {
      finished = true;
      return value;
    });
    const frame = (event: unknown) =>
      new TextEncoder().encode("data: " + JSON.stringify(event) + "\r\n\r\n");
    transport.enqueue(
      frame({
        type: "response.output_text.delta",
        delta:
          '{"content":[{"type":"text","text":"See this ∫ first."},{"type":"plot","spec":{"kind":"wave","title":"Inline field"}}',
      }),
    );
    await vi.waitFor(() =>
      expect(decoder.snapshot().content.map((b) => b.type)).toEqual([
        "text",
        "plot",
      ]),
    );
    expect(finished).toBe(false);
    transport.enqueue(
      frame({ type: "response.output_text.delta", delta: "]}" }),
    );
    transport.enqueue(frame({ type: "response.completed", response: {} }));
    transport.close();
    expect(await request).toContain("Inline field");
    expect(finished).toBe(true);
  });
  it("records a controlled production-pipeline timing sample with useful content available before completion", async () => {
    let transport!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          transport = controller;
        },
      }),
    );
    const decoder = new TutorStreamDecoder(),
      states: RequestState[] = [];
    const started = performance.now();
    let firstSafeParagraphReadyMs: number | undefined,
      firstValidatedFigureReadyMs: number | undefined;
    let completed = false;
    const service = new ModelRequestService({
      respond: (_request, onDelta, signal) =>
        consumeResponseStream(response, onDelta, signal),
      onState: (state) => states.push(state),
      onDelta: ({ delta }) => {
        const snapshot = decoder.push(delta);
        if (
          snapshot.content.some((block) => block.type === "text") &&
          firstSafeParagraphReadyMs === undefined
        )
          firstSafeParagraphReadyMs = performance.now() - started;
        if (
          snapshot.content.some((block) => block.type === "plot") &&
          firstValidatedFigureReadyMs === undefined
        )
          firstValidatedFigureReadyMs = performance.now() - started;
      },
    });
    const request = service
      .send({
        requestId: "controlled-stream-benchmark",
        model: "explicit-test",
        instructions: "Controlled synthetic source",
        input: [{ role: "user", content: "Synthetic scientific lesson" }],
      })
      .then((value) => {
        completed = true;
        return value;
      });
    const frame = (event: unknown) =>
      new TextEncoder().encode("data: " + JSON.stringify(event) + "\r\n\r\n");
    const pause = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    await pause(20);
    // Feed individual bytes so the production TextDecoder must retain split UTF-8.
    const first = frame({
      type: "response.output_text.delta",
      delta:
        '{"content":[{"type":"text","text":"A concentration gradient describes ∫ ',
    });
    for (const byte of first) transport.enqueue(Uint8Array.of(byte));
    await vi.waitFor(() => expect(firstSafeParagraphReadyMs).toBeDefined());
    expect(decoder.snapshot().content).toEqual([
      { type: "text", text: "A concentration gradient describes ∫ " },
    ]);
    expect(completed).toBe(false);
    await pause(25);
    transport.enqueue(
      frame({
        type: "response.output_text.delta",
        delta:
          'a changing concentration."},{"type":"plot","spec":{"kind":"gaussian","title":"A synthetic concentration profile"}}',
      }),
    );
    await vi.waitFor(() => expect(firstValidatedFigureReadyMs).toBeDefined());
    expect(completed).toBe(false);
    await pause(75);
    transport.enqueue(
      frame({
        type: "response.output_text.delta",
        delta:
          ',{"type":"text","text":"Adjust the width to explore the model."}],"lessonState":{"position":"A concentration profile"}}',
      }),
    );
    transport.enqueue(frame({ type: "response.completed", response: {} }));
    transport.close();
    await request;
    const providerCompletedMs = performance.now() - started;
    expect(firstSafeParagraphReadyMs!).toBeLessThan(
      firstValidatedFigureReadyMs!,
    );
    expect(firstValidatedFigureReadyMs!).toBeLessThan(providerCompletedMs);
    expect(decoder.snapshot().complete).toBe(true);
    writeFileSync(
      "docs/streaming-controlled-benchmark.json",
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          scope:
            "Controlled synthetic SSE through production ModelRequestService, consumeResponseStream, and TutorStreamDecoder. These are data-ready timings, not native view paint timings or live model speed.",
          controlledProvider: true,
          liveInference: false,
          firstSafeParagraphReadyMs,
          firstValidatedFigureReadyMs,
          providerCompletedMs,
          phases: states,
          contentTypes: decoder.snapshot().content.map((block) => block.type),
        },
        null,
        2,
      ),
    );
  });
});

describe("sanitized request timing", () => {
  const payload = {
    requestId: "timed",
    model: "explicit-test",
    instructions: "Synthetic fixture",
    input: [{ role: "user" as const, content: "Do not log this" }],
  };
  it("distinguishes admission, first text and completion without logging request or response content", async () => {
    const states: RequestState[] = [];
    let finish!: (value: string) => void;
    const service = new ModelRequestService({
      onState: (event) => states.push(event),
      onDelta: () => {},
      respond: async (_request, onDelta) => {
        onDelta("Visible partial lesson");
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });
    const request = service.send(payload);
    await vi.waitFor(() =>
      expect(states.map((s) => s.phase)).toEqual([
        "queued",
        "admitted",
        "first-text",
      ]),
    );
    expect(service.foregroundCount).toBe(1);
    finish("A final lesson");
    await request;
    expect(states.at(-1)?.phase).toBe("complete");
    expect(Object.keys(states.at(-1)!).sort()).toEqual([
      "elapsedMs",
      "firstTextMs",
      "phase",
      "queueMs",
      "requestId",
    ]);
    expect(JSON.stringify(states)).not.toContain("Do not log");
    expect(JSON.stringify(states)).not.toContain("Visible partial");
  });
  it("timing observers cannot fail the model request", async () => {
    const service = new ModelRequestService({
      onState: () => {
        throw new Error("Observer bug");
      },
      onDelta: () => {},
      respond: async () => "A lesson",
    });
    await expect(service.send(payload)).resolves.toBe("A lesson");
  });
  it("keeps validated partial content after interruption and distinguishes cancellation from timeout", async () => {
    for (const outcome of ["cancel", "timeout"] as const) {
      const states: RequestState[] = [],
        decoder = new TutorStreamDecoder();
      const service = new ModelRequestService({
        timeoutMs: outcome === "timeout" ? 10 : 1000,
        onState: (state) => states.push(state),
        onDelta: ({ delta }) => decoder.push(delta),
        respond: async (_request, onDelta) => {
          onDelta(
            '{"content":[{"type":"text","text":"This explanation is safe to retain."},{"type":"plot","spec":{"kind":"wave"',
          );
          return new Promise(() => {});
        },
      });
      const request = service.send({ ...payload, requestId: outcome });
      const rejected = expect(request).rejects.toThrow(
        outcome === "cancel" ? "canceled" : "five minutes",
      );
      if (outcome === "cancel") {
        await vi.waitFor(() =>
          expect(states.some((state) => state.phase === "first-text")).toBe(
            true,
          ),
        );
        service.cancel(outcome);
      }
      await rejected;
      expect(states.at(-1)?.phase).toBe(
        outcome === "cancel" ? "canceled" : "failed",
      );
      expect(decoder.snapshot().content).toEqual([
        { type: "text", text: "This explanation is safe to retain." },
      ]);
      expect(service.foregroundCount).toBe(0);
    }
  });
});
