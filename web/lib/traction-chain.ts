/**
 * Reading the traction inputs from the chain.
 *
 * Takes the Anchor program as a PARAMETER rather than building one, for two reasons: the
 * script and the /stats page each build their own read-only handle (the page's lives in
 * the server-only module, the script's must not import it), and a parameter can be faked
 * in a test without a validator.
 *
 * Read-only. Nothing here signs, sends or needs a key.
 */

import { PublicKey } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import { clusterOf, type Cluster } from "./init-plan";
import {
  buildTractionReport,
  taskRecordFromAccount,
  type RawTaskAccount,
  type TaskRecord,
  type TractionReport,
} from "./traction";

/** The slice of an Anchor `Program` this reads. */
export interface TractionProgram {
  programId: PublicKey;
  account: {
    task: { all(): Promise<Array<{ publicKey: PublicKey; account: unknown }>> };
    config: { fetch(address: PublicKey): Promise<unknown> };
  };
}

interface RawConfig {
  bountyMint: { toBase58(): string };
  feeBps: number;
}

/** Where and when the numbers came from, so anyone can reproduce them. */
export interface Provenance {
  programId: string;
  cluster: Cluster;
  genesisHash: string;
  slot: number;
  /** ISO-8601, from the reader's clock. */
  fetchedAt: string;
}

export interface TractionResult {
  report: TractionReport;
  records: TaskRecord[];
}

/** The `Config` PDA: `[b"config"]`. */
export function configAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

/**
 * Read every Task account and the deployment's Config, and build the report.
 *
 * `getProgramAccounts` returns the accounts the program owns that match the Task
 * discriminator. That is all of them, in any state, which is the point: settled and
 * refunded tasks are never closed, so the chain is a complete record.
 */
export async function loadTractionReport(
  program: TractionProgram,
  options: { teamWallets?: readonly string[] } = {}
): Promise<TractionResult> {
  let config: RawConfig;
  try {
    config = (await program.account.config.fetch(configAddress(program.programId))) as RawConfig;
  } catch {
    // Not an RPC detail worth passing on, and RPC messages can carry an API key.
    throw new Error(
      "Could not read the program's Config. Either the program is not initialised on this cluster, or the RPC endpoint failed."
    );
  }

  const accounts = await program.account.task.all();
  const records = accounts.map((a) => taskRecordFromAccount(a.account as RawTaskAccount));

  const report = buildTractionReport(records, {
    mint: config.bountyMint.toBase58(),
    feeBps: config.feeBps,
    teamWallets: options.teamWallets,
  });
  return { report, records };
}

/** Which cluster this is (by genesis hash, never by URL), and the slot it was read at. */
export async function readProvenance(connection: Connection, programId: PublicKey): Promise<Provenance> {
  const [genesisHash, slot] = await Promise.all([connection.getGenesisHash(), connection.getSlot("confirmed")]);
  return {
    programId: programId.toBase58(),
    cluster: clusterOf(genesisHash),
    genesisHash,
    slot,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Is this anything other than mainnet? Fails CLOSED: an unrecognised genesis hash is
 * "unknown", and unknown is not mainnet, so it is treated as test funds. Nothing here
 * should ever present non-mainnet numbers as traction.
 */
export const isTestNetwork = (p: Pick<Provenance, "cluster">): boolean => p.cluster !== "mainnet";
