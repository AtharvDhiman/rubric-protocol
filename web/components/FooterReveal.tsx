"use client";

import { Children, useEffect, useRef, type ReactNode } from "react";

/**
 * Scroll-progress reveal for the footer.
 *
 * The blocks are tied to HOW FAR the footer has entered the viewport rather
 * than to a trigger that fires once. That single change is what makes the
 * effect reversible: scroll toward the footer and it comes in and darkens,
 * scroll away and it goes back out the way it came, at whatever speed the
 * reader is actually moving.
 *
 * WHY PROGRESS AND NOT A TRIGGER
 * ------------------------------
 * This replaces a binary arm/release. A trigger can only play forwards - it
 * fires once, tears its listeners down, and the footer is finished for the life
 * of the page. Reversing it would mean a second trigger for the other
 * direction, then a third state for "changed direction mid-way", and the two
 * would fight over which one owns the element. A progress value has no states
 * to disagree about: there is one number, the scroll position decides it, and
 * every direction falls out of it for free.
 *
 * WHAT DRIVES THE SPEED
 * ---------------------
 * Two things, and only one of them is the obvious one.
 *
 * The progress RAMP - ENTER_AT to SETTLE_AT - decides where in the scroll the
 * travel is spent. It is not the speed control, and assuming it was is a trap
 * worth naming: this footer is the last thing on the page, so its top only
 * travels from one screen down to zero, which is a single screen of scrolling
 * during which it is visible at all. Widening the ramp pushes more of the
 * travel above that window, where the reader has not arrived yet, and the part
 * they can actually see gets SHORTER and faster. The lever points backwards.
 *
 * SMOOTH_MS is the speed control. The blocks ease toward the position the
 * scroll asks for instead of snapping to it, so the word keeps climbing for a
 * moment after the wheel stops. That is what reads as weight, and it is the
 * number to change when the rise should be slower or quicker.
 *
 * SAFE BY DEFAULT
 * ---------------
 * --fr-p defaults to 1 in the stylesheet, which is the finished footer. Script
 * only ever lowers it. So the server's output, a page with JavaScript blocked,
 * a reader who asked for no motion, and a thrown exception all land on the same
 * correct picture - the opposite of the reference this came from, which ships
 * its footer at opacity 0 and is permanently invisible if its script never
 * runs.
 */

/** Progress 0: the host is this many screens below the fold. */
const ENTER_AT = 1.7;
/** Progress 1: the host's top has come this far up the viewport. */
const SETTLE_AT = 0.05;

/**
 * How much of the ramp each successive block gives up to the one before it.
 *
 * Every block still finishes at progress 1; they just start at different
 * points, so the group arrives as a sequence rather than as a slab. 0.1 keeps
 * the last block's ramp at 60% of the full travel, which is enough room for it
 * to move at a believable speed rather than snapping at the end.
 */
const STAGGER = 0.1;

/**
 * How long the blocks take to catch up to the scroll, in milliseconds.
 *
 * This is the speed control, and it is worth saying why the obvious one is not.
 *
 * The footer is the last thing on the page, so its top only ever travels from
 * one screen down to zero - about a single screen of scrolling during which it
 * is actually visible. Widening the progress ramp therefore does NOT slow the
 * visible motion: it moves more of the travel off the top of the ramp, where
 * the footer has not been reached yet, and the part the reader can see gets
 * shorter and faster. The lever points the wrong way.
 *
 * Lag is the lever that points the right way. At 420ms the blocks ease toward
 * the position the scroll asks for rather than snapping to it, so the word
 * keeps climbing for a moment after the wheel stops and reads as something with
 * weight being lifted. Long enough to feel deliberate; short enough that it is
 * still obviously the reader doing the lifting.
 */
const SMOOTH_MS = 420;

/**
 * The catch-up curve. Fast to leave, slow to arrive - so the tail of every move
 * is the part that is drawn out, which is what makes it read as heavy rather
 * than merely delayed. No control point outside [0,1]: an overshoot here would
 * be a springy settle, which is the one thing the rest of this product's motion
 * is explicitly not.
 */
const SMOOTH_EASE = "cubic-bezier(0.16, 0.6, 0.2, 1)";

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export function FooterReveal({ children }: { children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Checked before anything is touched. For a reader who asked for no motion
    // the footer is already correct in the markup and is simply left alone -
    // --fr-p stays at its default of 1 and nothing is ever written.
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const parts = Array.from(
      host.querySelectorAll<HTMLElement>("[data-reveal]")
    );
    if (parts.length === 0) return;

    let frame = 0;
    let poll = 0;
    let last = -1;

    const apply = (): void => {
      const top = host.getBoundingClientRect().top;
      const vh = window.innerHeight || 1;

      // 0 while the footer is still ENTER_AT screens down, 1 once its top has
      // risen to SETTLE_AT. Linear on purpose: the easing belongs to the
      // reader's scroll, and a curve here would fight it.
      const span = vh * (ENTER_AT - SETTLE_AT);
      const p = clamp01((vh * ENTER_AT - top) / (span || 1));

      // One write per frame at most. Comparing first matters more than it
      // looks: a custom-property write invalidates style for the subtree, and
      // scroll fires far more often than the value actually changes.
      if (Math.abs(p - last) < 0.002) return;
      last = p;

      parts.forEach((el, i) => {
        // Each block gives up a slice of the ramp to the ones before it, then
        // covers the rest of the distance itself.
        const start = Math.min(i * STAGGER, 0.6);
        const own = clamp01((p - start) / (1 - start || 1));
        el.style.setProperty("--fr-p", own.toFixed(3));
      });
    };

    const onScroll = (): void => {
      // rAF-coalesced, because scroll can fire many times per frame and the
      // work is a layout read.
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        apply();
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    // A slow poll alongside the listener. rAF does not run in a background or
    // hidden tab, and the layout can also change underneath us for reasons
    // scroll never hears about - a font finishing, an image arriving, a panel
    // above the footer growing. This costs one rect read every 200ms and keeps
    // the value honest when the fast path is asleep.
    poll = window.setInterval(apply, 200);

    apply();

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(poll);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      // Hand every block back at its finished value, so a remount never leaves
      // a half-revealed footer behind.
      parts.forEach((el) => el.style.removeProperty("--fr-p"));
    };
  }, []);

  return (
    <div ref={hostRef} className="fr-host">
      <style>{`
        /* 1 is the finished state, and it is the DEFAULT. Script only ever
           lowers it, so no-JS, reduced motion, and a script that throws all
           render the same correct footer. */
        .fr-host [data-reveal] {
          --fr-p: 1;
          opacity: var(--fr-p);
          transform: translateY(calc((1 - var(--fr-p)) * 16px));
          transition:
            opacity ${SMOOTH_MS}ms ${SMOOTH_EASE},
            transform ${SMOOTH_MS}ms ${SMOOTH_EASE};
        }

        /* The reader asked for none of this. Belt and braces alongside the
           early return above: if the media query changes after mount, the CSS
           still refuses to move anything. */
        @media (prefers-reduced-motion: reduce) {
          .fr-host [data-reveal] {
            --fr-p: 1;
            opacity: 1;
            transform: none;
            transition: none;
          }
        }
      `}</style>
      {Children.toArray(children)}
    </div>
  );
}

export default FooterReveal;
