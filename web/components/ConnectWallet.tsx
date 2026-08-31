"use client";

/**
 * The wallet chip, styled to the design system rather than to wallet-adapter's
 * defaults: 1px border, 2px radius, mono text, truncated address and USDC
 * balance. The picker is a plain square modal - no backdrop blur, no rounding.
 */

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";
import {
  associatedTokenAddress,
  formatUsdc,
  truncateAddress,
  usdcMint,
} from "@/lib/solana";

export function ConnectWallet() {
  const { connection } = useConnection();
  const { publicKey, wallets, select, connect, connected, connecting, disconnect } =
    useWallet();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Keyed by owner so a stale balance from a previously connected wallet can
  // never be displayed against a new one. Storing the owner alongside the value
  // also means the effect never has to setState synchronously just to clear it.
  const [balance, setBalance] = useState<{ owner: string; value: string } | null>(
    null
  );

  // Read the connected wallet's USDC balance. Failures are silent on purpose -
  // an account that does not exist yet is the normal case for a new wallet,
  // not an error worth showing.
  useEffect(() => {
    if (!publicKey) return;
    let cancelled = false;
    const owner = publicKey.toBase58();
    (async () => {
      try {
        const ata = associatedTokenAddress(usdcMint(), publicKey);
        const result = await connection.getTokenAccountBalance(ata);
        if (!cancelled) {
          setBalance({ owner, value: formatUsdc(result.value.amount) });
        }
      } catch {
        if (!cancelled) setBalance({ owner, value: "—" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey, connection]);

  const shownBalance =
    balance && publicKey && balance.owner === publicKey.toBase58()
      ? balance.value
      : null;

  const choose = useCallback(
    async (name: WalletName) => {
      select(name);
      setPickerOpen(false);
      try {
        await connect();
      } catch (error) {
        // A user closing the wallet popup is not an error worth shouting about.
        console.warn("[wallet] connect failed:", error);
      }
    },
    [select, connect]
  );

  if (connected && publicKey) {
    return (
      <button
        type="button"
        onClick={() => void disconnect()}
        title="Disconnect"
        style={chipStyle}
      >
        <span className="data" style={{ fontSize: 12 }}>
          {truncateAddress(publicKey.toBase58())}
        </span>
        <span
          className="data"
          style={{ fontSize: 12, color: "var(--text-muted)" }}
        >
          {shownBalance === null ? "— USDC" : `${shownBalance} USDC`}
        </span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        disabled={connecting}
        style={chipStyle}
      >
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 14 }}>
          {connecting ? "Connecting…" : "Connect wallet"}
        </span>
      </button>

      {pickerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Choose a wallet"
          onClick={() => setPickerOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(28,25,23,0.42)",
            display: "grid",
            placeItems: "center",
            zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--raised)",
              border: "1px solid var(--border-strong)",
              borderRadius: 0,
              padding: 24,
              width: 360,
              maxWidth: "calc(100vw - 32px)",
            }}
          >
            <p className="label" style={{ margin: "0 0 16px" }}>
              Choose a wallet
            </p>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {wallets.map((wallet) => (
                <button
                  key={wallet.adapter.name}
                  type="button"
                  onClick={() => void choose(wallet.adapter.name)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "14px 0",
                    background: "none",
                    border: "none",
                    borderBottom: "1px solid var(--hairline)",
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: 15,
                    color: "var(--text)",
                    textAlign: "left",
                  }}
                >
                  {wallet.adapter.name}
                  <span className="label">
                    {wallet.readyState === "Installed" ? "Detected" : "Not installed"}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-text"
              onClick={() => setPickerOpen(false)}
              style={{ marginTop: 20 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

const chipStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  border: "1px solid var(--border-strong)",
  borderRadius: 2,
  padding: "8px 12px",
  background: "transparent",
  color: "var(--text)",
  cursor: "pointer",
};
