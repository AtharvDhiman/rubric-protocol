/**
 * The message a worker signs to prove a submission is theirs.
 *
 * This module is deliberately NOT server-only: the client has to build exactly
 * these bytes to sign them, and the server has to build exactly these bytes to
 * verify them. One function, imported by both, so the two can never drift. If
 * they ever did, every submission would fail closed rather than open - but a
 * shared function means the question does not arise.
 *
 * Verification lives in `lib/server/worker-auth.ts`, which is server-only.
 */

export interface WorkerProof {
  /** base58 ed25519 signature over `workerAuthMessage(...)`. */
  signature: string;
  /** The client's clock when it signed, ISO-8601. Part of the signed bytes. */
  issuedAt: string;
}

/** How far the client's clock may differ from the server's before we reject. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * The exact bytes the worker signs.
 *
 * Written to be readable in a wallet's signing dialog, because a person
 * approving it should be able to see what they are agreeing to. It names the
 * task, the wallet and a hash of the body, and says plainly that it moves no
 * money — the wallet signs `submit_work` separately for that.
 */
export function workerAuthMessage(params: {
  taskId: string;
  workerAddress: string;
  submissionHash: string;
  issuedAt: string;
}): string {
  return [
    "Rubric: authorise a submission",
    "",
    "This signs your work onto a task. It does not move any funds.",
    "",
    `Task:      ${params.taskId}`,
    `Worker:    ${params.workerAddress}`,
    `Body hash: ${params.submissionHash}`,
    `Issued:    ${params.issuedAt}`,
  ].join("\n");
}
