/**
 * Protocol limits, as the program holds them.
 *
 * The bounty cap and the pause switch live on-chain in the `Limits` account, set
 * by the admin. Until this existed the cap was a constant compiled into the
 * program and mirrored by hand into the UI, which is exactly the kind of number
 * that drifts: a page saying "cap 50 USDC" while the program says 100.
 *
 * Everything the UI or the API says about the cap now comes from the chain.
 *
 * THE PROGRAM IS THE RULE, THIS IS THE COURTESY
 * ---------------------------------------------
 * `create_task` enforces both limits itself. This module exists so a poster is
 * told "the cap is 50 USDC" BEFORE they sign, instead of watching a wallet
 * simulation fail with an error code. If this logic and the program ever
 * disagree, the program wins and the poster sees a failed transaction - which is
 * why the API route and the page both ask the chain rather than caching a value.
 *
 * This file is pure and imported by a client component, so it must not touch
 * `node:` modules or the server RPC client.
 */

import { formatUsdc } from "@/lib/solana";

/** What `Limits` holds, with the amount as a bigint (never a float for money). */
export interface ProtocolLimits {
  /** The largest bounty `create_task` accepts, in the mint's base units. */
  maxBounty: bigint;
  /** While true, `create_task` is refused. Nothing else is affected. */
  paused: boolean;
}

export type CreateRefusal =
  | "NOT_INITIALISED"
  | "PAUSED"
  | "NOT_POSITIVE"
  | "ABOVE_CAP";

export type CreateVerdict =
  | { ok: true }
  | { ok: false; code: CreateRefusal; message: string };

/**
 * Whether a new task with this bounty may be created right now.
 *
 * `limits` is null when the `Limits` account does not exist yet - a freshly
 * upgraded deployment where the admin has not run the one-time setup. That is a
 * refusal, not a "no cap": the program cannot create a task without the account,
 * and a UI that let the poster try would only produce a failed transaction.
 *
 * The order matters. State of the protocol first (a paused protocol is paused
 * for everyone, whatever they typed), then the poster's own input.
 */
export function evaluateCreate(
  limits: ProtocolLimits | null,
  bounty: bigint
): CreateVerdict {
  if (limits === null) {
    return {
      ok: false,
      code: "NOT_INITIALISED",
      message:
        "This deployment has not had its limits set up yet, so new tasks cannot be sealed. Nothing was sealed.",
    };
  }
  if (limits.paused) {
    return {
      ok: false,
      code: "PAUSED",
      message:
        "New tasks are paused. Tasks that already exist are unaffected and will still settle or be reclaimed.",
    };
  }
  if (bounty <= 0n) {
    return {
      ok: false,
      code: "NOT_POSITIVE",
      message: "The bounty must be greater than zero.",
    };
  }
  if (bounty > limits.maxBounty) {
    return {
      ok: false,
      code: "ABOVE_CAP",
      message: `The bounty is above the current cap of ${formatUsdc(limits.maxBounty)} USDC.`,
    };
  }
  return { ok: true };
}

/** The HTTP status a refusal maps to: the protocol's state is a 503, the poster's input a 400. */
export function refusalStatus(code: CreateRefusal): 400 | 503 {
  return code === "NOT_INITIALISED" || code === "PAUSED" ? 503 : 400;
}

/** The wire form of `ProtocolLimits` for `GET /api/limits` (JSON has no bigint). */
export interface LimitsPayload {
  initialised: boolean;
  /** Base units, as a decimal string. "0" when not initialised. */
  maxBounty: string;
  paused: boolean;
}

export function toPayload(limits: ProtocolLimits | null): LimitsPayload {
  return limits === null
    ? { initialised: false, maxBounty: "0", paused: false }
    : {
        initialised: true,
        maxBounty: limits.maxBounty.toString(),
        paused: limits.paused,
      };
}

export function fromPayload(payload: LimitsPayload): ProtocolLimits | null {
  return payload.initialised
    ? { maxBounty: BigInt(payload.maxBounty), paused: payload.paused }
    : null;
}
