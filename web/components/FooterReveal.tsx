"use client";

import { Children, useEffect, useRef, type ReactNode } from "react";

/**
 * Staggered entrance for footer content.
 *
 * The reference this copies (unionspaces.co.uk) marks three blocks
 * `.footer-to-animate`, parks them at opacity 0, and brings them in as the
 * footer enters view. That is the effect. It is worth saying what it is NOT:
 * there is no sticky reveal, no content sliding off a pinned footer. Measured,
 * the footer is `position: static` and the animated parts are simply hidden
 * until they are scrolled to.
 *
 * WHAT IS DELIBERATELY DIFFERENT
 * ------------------------------
 * The reference ships its footer at opacity 0 in the markup and reveals it with
 * script. With JavaScript blocked, or a scroll library that never initialises,
 * the footer is permanently invisible - which is exactly what happened when I
 * went to look at it: every block read `opacity: 0` and the page rendered blank.
 *
 * So this inverts the order. The footer is COMPLETE in the HTML at full
 * opacity, and the effect only exists if a client is running: on mount, and
 * only after confirming the reader has not asked for reduced motion, the parts
 * are armed (hidden) and then released as they come into view. Same animation,
 * but the failure mode is "no animation" rather than "no footer".
 *
 * That is the same rewind-a-finished-document pattern the rigs use, for the
 * same reason.
 *
 * WHY IT ARMS LATE
 * ----------------
 * The obvious shape - hide everything on mount, reveal when it scrolls into
 * view - has a failure that only shows up in testing. Anything hidden on mount
 * needs a watchdog in case the reveal never runs, and that watchdog is a race
 * against the reader: on a long page nobody reaches the footer inside a few
 * seconds, so the watchdog wins and the animation never happens. Lengthening it
 * only trades a missing animation for a long invisible footer.
 *
 * So the content is armed as LATE as possible: hidden while the footer is still
 * about a screen and a half away, released as it reaches the fold. Nothing is
 * ever hidden until it is about to be needed, and every failure degrades to
 * "no animation" rather than "no footer".
 *
 * WHY SCROLL POSITION AND NOT IntersectionObserver
 * ------------------------------------------------
 * IntersectionObserver was the obvious tool and it does not work on this
 * document. `html` and `body` both carry `overflow: hidden auto` - the
 * overflow-x guard that keeps a bled wordmark from widening the page - which
 * means the document is not the observer's implicit root. Verified directly:
 * with the footer 1484px below the fold and a 900px bottom rootMargin, an
 * observer that should have fired at 1520px never fired at all, and neither did
 * a percentage margin.
 *
 * getBoundingClientRect tracks the same scroll correctly, so the trigger is
 * computed from geometry on a passive, rAF-throttled scroll listener. One
 * rect read per frame while scrolling, and the listener removes itself the
 * moment the work is done.
 *
 * WHY A ONE-SHOT
 * --------------
 * Both observers disconnect after firing. A footer that re-animates every time
 * it scrolls past is a footer that flickers while you are trying to read the
 * links in it.
 */

const STEP_MS = 90;

export function FooterReveal({ children }: { children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Checked BEFORE anything is hidden. A reader who asked for no motion must
    // never see the content disappear and come back - for them the footer was
    // already correct in the HTML and is simply left alone.
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

    /** Hidden while the footer is further than this many screens away. */
    const ARM_SCREENS = 1.5;
    /** Released once its top has come this far up the viewport. */
    const RELEASE_AT = 0.88;

    let armed = false;
    let done = false;
    let frame = 0;
    let watchdog = 0;
    let poll = 0;

    const finish = (): void => {
      done = true;
      window.clearTimeout(watchdog);
      window.clearInterval(poll);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      parts.forEach((el) => {
        delete el.dataset.frArmed;
      });
    };

    const measure = (): void => {
      if (done) return;
      const top = host.getBoundingClientRect().top;
      const vh = window.innerHeight || 1;

      if (!armed) {
        // Never hide something the reader can already see. A short page, or a
        // reload restored to the bottom, lands here and simply stays finished.
        if (top < vh) {
          finish();
          return;
        }
        if (top <= vh * (1 + ARM_SCREENS)) {
          armed = true;
          parts.forEach((el, i) => {
            el.style.setProperty("--fr-i", String(i));
            el.dataset.frArmed = "";
          });
          // Only now is anything hidden, so only now does a watchdog matter -
          // and it can be generous, because the footer is still off screen.
          watchdog = window.setTimeout(finish, 10000);
        }
        return;
      }

      if (top < vh * RELEASE_AT) finish();
    };

    // One rect read per frame at most, however fast the scroll fires.
    function onScroll(): void {
      if (done || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    }

    measure();
    if (!done) {
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll, { passive: true });
      // A slow poll alongside the listener, and it is not belt-and-braces for
      // its own sake. This document does not always emit scroll events - the
      // overflow guard on html/body is enough to change how the page scrolls,
      // and IntersectionObserver is already unusable here for the same reason -
      // so the listener alone is not a guarantee that the footer is ever
      // measured again. 150ms is well inside the 520ms transition, so the
      // effect is identical when the listener does fire, and it still happens
      // when it does not. One rect read per tick, and it stops on finish.
      poll = window.setInterval(measure, 150);
    }

    return () => {
      window.clearTimeout(watchdog);
      window.clearInterval(poll);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      parts.forEach((el) => {
        delete el.dataset.frArmed;
        el.style.removeProperty("--fr-i");
      });
    };
  }, []);

  return (
    <div ref={hostRef} className="fr-host">
      <style>{`
        /* The armed state is applied by script only, so the default - and the
           server's output - is the finished footer. */
        .fr-host [data-reveal][data-fr-armed] {
          opacity: 0;
          transform: translateY(14px);
          /* Arming is INSTANT. A transition here applies in both directions,
             so the footer would visibly fade OUT as the reader approached it -
             which looks like a bug, because it is one. Hiding happens while it
             is still off screen; only the release is animated. */
          transition: none;
        }
        .fr-host [data-reveal] {
          opacity: 1;
          transform: none;
          transition:
            opacity 520ms cubic-bezier(0.35, 0, 0.65, 1)
              calc(var(--fr-i, 0) * ${STEP_MS}ms),
            transform 520ms cubic-bezier(0.35, 0, 0.65, 1)
              calc(var(--fr-i, 0) * ${STEP_MS}ms);
        }
        /* Belt and braces: if the media query changes after mount, the CSS
           still refuses to move anything. */
        @media (prefers-reduced-motion: reduce) {
          .fr-host [data-reveal],
          .fr-host [data-reveal][data-fr-armed] {
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
