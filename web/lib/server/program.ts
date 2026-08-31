/**
 * Server-side Anchor client.
 *
 * Reads on-chain state and signs the one instruction the server is allowed to
 * sign: `submit_verdict`. The verifier keypair never leaves this process.
 *
 * The IDL is loaded from disk at runtime rather than imported, because it is a
 * build artefact (`anchor build` writes `target/idl/rubric.json`) that does not
 * exist in a fresh checkout. A static import would make the whole app fail to
 * compile before you have ever run the Rust toolchain; this way, the UI works
 * against the database and only the chain-touching routes complain.
 */

import "server-only";

import fs from "node:fs";
import path from "node:path";
import { AnchorProvider, Program, BN, type Idl } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type Commitment,
} from "@solana/web3.js";

import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";

import { rpcUrl } from "../env";
import {
  associatedTokenAddress,
  configPda,
  escrowAddress,
  taskPda,
  TOKEN_PROGRAM_ID,
} from "../solana";
import { getVerifierKeypair } from "./verifier-keypair";

/** Where `npm run sync:idl` puts the built IDL, and the raw build location. */
const IDL_CANDIDATES = [
  path.join(process.cwd(), "lib", "idl", "rubric.json"),
  path.join(process.cwd(), "..", "target", "idl", "rubric.json"),
];

let cachedIdl: Idl | null = null;

export function loadIdl(): Idl {
  if (cachedIdl) return cachedIdl;
  for (const candidate of IDL_CANDIDATES) {
    try {
      // turbopackIgnore: the path is computed at runtime, so the bundler would
      // otherwise trace the whole project into the serverless output. The IDL
      // is a build artefact read from disk on purpose.
      if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
        cachedIdl = JSON.parse(
          fs.readFileSync(/*turbopackIgnore: true*/ candidate, "utf8")
        ) as Idl;
        return cachedIdl;
      }
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(
    "Rubric IDL not found. Run `anchor build` at the repo root, then " +
      "`npm run sync:idl` from web/. Looked in: " +
      IDL_CANDIDATES.join(", ")
  );
}

export function serverConnection(commitment: Commitment = "confirmed"): Connection {
  return new Connection(rpcUrl(), commitment);
}

type SignableTransaction = Transaction | VersionedTransaction;

/**
 * The minimal wallet an AnchorProvider needs.
 *
 * Anchor ships a `Wallet` class, but only its CommonJS build exports it
 * statically - the ESM build attaches it at runtime, so a bundler cannot see it
 * and the build fails. Twelve lines here is a better trade than importing a
 * deep internal path that may move.
 */
class KeypairWallet {
  constructor(readonly payer: Keypair) {}

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }

  async signTransaction<T extends SignableTransaction>(tx: T): Promise<T> {
    if (tx instanceof VersionedTransaction) {
      tx.sign([this.payer]);
    } else {
      tx.partialSign(this.payer);
    }
    return tx;
  }

  async signAllTransactions<T extends SignableTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)));
  }
}

/**
 * An Anchor program handle signed by the verifier keypair.
 *
 * Only ever used for `submit_verdict`. Creating it loads the secret, so do not
 * call it from a route that does not need to sign.
 */
export function verifierProgram(): Program {
  const connection = serverConnection();
  const wallet = new KeypairWallet(getVerifierKeypair());
  const provider = new AnchorProvider(connection, wallet as never, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return new Program(loadIdl(), provider);
}

/** A read-only program handle. Does NOT touch the secret key. */
export function readOnlyProgram(): Program {
  const connection = serverConnection();
  // A wallet that cannot sign. Reads never need to, and making the methods
  // throw means a future code path that accidentally tries to sign with the
  // read-only handle fails loudly instead of silently using the wrong key.
  const provider = new AnchorProvider(
    connection,
    {
      publicKey: PublicKey.default,
      signTransaction: async () => {
        throw new Error("read-only provider cannot sign");
      },
      signAllTransactions: async () => {
        throw new Error("read-only provider cannot sign");
      },
    } as never,
    { commitment: "confirmed" }
  );
  return new Program(loadIdl(), provider);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface OnChainConfig {
  admin: PublicKey;
  verifierAuthority: PublicKey;
  /** The single mint this deployment escrows in. Pinned by `create_task`. */
  bountyMint: PublicKey;
  feeBps: number;
  feeDestination: PublicKey;
}

/**
 * The shape Anchor decodes a Config account into. Declared by hand because the
 * generated types in target/types only exist after `anchor build`, and this
 * module has to compile without them.
 */
interface RawConfigAccount {
  admin: PublicKey;
  verifierAuthority: PublicKey;
  bountyMint: PublicKey;
  feeBps: number;
  feeDestination: PublicKey;
}

interface RawTaskAccount {
  creator: PublicKey;
  taskId: { toString(): string };
  worker: PublicKey | null;
  mint: PublicKey;
  rubricHash: number[];
  submissionHash: number[] | null;
  bountyAmount: { toString(): string };
  deadline: { toString(): string };
  state: Record<string, unknown>;
  verdict: { approved: boolean; confidence: number } | null;
}

/** Anchor's `program.account` namespace is keyed by account name at runtime. */
type AccountNamespace = Record<
  string,
  { fetch(address: PublicKey): Promise<unknown> }
>;

export async function fetchConfig(): Promise<OnChainConfig> {
  const program = readOnlyProgram();
  const accounts = program.account as unknown as AccountNamespace;
  const account = (await accounts.config.fetch(configPda())) as RawConfigAccount;
  return {
    admin: account.admin,
    verifierAuthority: account.verifierAuthority,
    bountyMint: account.bountyMint,
    feeBps: account.feeBps,
    feeDestination: account.feeDestination,
  };
}

export type OnChainTaskState =
  | "open"
  | "submitted"
  | "settled"
  | "refunded"
  | "unknown";

export interface OnChainTask {
  address: PublicKey;
  creator: PublicKey;
  taskId: bigint;
  worker: PublicKey | null;
  mint: PublicKey;
  rubricHashHex: string;
  submissionHashHex: string | null;
  bountyAmount: bigint;
  deadline: number;
  state: OnChainTaskState;
  approved: boolean | null;
  confidence: number | null;
}

function bytesToHex(bytes: number[] | Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function readState(state: Record<string, unknown>): OnChainTaskState {
  const key = Object.keys(state ?? {})[0];
  if (key === "open" || key === "submitted" || key === "settled" || key === "refunded") {
    return key;
  }
  return "unknown";
}

/**
 * Fetch a task from the chain. Returns null if the account does not exist -
 * which is the normal case for a task whose create transaction has not
 * confirmed yet.
 */
export async function fetchTask(
  creator: PublicKey,
  taskId: bigint
): Promise<OnChainTask | null> {
  const program = readOnlyProgram();
  const accounts = program.account as unknown as AccountNamespace;
  const address = taskPda(creator, taskId);
  let account: RawTaskAccount;
  try {
    account = (await accounts.task.fetch(address)) as RawTaskAccount;
  } catch {
    return null;
  }

  return {
    address,
    creator: account.creator,
    taskId: BigInt(account.taskId.toString()),
    worker: account.worker ?? null,
    mint: account.mint,
    rubricHashHex: bytesToHex(account.rubricHash),
    submissionHashHex: account.submissionHash
      ? bytesToHex(account.submissionHash)
      : null,
    bountyAmount: BigInt(account.bountyAmount.toString()),
    deadline: Number(account.deadline.toString()),
    state: readState(account.state),
    approved: account.verdict ? account.verdict.approved : null,
    confidence: account.verdict ? account.verdict.confidence : null,
  };
}

// ---------------------------------------------------------------------------
// The one write the server performs
// ---------------------------------------------------------------------------

/**
 * Sign and send `submit_verdict`.
 *
 * The caller is responsible for having established that the task is genuinely
 * `Submitted` on-chain first - see the idempotency check in the verify route.
 * This function does not decide anything; it transmits a decision.
 */
/**
 * Build idempotent "create this ATA if it is missing" instructions for the three
 * payout destinations.
 *
 * `submit_verdict` requires all three token accounts to exist, on BOTH the
 * approve and reject branches, because Anchor deserializes every account before
 * the handler branches. That is a liveness hazard: a worker who closes their own
 * zero-balance token account after submitting - or an admin who never created
 * the fee destination's account for this mint - makes the task unsettleable, and
 * a task stuck in `Submitted` can only be freed by the grace-period reclaim a
 * week later.
 *
 * ATA creation is permissionless (only the funder signs), so the verifier can
 * simply create any that are missing. Doing it as preInstructions in the SAME
 * transaction is what makes it safe: there is no window in which someone
 * re-closes the account between our check and the verdict.
 *
 * The idempotent variant is a no-op when the account already exists, so this
 * costs one extra instruction and nothing else in the normal case.
 */
function ataPreInstructions(
  payer: PublicKey,
  mint: PublicKey,
  owners: PublicKey[]
) {
  const seen = new Set<string>();
  const instructions = [];
  for (const owner of owners) {
    const key = owner.toBase58();
    if (seen.has(key)) continue;
    seen.add(key);
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        associatedTokenAddress(mint, owner),
        owner,
        mint
      )
    );
  }
  return instructions;
}

export async function sendVerdict(params: {
  creator: PublicKey;
  taskId: bigint;
  worker: PublicKey;
  mint: PublicKey;
  approved: boolean;
  confidence: number;
  reasoningHash: Uint8Array;
}): Promise<string> {
  const program = verifierProgram();
  const config = await fetchConfig();
  const task = taskPda(params.creator, params.taskId);
  const verifier = getVerifierKeypair().publicKey;

  return await program.methods
    .submitVerdict(
      params.approved,
      params.confidence,
      Array.from(params.reasoningHash)
    )
    .accounts({
      verifier,
      config: configPda(),
      task,
      mint: params.mint,
      escrow: escrowAddress(task, params.mint),
      worker: params.worker,
      workerTokenAccount: associatedTokenAddress(params.mint, params.worker),
      creator: params.creator,
      creatorTokenAccount: associatedTokenAddress(params.mint, params.creator),
      feeDestination: config.feeDestination,
      feeDestinationTokenAccount: associatedTokenAddress(
        params.mint,
        config.feeDestination
      ),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(
      ataPreInstructions(verifier, params.mint, [
        params.worker,
        params.creator,
        config.feeDestination,
      ])
    )
    .rpc();
}

/**
 * Verify that a transaction signature really did what the client claims.
 *
 * Used by the confirm endpoints. We never take a client's word that a
 * transaction landed - the whole product is "verify, don't trust", and that has
 * to apply to our own UI too.
 */
export async function transactionSucceeded(
  signature: string
): Promise<{ ok: boolean; reason?: string }> {
  const connection = serverConnection();
  const status = await connection.getSignatureStatus(signature, {
    searchTransactionHistory: true,
  });
  const value = status.value;
  if (!value) return { ok: false, reason: "Transaction not found on this cluster." };
  if (value.err) return { ok: false, reason: "Transaction failed on-chain." };
  const confirmed =
    value.confirmationStatus === "confirmed" ||
    value.confirmationStatus === "finalized";
  if (!confirmed) return { ok: false, reason: "Transaction is not confirmed yet." };
  return { ok: true };
}

export { BN, Transaction };
