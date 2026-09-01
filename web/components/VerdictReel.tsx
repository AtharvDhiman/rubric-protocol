"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The hero motion: a verdict, ruling itself.
 *
 * The previous hero drew an abstract lock mechanism. The metaphor was right —
 * a lever lock cannot throw unless every tumbler aligns, which is exactly
 * "approved only if every clause passes" — but as a drawing it read as a bar
 * chart, and a visual that has to be explained is not doing its job.
 *
 * This shows the product's actual moment instead: a judge reading sealed
 * clauses and ruling on each one, with the reasoning arriving as it decides,
 * then the stamp landing and the escrow releasing. Nothing here is a symbol of
 * the product; it is a replay of one, with real text from a real devnet task.
 *
 * The sequence is deliberately paced like a decision rather than a loading bar:
 * a pause while it reads, then rulings that land one at a time, then a beat
 * before the payout. Motion carries the *order* of events, which is information
 * — a verdict is a sequence, not a state.
 *
 * Under reduced motion, or before hydration, every line is already at its final
 * state: the complete verdict sheet, no cursor, no counting. That is not a
 * degraded version — the sheet is what the sequence is building toward.
 */

interface Ruling {
  n: number;
  clause: string;
  reason: string;
}

// From matter Nº 0006 on devnet, settled at confidence 95.
const RULINGS: Ruling[] = [
  {
    n: 1,
    clause: "Every barcode in the delivered labels is legible and in focus.",
    reason: "Checked at full resolution; all delivered labels are legible.",
  },
  {
    n: 2,
    clause: "Images too blurred to read are excluded rather than guessed at.",
    reason: "9 frames excluded and listed with a reason, not guessed.",
  },
  {
    n: 3,
    clause: "There is exactly one label per image.",
    reason: "Verified with a uniqueness check on image_id.",
  },
];

const PAYOUT = 0.98;

export function VerdictReel() {
  // `step` counts the beats: 0 reading, 1..n rulings, n+1 stamp, n+2 payout.
  const [step, setStep] = useState<number>(RULINGS.length + 2);
  const [paid, setPaid] = useState<number>(PAYOUT);
  const frame = useRef<number>(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timers: number[] = [];

    // Rewind to the start on the next frame rather than synchronously. The
    // component renders the finished sheet first, so a viewer whose JS is slow,
    // blocked or absent sees the complete verdict rather than an empty panel -
    // and scheduling the rewind asynchronously keeps that true through
    // hydration instead of flashing a blank frame.
    timers.push(
      window.setTimeout(() => {
        setStep(0);
        setPaid(0);
      }, 0)
    );
    // Reads for a beat, then rules once per clause, then stamps.
    timers.push(window.setTimeout(() => setStep(1), 900));
    RULINGS.forEach((_, i) => {
      timers.push(window.setTimeout(() => setStep(i + 2), 900 + (i + 1) * 620));
    });

    const settleAt = 900 + RULINGS.length * 620 + 420;
    timers.push(
      window.setTimeout(() => {
        const started = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - started) / 700);
          // Ease out, so the figure decelerates into its final value rather
          // than stopping dead on it.
          setPaid(PAYOUT * (1 - Math.pow(1 - t, 3)));
          if (t < 1) frame.current = requestAnimationFrame(tick);
        };
        frame.current = requestAnimationFrame(tick);
      }, settleAt)
    );

    return () => {
      timers.forEach(clearTimeout);
      cancelAnimationFrame(frame.current);
    };
  }, []);

  const reading = step === 0;
  const stamped = step >= RULINGS.length + 1;

  return (
    <figure className="reel plate--sealed" aria-label="A settled verdict, replayed">
      <div className="reel-head">
        <span className="label">VERDICT · MATTER Nº 0006</span>
        <span className="label reel-conf">
          CONFIDENCE <span className="data">95</span>
        </span>
      </div>

      <ol className="reel-list">
        {RULINGS.map((r, i) => {
          const ruled = step >= i + 2;
          return (
            <li key={r.n} className={`reel-row ${ruled ? "is-ruled" : ""}`}>
              <span className="reel-n data">{r.n}</span>
              <span className="reel-clause">{r.clause}</span>
              <span className="reel-mark data">{ruled ? "PASS" : "—"}</span>
              <span className="reel-reason">{r.reason}</span>
            </li>
          );
        })}
      </ol>

      <div className="reel-foot">
        <span className={`reel-stamp ${stamped ? "is-in" : ""}`} aria-hidden="true">
          APPROVED
        </span>
        <span className="reel-payout">
          <span className="data">{paid.toFixed(2)}</span> USDC released
        </span>
      </div>

      <span className="reel-status label" aria-live="polite">
        {reading ? "READING SEALED CLAUSES…" : "ESCROW RELEASED TO THE WORKER"}
      </span>
    </figure>
  );
}
