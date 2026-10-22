/**
 * On-chain task ids, and the record numbers people read.
 *
 * WHY THESE ARE NOT THE SAME THING ANY MORE
 * -----------------------------------------
 * A task's PDA is derived from (creator, task_id) and so is its escrow token
 * account. Token accounts can be created by anyone, and creating one is not
 * idempotent inside `create_task`, so an attacker who can GUESS a creator's next
 * task id can pre-create that escrow and make the poster's transaction fail
 * (docs/security-review.md, R-08; reproduced by test 30 in tests/rubric.ts).
 * Every task id used to be `latest + 1`, which is trivially guessable by anyone
 * who can read the public docket.
 *
 * But the id is also what readers see as "MATTER N° 0045", a per-poster running
 * count that means something. Replacing it with a random 64-bit number would
 * trade a Low finding for a worse product.
 *
 * So the id carries both:
 *
 *     task_id  =  (sequence << 24)  |  24 random bits
 *
 * The high bits keep the human sequence; the low 24 bits make the id
 * unguessable. An attacker aiming at one specific next task has a 1 in 16.7
 * million chance per attempt, and every attempt locks a token-account rent
 * (~0.0015 SOL) they can never recover.
 *
 * LEGACY IDS
 * ----------
 * Tasks created before this change have the plain dense ids 1, 2, 3 ... which are
 * all far below 2^24. `recordNumber` treats anything below that as already being
 * a record number, so every existing task keeps the number it always showed.
 * Encoded ids start at (1 << 24), so the two ranges can never be confused.
 *
 * This file is pure on purpose: it is imported by client components for display,
 * so it must not pull in `node:crypto`. The route supplies the random bits.
 */

/** How many low bits of the id are random. */
export const TASK_ID_RANDOM_BITS = 24n;

const RANDOM_MASK = (1n << TASK_ID_RANDOM_BITS) - 1n;

/**
 * Ids below this are legacy dense record numbers. Encoded ids are always at or
 * above it, because the smallest sequence number is 1.
 */
export const LEGACY_ID_LIMIT = 1n << TASK_ID_RANDOM_BITS;

/** The per-poster record number for any id, legacy or encoded. */
export function recordNumber(onchainTaskId: bigint): bigint {
  return onchainTaskId < LEGACY_ID_LIMIT
    ? onchainTaskId
    : onchainTaskId >> TASK_ID_RANDOM_BITS;
}

/**
 * The id for a poster's next task, given their latest existing id (or null if
 * they have none) and 24 random bits from a CSPRNG.
 *
 * Guarantees the caller relies on, each covered by a test:
 *  - the record number is exactly one more than the previous one;
 *  - the result is strictly greater than `latest`, whatever the random bits are,
 *    so `ORDER BY onchainTaskId DESC` still finds the newest task;
 *  - it fits an unsigned 64-bit seed AND a signed 64-bit Postgres bigint.
 */
export function nextOnchainTaskId(latest: bigint | null, random: bigint): bigint {
  const sequence = latest === null ? 1n : recordNumber(latest) + 1n;
  return (sequence << TASK_ID_RANDOM_BITS) | (random & RANDOM_MASK);
}

/** "MATTER N° 0045" - four digits, from either kind of id (or its string form). */
export function formatRecordNumber(onchainTaskId: bigint | string): string {
  return recordNumber(BigInt(onchainTaskId)).toString().padStart(4, "0");
}
