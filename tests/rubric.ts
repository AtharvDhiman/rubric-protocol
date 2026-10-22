/**
 * Rubric program integration tests.
 *
 * Five happy paths, and a large set of attack and edge cases. The attack cases are
 * the point: each one must fail, and must fail with the SPECIFIC error we expect.
 * A test that passes because the transaction failed for some unrelated reason is
 * worse than no test at all, so every negative assertion checks the error code by
 * name - except where the defence sits below Anchor's error layer, and then the
 * assertion is that nothing changed.
 *
 * Run with:  anchor test --validator legacy
 *
 *   - `--validator legacy` because anchor-cli 1.x defaults to surfpool, which is
 *     not installed here, and the run dies before a single test with
 *     "Failed to spawn surfpool".
 *   - Anchor.toml must have `[test] upgradeable = true`. `initialize_config` only
 *     accepts the program's upgrade authority, and an immutable test program has
 *     none, so without it the suite dies in `before all` with NotAdmin.
 *
 * ORDER MATTERS. The first `describe` proves the initialize_config refusals, which
 * can only be shown while no Config exists, so it must stay ahead of the main
 * suite, whose `before` hook initialises the protocol.
 *
 * The suite spins up a mock SPL mint with 6 decimals to stand in for USDC, so no
 * devnet faucet or real token is involved.
 */

import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  closeAccount,
  createAccount,
  createAssociatedTokenAccount,
  createAssociatedTokenAccountIdempotentInstruction,
  createAssociatedTokenAccountInstruction,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Rubric } from "../target/types/rubric";

// ---------------------------------------------------------------------------
// Constants mirrored from the program. If you change them in Rust, change them
// here - these are duplicated on purpose so a silent drift shows up as a failure.
// ---------------------------------------------------------------------------
const USDC_DECIMALS = 6;
const ONE_USDC = 1_000_000;
const FEE_BPS = 200; // 2%
const MAX_BOUNTY = 50_000_000; // 50 USDC

const CONFIG_SEED = Buffer.from("config");
const TASK_SEED = Buffer.from("task");

/** Where ProgramData lives, so we can prove the signer is the upgrade authority. */
const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

/** Deterministic non-zero hashes. The program rejects all-zero hashes. */
const RUBRIC_HASH = Array.from({ length: 32 }, (_, i) => (i + 1) % 256);
const SUBMISSION_HASH = Array.from({ length: 32 }, (_, i) => (i + 64) % 256);
const REASONING_HASH = Array.from({ length: 32 }, (_, i) => (i + 128) % 256);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Assert that a transaction fails with a specific Anchor error code NAME.
 * Prints the code it actually got, so a mismatch is immediately diagnosable.
 */
async function expectError(
  promise: Promise<unknown>,
  expectedCode: string | string[]
): Promise<void> {
  const expected = Array.isArray(expectedCode) ? expectedCode : [expectedCode];
  try {
    await promise;
  } catch (err: any) {
    const code =
      err?.error?.errorCode?.code ??
      err?.errorCode?.code ??
      // Constraint failures thrown during simulation land in the logs.
      (String(err?.message ?? err).match(/Error Code: (\w+)/)?.[1] as string) ??
      String(err?.message ?? err);
    assert.include(
      expected,
      code,
      `expected one of [${expected.join(", ")}] but got "${code}"`
    );
    return;
  }
  assert.fail(
    `expected the transaction to fail with ${expected.join(" | ")}, but it succeeded`
  );
}

/**
 * Assert a transaction fails, without pinning the error name.
 *
 * Used only where the defence sits BELOW Anchor's custom-error layer - for
 * example when an account address is derived by the framework, so a
 * substituted account is rejected during account resolution and never reaches
 * a constraint. The security assertion in those tests is the balance/state
 * check that follows, not the error string.
 */
async function expectFailure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err: any) {
    const code =
      err?.error?.errorCode?.code ??
      (String(err?.message ?? err).match(/Error Code: (\w+)/)?.[1] as string) ??
      String(err?.message ?? err).slice(0, 90);
    return code;
  }
  assert.fail("expected the transaction to fail, but it succeeded");
}

/**
 * THE INIT GATE, proved BEFORE the suite initialises anything.
 *
 * `initialize_config` can succeed exactly once per deployment, so its refusals
 * can only be demonstrated while no Config exists yet. Mocha runs `describe`
 * blocks in the order they are defined, so this one runs first and the main
 * suite's `before` hook initialises afterwards.
 *
 * Both tests also assert that the refused attempt left NO account behind. That
 * is not decoration: a refused attempt that still created the config would make
 * the legitimate initialisation below fail for the wrong reason, and would mean
 * the gate had let the land-grab through.
 *
 * Until these existed, nothing in the suite proved that anyone other than the
 * upgrade authority is turned away - the most heavily commented fix in the
 * program was only ever exercised as setup.
 */
describe("rubric: initialize_config gate (runs before setup)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = ((anchor.workspace as any).rubric ??
    (anchor.workspace as any).Rubric) as Program<Rubric>;
  const connection = provider.connection;
  const upgradeAuthority = (provider.wallet as anchor.Wallet).payer;

  const [configPda] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED],
    program.programId
  );
  const [programDataPda] = PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE
  );
  const anyKey = () => Keypair.generate().publicKey;
  const initAccounts = (signer: PublicKey) => ({
    admin: signer,
    config: configPda,
    program: program.programId,
    programData: programDataPda,
    systemProgram: SystemProgram.programId,
  });

  it("20. initialize_config by anyone but the upgrade authority -> NotAdmin, and creates nothing", async () => {
    // A stranger who would install themselves as admin and verifier if the gate
    // were missing. They can pay for the transaction; they must not be allowed.
    const stranger = Keypair.generate();
    const sig = await connection.requestAirdrop(
      stranger.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    const bh = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");

    await expectError(
      program.methods
        .initializeConfig(stranger.publicKey, anyKey(), FEE_BPS, stranger.publicKey)
        .accounts(initAccounts(stranger.publicKey))
        .signers([stranger])
        .rpc(),
      "NotAdmin"
    );

    assert.isNull(
      await connection.getAccountInfo(configPda),
      "the refused attempt must not leave a config behind"
    );
  });

  it("21. initialize_config with a fee above the 10% ceiling -> FeeTooHigh, and creates nothing", async () => {
    // The caller here IS the upgrade authority, so only the fee check can refuse.
    await expectError(
      program.methods
        .initializeConfig(anyKey(), anyKey(), 1_001, anyKey())
        .accounts(initAccounts(upgradeAuthority.publicKey))
        .rpc(),
      "FeeTooHigh"
    );

    assert.isNull(
      await connection.getAccountInfo(configPda),
      "the refused attempt must not leave a config behind"
    );
  });
});

describe("rubric", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Anchor exposes the workspace program under the crate name. Different Anchor
  // versions have used camelCase and PascalCase keys; accept either so the suite
  // is not hostage to that detail.
  const program = ((anchor.workspace as any).rubric ??
    (anchor.workspace as any).Rubric) as Program<Rubric>;

  const connection = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  // Test actors.
  const verifier = Keypair.generate();
  const creator = Keypair.generate();
  const worker = Keypair.generate();
  const attacker = Keypair.generate();
  const feeDestination = Keypair.generate();

  let mint: PublicKey;
  let creatorAta: PublicKey;
  let workerAta: PublicKey;
  let attackerAta: PublicKey;
  let feeAta: PublicKey;
  let configPda: PublicKey;
  let programDataPda: PublicKey;

  /** Monotonic task ids so tests never collide on a PDA. */
  let nextTaskId = 1;
  const newTaskId = () => new BN(nextTaskId++);

  const taskPda = (creatorKey: PublicKey, taskId: BN) =>
    PublicKey.findProgramAddressSync(
      [TASK_SEED, creatorKey.toBuffer(), taskId.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  const escrowFor = (task: PublicKey) =>
    getAssociatedTokenAddressSync(mint, task, true);

  const balanceOf = async (ata: PublicKey) =>
    Number((await getAccount(connection, ata)).amount);

  /** Fund a keypair with SOL so it can pay rent and fees. */
  async function airdrop(to: PublicKey, sol = 2) {
    const sig = await connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
    const bh = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  }

  /** Create an Open, funded task. Returns its PDA and id. */
  async function createTask(opts?: {
    bounty?: number;
    deadlineOffsetSeconds?: number;
    rubricHash?: number[];
  }) {
    const taskId = newTaskId();
    const task = taskPda(creator.publicKey, taskId);
    const now = Math.floor(Date.now() / 1000);
    await program.methods
      .createTask(
        taskId,
        opts?.rubricHash ?? RUBRIC_HASH,
        new BN(opts?.bounty ?? 25 * ONE_USDC),
        new BN(now + (opts?.deadlineOffsetSeconds ?? 3600))
      )
      .accounts({
        creator: creator.publicKey,
        config: configPda,
        task,
        mint,
        creatorTokenAccount: creatorAta,
        escrow: escrowFor(task),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();
    return { taskId, task };
  }

  /** Move a task to Submitted with the default worker. */
  async function submitWork(task: PublicKey, by = worker, ata = workerAta) {
    await program.methods
      .submitWork(SUBMISSION_HASH)
      .accounts({
        worker: by.publicKey,
        task,
        mint,
        workerTokenAccount: ata,
      })
      .signers([by])
      .rpc();
  }

  /** Build a submit_verdict call. Not sent - callers decide how to send it. */
  function verdictCall(
    task: PublicKey,
    approved: boolean,
    confidence: number,
    signer = verifier
  ) {
    return program.methods
      .submitVerdict(approved, confidence, REASONING_HASH)
      .accounts({
        verifier: signer.publicKey,
        config: configPda,
        task,
        mint,
        escrow: escrowFor(task),
        worker: worker.publicKey,
        workerTokenAccount: workerAta,
        creator: creator.publicKey,
        creatorTokenAccount: creatorAta,
        feeDestination: feeDestination.publicKey,
        feeDestinationTokenAccount: feeAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([signer]);
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------
  before(async () => {
    await Promise.all([
      airdrop(creator.publicKey, 5),
      airdrop(worker.publicKey),
      airdrop(attacker.publicKey),
      airdrop(verifier.publicKey),
    ]);

    // Mock USDC: 6 decimals, admin is the mint authority.
    mint = await createMint(
      connection,
      admin,
      admin.publicKey,
      null,
      USDC_DECIMALS
    );

    creatorAta = await createAssociatedTokenAccount(
      connection,
      admin,
      mint,
      creator.publicKey
    );
    workerAta = await createAssociatedTokenAccount(
      connection,
      admin,
      mint,
      worker.publicKey
    );
    attackerAta = await createAssociatedTokenAccount(
      connection,
      admin,
      mint,
      attacker.publicKey
    );
    feeAta = await createAssociatedTokenAccount(
      connection,
      admin,
      mint,
      feeDestination.publicKey
    );

    // Give the poster plenty of test USDC.
    await mintTo(connection, admin, mint, creatorAta, admin, 10_000 * ONE_USDC);

    [configPda] = PublicKey.findProgramAddressSync(
      [CONFIG_SEED],
      program.programId
    );
    [programDataPda] = PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE
    );

    // The signer must be the program's upgrade authority. Under `anchor test`
    // that is the provider wallet, which deployed the program.
    await program.methods
      .initializeConfig(
        verifier.publicKey,
        mint,
        FEE_BPS,
        feeDestination.publicKey
      )
      .accounts({
        admin: admin.publicKey,
        config: configPda,
        program: program.programId,
        programData: programDataPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const config = await program.account.config.fetch(configPda);
    assert.equal(config.verifierAuthority.toBase58(), verifier.publicKey.toBase58());
    assert.equal(config.bountyMint.toBase58(), mint.toBase58());
    assert.equal(config.feeBps, FEE_BPS);
  });

  // =========================================================================
  // HAPPY PATHS
  // =========================================================================

  it("1. create_task locks the exact bounty into escrow", async () => {
    const bounty = 25 * ONE_USDC;
    const before = await balanceOf(creatorAta);

    const { task, taskId } = await createTask({ bounty });

    const escrowBalance = await balanceOf(escrowFor(task));
    assert.equal(escrowBalance, bounty, "escrow holds exactly the bounty");
    assert.equal(
      await balanceOf(creatorAta),
      before - bounty,
      "poster was debited exactly the bounty"
    );

    const account = await program.account.task.fetch(task);
    assert.equal(account.bountyAmount.toNumber(), bounty);
    assert.equal(account.taskId.toNumber(), taskId.toNumber());
    assert.deepEqual(account.rubricHash, RUBRIC_HASH, "sealed hash is recorded");
    assert.isNull(account.worker, "no worker yet");
    assert.deepEqual(Object.keys(account.state), ["open"]);

    // The escrow's authority must be the Task PDA - not the creator, not us.
    const escrowAccount = await getAccount(connection, escrowFor(task));
    assert.equal(escrowAccount.owner.toBase58(), task.toBase58());
  });

  it("2. submit_work moves the task from Open to Submitted", async () => {
    const { task } = await createTask();
    await submitWork(task);

    const account = await program.account.task.fetch(task);
    assert.deepEqual(Object.keys(account.state), ["submitted"]);
    assert.equal(account.worker.toBase58(), worker.publicKey.toBase58());
    assert.deepEqual(account.submissionHash, SUBMISSION_HASH);
  });

  it("3. an approved verdict pays the worker and the fee destination", async () => {
    const bounty = 25 * ONE_USDC;
    const expectedFee = (bounty * FEE_BPS) / 10_000; // 0.5 USDC
    const expectedPayout = bounty - expectedFee; // 24.5 USDC

    const { task } = await createTask({ bounty });
    await submitWork(task);

    const workerBefore = await balanceOf(workerAta);
    const feeBefore = await balanceOf(feeAta);

    await verdictCall(task, true, 96).rpc();

    assert.equal(
      (await balanceOf(workerAta)) - workerBefore,
      expectedPayout,
      "worker received bounty minus fee"
    );
    assert.equal(
      (await balanceOf(feeAta)) - feeBefore,
      expectedFee,
      "fee destination received the fee"
    );

    const account = await program.account.task.fetch(task);
    assert.deepEqual(Object.keys(account.state), ["settled"]);
    assert.isTrue(account.verdict.approved);
    assert.equal(account.verdict.confidence, 96);
    assert.deepEqual(account.verdict.reasoningHash, REASONING_HASH);

    // The escrow account is closed once settled.
    assert.isNull(await connection.getAccountInfo(escrowFor(task)));
  });

  it("4. a rejected verdict refunds the poster in full, with no fee taken", async () => {
    const bounty = 10 * ONE_USDC;
    const { task } = await createTask({ bounty });
    await submitWork(task);

    const creatorBefore = await balanceOf(creatorAta);
    const feeBefore = await balanceOf(feeAta);
    const workerBefore = await balanceOf(workerAta);

    await verdictCall(task, false, 88).rpc();

    assert.equal(
      (await balanceOf(creatorAta)) - creatorBefore,
      bounty,
      "poster got the entire bounty back"
    );
    assert.equal(await balanceOf(feeAta), feeBefore, "no fee on a rejection");
    assert.equal(await balanceOf(workerAta), workerBefore, "worker got nothing");

    const account = await program.account.task.fetch(task);
    assert.deepEqual(Object.keys(account.state), ["refunded"]);
    assert.isFalse(account.verdict.approved);
  });

  it("5. reclaim_expired refunds the poster after the deadline with no submission", async () => {
    const bounty = 5 * ONE_USDC;
    const { task } = await createTask({ bounty, deadlineOffsetSeconds: 2 });

    // Wait for the work window to close. The validator clock tracks wall time.
    await sleep(5000);

    const before = await balanceOf(creatorAta);
    await program.methods
      .reclaimExpired()
      .accounts({
        creator: creator.publicKey,
        task,
        mint,
        escrow: escrowFor(task),
        creatorTokenAccount: creatorAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([creator])
      .rpc();

    assert.equal((await balanceOf(creatorAta)) - before, bounty);
    const account = await program.account.task.fetch(task);
    assert.deepEqual(Object.keys(account.state), ["refunded"]);
    assert.isNull(await connection.getAccountInfo(escrowFor(task)));
  });

  // =========================================================================
  // ATTACK / EDGE CASES - these must fail, with the right error
  // =========================================================================

  it("6. a random keypair cannot submit a verdict -> NotVerifierAuthority", async () => {
    const { task } = await createTask();
    await submitWork(task);

    // The attacker signs their own verdict, approving their own payout.
    await expectError(
      verdictCall(task, true, 100, attacker).rpc(),
      "NotVerifierAuthority"
    );

    // And the money is still exactly where it was.
    const account = await program.account.task.fetch(task);
    assert.deepEqual(Object.keys(account.state), ["submitted"]);
    assert.equal(await balanceOf(escrowFor(task)), 25 * ONE_USDC);
  });

  it("7. submit_verdict twice on the same task -> InvalidState", async () => {
    const { task } = await createTask();
    await submitWork(task);
    await verdictCall(task, true, 91).rpc();

    // Second ruling on a Settled task. Settled is terminal.
    //
    // Note which error actually fires: settling CLOSES the escrow token
    // account, so the second attempt fails at account validation
    // (AccountNotInitialized) before the handler's state check is reached.
    // That is a stronger guarantee than InvalidState, not a weaker one - there
    // is no escrow account left to drain. The state check stays as defence in
    // depth. Both outcomes are acceptable; silently settling twice is not.
    await expectError(verdictCall(task, true, 91).rpc(), [
      "InvalidState",
      "AccountNotInitialized",
    ]);

    // The property that actually matters.
    const account = await program.account.task.fetch(task);
    assert.deepEqual(Object.keys(account.state), ["settled"]);
    assert.isNull(
      await connection.getAccountInfo(escrowFor(task)),
      "escrow must stay closed"
    );
  });

  it("8. submit_work on an already-Submitted task -> InvalidState", async () => {
    const { task } = await createTask();
    await submitWork(task);

    await expectError(submitWork(task, attacker, attackerAta), "InvalidState");
  });

  it("9. submit_work after the deadline -> DeadlinePassed", async () => {
    const { task } = await createTask({ deadlineOffsetSeconds: 2 });
    await sleep(5000);

    await expectError(submitWork(task), "DeadlinePassed");
  });

  it("10. create_task with bounty_amount = 0 -> AmountZero", async () => {
    const taskId = newTaskId();
    const task = taskPda(creator.publicKey, taskId);
    const now = Math.floor(Date.now() / 1000);

    await expectError(
      program.methods
        .createTask(taskId, RUBRIC_HASH, new BN(0), new BN(now + 3600))
        .accounts({
          creator: creator.publicKey,
          config: configPda,
          task,
          mint,
          creatorTokenAccount: creatorAta,
          escrow: escrowFor(task),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc(),
      "AmountZero"
    );
  });

  it("11. a verdict with confidence = 150 -> ConfidenceOutOfRange", async () => {
    const { task } = await createTask();
    await submitWork(task);

    // confidence is a u8 on the wire, so 150 is representable and must be
    // rejected by the program's own range check rather than by serialization.
    await expectError(verdictCall(task, true, 150).rpc(), "ConfidenceOutOfRange");
  });

  it("12. reclaim_expired before the deadline -> DeadlineNotPassed", async () => {
    const { task } = await createTask({ deadlineOffsetSeconds: 3600 });

    await expectError(
      program.methods
        .reclaimExpired()
        .accounts({
          creator: creator.publicKey,
          task,
          mint,
          escrow: escrowFor(task),
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([creator])
        .rpc(),
      "DeadlineNotPassed"
    );
  });

  it("13. reclaim_expired on a Settled task -> InvalidState", async () => {
    const { task } = await createTask({ deadlineOffsetSeconds: 2 });
    await submitWork(task);
    await verdictCall(task, true, 90).rpc();

    // Past the deadline AND settled. The state check must win.
    await sleep(5000);

    await expectError(
      program.methods
        .reclaimExpired()
        .accounts({
          creator: creator.publicKey,
          task,
          mint,
          escrow: escrowFor(task),
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([creator])
        .rpc(),
      // As in test 7: the escrow was closed when the task settled, so account
      // validation rejects this before the state check. Either error means the
      // creator cannot claw back an already-settled bounty.
      ["InvalidState", "AccountNotInitialized"]
    );

    const account = await program.account.task.fetch(task);
    assert.deepEqual(Object.keys(account.state), ["settled"]);
  });

  it("14. an attacker cannot pass their own token account as the escrow", async () => {
    const taskId = newTaskId();
    const task = taskPda(creator.publicKey, taskId);
    const now = Math.floor(Date.now() / 1000);

    // A token account the attacker owns outright, offered in place of the
    // program-derived escrow. If this ever succeeds, the bounty is deposited
    // straight into the attacker's wallet while the task looks funded.
    const fakeEscrow = await createAccount(
      connection,
      attacker,
      mint,
      attacker.publicKey,
      Keypair.generate()
    );

    // The substitution cannot even be expressed. Anchor DERIVES the escrow
    // address from (task, mint) rather than trusting what the client sends, so
    // the program looks for the canonical ATA, does not find it among the
    // supplied accounts, and aborts during account resolution - it never gets
    // as far as a named constraint error. Observed:
    //   "Instruction references an unknown account <derived ATA>"
    // so this asserts the failure and then the property that matters.
    const code = await expectFailure(
      program.methods
        .createTask(taskId, RUBRIC_HASH, new BN(ONE_USDC), new BN(now + 3600))
        .accounts({
          creator: creator.publicKey,
          config: configPda,
          task,
          mint,
          creatorTokenAccount: creatorAta,
          escrow: fakeEscrow,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc()
    );
    assert.isString(code);

    // THE SECURITY ASSERTIONS: the attacker got nothing, and no task exists.
    assert.equal(await balanceOf(fakeEscrow), 0, "attacker account must stay empty");
    assert.isNull(
      await connection.getAccountInfo(task),
      "no task account may have been created"
    );
  });

  // =========================================================================
  // EXTRA GUARDS - not in the original 14, but cheap and they cover the
  // constants the security review depends on.
  // =========================================================================

  it("15. create_task above MAX_BOUNTY -> AmountTooLarge", async () => {
    const taskId = newTaskId();
    const task = taskPda(creator.publicKey, taskId);
    const now = Math.floor(Date.now() / 1000);

    await expectError(
      program.methods
        .createTask(
          taskId,
          RUBRIC_HASH,
          new BN(MAX_BOUNTY + 1),
          new BN(now + 3600)
        )
        .accounts({
          creator: creator.publicKey,
          config: configPda,
          task,
          mint,
          creatorTokenAccount: creatorAta,
          escrow: escrowFor(task),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc(),
      "AmountTooLarge"
    );
  });

  it("16. create_task with an all-zero rubric hash -> EmptyHash", async () => {
    const taskId = newTaskId();
    const task = taskPda(creator.publicKey, taskId);
    const now = Math.floor(Date.now() / 1000);

    await expectError(
      program.methods
        .createTask(
          taskId,
          new Array(32).fill(0),
          new BN(ONE_USDC),
          new BN(now + 3600)
        )
        .accounts({
          creator: creator.publicKey,
          config: configPda,
          task,
          mint,
          creatorTokenAccount: creatorAta,
          escrow: escrowFor(task),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc(),
      "EmptyHash"
    );
  });

  it("17. a stranger cannot reclaim someone else's expired task", async () => {
    const { task } = await createTask({ deadlineOffsetSeconds: 2 });
    await sleep(5000);

    await expectError(
      program.methods
        .reclaimExpired()
        .accounts({
          creator: attacker.publicKey,
          task,
          mint,
          escrow: escrowFor(task),
          creatorTokenAccount: attackerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([attacker])
        .rpc(),
      ["CreatorMismatch", "ConstraintSeeds", "ConstraintHasOne"]
    );
  });

  it("19. a Submitted task cannot be reclaimed before the grace period", async () => {
    // The escape hatch out of Submitted opens a week after the deadline. Before
    // that, the worker still has a claim and only the verifier may resolve it.
    const { task } = await createTask({ deadlineOffsetSeconds: 2 });
    await submitWork(task);
    await sleep(5000); // past the deadline, nowhere near the grace period

    await expectError(
      program.methods
        .reclaimExpired()
        .accounts({
          creator: creator.publicKey,
          task,
          mint,
          escrow: escrowFor(task),
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([creator])
        .rpc(),
      "DeadlineNotPassed"
    );

    // Still Submitted, still funded.
    const account = await program.account.task.fetch(task);
    assert.deepEqual(Object.keys(account.state), ["submitted"]);
    assert.equal(await balanceOf(escrowFor(task)), 25 * ONE_USDC);
  });

  it("18. only the admin can rotate the verifier authority", async () => {
    await expectError(
      program.methods
        .setVerifierAuthority(attacker.publicKey)
        .accounts({ admin: attacker.publicKey, config: configPda })
        .signers([attacker])
        .rpc(),
      "NotAdmin"
    );

    const config = await program.account.config.fetch(configPda);
    assert.equal(
      config.verifierAuthority.toBase58(),
      verifier.publicKey.toBase58(),
      "verifier authority is unchanged"
    );
  });

  // =========================================================================
  // GUARDS THE ORIGINAL SUITE NEVER EXERCISED
  //
  // Each of these is a constraint the program's own comments call the fix for a
  // real bug, and until now each could have been deleted without a single test
  // failing. See docs/security-review.md, finding R-06.
  // =========================================================================

  /**
   * A create_task call with every account defaulted. Tests override only the one
   * thing they attack, so a failure can be attributed to that thing alone.
   */
  function createTaskCall(
    opts: {
      deadline?: number;
      bounty?: number;
      /** Swap the whole token context for another mint, consistently. */
      otherMint?: { mint: PublicKey; creatorAta: PublicKey };
    } = {}
  ) {
    const taskId = newTaskId();
    const task = taskPda(creator.publicKey, taskId);
    const now = Math.floor(Date.now() / 1000);
    const m = opts.otherMint?.mint ?? mint;
    return {
      taskId,
      task,
      call: program.methods
        .createTask(
          taskId,
          RUBRIC_HASH,
          new BN(opts.bounty ?? ONE_USDC),
          new BN(opts.deadline ?? now + 3600)
        )
        .accounts({
          creator: creator.publicKey,
          config: configPda,
          task,
          mint: m,
          creatorTokenAccount: opts.otherMint?.creatorAta ?? creatorAta,
          escrow: getAssociatedTokenAddressSync(m, task, true),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator]),
    };
  }

  /** A submit_verdict call with every account defaulted and the ones under attack overridable. */
  function verdictCallWith(
    task: PublicKey,
    approved: boolean,
    overrides: Partial<{
      worker: PublicKey;
      workerTokenAccount: PublicKey;
      creator: PublicKey;
      creatorTokenAccount: PublicKey;
      feeDestination: PublicKey;
      feeDestinationTokenAccount: PublicKey;
    }> = {}
  ) {
    return program.methods
      .submitVerdict(approved, 95, REASONING_HASH)
      .accounts({
        verifier: verifier.publicKey,
        config: configPda,
        task,
        mint,
        escrow: escrowFor(task),
        worker: overrides.worker ?? worker.publicKey,
        workerTokenAccount: overrides.workerTokenAccount ?? workerAta,
        creator: overrides.creator ?? creator.publicKey,
        creatorTokenAccount: overrides.creatorTokenAccount ?? creatorAta,
        feeDestination: overrides.feeDestination ?? feeDestination.publicKey,
        feeDestinationTokenAccount:
          overrides.feeDestinationTokenAccount ?? feeAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([verifier]);
  }

  /** After a refused verdict the task must be exactly as it was: Submitted and funded. */
  async function assertStillSubmittedAndFunded(task: PublicKey, funded: number) {
    const account = await program.account.task.fetch(task);
    assert.deepEqual(Object.keys(account.state), ["submitted"]);
    assert.equal(await balanceOf(escrowFor(task)), funded);
  }

  it("22. initialize_config cannot run a second time, and the config is unchanged", async () => {
    const before = await program.account.config.fetch(configPda);

    // Fails below Anchor's error layer (the account already exists), so the
    // security assertion is that nothing changed, not the error string.
    await expectFailure(
      program.methods
        .initializeConfig(attacker.publicKey, mint, FEE_BPS, attacker.publicKey)
        .accounts({
          admin: admin.publicKey,
          config: configPda,
          program: program.programId,
          programData: programDataPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc()
    );

    const after = await program.account.config.fetch(configPda);
    assert.equal(after.admin.toBase58(), before.admin.toBase58());
    assert.equal(
      after.verifierAuthority.toBase58(),
      before.verifierAuthority.toBase58()
    );
    assert.equal(
      after.feeDestination.toBase58(),
      before.feeDestination.toBase58()
    );
  });

  it("23. create_task with a deadline in the past -> DeadlineInPast", async () => {
    const { task, call } = createTaskCall({
      deadline: Math.floor(Date.now() / 1000) - 10,
    });
    await expectError(call.rpc(), "DeadlineInPast");
    assert.isNull(await connection.getAccountInfo(task), "no task was created");
  });

  it("24. create_task with a deadline beyond the 30-day window -> DeadlineTooFar", async () => {
    const thirtyOneDays = 31 * 24 * 60 * 60;
    const { task, call } = createTaskCall({
      deadline: Math.floor(Date.now() / 1000) + thirtyOneDays,
    });
    await expectError(call.rpc(), "DeadlineTooFar");
    assert.isNull(await connection.getAccountInfo(task), "no task was created");
  });

  it("25. create_task with any mint but the configured one -> MintMismatch", async () => {
    // A consistent, fully-funded context for a DIFFERENT mint, so that the only
    // thing that can refuse the call is the pin on config.bounty_mint. This is
    // the constraint that makes MAX_BOUNTY mean 50 USDC and not 50 million of a
    // token the attacker minted.
    const otherMint = await createMint(
      connection,
      admin,
      admin.publicKey,
      null,
      0 // a 0-decimal mint: "50_000_000 base units" would be 50 million tokens
    );
    const otherAta = await createAssociatedTokenAccount(
      connection,
      admin,
      otherMint,
      creator.publicKey
    );
    await mintTo(connection, admin, otherMint, otherAta, admin, 1_000_000);

    const { task, call } = createTaskCall({
      bounty: 1_000_000,
      otherMint: { mint: otherMint, creatorAta: otherAta },
    });
    await expectError(call.rpc(), "MintMismatch");

    assert.isNull(await connection.getAccountInfo(task), "no task was created");
    assert.equal(await balanceOf(otherAta), 1_000_000, "the other token never moved");
  });

  it("26. a verdict naming a different worker -> WorkerMismatch", async () => {
    // The payout must go to whoever `submit_work` recorded, and nobody else.
    const { task } = await createTask();
    await submitWork(task);
    // Compared against its own starting balance, not zero: if this guard ever
    // fails, the attack succeeds and leaves funds behind, which must not make the
    // NEXT tests fail for a reason that is not theirs.
    const attackerBefore = await balanceOf(attackerAta);

    await expectError(
      verdictCallWith(task, true, {
        worker: attacker.publicKey,
        workerTokenAccount: attackerAta,
      }).rpc(),
      "WorkerMismatch"
    );

    await assertStillSubmittedAndFunded(task, 25 * ONE_USDC);
    assert.equal(await balanceOf(attackerAta), attackerBefore, "the attacker was not paid");
  });

  it("27. a verdict naming a different creator -> CreatorMismatch", async () => {
    // A refund must go to the poster recorded at creation, not to whoever the
    // transaction builder names.
    const { task } = await createTask();
    await submitWork(task);
    const attackerBefore = await balanceOf(attackerAta);

    await expectError(
      verdictCallWith(task, false, {
        creator: attacker.publicKey,
        creatorTokenAccount: attackerAta,
      }).rpc(),
      "CreatorMismatch"
    );

    await assertStillSubmittedAndFunded(task, 25 * ONE_USDC);
    assert.equal(
      await balanceOf(attackerAta),
      attackerBefore,
      "the attacker was not refunded"
    );
  });

  it("28. a verdict naming a different fee destination -> FeeDestinationMismatch", async () => {
    // "Fees cannot be diverted, not even by the verifier." Prove it.
    const { task } = await createTask();
    await submitWork(task);
    const attackerBefore = await balanceOf(attackerAta);

    await expectError(
      verdictCallWith(task, true, {
        feeDestination: attacker.publicKey,
        feeDestinationTokenAccount: attackerAta,
      }).rpc(),
      "FeeDestinationMismatch"
    );

    await assertStillSubmittedAndFunded(task, 25 * ONE_USDC);
    assert.equal(await balanceOf(attackerAta), attackerBefore, "the attacker took no fee");
  });

  it("29. a Task account is exactly 239 bytes (layout guard)", async () => {
    // Changing Task's layout orphans every task already on chain: the new struct
    // would no longer deserialise them. This turns that from something a refactor
    // does by accident into something a person has to decide to do.
    const { task } = await createTask({ bounty: 5 * ONE_USDC });
    const info = await connection.getAccountInfo(task);
    assert.equal(info!.data.length, 239);
    assert.equal(
      info!.lamports,
      await connection.getMinimumBalanceForRentExemption(239),
      "rent-exempt, to the lamport"
    );
  });

  // =========================================================================
  // KNOWN HAZARDS - characterisation tests.
  //
  // These assert behaviour that is UNDESIRABLE but currently true, so that the
  // day someone fixes it the suite says so instead of staying quietly green.
  // If one of these starts failing because a hazard was removed, delete the test
  // and update docs/security-review.md in the same change. Do not "fix the test".
  // =========================================================================

  it("30. KNOWN HAZARD (R-08): a pre-created escrow account blocks create_task for that id", async () => {
    const taskId = newTaskId();
    const task = taskPda(creator.publicKey, taskId);
    const escrow = escrowFor(task);

    // All an attacker needs is the PDA address: a pure function of the creator's
    // key and the task id. They create the escrow's token account first.
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        createAssociatedTokenAccountInstruction(
          attacker.publicKey,
          escrow,
          task,
          mint
        )
      ),
      [attacker]
    );
    const tokenAccountRent = await connection.getMinimumBalanceForRentExemption(165);
    assert.equal(
      (await connection.getAccountInfo(escrow))!.lamports,
      tokenAccountRent,
      "the attacker locked exactly one token-account rent"
    );

    const before = await balanceOf(creatorAta);
    await expectFailure(
      program.methods
        .createTask(
          taskId,
          RUBRIC_HASH,
          new BN(10 * ONE_USDC),
          new BN(Math.floor(Date.now() / 1000) + 3600)
        )
        .accounts({
          creator: creator.publicKey,
          config: configPda,
          task,
          mint,
          creatorTokenAccount: creatorAta,
          escrow,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc()
    );

    assert.isNull(await connection.getAccountInfo(task), "no task exists");
    assert.equal(await balanceOf(creatorAta), before, "creator funds untouched");
  });

  it("31. KNOWN HAZARD (R-04): a worker who closes their own USDC account blocks even a REJECTION; the verifier's workaround pays rent the worker then recovers", async () => {
    const poster = Keypair.generate();
    const griefer = Keypair.generate();
    await Promise.all([airdrop(poster.publicKey), airdrop(griefer.publicKey)]);
    const posterAta = await createAssociatedTokenAccount(
      connection,
      admin,
      mint,
      poster.publicKey
    );
    const grieferAta = await createAssociatedTokenAccount(
      connection,
      admin,
      mint,
      griefer.publicKey
    );
    await mintTo(connection, admin, mint, posterAta, admin, 100 * ONE_USDC);

    const taskId = newTaskId();
    const task = taskPda(poster.publicKey, taskId);
    await program.methods
      .createTask(
        taskId,
        RUBRIC_HASH,
        new BN(10 * ONE_USDC),
        new BN(Math.floor(Date.now() / 1000) + 3600)
      )
      .accounts({
        creator: poster.publicKey,
        config: configPda,
        task,
        mint,
        creatorTokenAccount: posterAta,
        escrow: escrowFor(task),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([poster])
      .rpc();
    await submitWork(task, griefer, grieferAta);

    // The worker claims the task, then closes their own (empty) account.
    await closeAccount(connection, griefer, grieferAta, griefer.publicKey, griefer);

    const rejection = () =>
      verdictCallWith(task, false, {
        worker: griefer.publicKey,
        workerTokenAccount: grieferAta,
        creator: poster.publicKey,
        creatorTokenAccount: posterAta,
      });

    // 1. As the program stands, even a REJECTION reverts - and a rejection never
    //    touches the worker's account at all.
    await expectError(rejection().rpc(), "AccountNotInitialized");
    assert.deepEqual(
      Object.keys((await program.account.task.fetch(task)).state),
      ["submitted"]
    );

    // 2. What web/lib/server/program.ts does about it: recreate the account in
    //    the SAME transaction, paid for by the verifier.
    const rent = await connection.getMinimumBalanceForRentExemption(165);
    const verifierBefore = await connection.getBalance(verifier.publicKey);
    await rejection()
      .preInstructions([
        createAssociatedTokenAccountIdempotentInstruction(
          verifier.publicKey,
          grieferAta,
          griefer.publicKey,
          mint
        ),
      ])
      .rpc();
    const verifierSpent =
      verifierBefore - (await connection.getBalance(verifier.publicKey));
    assert.equal(await balanceOf(posterAta), 100 * ONE_USDC, "poster refunded");
    assert.isAtLeast(verifierSpent, rent, "the verifier paid the rent");

    // 3. The worker closes the recreated account again and keeps the rent.
    const grieferBefore = await connection.getBalance(griefer.publicKey);
    await closeAccount(connection, griefer, grieferAta, griefer.publicKey, griefer);
    const grieferGained =
      (await connection.getBalance(griefer.publicKey)) - grieferBefore;
    assert.isAtLeast(
      grieferGained,
      rent - 10_000,
      "the worker recovered the rent, less one transaction fee"
    );
  });

  // =========================================================================
  // set_fee_destination (review finding R-03)
  // =========================================================================

  /** set_fee_destination, signed by the admin (the provider wallet) unless told otherwise. */
  function setFeeDestinationCall(newDestination: PublicKey, signer?: Keypair) {
    const call = program.methods
      .setFeeDestination(newDestination)
      .accounts({
        admin: (signer ?? admin).publicKey,
        config: configPda,
      });
    return signer ? call.signers([signer]) : call;
  }

  /**
   * Put the fee destination back if a test left it changed.
   *
   * These tests mutate the shared Config. If a guard they exercise is ever broken,
   * the attack succeeds and the destination really does change - and every later
   * test would then fail for a reason that is not its own. Restoring in `finally`
   * keeps one broken guard from reading as several.
   */
  async function restoreFeeDestination() {
    const config = await program.account.config.fetch(configPda);
    if (config.feeDestination.toBase58() !== feeDestination.publicKey.toBase58()) {
      await setFeeDestinationCall(feeDestination.publicKey).rpc();
    }
  }

  it("32. only the admin can change the fee destination -> NotAdmin", async () => {
    const before = await program.account.config.fetch(configPda);

    try {
      await expectError(
        setFeeDestinationCall(attacker.publicKey, attacker).rpc(),
        "NotAdmin"
      );

      const after = await program.account.config.fetch(configPda);
      assert.equal(
        after.feeDestination.toBase58(),
        before.feeDestination.toBase58(),
        "the fee destination is unchanged"
      );
    } finally {
      await restoreFeeDestination();
    }
  });

  it("33. the fee destination cannot be set to the all-zero key -> InvalidFeeDestination", async () => {
    // What an uninitialised client field looks like. Fees paid to it would be
    // unrecoverable, so a typo must not be able to burn the protocol's revenue.
    try {
      await expectError(
        setFeeDestinationCall(PublicKey.default).rpc(),
        "InvalidFeeDestination"
      );
      const config = await program.account.config.fetch(configPda);
      assert.equal(config.feeDestination.toBase58(), feeDestination.publicKey.toBase58());
    } finally {
      await restoreFeeDestination();
    }
  });

  it("34. after set_fee_destination, fees are paid to the NEW wallet and the old one is refused", async () => {
    // The scenario this exists for: the account fees go to has become unusable
    // (e.g. frozen), and without this every approval would revert.
    const newFee = Keypair.generate();
    const newFeeAta = await createAssociatedTokenAccount(
      connection,
      admin,
      mint,
      newFee.publicKey
    );
    const before = await program.account.config.fetch(configPda);

    await setFeeDestinationCall(newFee.publicKey).rpc();
    try {
      const after = await program.account.config.fetch(configPda);
      assert.equal(after.feeDestination.toBase58(), newFee.publicKey.toBase58());
      // Nothing else moved: this instruction must touch the one field.
      assert.equal(after.admin.toBase58(), before.admin.toBase58());
      assert.equal(after.verifierAuthority.toBase58(), before.verifierAuthority.toBase58());
      assert.equal(after.bountyMint.toBase58(), before.bountyMint.toBase58());
      assert.equal(after.feeBps, before.feeBps);

      // An approval now pays the fee to the new wallet.
      const bounty = 20 * ONE_USDC;
      const expectedFee = (bounty * FEE_BPS) / 10_000;
      const { task } = await createTask({ bounty });
      await submitWork(task);
      const newBefore = await balanceOf(newFeeAta);
      const oldBefore = await balanceOf(feeAta);
      await verdictCallWith(task, true, {
        feeDestination: newFee.publicKey,
        feeDestinationTokenAccount: newFeeAta,
      }).rpc();
      assert.equal(await balanceOf(newFeeAta), newBefore + expectedFee, "new wallet got the fee");
      assert.equal(await balanceOf(feeAta), oldBefore, "old wallet got nothing");

      // And the OLD destination is now refused, so nobody can keep paying it.
      const { task: second } = await createTask();
      await submitWork(second);
      await expectError(verdictCallWith(second, true).rpc(), "FeeDestinationMismatch");
    } finally {
      // Restore, so the rest of the suite is unaffected even if an assertion above fails.
      await restoreFeeDestination();
    }
    const restored = await program.account.config.fetch(configPda);
    assert.equal(restored.feeDestination.toBase58(), feeDestination.publicKey.toBase58());
  });

  it("35. every error code that existed at first deploy keeps its number", async () => {
    // Anchor numbers errors from 6000 in declaration order, and those numbers are
    // part of the deployed ABI: the web app, explorers and any client see them.
    // New errors must be APPENDED. Inserting one above an existing variant
    // silently renumbers everything beneath it and nothing else would notice.
    const firstDeploy = [
      "FeeTooHigh",
      "AmountZero",
      "AmountTooLarge",
      "MathOverflow",
      "EscrowUnderfunded",
      "DeadlineInPast",
      "DeadlineTooFar",
      "DeadlinePassed",
      "DeadlineNotPassed",
      "InvalidState",
      "NotVerifierAuthority",
      "NotAdmin",
      "WorkerMismatch",
      "CreatorMismatch",
      "MissingWorker",
      "ConfidenceOutOfRange",
      "EmptyHash",
      "MintMismatch",
      "FeeDestinationMismatch",
    ];
    // Read the generated IDL FILE, not `program.idl`: Anchor's TS client re-cases
    // names on the in-memory copy, and the file is the artefact that is actually
    // published and synced into web/lib/idl.
    const errors = JSON.parse(
      readFileSync(join(process.cwd(), "target", "idl", "rubric.json"), "utf8")
    ).errors as Array<{ code: number; name: string }>;
    firstDeploy.forEach((name, index) => {
      const found = errors.find((e) => e.name === name);
      assert.isDefined(found, `${name} is missing from the IDL`);
      assert.equal(found!.code, 6000 + index, `${name} must stay at ${6000 + index}`);
    });
    // And nothing sits inside the original range that is not one of them.
    const inRange = errors.filter((e) => e.code < 6000 + firstDeploy.length);
    assert.equal(inRange.length, firstDeploy.length);
  });

  // =========================================================================
  // THE GRACE-PERIOD ESCAPE HATCH (review finding R-07)
  //
  // reclaim_expired out of `Submitted` is what stops a lost verifier key freezing
  // every escrow. Its failure path (test 19) was tested; its SUCCESS path never
  // was, because the grace period is a 7-day constant and the validator's clock
  // cannot be moved mid-test. A build with `--features short-grace` shortens it to
  // six seconds, and RUBRIC_SHORT_GRACE=1 tells the suite it is running against
  // one. See `npm run test:grace`.
  // =========================================================================

  it("36. the short-grace feature is OFF by default and enables nothing else", async () => {
    // A binary built with short-grace lets a poster reclaim a bounty seconds after
    // the deadline from work the verifier has not ruled on yet. It exists only so
    // the suite can run the escape hatch to completion, and it must be impossible
    // to turn on by accident: not a default, and not pulled in by another feature.
    const cargo = readFileSync(
      join(process.cwd(), "programs", "rubric", "Cargo.toml"),
      "utf8"
    );
    const featuresBlock = cargo.split(/^\[features\]\s*$/m)[1]?.split(/^\[/m)[0];
    assert.isString(featuresBlock, "Cargo.toml has a [features] table");

    const live = featuresBlock!
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"));
    const mentions = live.filter((line) => line.includes("short-grace"));
    assert.deepEqual(
      mentions.map((l) => l.trim()),
      ["short-grace = []"],
      "short-grace appears once, as an empty feature, and nowhere else"
    );
    const defaults = /^default\s*=\s*\[(.*?)\]/m.exec(featuresBlock!);
    assert.isNotNull(defaults, "there is a default feature list");
    assert.notInclude(defaults![1], "short-grace");
  });

  /** reclaim_expired by the creator. */
  const reclaimCall = (task: PublicKey) =>
    program.methods
      .reclaimExpired()
      .accounts({
        creator: creator.publicKey,
        task,
        mint,
        escrow: escrowFor(task),
        creatorTokenAccount: creatorAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([creator]);

  /**
   * Reclaim, and turn the one confusing failure into a clear one: if the suite was
   * told it is running against a short-grace build but the program was built the
   * normal way, the reclaim fails with DeadlineNotPassed. That is a harness
   * mistake, not a program bug, and it should say so.
   */
  async function reclaimOrExplain(task: PublicKey) {
    try {
      await reclaimCall(task).rpc();
    } catch (err: any) {
      const code = err?.error?.errorCode?.code ?? String(err?.message ?? err);
      if (String(code).includes("DeadlineNotPassed")) {
        assert.fail(
          "RUBRIC_SHORT_GRACE=1 but the grace period has not elapsed: was the " +
            "program built WITHOUT `--features short-grace`? Use `npm run test:grace`."
        );
      }
      throw err;
    }
  }

  const graceIt = process.env.RUBRIC_SHORT_GRACE === "1" ? it : it.skip;

  graceIt("37. [short-grace build] reclaim_expired releases a Submitted task once the grace period has passed", async () => {
    const bounty = 25 * ONE_USDC;
    const { task } = await createTask({ bounty, deadlineOffsetSeconds: 2 });
    await submitWork(task);
    const creatorBefore = await balanceOf(creatorAta);
    const workerBefore = await balanceOf(workerAta);

    // deadline (2s) + grace (6s) + margin for the validator's slot-time lag.
    await sleep(2_000 + 6_000 + 4_000);
    await reclaimOrExplain(task);

    assert.equal(
      await balanceOf(creatorAta),
      creatorBefore + bounty,
      "the poster got the whole bounty back"
    );
    assert.equal(await balanceOf(workerAta), workerBefore, "the worker was not paid");
    assert.isNull(
      await connection.getAccountInfo(escrowFor(task)),
      "the escrow was closed"
    );
    const account = await program.account.task.fetch(task);
    assert.deepEqual(Object.keys(account.state), ["refunded"]);
    assert.isNull(
      account.verdict,
      "nobody ruled, and the record must not pretend someone did"
    );
  });

  graceIt("38. [short-grace build] a verdict that arrives after a grace-period reclaim is refused and the worker is not paid", async () => {
    // The price of verifier downtime, made explicit: once the poster has
    // reclaimed, the task is terminal and the worker's approval comes too late.
    const { task } = await createTask({ deadlineOffsetSeconds: 2 });
    await submitWork(task);
    await sleep(2_000 + 6_000 + 4_000);
    await reclaimOrExplain(task);

    const workerBefore = await balanceOf(workerAta);
    // The escrow no longer exists, so the failure may surface as the missing
    // account before the handler's own InvalidState check is reached. Either way
    // nothing may be paid.
    await expectError(verdictCall(task, true, 95).rpc(), [
      "AccountNotInitialized",
      "InvalidState",
    ]);
    assert.equal(await balanceOf(workerAta), workerBefore, "the worker was not paid");
    assert.deepEqual(
      Object.keys((await program.account.task.fetch(task)).state),
      ["refunded"]
    );
  });

  it("39. a verdict still settles a task whose deadline has passed, inside the grace window", async () => {
    // reclaim_expired's own comments promise this - "submit_verdict has no
    // deadline check, so the verifier can still rule normally at any point inside
    // the grace window" - and it is the property that makes the grace period safe
    // for the worker. It was never tested. 4s is past the 2s deadline and inside
    // the window in BOTH builds (6s short, 7 days normal).
    const bounty = 25 * ONE_USDC;
    const { task } = await createTask({ bounty, deadlineOffsetSeconds: 2 });
    await submitWork(task);
    await sleep(4_000);

    const workerBefore = await balanceOf(workerAta);
    const feeBefore = await balanceOf(feeAta);
    await verdictCall(task, true, 95).rpc();

    const fee = (bounty * FEE_BPS) / 10_000;
    assert.equal(await balanceOf(workerAta), workerBefore + bounty - fee, "worker paid");
    assert.equal(await balanceOf(feeAta), feeBefore + fee, "fee paid");
    assert.deepEqual(
      Object.keys((await program.account.task.fetch(task)).state),
      ["settled"]
    );
  });
});
