/** Raised when the user aborts a long-running job. Callers treat it as normal, not a failure. */
export class CancelledError extends Error {
  constructor(message = "Cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new CancelledError();
}

/** Rejects as soon as `signal` aborts, so a pending await can be interrupted. */
export function rejectOnAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) return reject(new CancelledError());
    signal.addEventListener("abort", () => reject(new CancelledError()), { once: true });
  });
}
