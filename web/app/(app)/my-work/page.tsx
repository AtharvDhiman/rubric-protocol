"use client";

/**
 * /my-work — every matter the connected wallet has posted or worked on.
 *
 * Filtered client-side by the connected address rather than server-side, because
 * there is no login: the wallet IS the identity, and it only exists in the
 * browser. No signature is required to read a public ledger.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { MetaRow } from "@/components/MetaRow";
import { Stamp, stampForState } from "@/components/Stamp";
import { formatUsdc } from "@/lib/solana";

interface Row {
  id: string;
  onchainTaskId: string;
  title: string;
  clauseCount: number;
  bountyAmount: string;
  state: string;
  creatorAddress: string;
}

export default function MyWorkPage() {
  const { publicKey, connected } = useWallet();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/tasks?perPage=50");
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? "failed");
        if (!cancelled) setRows(body.tasks as Row[]);
      } catch (error) {
        console.error("[my-work] load failed:", error);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const address = publicKey?.toBase58();
  const mine = rows?.filter((r) => r.creatorAddress === address) ?? [];

  return (
    <article>
      <h1 style={{ fontSize: 30, letterSpacing: "-0.02em" }}>My work</h1>
      <p style={{ fontSize: 15, color: "var(--text-muted)", margin: "8px 0 0" }}>
        Matters posted by the connected wallet.
      </p>
      <hr className="rule" style={{ marginTop: 24 }} />

      {!connected && (
        <p style={{ fontSize: 15, color: "var(--text-muted)", marginTop: 32 }}>
          Connect a wallet to see your matters.
        </p>
      )}

      {connected && failed && (
        <p style={{ fontSize: 15, color: "var(--text-muted)", marginTop: 32 }}>
          The record store is unavailable. The chain is unaffected.
        </p>
      )}

      {connected && !failed && rows === null && (
        <p style={{ fontSize: 15, color: "var(--text-muted)", marginTop: 32 }}>
          Loading…
        </p>
      )}

      {connected && rows !== null && mine.length === 0 && (
        <p style={{ fontSize: 15, color: "var(--text-muted)", marginTop: 32 }}>
          Nothing yet.{" "}
          <Link href="/create" style={{ color: "var(--accent)" }}>
            Draft a rubric
          </Link>
          .
        </p>
      )}

      <div style={{ marginTop: 24 }}>
        {mine.map((row) => (
          <Link key={row.id} href={`/task/${row.id}`} className="record-row">
            <span
              className="data"
              style={{ width: 56, flex: "0 0 56px", color: "var(--accent)", fontSize: 13 }}
            >
              {row.onchainTaskId.padStart(4, "0")}
            </span>
            <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>{row.title}</span>
            <span className="data" style={{ fontSize: 13 }}>
              {formatUsdc(row.bountyAmount)}
            </span>
            <span style={{ width: 120, flex: "0 0 120px", textAlign: "right" }}>
              <Stamp variant={stampForState(row.state)} small />
            </span>
          </Link>
        ))}
      </div>

      <MetaRow footnote="Your wallet is your identity here." record="RECORD · MY WORK" />
    </article>
  );
}
