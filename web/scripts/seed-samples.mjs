/**
 * Seed the sample docket into a real database.
 *
 * The deployed site had a working database but nothing in it, so every screen
 * that matters — the ledger, the verdict sheet — was an empty state. This puts
 * the same five sample records from lib/demo.ts into Postgres so the deployment
 * actually demonstrates something.
 *
 * WHY THESE ARE NOT REAL TASKS
 * ----------------------------
 * A genuinely real record would mean sealing a rubric on devnet, which needs
 * devnet USDC, which needs Circle's faucet. Until that wallet is funded, these
 * are examples and are labelled as such everywhere they appear: a SAMPLE badge
 * on every docket row, a notice across the top of the task sheet, and a line
 * above the ledger. Their ids keep the `demo-` prefix, which is what
 * `isSampleTask()` keys off — cuid() never produces that, so a real task cannot
 * be mistaken for one of these, or the reverse.
 *
 * That labelling is not decoration. Rubric's whole claim is that what you see is
 * what was sealed on-chain; a row that looked like a settled task with no escrow
 * behind it would be exactly the lie the protocol exists to prevent.
 *
 * Idempotent — upserts by id, so running it twice changes nothing.
 *
 *   npx tsx scripts/seed-samples.mjs            # uses DATABASE_URL
 *   DATABASE_SCHEMA=rubric npx tsx scripts/seed-samples.mjs
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { demoTasks } from "../lib/demo.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const schema = process.env.DATABASE_SCHEMA || "public";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }, { schema }),
});

const tasks = demoTasks();
console.log(`Seeding ${tasks.length} sample records into schema "${schema}".`);

let created = 0;
let updated = 0;

for (const task of tasks) {
  const existing = await prisma.task.findUnique({ where: { id: task.id } });
  const data = {
    onchainTaskId: task.onchainTaskId,
    creatorAddress: task.creatorAddress,
    workerAddress: task.workerAddress,
    title: task.title,
    clauses: task.clauses,
    rubricHash: task.rubricHash,
    bountyAmount: task.bountyAmount,
    mint: task.mint,
    deadline: task.deadline,
    category: task.category,
    state: task.state,
    txCreate: task.txCreate,
    txSubmit: task.txSubmit,
    txSettle: task.txSettle,
    submissionContent: task.submissionContent,
    submissionHash: task.submissionHash,
    submittedAt: task.submittedAt,
    verdictJson: task.verdictJson ?? undefined,
    verdictReasoningHash: task.verdictReasoningHash,
    confidence: task.confidence,
    heldReason: task.heldReason,
    decidedAt: task.decidedAt,
  };

  await prisma.task.upsert({
    where: { id: task.id },
    create: { id: task.id, ...data },
    update: data,
  });

  if (existing) updated++;
  else created++;
  console.log(`  ${existing ? "updated" : "created"}  ${task.state.padEnd(9)} ${task.title}`);
}

const total = await prisma.task.count();
console.log(`\n${created} created, ${updated} updated. ${total} rows in the table.`);

await prisma.$disconnect();
