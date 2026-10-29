import { z } from "zod";

export const foregroundDeadlineMs = 5 * 60_000;
export type RequestState = {
  requestId: string;
  phase:
    "queued" | "admitted" | "first-text" | "complete" | "failed" | "canceled";
  elapsedMs: number;
  queueMs?: number;
  firstTextMs?: number;
};
const modelRequest = z.object({
  requestId: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/),
  model: z.string().min(1).max(200),
  reasoning: z.string().min(1).max(30).optional(),
  instructions: z.string().max(150_000),
  input: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(300_000),
      }),
    )
    .min(1)
    .max(200),
});
type ModelRequest = Omit<z.infer<typeof modelRequest>, "requestId">;
type Priority = "foreground" | "background";
type Waiting = {
  priority: Priority;
  signal: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  abort: () => void;
  timer: ReturnType<typeof setTimeout>;
};
function reason(
  signal: AbortSignal,
  fallback = "This response was canceled. Saved work is preserved.",
) {
  return signal.reason instanceof Error && signal.reason.name !== "AbortError"
    ? signal.reason
    : new Error(fallback);
}
async function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let abort: () => void = () => {};
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        abort = () => reject(reason(signal));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
/** Two admitted provider calls at most; background work can occupy only one.
 * Foreground requests are selected before waiting background work. No retry or
 * preemption is implicit, so an admitted request is never silently replayed. */
export class ModelRequestGate {
  private active = 0;
  private backgroundActive = 0;
  private waiting: Waiting[] = [];
  constructor(private queueDeadlineMs = 3 * 60_000) {}
  get counts() {
    return {
      active: this.active,
      background: this.backgroundActive,
      queued: this.waiting.length,
    };
  }
  private available(priority: Priority) {
    return (
      this.active < 2 &&
      (priority === "foreground" || this.backgroundActive === 0)
    );
  }
  private permit(priority: Priority) {
    this.active++;
    if (priority === "background") this.backgroundActive++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      if (priority === "background") this.backgroundActive--;
      this.drain();
    };
  }
  private drain() {
    while (this.active < 2) {
      const next =
        this.waiting.find((entry) => entry.priority === "foreground") ||
        this.waiting.find((entry) => this.available(entry.priority));
      if (!next) return;
      this.remove(next);
      if (next.signal.aborted) next.reject(reason(next.signal));
      else next.resolve(this.permit(next.priority));
    }
  }
  private remove(entry: Waiting) {
    this.waiting = this.waiting.filter((item) => item !== entry);
    clearTimeout(entry.timer);
    entry.signal.removeEventListener("abort", entry.abort);
  }
  private acquire(
    priority: Priority,
    signal: AbortSignal,
  ): Promise<() => void> {
    if (signal.aborted) return Promise.reject(reason(signal));
    if (
      this.available(priority) &&
      !this.waiting.some((entry) => entry.priority === "foreground")
    )
      return Promise.resolve(this.permit(priority));
    if (this.waiting.length >= 6)
      return Promise.reject(
        new Error(
          "Several model requests are already waiting. Finish or cancel one, then send again. This request was not sent.",
        ),
      );
    return new Promise((resolve, reject) => {
      const entry: Waiting = {
        priority,
        signal,
        resolve,
        reject,
        abort: () => {
          this.remove(entry);
          reject(reason(signal));
        },
        timer: setTimeout(() => {
          this.remove(entry);
          reject(
            new Error(
              "The model queue did not become available within three minutes. This request was not sent; retry when ready.",
            ),
          );
        }, this.queueDeadlineMs),
      };
      this.waiting.push(entry);
      signal.addEventListener("abort", entry.abort, { once: true });
    });
  }
  async run<T>(
    priority: Priority,
    signal: AbortSignal,
    operation: () => Promise<T>,
  ): Promise<T> {
    const release = await this.acquire(priority, signal);
    try {
      signal.throwIfAborted();
      return await abortable(
        Promise.resolve().then(() => {
          signal.throwIfAborted();
          return operation();
        }),
        signal,
      );
    } finally {
      release();
    }
  }
}

/** Production foreground cancellation/deadlines and shared background admission. */
export class ModelRequestService {
  private requests = new Map<string, AbortController>();
  private gate: ModelRequestGate;
  constructor(
    private options: {
      respond: (
        request: ModelRequest,
        onDelta: (delta: string) => void,
        signal: AbortSignal,
      ) => Promise<string>;
      onDelta: (event: { requestId: string; delta: string }) => void;
      /** Local timing metadata only: no prompts, response bodies, or credentials. */
      onState?: (state: RequestState) => void;
      timeoutMs?: number;
      queueDeadlineMs?: number;
    },
  ) {
    this.gate = new ModelRequestGate(options.queueDeadlineMs);
  }
  get foregroundCount() {
    return this.requests.size;
  }
  get counts() {
    return this.gate.counts;
  }
  cancel(
    requestId: string,
    message = "This response was canceled. Any partial explanation is saved; you can continue or retry.",
  ) {
    this.requests.get(requestId)?.abort(new Error(message));
  }
  cancelAll(message: string) {
    for (const request of this.requests.values())
      request.abort(new Error(message));
  }
  async send(payload: unknown): Promise<string> {
    const parsed = modelRequest.safeParse(payload);
    if (!parsed.success)
      throw new Error(
        "The model request is malformed. Check its model, instructions, and conversation messages.",
      );
    const request = parsed.data;
    if (this.requests.has(request.requestId))
      throw new Error("This request is already active.");
    if (this.requests.size >= 6)
      throw new Error(
        "Several tutor requests are already active or waiting. Finish or cancel one, then send again.",
      );
    if (Buffer.byteLength(JSON.stringify(request), "utf8") > 500_000)
      throw new Error("The conversation is too large. Start a new lesson.");
    const controller = new AbortController();
    this.requests.set(request.requestId, controller);
    const submittedAt = Date.now();
    let admittedAt: number | undefined, firstTextAt: number | undefined;
    let timedOut = false;
    const state = (phase: RequestState["phase"]) => {
      try {
        this.options.onState?.({
          requestId: request.requestId,
          phase,
          elapsedMs: Math.max(0, Date.now() - submittedAt),
          ...(admittedAt === undefined
            ? {}
            : { queueMs: Math.max(0, admittedAt - submittedAt) }),
          ...(firstTextAt === undefined || admittedAt === undefined
            ? {}
            : { firstTextMs: Math.max(0, firstTextAt - admittedAt) }),
        });
      } catch {
        /* Timing observers cannot interrupt learning or expose content. */
      }
    };
    state("queued");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await this.gate.run(
        "foreground",
        controller.signal,
        async () => {
          admittedAt = Date.now();
          state("admitted");
          timer = setTimeout(() => {
            timedOut = true;
            controller.abort(
              new Error(
                "The model did not complete within five minutes. Any partial explanation is saved. Retry explicitly, or choose a faster reasoning level in Settings.",
              ),
            );
          }, this.options.timeoutMs ?? foregroundDeadlineMs);
          return this.options.respond(
            request,
            (delta) => {
              if (!controller.signal.aborted) {
                if (delta && firstTextAt === undefined) {
                  firstTextAt = Date.now();
                  state("first-text");
                }
                this.options.onDelta({ requestId: request.requestId, delta });
              }
            },
            controller.signal,
          );
        },
      );
      state("complete");
      return response;
    } catch (error) {
      state(controller.signal.aborted && !timedOut ? "canceled" : "failed");
      if (controller.signal.aborted) throw reason(controller.signal);
      if (
        error instanceof Error &&
        (error.name === "AbortError" || /operation.*abort/i.test(error.message))
      )
        throw new Error(
          "The model connection was interrupted. Any partial explanation is saved. Continue or retry explicitly when ready.",
        );
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      this.requests.delete(request.requestId);
    }
  }
  background(request: ModelRequest, signal: AbortSignal) {
    return this.gate.run("background", signal, () =>
      this.options.respond(request, () => {}, signal),
    );
  }
}
