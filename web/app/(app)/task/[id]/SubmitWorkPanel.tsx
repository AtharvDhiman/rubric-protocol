"use client";

/**
 * Submit a deliverable against an open task.
 *
 * Two steps, in this order and not the other one:
 *   1. POST the content to the API, which stores it and returns its hash.
 *   2. Commit that hash on-chain with `submit_work`, signed by the WORKER's own
 *      wallet. The signature is what binds the payout address to them, so the
 *      server must not sign this on their behalf.
 *
 * Then the signature is posted back to /api/tasks/confirm, which re-reads the
 * chain and only advances the row if the hash on-chain matches the hash we
 * stored. The UI never claims a state it has not verified.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { useRubricProgram } from "@/lib/useRubricProgram";
import { TxFlow, useTxFlow } from "@/components/TxFlow";
import { WalletPreflight } from "@/components/WalletPreflight";
import { fromHex, hashSubmissionHex } from "@/lib/hash";
import { workerAuthMessage } from "@/lib/worker-auth";
import bs58 from "bs58";
import { methodsOf } from "@/lib/anchor-methods";

export function SubmitWorkPanel({
  taskId,
  closed,
}: {
  taskId: string;
  /**
   * Computed on the server. Reading the clock during render is impure and makes
   * the first client render disagree with the server's HTML.
   */
  closed: boolean;
}) {
  const router = useRouter();
  const { connection } = useConnection();
  const { publicKey, connected, signMessage } = useWallet();
  const { program, usdcMint, error: idlError } = useRubricProgram();
  const { state, run, reset, busy } = useTxFlow();
  // The judge runs after the transaction is already done, so it cannot be a
  // TxFlow state - TxFlow describes one signature's journey, and this is a
  // separate server-side phase that happens once the chain says "Submitted".
  const [judging, setJudging] = useState(false);

  const [content, setContent] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  async function onSubmit() {
    setProblem(null);

    if (!connected || !publicKey) {
      setProblem("Connect a wallet before submitting.");
      return;
    }
    if (content.trim().length === 0) {
      setProblem("A submission cannot be empty.");
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

      // Step 0 - prove this wallet is the one submitting.
      //
      // Costs the worker one signature prompt, before the transaction. It is not
      // a transaction and moves nothing; it stops anyone else overwriting the
      // work staged here between now and the moment it is sealed on-chain. The
      // bytes are built by the same shared function the server verifies with.
      if (!signMessage) {
        throw new Error(
          "This wallet cannot sign messages, which is required to submit work."
        );
      }
      const workerAddress = publicKey.toBase58();
      const submissionHash = hashSubmissionHex(content);
      const issuedAt = new Date().toISOString();
      // Named apart from the TRANSACTION signature further down. They are
      // different things: this authenticates the writer, that one moves money.
      const authSignature = await signMessage(
        new TextEncoder().encode(
          workerAuthMessage({ taskId, workerAddress, submissionHash, issuedAt })
        )
      );

      // Step 1 - store the content, get the hash the chain will commit to.
      const response = await fetch(`/api/tasks/${taskId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content,
          workerAddress,
          proof: { signature: bs58.encode(authSignature), issuedAt },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "Could not store the submission.");

      const mint = new PublicKey(usdcMint);
      const workerAta = getAssociatedTokenAddressSync(mint, publicKey);

      // The program requires the worker's token account to already exist, so
      // that an approved payout can never fail and strand the task. Create it
      // in the same transaction if it is missing.
      const preInstructions = [];
      const existing = await connection.getAccountInfo(workerAta);
      if (!existing) {
        preInstructions.push(
          createAssociatedTokenAccountInstruction(
            publicKey,
            workerAta,
            publicKey,
            mint
          )
        );
      }

      tx.awaitingSignature();

      const signature: string = await methodsOf(program)
        .submitWork(Array.from(fromHex(body.submissionHash)))
        .accounts({
          worker: publicKey,
          task: await taskAddressFor(taskId),
          mint,
          workerTokenAccount: workerAta,
        })
        .preInstructions(preInstructions)
        .rpc();

      tx.confirming(signature);

      // Step 2 - the server checks the chain before it believes us.
      const confirm = await fetch("/api/tasks/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: taskId, signature, kind: "submit" }),
      });
      if (!confirm.ok) {
        // The transaction may well have landed - do not retry automatically.
        tx.unconfirmed(signature);
        return;
      }

      tx.done(signature, "Your submission is sealed on-chain. Sending it to the judge.");

      // Step 3 - RUN THE JUDGE. Nothing else in the app calls this, and the
      // whole product is "submit, get judged, get paid": without this the task
      // sits in `Submitted` until the poster reclaims it after the grace period.
      // Deliberately not awaited inside the transaction's own error handling -
      // the money-moving part already succeeded, and a judge failure must not be
      // reported as a failed transaction. The route is idempotent and the
      // verdict can always be re-run.
      setJudging(true);
      try {
        await fetch(`/api/tasks/${taskId}/verify`, { method: "POST" });
      } catch {
        // Swallowed on purpose. The submission is safe on-chain either way, and
        // the page below will show the task as still awaiting a verdict.
      } finally {
        setJudging(false);
      }
      router.refresh();
    });
  }

  if (closed) {
    return (
      <p style={{ fontSize: 15, color: "var(--text-muted)" }}>
        The work window for this matter has closed. The escrow is returnable to
        the poster through the program&rsquo;s <span className="data">reclaim_expired</span>{" "}
        instruction, which this interface does not yet offer — it has to be
        called against the program directly.
      </p>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 15, color: "var(--text-muted)", marginTop: 0 }}>
        Nothing submitted yet. Deliver against the sealed clauses on the left —
        the judge will read only those.
      </p>

      <label htmlFor="submission" className="label" style={{ display: "block", marginTop: 20 }}>
        YOUR SUBMISSION
      </label>
      <textarea
        id="submission"
        className="field field-clause"
        rows={7}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Describe or paste what you delivered."
        style={{ marginTop: 8, overflow: "auto" }}
      />

      {problem && (
        <p style={{ fontSize: 14, color: "var(--negative)", marginTop: 12 }}>
          {problem}
        </p>
      )}

      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void onSubmit()}
        disabled={busy}
        style={{ marginTop: 20, width: "100%" }}
      >
        {busy ? "Working…" : "Submit work"}
      </button>

      <WalletPreflight />

      <TxFlow state={state} onDismiss={reset} />

      {/* The judge runs after the transaction has already succeeded. Saying so
          explicitly beats a silent pause on the one screen where the person is
          waiting to find out whether they get paid. */}
      {judging && (
        <p
          role="status"
          className="label"
          style={{ marginTop: 12, color: "var(--text-muted)" }}
        >
          The judge is reading your submission against the sealed clauses.
        </p>
      )}
    </div>
  );
}

/**
 * Ask the server for the Task PDA rather than deriving it here, so the client
 * bundle does not need the program id and the derivation lives in one place.
 */
async function taskAddressFor(taskId: string): Promise<PublicKey> {
  const response = await fetch(`/api/tasks/${taskId}/address`);
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? "Could not derive the task address.");
  return new PublicKey(body.task);
}
