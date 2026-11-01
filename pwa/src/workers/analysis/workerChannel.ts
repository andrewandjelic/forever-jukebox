// A nested worker driven one request at a time: post a message, then wait
// for its "result" (or "error"), passing any other messages to onEvent.
export class WorkerChannel {
  private readonly worker: Worker;
  private failure: Error | null = null;
  private queue: Promise<void> = Promise.resolve();
  private pending: {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    onEvent?: (message: any) => void;
  } | null = null;

  constructor(worker: Worker, private readonly describeError: (message: string) => Error) {
    this.worker = worker;
    worker.addEventListener("message", (event: MessageEvent) => {
      const data = event.data;
      const pending = this.pending;
      if (!data || !pending) {
        return;
      }
      if (data.type === "result") {
        this.pending = null;
        pending.resolve(data.payload);
      } else if (data.type === "error") {
        this.pending = null;
        pending.reject(this.describeError(data.message || "worker error"));
      } else {
        pending.onEvent?.(data);
      }
    });
    worker.addEventListener("error", (event) => {
      this.fail(this.describeError(`worker runtime failure: ${event.message}`));
    });
    worker.addEventListener("messageerror", () => {
      this.fail(this.describeError("worker message error"));
    });
  }

  // Requests made while one is in flight wait their turn.
  request<T>(
    message: unknown,
    transfer: Transferable[] = [],
    onEvent?: (message: any) => void,
  ): Promise<T> {
    const run = this.queue.then(() => {
      if (this.failure) {
        return Promise.reject(this.failure);
      }
      return new Promise<T>((resolve, reject) => {
        this.pending = { resolve: resolve as (value: unknown) => void, reject, onEvent };
        this.worker.postMessage(message, transfer);
      });
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  terminate() {
    this.worker.terminate();
  }

  private fail(error: Error) {
    this.failure = error;
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
  }
}

// Threads the browser reports, for sizing worker pools (at least 1).
export function hardwareThreads(): number {
  return Math.max(1, navigator.hardwareConcurrency || 2);
}
