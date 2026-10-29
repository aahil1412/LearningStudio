import {
  ModelRequestGate,
  ModelRequestService,
} from "../electron/modelRequests";
import { afterEach, describe, expect, it, vi } from "vitest";

function deferred<T = string>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const payload = (requestId: string) => ({
  requestId,
  model: "test-model",
  instructions: "Explicit controlled provider fixture",
  input: [{ role: "user" as const, content: requestId }],
});
afterEach(() => vi.useRealTimers());

describe("bounded independent foreground/background requests", () => {
  it("reserves foreground capacity, bounds total calls to two, and admits foreground ahead of waiting background", async () => {
    const gate = new ModelRequestGate(),
      events: string[] = [];
    const b1 = deferred(),
      b2 = deferred(),
      f1 = deferred(),
      f2 = deferred();
    const run = (
      id: string,
      priority: "foreground" | "background",
      job: { promise: Promise<string> },
    ) =>
      gate.run(priority, new AbortController().signal, () => {
        events.push(id);
        return job.promise;
      });
    const pB1 = run("b1", "background", b1),
      pB2 = run("b2", "background", b2),
      pF1 = run("f1", "foreground", f1);
    await vi.waitFor(() => expect(events).toEqual(["b1", "f1"]));
    expect(gate.counts).toEqual({ active: 2, background: 1, queued: 1 });
    const pF2 = run("f2", "foreground", f2);
    b1.resolve("b1 complete");
    await pB1;
    await vi.waitFor(() => expect(events).toEqual(["b1", "f1", "f2"]));
    expect(gate.counts).toEqual({ active: 2, background: 0, queued: 1 });
    f1.resolve("f1 complete");
    await pF1;
    await vi.waitFor(() => expect(events.at(-1)).toBe("b2"));
    f2.resolve("f2 complete");
    b2.resolve("b2 complete");
    await Promise.all([pF2, pB2]);
    expect(gate.counts).toEqual({ active: 0, background: 0, queued: 0 });
  });

  it("cancels only the intended response, keeps partial deltas, and permits an explicit retry while planning continues", async () => {
    const background = deferred(),
      other = deferred();
    const deltas: { requestId: string; delta: string }[] = [];
    let reply: ((text: string) => void) | undefined;
    const service = new ModelRequestService({
      onDelta: (event) => deltas.push(event),
      respond: async (request, onDelta, signal) => {
        const input = request.input[0].content;
        if (input === "planning") return background.promise;
        if (input === "other") return other.promise;
        onDelta("Saved partial explanation.");
        reply = onDelta;
        return new Promise<string>((_, reject) =>
          signal.addEventListener(
            "abort",
            () =>
              reject(
                new DOMException("The operation was aborted", "AbortError"),
              ),
            { once: true },
          ),
        );
      },
    });
    const controller = new AbortController();
    const planning = service.background(
      { ...payload("planning") },
      controller.signal,
    );
    const first = service.send(payload("first"));
    const rejected = expect(first).rejects.toThrow(
      "This response was canceled",
    );
    await vi.waitFor(() => expect(deltas).toHaveLength(1));
    service.cancel("first");
    await rejected;
    reply?.("Late ignored delta");
    expect(deltas).toEqual([
      { requestId: "first", delta: "Saved partial explanation." },
    ]);
    expect(service.counts).toMatchObject({ active: 1, background: 1 });
    const next = service.send(payload("other"));
    await vi.waitFor(() => expect(service.counts.active).toBe(2));
    other.resolve("Other chat completed");
    expect(await next).toBe("Other chat completed");
    expect(service.foregroundCount).toBe(0);
    background.resolve("Planning completed");
    await planning;
  });

  it("turns a deadline abort into a meaningful timeout even if transport ignores abort; clears writing capacity", async () => {
    vi.useFakeTimers();
    const deltas: string[] = [];
    const service = new ModelRequestService({
      timeoutMs: 1000,
      onDelta: (event) => deltas.push(event.delta),
      respond: (_request, onDelta) => {
        onDelta("Preserve this partial answer.");
        return new Promise(() => {});
      },
    });
    const response = service.send(payload("deadline"));
    const rejected = expect(response).rejects.toThrow("five minutes");
    await vi.advanceTimersByTimeAsync(1001);
    await rejected;
    expect(deltas).toEqual(["Preserve this partial answer."]);
    expect(service.foregroundCount).toBe(0);
    expect(service.counts.active).toBe(0);
  });

  it("removes a canceled queued request without ever submitting it or aborting its siblings", async () => {
    const a = deferred(),
      b = deferred(),
      started: string[] = [];
    const service = new ModelRequestService({
      onDelta: () => {},
      respond: (request) => {
        started.push(request.input[0].content);
        return request.input[0].content === "a" ? a.promise : b.promise;
      },
    });
    const first = service.send(payload("a")),
      second = service.send(payload("b")),
      queued = service.send(payload("queued"));
    const rejected = expect(queued).rejects.toThrow("canceled");
    await vi.waitFor(() => expect(started).toEqual(["a", "b"]));
    service.cancel("queued");
    await rejected;
    expect(started).toEqual(["a", "b"]);
    expect(service.foregroundCount).toBe(2);
    a.resolve("a");
    b.resolve("b");
    await Promise.all([first, second]);
  });

  it("expires a bounded queue without submitting or silently retrying its request", async () => {
    vi.useFakeTimers();
    const a = deferred(),
      b = deferred(),
      started: string[] = [];
    const service = new ModelRequestService({
      queueDeadlineMs: 100,
      timeoutMs: 10000,
      onDelta: () => {},
      respond: (request) => {
        started.push(request.input[0].content);
        return request.input[0].content === "a" ? a.promise : b.promise;
      },
    });
    const first = service.send(payload("a")),
      second = service.send(payload("b")),
      queued = service.send(payload("queued"));
    const rejected = expect(queued).rejects.toThrow(
      "This request was not sent",
    );
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    expect(started).toEqual(["a", "b"]);
    a.resolve("a");
    b.resolve("b");
    await Promise.all([first, second]);
  });

  it("normalizes an unexpected transport AbortError and validates before admission", async () => {
    const respond = vi.fn(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });
    const service = new ModelRequestService({ onDelta: () => {}, respond });
    await expect(
      service.send({ ...payload("bad"), input: [] }),
    ).rejects.toThrow("malformed");
    expect(respond).not.toHaveBeenCalled();
    await expect(service.send(payload("interrupted"))).rejects.toThrow(
      "connection was interrupted",
    );
    expect(service.foregroundCount).toBe(0);
  });
});
