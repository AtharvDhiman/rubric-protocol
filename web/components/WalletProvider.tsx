"use client";

/**
 * Wallet plumbing. Phantom and Solflare, cluster from the environment.
 *
 * We deliberately do NOT use @solana/wallet-adapter-react-ui or its stylesheet -
 * shipping that CSS would drop a generic purple modal into a design system that
 * has exactly two motifs. The connect control is ours, in <ConnectWallet>.
 */

import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider as AdapterWalletProvider,
} from "@solana/wallet-adapter-react";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { rpcUrl } from "@/lib/env";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(() => rpcUrl(), []);
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      {/* autoConnect reconnects a previously approved wallet without a prompt. */}
      <AdapterWalletProvider wallets={wallets} autoConnect>
        {children}
      </AdapterWalletProvider>
    </ConnectionProvider>
  );
}
