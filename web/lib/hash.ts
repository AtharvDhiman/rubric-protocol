/**
 * Canonical rubric hashing.
 *
 * THIS FILE IS LOAD-BEARING. The 32 bytes produced here are written into the
 * `Task` PDA at seal time and are the entire basis of the promise that the
 * acceptance criteria did not change after work started. The verifier reads the
 * clauses back out of the database and re-derives this hash; if the two do not
 * match, the task is not judged at all.
 *
 * Therefore: the SAME function must run at create time and at verify time, and
 * its output must never change once tasks exist on-chain. If you need to change
 * the canonical format, bump CANONICAL_VERSION and keep the old path around for
 * existing tasks.
 *
 * ---------------------------------------------------------------------------
 * THE CANONICAL FORM (version 1)
 * ---------------------------------------------------------------------------
 *
 * Given { title, clauses }:
 *
 *  1. Every string is Unicode-normalized to NFC. ("é" typed as e+U+0301 and "é"
 *     as U+00E9 look identical and must hash identically.)
 *  2. CRLF and lone CR are converted to LF, so a rubric drafted on Windows and
 *     the same rubric drafted on macOS produce the same hash.
 *  3. Every run of whitespace inside a string collapses to a single space, and
 *     the string is then trimmed. A clause is one requirement; internal line
 *     breaks and double spaces are formatting, not meaning.
 *  4. Clauses that are empty after step 3 are dropped.
 *  5. The result is serialized as JSON with keys in a FIXED order:
 *       {"v":1,"title":<title>,"clauses":[<clause>,...]}
 *
 * Step 5 deviates from the original spec, which said to join clauses with "\n".
 * That was rejected deliberately: if clauses are joined with a newline, a poster
 * can write a single clause containing a newline and produce a canonical string
 * identical to a two-clause rubric. JSON string escaping makes clause boundaries
 * unforgeable, which is the property we actually need. The order is written out
 * explicitly rather than relying on `JSON.stringify` key ordering, because
 * insertion order is an implementation detail and this must never drift.
 */

import { sha256 } from "@noble/hashes/sha2.js";

/** Bump this if the canonical format ever changes. It is inside the hash. */
export const CANONICAL_VERSION = 1;

/** Limits mirrored by the UI and validated again server-side. */
export const MAX_CLAUSES = 8;
export const MAX_CLAUSE_LENGTH = 280;
export const MAX_TITLE_LENGTH = 120;

export interface Rubric {
  title: string;
  clauses: string[];
}

/**
 * Steps 1-3 above, applied to a single string.
 * Exported so the UI can show the user exactly what their text will become.
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Produce the exact string that gets hashed. This is what the confirmation
 * modal on /create displays to the user before they sign - what they see here
 * is byte-for-byte what the chain commits to.
 */
export function canonicalizeRubric(rubric: Rubric): string {
  const title = normalizeText(rubric.title);
  const clauses = rubric.clauses
    .map(normalizeText)
    .filter((clause) => clause.length > 0);

  // Written literally, in this order, on purpose. Do not refactor into an
  // object literal that "happens to" serialize the same way.
  return (
    "{" +
    `"v":${CANONICAL_VERSION},` +
    `"title":${JSON.stringify(title)},` +
    `"clauses":${JSON.stringify(clauses)}` +
    "}"
  );
}

/** SHA-256 over UTF-8 bytes. Synchronous, and identical in Node and browsers. */
export function sha256Bytes(input: string): Uint8Array {
  return sha256(new TextEncoder().encode(input));
}

/** The 32 bytes written to the Task PDA. */
export function hashRubric(rubric: Rubric): Uint8Array {
  return sha256Bytes(canonicalizeRubric(rubric));
}

/** Lowercase hex, no 0x prefix. The form stored in Postgres and shown in the UI. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error("Not a hex string");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Convenience: the rubric hash as hex, which is how it travels over the API. */
export function hashRubricHex(rubric: Rubric): string {
  return toHex(hashRubric(rubric));
}

/**
 * Hash of a worker's deliverable. Same normalization discipline as the rubric so
 * that a resubmission of identical content produces an identical hash, but the
 * content itself is NOT collapsed - whitespace can be meaningful in a deliverable
 * (code, tables), so only line endings and Unicode form are normalized.
 */
export function hashSubmission(content: string): Uint8Array {
  const normalized = content.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  return sha256Bytes(`{"v":${CANONICAL_VERSION},"submission":${JSON.stringify(normalized)}}`);
}

export function hashSubmissionHex(content: string): string {
  return toHex(hashSubmission(content));
}

/**
 * Hash of the published verdict JSON. Recorded on-chain as `reasoning_hash` so
 * the public reasoning cannot be quietly edited after settlement.
 *
 * The verdict object is serialized with sorted keys at every level so that two
 * structurally identical verdicts always hash the same.
 */
export function hashVerdict(verdict: unknown): Uint8Array {
  return sha256Bytes(stableStringify(verdict));
}

export function hashVerdictHex(verdict: unknown): string {
  return toHex(hashVerdict(verdict));
}

/** JSON.stringify with object keys sorted at every depth. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** Shape check used by both the API and the UI before anything is hashed. */
export function validateRubric(rubric: Rubric): string[] {
  const problems: string[] = [];
  const title = normalizeText(rubric.title);
  const clauses = rubric.clauses.map(normalizeText).filter((c) => c.length > 0);

  if (title.length === 0) problems.push("A title is required.");
  if (title.length > MAX_TITLE_LENGTH)
    problems.push(`Title is over ${MAX_TITLE_LENGTH} characters.`);
  if (clauses.length === 0) problems.push("At least one clause is required.");
  if (clauses.length > MAX_CLAUSES)
    problems.push(`No more than ${MAX_CLAUSES} clauses.`);
  clauses.forEach((clause, i) => {
    if (clause.length > MAX_CLAUSE_LENGTH)
      problems.push(`Clause ${i + 1} is over ${MAX_CLAUSE_LENGTH} characters.`);
  });
  return problems;
}
