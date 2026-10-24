"use client";

/**
 * <TxFlow> - the single path every on-chain action takes.
 *
 * Four explicit states, plus two first-class failures that most apps treat as
 * afterthoughts:
 *
 *   preparing -> awaiting signature -> confirming -> done
 *   declined        (the user said no; that is a normal outcome, not an error)
 *   unconfirmed     (we stopped waiting; the transaction MAY STILL HAVE LANDED)
 *
 * Two rules this component exists to enforce:
 *
 *  1. Never leave a spinner hanging. Every path terminates in a state with text.
 *  2. NEVER auto-retry. Once a transaction has been signed and broadcast, a
 *     retry can double-spend or double-submit. `unconfirmed` deliberately offers
 *     an Explorer link and no retry button - the user checks, then decides.
 *
 * It is an inline status strip, not a toast: the record stays on the page next
 * to the thing it describes.
 */

import { useCallback, useState } from "react";
import { explorerTxUrl } from "@/lib/env";
import { truncateAddress } from "@/lib/solana";

export type TxState =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "awaiting-signature" }
  | { kind: "confirming"; signature: string }
  | { kind: "done"; signature: string; message?: string }
  | { kind: "declined" }
  | { kind: "unconfirmed"; signature: string }
  | { kind: "error"; message: string };

export interface TxHandle {
  preparing(): void;
  awaitingSignature(): void;
  confirming(signature: string): void;
  done(signature: string, message?: string): void;
  unconfirmed(signature: string): void;
}

/** Heuristic for "the user closed the wallet popup" across adapters. */
/**
 * Did this transaction get broadcast and then fail to confirm in time?
 *
 * This is the single most dangerous error to get wrong. web3.js throws when it
 * stops waiting, but the transaction is already on the wire and may well land a
 * moment later. Reporting that as a generic failure tells the person nothing was
 * sent, and the natural response - try again - double-submits and can cost them
 * a second bounty. Returns the signature when it can be recovered, an empty
 * string when we know it was a timeout but cannot name the signature, and null
 * when this is an ordinary error that really did stop before sending.
 */
function confirmationTimeoutSignature(error: unknown): string | null {
  const carried = (error as { signature?: unknown })?.signature;
  if (typeof carried === "string" && carried.length >= 64) return carried;

  const message = error instanceof Error ? error.message : String(error);
  // "Transaction was not confirmed in 30.00 seconds... Check signature <sig>"
  const named = message.match(/signature\s+([1-9A-HJ-NP-Za-km-z]{64,88})/);
  if (named) return named[1];
  if (
    /was not confirmed|TransactionExpired|block height exceeded|timed? ?out/i.test(
      message
    )
  ) {
    return "";
  }
  return null;
}

function isUserRejection(error: unknown): boolean {
  const message = String(
    (error as { message?: string })?.message ?? error ?? ""
  ).toLowerCase();
  return (
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("rejected the request") ||
    message.includes("declined")
  );
}

export function useTxFlow() {
  const [state, setState] = useState<TxState>({ kind: "idle" });

  const handle: TxHandle = {
    preparing: () => setState({ kind: "preparing" }),
    awaitingSignature: () => setState({ kind: "awaiting-signature" }),
    confirming: (signature) => setState({ kind: "confirming", signature }),
    done: (signature, message) => setState({ kind: "done", signature, message }),
    unconfirmed: (signature) => setState({ kind: "unconfirmed", signature }),
  };

  const run = useCallback(
    async (action: (tx: TxHandle) => Promise<void>) => {
      setState({ kind: "preparing" });
      try {
        await action(handle);
      } catch (error) {
        if (isUserRejection(error)) {
          setState({ kind: "declined" });
          return;
        }
        // Raw errors and RPC codes go to the console, never to the user.
        console.error("[tx]", error);
        // Before calling this a failure, check whether it is really a
        // confirmation timeout. Saying "nothing was sent" about a transaction
        // that is already on the wire is how people pay twice.
        const pending = confirmationTimeoutSignature(error);
        if (pending !== null) {
          setState({ kind: "unconfirmed", signature: pending });
          return;
        }
        setState({
          kind: "error",
          message:
            error instanceof Error && error.message.length < 160
              ? error.message
              : "Something went wrong before the transaction was sent.",
        });
      }
    },
    // `handle` is recreated each render but only closes over setState, which is
    // stable. Intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const reset = useCallback(() => setState({ kind: "idle" }), []);

  return { state, run, reset, busy: isBusy(state) };
}

export function isBusy(state: TxState): boolean {
  return (
    state.kind === "preparing" ||
    state.kind === "awaiting-signature" ||
    state.kind === "confirming"
  );
}

export function TxFlow({
  state,
  onDismiss,
}: {
  state: TxState;
  onDismiss?: () => void;
}) {
  if (state.kind === "idle") return null;

  const strip = (
    accent: string,
    label: string,
    body: React.ReactNode,
    signature?: string
  ) => (
    <div
      role="status"
      aria-live="polite"
      style={{
        border: "1px solid var(--border)",
        borderLeft: `2px solid ${accent}`,
        background: "var(--raised)",
        padding: "14px 18px",
        marginTop: 24,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <span className="label" style={{ color: accent }}>
        {label}
      </span>
      <div style={{ fontSize: 14, color: "var(--text-2)" }}>{body}</div>
      {signature && (
        <a
          className="data"
          href={explorerTxUrl(signature)}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: "var(--accent)" }}
        >
          {truncateAddress(signature, 8, 8)} — view on Solana Explorer
        </a>
      )}
      {onDismiss && (state.kind === "done" || state.kind === "declined" || state.kind === "error") && (
        <button
          type="button"
          className="btn btn-text"
          onClick={onDismiss}
          style={{ alignSelf: "flex-start", marginTop: 4 }}
        >
          Dismiss
        </button>
      )}
    </div>
  );

  switch (state.kind) {
    case "preparing":
      return strip("var(--accent)", "Preparing transaction", "Building the instruction and fetching a recent blockhash.");
    case "awaiting-signature":
      return strip(
        "var(--accent)",
        "Awaiting signature",
        "Approve the transaction in your wallet. Nothing has been sent yet."
      );
    case "confirming":
      return strip(
        "var(--accent)",
        "Confirming on Solana",
        "Sent. Waiting for the network to confirm.",
        state.signature
      );
    case "done":
      return strip(
        "var(--positive)",
        "Done",
        state.message ?? "Confirmed on-chain.",
        state.signature
      );
    case "declined":
      return strip(
        "var(--text-muted)",
        "Signature declined",
        "You declined the signature in your wallet. Nothing was sent and nothing was charged."
      );
    case "unconfirmed":
      return strip(
        "var(--warning)",
        "Not confirmed",
        state.signature
          ? "We stopped waiting before the network confirmed. This transaction MAY still have landed — check Explorer before trying again, or you risk doing it twice."
          : "We stopped waiting before the network confirmed, and could not recover the signature. This transaction MAY still have landed — check your wallet's recent activity before trying again, or you risk doing it twice.",
        state.signature || undefined
      );
    case "error":
      return strip("var(--negative)", "Failed", state.message);
  }
}
