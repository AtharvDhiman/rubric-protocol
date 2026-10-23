"use client";

/**
 * A human reviewer's ruling on a HELD task.
 *
 * Renders nothing unless the connected wallet is on the reviewer allowlist, which the
 * server decides (GET /api/review/eligibility). That check is a convenience: the review
 * route re-checks it, and checks everything else too. See docs/dispute-design.md.
 *
 * The reviewer marks each sealed clause as passing or failing, with a reason. There is
 * no "approve" or "reject" button: the outcome follows from the clauses, exactly as it
 * does for the AI judge, so a reviewer cannot approve a task with a failing clause or
 * reject one without saying which clause failed.
 *
 * The wallet signs a MESSAGE, not a transaction. It authenticates the ruling; the
 * server's verifier key signs the on-chain verdict. Nothing here moves the reviewer's
 * own funds.
 *
 * No automatic retry. If the request fails AFTER it was sent, the ruling may have
 * landed, so the reviewer is told to check the task rather than resubmit blindly.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import {
  MAX_REASON_LENGTH,
  MAX_SUMMARY_LENGTH,
  decisionApproves,
  decisionHash,
  reviewAuthMessage,
  validateDecision,
} from "@/lib/review";

type Choice = "" | "pass" | "fail";
type Phase = "idle" | "signing" | "submitting" | "done" | "error";

export function ReviewPanel({ taskId, clauses }: { taskId: string; clauses: string[] }) {
  const router = useRouter();
  const { publicKey, signMessage } = useWallet();
  const address = publicKey?.toBase58();

  // Keyed by address so a stale answer for a previous wallet is never used.
  const [checked, setChecked] = useState<{ address: string; eligible: boolean } | null>(null);
  const [choices, setChoices] = useState<Choice[]>(() => clauses.map(() => ""));
  const [reasons, setReasons] = useState<string[]>(() => clauses.map(() => ""));
  const [summary, setSummary] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/review/eligibility?address=${encodeURIComponent(address)}`);
        const body = await response.json();
        if (!cancelled) setChecked({ address, eligible: Boolean(body?.eligible) });
      } catch {
        // The panel simply stays hidden. Review is never offered on a guess.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  const eligible = checked !== null && checked.address === address && checked.eligible;
  if (!eligible) return null;

  const busy = phase === "signing" || phase === "submitting";

  const raw = {
    clauses: clauses.map((_, i) => ({ index: i, passed: choices[i] === "pass", reason: reasons[i] ?? "" })),
    summary,
  };
  const allMarked = choices.every((c) => c !== "");
  const parsed = validateDecision(raw, clauses.length);
  // What the ruling WOULD do, shown only once it is complete and valid.
  const preview = allMarked && parsed.ok ? (decisionApproves(parsed.value) ? "approve" : "reject") : null;

  async function onSubmit() {
    setProblem(null);
    if (!publicKey || !signMessage) {
      setProblem("Connect a reviewer wallet that can sign messages.");
      return;
    }
    if (!allMarked) {
      setProblem("Rule on every clause: mark each one as passing or failing.");
      return;
    }
    if (!parsed.ok) {
      setProblem(parsed.error);
      return;
    }

    const reviewerAddress = publicKey.toBase58();
    const issuedAt = new Date().toISOString();

    setPhase("signing");
    let signature: Uint8Array;
    try {
      signature = await signMessage(
        new TextEncoder().encode(
          reviewAuthMessage({ taskId, reviewerAddress, decisionHash: decisionHash(parsed.value), issuedAt })
        )
      );
    } catch {
      setPhase("error");
      setProblem("The signature was declined, so nothing was submitted.");
      return;
    }

    setPhase("submitting");
    try {
      const response = await fetch(`/api/tasks/${taskId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewerAddress,
          decision: parsed.value,
          proof: { signature: bs58.encode(signature), issuedAt },
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setPhase("error");
        setProblem(body?.error ?? "The ruling was not accepted.");
        return;
      }
      setPhase("done");
      router.refresh();
    } catch {
      // Sent, but no answer. It may have landed. Never resend blindly.
      setPhase("error");
      setProblem(
        "Could not confirm whether the ruling was recorded. Refresh this page and check the task before submitting again."
      );
    }
  }

  if (phase === "done") {
    return (
      <p role="status" style={{ fontSize: 14, color: "var(--text-2)", marginTop: 32 }}>
        <strong>Ruling recorded.</strong> It has been published and the escrow has been settled.
      </p>
    );
  }

  return (
    <section
      aria-label="Review this held task"
      style={{ marginTop: 32, borderTop: "1px solid var(--border)", paddingTop: 24 }}
    >
      <div className="label">REVIEW THIS HELD TASK</div>
      <p style={{ fontSize: 14, color: "var(--text-2)", marginTop: 12 }}>
        You are a reviewer. Rule on each sealed clause below, with a reason. The outcome follows
        from your rulings: the work is approved only if every clause passes. Your ruling is final,
        it releases or refunds the escrow, and it is published with your wallet address. A
        reviewer cannot rule on a task they posted or worked on.
      </p>

      {clauses.map((clause, i) => (
        <div key={i} style={{ marginTop: 24 }}>
          <div style={{ fontSize: 14 }}>
            <span className="data">{String(i + 1).padStart(2, "0")}</span> {clause}
          </div>
          <label htmlFor={`verdict-${i}`} className="label" style={{ display: "block", marginTop: 12 }}>
            CLAUSE {i + 1} RULING
          </label>
          <select
            id={`verdict-${i}`}
            className="field"
            value={choices[i]}
            disabled={busy}
            onChange={(event) =>
              setChoices((prev) => prev.map((c, j) => (j === i ? (event.target.value as Choice) : c)))
            }
            style={{ marginTop: 8 }}
          >
            <option value="">Not ruled on</option>
            <option value="pass">Passes</option>
            <option value="fail">Fails</option>
          </select>
          <label htmlFor={`reason-${i}`} className="label" style={{ display: "block", marginTop: 12 }}>
            REASON (PUBLIC)
          </label>
          <textarea
            id={`reason-${i}`}
            className="field field-clause"
            rows={2}
            maxLength={MAX_REASON_LENGTH}
            value={reasons[i]}
            disabled={busy}
            onChange={(event) =>
              setReasons((prev) => prev.map((r, j) => (j === i ? event.target.value : r)))
            }
            placeholder="Cite what in the submission drove this ruling."
            style={{ marginTop: 8, overflow: "auto" }}
          />
        </div>
      ))}

      <label htmlFor="review-summary" className="label" style={{ display: "block", marginTop: 24 }}>
        SUMMARY (PUBLIC)
      </label>
      <textarea
        id="review-summary"
        className="field field-clause"
        rows={3}
        maxLength={MAX_SUMMARY_LENGTH}
        value={summary}
        disabled={busy}
        onChange={(event) => setSummary(event.target.value)}
        placeholder="Two sentences at most, addressed to the poster and the worker."
        style={{ marginTop: 8, overflow: "auto" }}
      />

      {preview && (
        <p style={{ fontSize: 14, marginTop: 20 }}>
          <strong>
            As marked, this ruling {preview === "approve" ? "APPROVES the work and pays the worker" : "REJECTS the work and refunds the poster"}.
          </strong>
        </p>
      )}

      {problem && (
        <p role="alert" style={{ fontSize: 14, color: "var(--negative)", marginTop: 12 }}>
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
        {phase === "signing"
          ? "Waiting for your signature…"
          : phase === "submitting"
            ? "Submitting your ruling…"
            : "Sign and submit ruling"}
      </button>

      {phase === "signing" && (
        <p role="status" className="label" style={{ marginTop: 12, color: "var(--text-muted)" }}>
          Approve the message in your wallet. It moves none of your funds.
        </p>
      )}
    </section>
  );
}
