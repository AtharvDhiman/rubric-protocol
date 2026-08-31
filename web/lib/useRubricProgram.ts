"use client";

/**
 * Client-side Anchor program handle, signed by the user's wallet.
 *
 * The IDL is fetched from /api/idl at runtime rather than imported, so the app
 * builds without the Rust toolchain having ever run. See that route for why.
 */

import { useEffect, useMemo, useState } from "react";
import { AnchorProvider, Program } from "@anchor-lang/core";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { useAnchorWallet } from "@solana/wallet-adapter-react";

interface IdlPayload {
  idl: unknown;
  programId: string | null;
  usdcMint: string | null;
}

let cache: IdlPayload | null = null;

export function useRubricProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { connected } = useWallet();
  const [payload, setPayload] = useState<IdlPayload | null>(cache);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/idl");
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? "IDL unavailable");
        cache = body as IdlPayload;
        if (!cancelled) setPayload(cache);
      } catch (err) {
        console.error("[idl] fetch failed:", err);
        if (!cancelled) {
          setError(
            "The on-chain program is not wired up in this environment yet."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const program = useMemo(() => {
    if (!payload?.idl || !wallet) return null;
    try {
      const provider = new AnchorProvider(connection, wallet as AnchorWallet, {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
      });
      return new Program(payload.idl as never, provider);
    } catch (err) {
      console.error("[idl] program construction failed:", err);
      return null;
    }
  }, [payload, wallet, connection]);

  return {
    program,
    usdcMint: payload?.usdcMint ?? null,
    programId: payload?.programId ?? null,
    ready: Boolean(program) && connected,
    loading,
    error,
  };
}
