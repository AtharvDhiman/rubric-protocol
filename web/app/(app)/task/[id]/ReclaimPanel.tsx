"use client";

/**
 * The poster's way out.
 *
 * `reclaim_expired` is the program's escape hatch: if a task expires with no
 * submission, or a submission sits unjudged long past its deadline, the poster
 * can take their escrow back. It existed on-chain and was covered by the Anchor
 * tests from the start, but nothing in this app called it — so a poster whose
 * task went nowhere had no way to recover their money except by invoking the
 * program directly. This is that button.
 *
 * Two things worth knowing about the timing, both enforced on-chain rather than
 * here. This screen only mirrors them:
 *
 *   - An OPEN task with nothing submitted can be reclaimed as soon as the work
 *     window closes.
 *   - A SUBMITTED task cannot. It only opens a full week after the deadline, so
 *     a poster cannot wait for good work to land and then snatch the bounty back
 *     before the judge has ruled. The grace period is the worker's protection.
 *
 * The button is deliberately not the primary style. Taking money out of escrow
 * is a fallback, not the happy path.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { useRubricProgram } from "@/lib/useRubricProgram";
import { TxFlow, useTxFlow } from "@/components/TxFlow";
import { methodsOf } from "@/lib/anchor-methods";

export function ReclaimPanel({
  taskId,
  creatorAddress,
  /** Computed on the server — reading the clock during render is impure. */
  reclaimable,
  /** True while the task is SUBMITTED, where the grace period applies. */
  awaitingVerdict,
}: {
  taskId: string;
  creatorAddress: string;
  reclaimable: boolean;
  awaitingVerdict: boolean;
}) {
  const router = useRouter();
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const { program, usdcMint, error: idlError } = useRubricProgram();
  const { state, run, reset, busy } = useTxFlow();
  const [problem, setProblem] = useState<string | null>(null);

  const isCreator = connected && publicKey?.toBase58() === creatorAddress;

  // Only the poster sees this at all. A worker being shown a button that takes
  // the bounty away from them would be a cruel piece of interface.
  if (!isCreator) return null;

  async function reclaim() {
    setProblem(null);
    if (!publicKey) {
      setProblem("Connect the wallet that posted this task.");
      return;
    }
    if (!program || !usdcMint) {
      setProblem(
        idlError ?? "The on-chain program is not available in this environment."
      );
      return;
    }

    await run(async (tx) => {
      tx.preparing();

      const mint = new PublicKey(usdcMint);
      const creatorAta = getAssociatedTokenAddressSync(mint, publicKey);

      // The program requires the destination account to exist before it will
      // move anything into it. If the poster closed it since funding the task,
      // recreate it in the same transaction rather than failing in front of them.
      const preInstructions = [];
      const existing = await connection.getAccountInfo(creatorAta);
      if (!existing) {
        preInstructions.push(
          createAssociatedTokenAccountInstruction(
            publicKey,
            creatorAta,
            publicKey,
            mint
          )
        );
      }

      tx.awaitingSignature();

      const signature: string = await methodsOf(program)
        .reclaimExpired()
        .accounts({
          creator: publicKey,
          task: await taskAddressFor(taskId),
          mint,
          creatorTokenAccount: creatorAta,
        })
        .preInstructions(preInstructions)
        .rpc();

      tx.confirming(signature);

      // The server re-reads the chain before it believes any of this. It will
      // only record the refund if the chain itself says Refunded.
      const confirm = await fetch("/api/tasks/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: taskId, signature, kind: "reclaim" }),
      });
      if (!confirm.ok) {
        // Never retried automatically. The transfer may well have landed, and
        // sending it twice is not something to do on the user's behalf.
        tx.unconfirmed(signature);
        return;
      }

      tx.done(signature, "The escrow has been returned to your wallet.");
      router.refresh();
    });
  }

  return (
    <div style={{ marginTop: 32 }}>
      <h2 className="label" style={{ fontSize: 10, marginBottom: 12 }}>
        RECLAIM ESCROW
      </h2>

      {awaitingVerdict && !reclaimable ? (
        <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>
          Work was submitted against this task, so the escrow is not yours to
          take back yet. The program holds it for seven days past the deadline so
          the judge has time to rule — that grace period is the worker&rsquo;s
          protection, and it is enforced on-chain, not here.
        </p>
      ) : !reclaimable ? (
        <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>
          The work window is still open. You can reclaim the escrow once it
          closes and nobody has submitted.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 15, color: "var(--text-muted)", margin: "0 0 16px" }}>
            The window has closed and this task can be settled no further. You
            can return the escrow to your wallet.
          </p>
          <button
            type="button"
            className="btn"
            onClick={reclaim}
            disabled={busy}
            style={{ borderRadius: 2 }}
          >
            {busy ? "Working…" : "Reclaim escrow"}
          </button>
        </>
      )}

      {problem && (
        <p
          role="alert"
          style={{ fontSize: 14, color: "var(--negative)", marginTop: 12 }}
        >
          {problem}
        </p>
      )}

      <TxFlow state={state} onDismiss={reset} />
    </div>
  );
}

/**
 * Ask the server for the Task PDA rather than deriving it here, so the client
 * bundle does not need the program id and the derivation lives in one place.
 */
async function taskAddressFor(taskId: string): Promise<PublicKey> {
  const response = await fetch(`/api/tasks/${taskId}/address`);
  if (!response.ok) throw new Error("Could not resolve this task's address.");
  const { address } = await response.json();
  return new PublicKey(address);
}
