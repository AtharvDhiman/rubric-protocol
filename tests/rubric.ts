/**
 * Rubric program integration tests.
 *
 * Five happy paths and fourteen attack/edge cases. The attack cases are the point:
 * each one must fail, and must fail with the SPECIFIC error we expect. A test
 * that passes because the transaction failed for some unrelated reason is worse
 * than no test at all, so every negative assertion checks the error code by name.
 *
 * Run with:  anchor test
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
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAccount,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import { assert, expect } from "chai";
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
    await expectError(verdictCall(task, true, 91).rpc(), "InvalidState");
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
      "InvalidState"
    );
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

    await expectError(
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
        .rpc(),
      // Anchor rejects this when it re-derives the associated token address and
      // finds the supplied account is not it. The exact code depends on which
      // check fires first; all of these mean "the derivation did not match".
      ["ConstraintAssociated", "ConstraintSeeds", "ConstraintTokenOwner", "AccountNotAssociatedTokenAccount"]
    );

    // The attacker's account never received anything.
    assert.equal(await balanceOf(fakeEscrow), 0);
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
});
