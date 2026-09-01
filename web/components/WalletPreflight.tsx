"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import { solanaCluster, usdcMintString } from "@/lib/env";

/**
 * Tells someone what is wrong with their wallet BEFORE they click the button.
 *
 * Every one of these was hit for real, and each failed in a way that pointed
 * somewhere other than the cause:
 *
 *   - Wallet on mainnet while the app is on devnet. The address is valid on
 *     both networks and looks identical, so the wallet shows an empty balance
 *     and no warning whatsoever. It reads as "my funds are gone".
 *   - No SOL for the fee. The signature simply fails, and the error surfaces
 *     from deep in the RPC layer rather than saying "you need SOL".
 *   - No USDC when trying to post. The seal transaction fails at the token
 *     transfer, long after the person has written their clauses.
 *
 * A zero balance cannot distinguish "wrong network" from "not funded" - both
 * look the same from here - so the copy names both and gives the fix for each,
 * rather than guessing and being confidently wrong half the time.
 */

/** Enough for a fee plus an associated token account's rent, with headroom. */
const MIN_SOL = 0.01;

export function WalletPreflight({
  needsUsdc = false,
}: {
  /** Posting work moves a bounty, so it needs USDC as well as SOL. */
  needsUsdc?: boolean;
}) {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  // Balances are stored WITH the wallet they belong to. Resetting them on a
  // wallet change would mean calling setState synchronously inside the effect;
  // tagging them instead means a reading from a previous wallet simply does not
  // match, and is never rendered.
  const [reading, setReading] = useState<{
    owner: string;
    sol: number | null;
    usdc: number | null;
  } | null>(null);

  useEffect(() => {
    if (!publicKey) return;
    const owner = publicKey.toBase58();
    let cancelled = false;

    (async () => {
      let solBalance: number | null = null;
      let usdcBalance: number | null = null;
      try {
        solBalance = (await connection.getBalance(publicKey)) / 1e9;
      } catch {
        solBalance = null;
      }
      if (needsUsdc) {
        try {
          const mint = usdcMintString();
          usdcBalance = mint
            ? Number(
                (
                  await getAccount(
                    connection,
                    getAssociatedTokenAddressSync(new PublicKey(mint), publicKey)
                  )
                ).amount
              ) / 1e6
            : null;
        } catch {
          // No token account yet is a zero balance, for our purposes.
          usdcBalance = 0;
        }
      }
      if (!cancelled) setReading({ owner, sol: solBalance, usdc: usdcBalance });
    })();

    return () => {
      cancelled = true;
    };
  }, [connection, publicKey, needsUsdc]);

  if (!connected || !publicKey) return null;

  // Only trust a reading taken for the wallet that is connected right now.
  const current =
    reading && reading.owner === publicKey.toBase58() ? reading : null;
  if (!current) return null;

  const lowSol = current.sol !== null && current.sol < MIN_SOL;
  const noUsdc = needsUsdc && current.usdc !== null && current.usdc <= 0;
  if (!lowSol && !noUsdc) return null;

  const cluster = solanaCluster();

  return (
    <div
      role="status"
      style={{
        border: "1px solid var(--warning)",
        background: "var(--surface)",
        padding: "14px 16px",
        marginTop: 16,
      }}
    >
      <p
        className="label"
        style={{ color: "var(--warning)", margin: 0 }}
      >
        THIS WALLET CANNOT COMPLETE THE TRANSACTION YET
      </p>

      <ul
        style={{
          margin: "10px 0 0",
          paddingLeft: 18,
          fontSize: 14,
          lineHeight: 1.6,
          color: "var(--text-2)",
        }}
      >
        {lowSol && (
          <li>
            It holds{" "}
            <span className="data">{current.sol?.toFixed(4) ?? "0"}</span> SOL on{" "}
            {cluster}, and needs about {MIN_SOL} for the network fee.{" "}
            <a
              href="https://faucet.solana.com"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)", textDecoration: "underline" }}
            >
              Get {cluster} SOL
            </a>
            .
          </li>
        )}
        {noUsdc && (
          <li>
            It holds no USDC on {cluster}, and posting a task transfers the
            bounty into escrow.{" "}
            <a
              href="https://faucet.circle.com"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)", textDecoration: "underline" }}
            >
              Get {cluster} USDC
            </a>
            .
          </li>
        )}
        <li>
          If you believe you already funded it, check your wallet is set to{" "}
          <strong>{cluster}</strong> — in Phantom, Settings → Developer Settings →
          Testnet Mode. An address looks the same on every network, so a wallet
          on the wrong one shows an empty balance and no warning.
        </li>
      </ul>
    </div>
  );
}
