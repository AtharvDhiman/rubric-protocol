# Writing clauses a judge can actually rule on

The clause hash and the bounty lock into the task's PDA in the same transaction, before any
work starts. From that moment nobody can rewrite the criteria — not the poster, not the
worker, not the operator of the site ([README](../README.md#if-you-are-posting-work)). A vague
clause therefore cannot be repaired later; the ruling it produces is the ruling you get. This
page is what "Be specific" in the README means in practice, and every number in it is quoted
from the code rather than from memory.

## 1. The judge reads two things, and nothing else

It receives the sealed title and clauses, and the pasted submission
([`web/lib/verifier.ts`](../web/lib/verifier.ts)). The system prompt puts the limit plainly:

> You receive text and nothing else. You cannot open files, download attachments, follow
> links, run code or view images.

The worker's wallet address travels alongside the submission as metadata, and the prompt tells
the judge it has no bearing on the merits. Everything inside the submission is fenced by a
per-request random delimiter and treated as data rather than instruction, so a submission
cannot talk its way past a clause — and it cannot fetch anything either.

Two consequences decide how you write:

**A clause that depends on material the judge cannot see cannot be checked.** If the clause
turns on a repository, a design file, a screenshot or a URL, the judge has none of it. It is
instructed not to fail work because a file or link is not inline, so such a clause is not
decided on the evidence — it is decided on how convincing the prose about that evidence
sounds. The fix is to make the clause ask for the evidence: name what the submission must
contain, so the worker pastes it in. The README says the same thing from the worker's side:
what you write is what it rules on.

**What no clause mentions is not judged.** The judge is instructed not to invent criteria: if
nothing in the sealed list requires something, that part passes, and the concern is noted in
the summary instead. Sloppiness, lateness, tone and anything else you noticed but did not seal
are outside the contract.

## 2. The limits ([`web/lib/hash.ts`](../web/lib/hash.ts))

| Limit | Value | Constant |
| --- | --- | --- |
| Title | 120 characters | `MAX_TITLE_LENGTH` |
| Clauses per task | 8 | `MAX_CLAUSES` |
| Clause | 280 characters | `MAX_CLAUSE_LENGTH` |

Four things about how those numbers are counted:

- **After normalisation, not as you typed it.** Every string is Unicode-normalised to NFC,
  line endings become `\n`, every run of whitespace collapses to a single space, and the string
  is trimmed (`normalizeText`). What is measured is the length of that result, and collapsing
  whitespace can only make a clause shorter than what is in the box.
- **Empty clauses are dropped.** A clause containing only spaces or line breaks disappears
  entirely, and the remaining ones are what gets hashed — so a set of "8" can silently become
  7. The confirmation modal prints the canonical string, and a clause that was only whitespace
  is simply not in it.
- **A character is a JavaScript character.** The check is `clause.length > 280`, which counts
  UTF-16 code units: an emoji counts as two, and a rare lone surrogate is one.
- **The whole budget is 8 × 280 = 2,240 characters plus a 120-character title.** That is the
  entire contract between you and the worker. `validateRubric` states these exact limits in its
  error messages, the create screen runs it before you can seal, and the confirmation modal
  then shows the canonical text and its SHA-256 — the last moment anything can change.

Two consequences for writing: **one requirement per clause**, because the ruling is pass or
fail on the clause as a whole and there is no partial credit; and **do not spend characters on
preamble**, because a clause that explains itself instead of demanding evidence is a clause the
judge can only answer from the prose.

## 3. How a ruling becomes a payment ([`web/lib/verifier.ts`](../web/lib/verifier.ts))

- The judge returns **one ruling per clause, in clause order**: `passed: true` or `false`, plus
  one sentence citing the specific thing in the submission that drove the decision. An index
  missing, repeated or out of range holds the task instead of settling it.
- **Approved only if every clause passed.** The model's own `approved` flag is recomputed from
  the per-clause table rather than taken on trust; if the two disagree, the task is held rather
  than settled either way.
- **A rejection must cite a failed clause** with a non-empty reason. A rejection that cannot
  point at one is held.
- **Confidence is 0–100 and gates settlement.** Below the threshold — `DEFAULT_CONFIDENCE_THRESHOLD`
  is **70**, overridable by `CONFIDENCE_THRESHOLD` — the task is held for a human, and this
  applies to rejections as much as approvals. A held task moves **no money in either
  direction** until someone rules on it.
- If the judge could not be asked at all (quota, timeout, the service being down), the task is
  held as **not a ruling**: no verdict and no confidence are recorded, and it can be judged
  again later.
- On an approval the escrow releases to the worker minus the **2% protocol fee**; on a
  rejection the poster is refunded **in full** ([README](../README.md)). If a held task is never
  ruled on, the poster can reclaim the bounty after the deadline plus seven days, whatever the
  merit of the work.

This is the machinery a clause is written for. Note what it does not contain: a partial score,
a negotiation, or a second look once a verdict has landed.

## 4. What is checkable in text, and what is not

The dividing line is simple: **a checkable clause names something the submission contains;
an uncheckable one names something the world is like.**

| Checkable in the submission | Not checkable by the judge |
| --- | --- |
| "lists numbered reproduction steps" | "the bug is real" |
| "quotes the exact error text" | "the translation is idiomatic" |
| "gives a total count labelled and excluded" | "the labels are correct" |
| "shows the exact command in a code block" | "the link works" |
| "quotes each paragraph above its translation" | "the design is good" |

The first column is a property of the text you will receive. The second is a claim about
something outside it, which the judge can only take on trust from the same prose it is meant to
verify. A poster should not rely on the second column, and a worker should not be surprised
when it does not carry weight.

Section 1 of [launch-plan.md](launch-plan.md) reaches the same conclusion from the niche
side, and lists three illustrative clause sets. All three are rewritten below, with a fourth
that is not.

## 5. Four worked examples

Each has a weak set that a reasonable poster would write first, and a set that can be ruled on
from the submission alone.

### A. Translate a docs page into Spanish

**Weak**

1. The translation is accurate and natural.
2. Nothing from the page is left out.
3. The result reads like it was written in Spanish.

Clause 1 and 3 are quality judgements about a text the judge does not have; clause 2 asks about
a page it cannot open. All three can only be answered from the worker's own account of the
work.

**Better**

1. The submission quotes each English paragraph, then gives its Spanish translation directly below it.
2. Every paragraph of the original appears; none is skipped or merged.
3. Product names, code snippets and commands are left in English and unchanged.

Clause 1 is the load-bearing one: it moves the original into the submission, which is what makes
clauses 2 and 3 checkable at all. Whether the Spanish is *idiomatic* is still not established —
nothing here can establish that — but completeness, ordering and untouched code strings are.

### B. Report a bug

**Weak**

1. The bug is real and worth fixing.
2. The report is clear and easy to act on.
3. It includes whatever a developer would need.

"The bug is real" is a claim about the world, and it is the most common clause to write and the
least checkable. The other two cannot fail anything, because nothing in them says what the
submission must contain.

**Better**

1. The submission lists numbered steps that reproduce the problem from a clean start.
2. It states what was expected and what happened instead.
3. It quotes the exact error text or output.
4. It names the version and environment.

Every one of these is a yes-or-no about the text. Whether the reproduction really reproduces
the defect remains outside the protocol — what the judge can check is that the report gives a
developer everything in this list.

### C. Label a batch

**Weak**

1. Every image is labelled correctly.
2. Anything ambiguous is handled sensibly.
3. The final report is accurate and complete.

Clause 1 needs the images; clause 2 is undefined; clause 3 does not say what the report must
contain.

**Better**

1. The submission lists every item with the label it was given.
2. Items that could not be labelled are listed separately with a reason, not guessed at.
3. It ends with the total count labelled and the total count excluded.

Correctness against the source images is still not checkable — the images are not in the
submission. What becomes checkable is the property that matters most in practice: nothing was
silently dropped, nothing was guessed, and the totals add up.

### D. Write a how-to

**Weak**

1. The guide is clear and easy to follow.
2. It covers the whole process end to end.
3. A beginner could follow it without getting stuck.

Three clauses, none of which names a thing the submission must contain.

**Better**

1. The full text of the how-to is in the submission, not a link to it.
2. The steps are a numbered list of at least 6, each beginning with a verb.
3. Every step that needs a command shows the exact command in a code block.
4. It states the versions, operating system and date it was written for.

Clause 1 prevents the failure mode of section 1 outright: the deliverable is the submission, so
there is no file for the judge to be unable to open. The rest are counts, structures and stated
facts — all readable in the text.

## 6. The checklist, before you seal

Ask these of every clause:

1. **Can the judge see this in the submission?** If it needs a file, a link, a screenshot or a
   repository, rewrite it so the submission must contain the evidence instead.
2. **Does it name something the submission contains, rather than something the world is like?**
3. **Reading only this clause, would the worker know exactly what to paste?** If not, the
   worker cannot guess either.
4. **Is it one requirement with one answer?** Split clauses joined by "and"; the ruling is
   pass or fail per clause.
5. **Is it inside the limits?** 8 clauses, 280 characters each after whitespace collapses, a
   120-character title — and no clause you intended to write that is only whitespace, because
   it will be dropped before hashing.
6. **Is anything you care about missing entirely?** If you did not seal it, it will not be
   judged, and it will pass by default.
7. **Read the set as a worker would** and ask: does the submission this implies contain
   everything you would need to say "yes, paid" without opening anything?

## What this guide does not promise

A clause that can be seen in the submission bounds the argument — it says what must be in front
of the judge, not what the judge will conclude from it. The judge is a language model reading
prose and, as the README's [Known limitations](../README.md#known-limitations) state plainly,
it can be wrong. Nothing a poster writes changes that; a checkable clause set only makes sure
the disagreement, if there is one, is about the text rather than about something nobody put in
front of anyone.
