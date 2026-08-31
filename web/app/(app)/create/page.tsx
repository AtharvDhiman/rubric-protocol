"use client";

/**
 * /create — draft a rubric, seal it, fund the escrow.
 *
 * The confirmation step is not a formality. It shows the EXACT canonical string
 * that is about to be hashed and the hash itself, because after this point the
 * clauses are immutable and the user is entitled to see precisely what they are
 * committing to. The confirm button stays disabled until they tick a real
 * checkbox saying they understand that.
 *
 * The hash is computed on the client AND on the server, and the two are compared
 * before anything is signed. A silent disagreement there would be an expensive
 * bug: the chain would seal criteria that differ from the ones we would later
 * judge against, and the task could never be settled.
 */

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BN } from "@anchor-lang/core";

import { MetaRow } from "@/components/MetaRow";
import { Stamp } from "@/components/Stamp";
import { TxFlow, useTxFlow } from "@/components/TxFlow";
import { useRubricProgram } from "@/lib/useRubricProgram";
import { methodsOf } from "@/lib/anchor-methods";
import {
  canonicalizeRubric,
  fromHex,
  hashRubricHex,
  validateRubric,
} from "@/lib/hash";
import {
  CATEGORIES,
  CLAUSE_COUNTER_VISIBLE_FROM,
  FEE_BPS,
  MAX_BOUNTY_BASE_UNITS,
  MAX_CLAUSES,
  MAX_CLAUSE_LENGTH,
  WORK_WINDOWS,
} from "@/lib/constants";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  configPda,
  escrowAddress,
  formatUsdc,
  parseUsdc,
  taskPda,
  TOKEN_PROGRAM_ID,
} from "@/lib/solana";

/** A rough network-fee figure for the breakdown. Solana fees are ~0.000005 SOL. */
const NETWORK_FEE_LABEL = "~0.00001 SOL";

export default function CreatePage() {
  const router = useRouter();
  const { publicKey, connected } = useWallet();
  const { program, usdcMint, error: idlError } = useRubricProgram();
  const { state, run, reset, busy } = useTxFlow();

  const [title, setTitle] = useState("");
  const [clauses, setClauses] = useState<string[]>([""]);
  const [windowSeconds, setWindowSeconds] = useState<number>(
    WORK_WINDOWS[1].seconds
  );
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [bounty, setBounty] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const problems = useMemo(
    () => validateRubric({ title, clauses }),
    [title, clauses]
  );

  const bountyBaseUnits = useMemo(() => {
    try {
      return bounty.trim() === "" ? 0n : parseUsdc(bounty);
    } catch {
      return null;
    }
  }, [bounty]);

  const fee =
    bountyBaseUnits === null
      ? 0n
      : (bountyBaseUnits * BigInt(FEE_BPS)) / 10_000n;

  const canonical = useMemo(
    () => canonicalizeRubric({ title, clauses }),
    [title, clauses]
  );
  const localHash = useMemo(
    () => hashRubricHex({ title, clauses }),
    [title, clauses]
  );

  const readyToSeal =
    problems.length === 0 &&
    bountyBaseUnits !== null &&
    bountyBaseUnits > 0n &&
    bountyBaseUnits <= BigInt(MAX_BOUNTY_BASE_UNITS);

  function updateClause(index: number, value: string) {
    setClauses((prev) => prev.map((c, i) => (i === index ? value : c)));
  }

  function addClause() {
    setClauses((prev) => (prev.length >= MAX_CLAUSES ? prev : [...prev, ""]));
  }

  function removeClause(index: number) {
    setClauses((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function seal() {
    setProblem(null);

    if (!connected || !publicKey) {
      setProblem("Connect a wallet before sealing.");
      return;
    }
    if (!program || !usdcMint) {
      setProblem(
        idlError ?? "The on-chain program is not available in this environment."
      );
      return;
    }
    if (bountyBaseUnits === null || bountyBaseUnits <= 0n) {
      setProblem("Enter a bounty amount.");
      return;
    }

    const deadlineUnix = Math.floor(Date.now() / 1000) + windowSeconds;

    await run(async (tx) => {
      tx.preparing();

      // 1. Draft the row server-side and get the server's hash.
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          clauses: clauses.filter((c) => c.trim().length > 0),
          bountyAmount: bountyBaseUnits.toString(),
          deadline: deadlineUnix,
          category,
          creatorAddress: publicKey.toBase58(),
          mint: usdcMint,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.problems?.[0] ?? body?.error ?? "Could not draft the task.");
      }

      // 2. THE CHECK. If the server hashed something different from what this
      //    browser showed the user, stop. Sealing here would commit criteria the
      //    user never saw.
      if (body.rubricHash !== localHash) {
        console.error(
          `[create] hash mismatch: client=${localHash} server=${body.rubricHash}`
        );
        throw new Error(
          "The server computed a different clause hash than this page did. Nothing was sealed. Please report this."
        );
      }

      const mint = new PublicKey(usdcMint);
      const taskIdBn = BigInt(body.taskId);
      const task = taskPda(publicKey, taskIdBn);
      const creatorAta = getAssociatedTokenAddressSync(mint, publicKey);

      tx.awaitingSignature();

      const signature: string = await methodsOf(program)
        .createTask(
          new BN(body.taskId),
          Array.from(fromHex(body.rubricHash)),
          new BN(bountyBaseUnits.toString()),
          new BN(deadlineUnix)
        )
        .accounts({
          creator: publicKey,
          config: configPda(),
          task,
          mint,
          creatorTokenAccount: creatorAta,
          escrow: escrowAddress(task, mint),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: new PublicKey("11111111111111111111111111111111"),
        })
        .rpc();

      tx.confirming(signature);

      const confirm = await fetch("/api/tasks/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: body.id, signature, kind: "create" }),
      });
      if (!confirm.ok) {
        tx.unconfirmed(signature);
        return;
      }

      tx.done(signature, "Sealed and funded. The clauses are now immutable.");
      setConfirmOpen(false);
      router.push(`/task/${body.id}`);
    });
  }

  return (
    <article>
      {/* ---------------- HEADER ---------------- */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 className="page-title">Draft a rubric</h1>
          <p className="page-lede">
            Write the clauses, seal them, fund the escrow.
          </p>
        </div>
        <span className="label label-11">DRAFT — NOT YET ON-CHAIN</span>
      </div>

      <hr className="rule" style={{ marginTop: 24 }} />

      <div
        className="app-two-col"
        style={{
          display: "grid",
          gridTemplateColumns: "1.3fr 1fr",
          gap: 40,
          marginTop: 32,
          alignItems: "start",
        }}
      >
        {/* ---------------- LEFT ---------------- */}
        <section>
          <label htmlFor="title" className="label" style={{ display: "block" }}>
            TITLE
          </label>
          <input
            id="title"
            className="field field-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Label 500 warehouse shelf photos"
            style={{ marginTop: 8 }}
          />

          <div style={{ marginTop: 40 }}>
            <label className="label" style={{ display: "block" }}>
              CLAUSES
            </label>
            <p style={{ fontSize: 14, color: "var(--text-muted)", margin: "6px 0 16px" }}>
              What counts as done.
            </p>

            {clauses.map((clause, i) => (
              <ClauseRow
                key={i}
                index={i}
                value={clause}
                canRemove={clauses.length > 1}
                onChange={(v) => updateClause(i, v)}
                onRemove={() => removeClause(i)}
              />
            ))}

            {clauses.length < MAX_CLAUSES && (
              <button
                type="button"
                className="btn btn-text"
                onClick={addClause}
                style={{ marginTop: 16 }}
              >
                + Add clause
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: 32, marginTop: 40, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="window" className="label" style={{ display: "block" }}>
                WORK WINDOW
              </label>
              <select
                id="window"
                className="field"
                value={windowSeconds}
                onChange={(e) => setWindowSeconds(Number(e.target.value))}
                style={{ marginTop: 8, fontSize: 15 }}
              >
                {WORK_WINDOWS.map((w) => (
                  <option key={w.seconds} value={w.seconds}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="category" className="label" style={{ display: "block" }}>
                CATEGORY
              </label>
              <select
                id="category"
                className="field"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{ marginTop: 8, fontSize: 15 }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* ---------------- RIGHT ---------------- */}
        <section style={{ borderLeft: "1px solid var(--border)", paddingLeft: 32 }}>
          <label htmlFor="bounty" className="label" style={{ display: "block" }}>
            BOUNTY
          </label>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 }}>
            <input
              id="bounty"
              className="field field-amount"
              inputMode="decimal"
              value={bounty}
              onChange={(e) => setBounty(e.target.value)}
              placeholder="25.00"
              aria-describedby="bounty-cap"
            />
            <span className="data" style={{ fontSize: 12, color: "var(--text-muted)" }}>
              USDC
            </span>
          </div>
          <p id="bounty-cap" className="label" style={{ marginTop: 8 }}>
            MVP CAP {formatUsdc(MAX_BOUNTY_BASE_UNITS)} USDC
          </p>

          <dl
            style={{
              margin: "32px 0 0",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
          >
            <Row label={`Protocol fee ${FEE_BPS / 100}%`} value={`${formatUsdc(fee)} USDC`} />
            <Row label="Network fee" value={NETWORK_FEE_LABEL} />
            <hr className="rule" style={{ margin: "12px 0" }} />
            <Row
              label="INTO ESCROW"
              value={`${
                bountyBaseUnits === null ? "—" : formatUsdc(bountyBaseUnits)
              } USDC`}
              bold
            />
          </dl>

          <button
            type="button"
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 32 }}
            disabled={!readyToSeal || busy}
            onClick={() => {
              setUnderstood(false);
              setConfirmOpen(true);
            }}
          >
            Seal rubric and fund escrow
          </button>

          <p style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 16 }}>
            Sealing is final. The clauses cannot be edited afterward — not by you,
            not by the protocol.
          </p>

          {problems.length > 0 && (title.length > 0 || clauses.some(Boolean)) && (
            <ul
              style={{
                fontSize: 14,
                color: "var(--warning)",
                marginTop: 16,
                paddingLeft: 18,
              }}
            >
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          {problem && (
            <p style={{ fontSize: 14, color: "var(--negative)", marginTop: 16 }}>
              {problem}
            </p>
          )}

          <TxFlow state={state} onDismiss={reset} />
        </section>
      </div>

      <MetaRow
        footnote="Funding writes the clause hash to a program-derived address."
        record="RECORD DRAFT · CREATE"
      />

      {/* ---------------- CONFIRMATION ---------------- */}
      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-heading"
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--overlay)",
            display: "grid",
            placeItems: "center",
            padding: 24,
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border-strong)",
              borderRadius: 0,
              padding: 32,
              width: 640,
              maxWidth: "100%",
              maxHeight: "86vh",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
              }}
            >
              <h2 id="confirm-heading" style={{ fontSize: 22 }}>
                Seal these clauses
              </h2>
              <Stamp variant="sealed" small />
            </div>

            <p style={{ fontSize: 14, color: "var(--text-2)", marginTop: 12 }}>
              This is the exact text that will be hashed and written on-chain.
              Nothing outside it is binding, and none of it can be changed
              afterward.
            </p>

            <pre
              style={{
                background: "var(--raised)",
                border: "1px solid var(--border)",
                borderRadius: 2,
                padding: 16,
                marginTop: 20,
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                lineHeight: 1.7,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                overflowX: "auto",
              }}
            >
              {canonical}
            </pre>

            <div style={{ marginTop: 16 }}>
              <div className="label">CLAUSE HASH (SHA-256)</div>
              <div
                className="data"
                style={{ fontSize: 13, wordBreak: "break-all", marginTop: 6 }}
              >
                {localHash}
              </div>
            </div>

            <label
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                marginTop: 24,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
                style={{ marginTop: 3, width: 16, height: 16 }}
              />
              I understand these clauses cannot be changed after sealing.
            </label>

            <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!understood || busy}
                onClick={() => void seal()}
              >
                {busy ? "Sealing…" : "Seal and fund"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
              >
                Back
              </button>
            </div>

            <TxFlow state={state} />
          </div>
        </div>
      )}
    </article>
  );
}

function ClauseRow({
  index,
  value,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  value: string;
  canRemove: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: "flex", gap: 12, alignItems: "flex-start", marginTop: 16 }}
    >
      <span className="clause-mark" style={{ fontSize: 14, paddingTop: 10 }}>
        §{index + 1}
      </span>
      <div style={{ flex: 1 }}>
        <textarea
          ref={ref}
          className="field field-clause"
          rows={1}
          value={value}
          maxLength={MAX_CLAUSE_LENGTH}
          aria-label={`Clause ${index + 1}`}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            onChange(e.target.value);
            // Auto-grow. Reset first so the box can also shrink.
            const el = e.target;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
          placeholder={
            index === 0
              ? "Every barcode is legible and in focus."
              : "Add another binding requirement."
          }
        />
        {value.length >= CLAUSE_COUNTER_VISIBLE_FROM && (
          <div
            className="data"
            style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}
          >
            {value.length} / {MAX_CLAUSE_LENGTH}
          </div>
        )}
      </div>
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove clause ${index + 1}`}
          style={{
            visibility: hovered || focused ? "visible" : "hidden",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted)",
            padding: "10px 4px",
            fontSize: 14,
          }}
        >
          Remove
        </button>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        padding: "8px 0",
        borderBottom: bold ? "none" : "1px solid var(--hairline)",
        fontWeight: bold ? 600 : 400,
      }}
    >
      <span style={{ color: bold ? "var(--text)" : "var(--text-muted)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
