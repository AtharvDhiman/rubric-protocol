"use client";

import { useEffect } from "react";

/**
 * Wires up the entrance sequence. Two jobs, and the second one matters more.
 *
 * 1. Each `.appear` retires its own animation on `animationend`, gaining
 *    `.is-in`. Without that, a finished animation's fill state keeps holding a
 *    transform, and anything that transforms later - a hover lift, the verdict
 *    stamp's rotation - ends up fighting it.
 *
 * 2. If the animations never ran, reveal everything. `.appear` rests at
 *    opacity 1 precisely so a failure is invisible, but `animation-fill-mode:
 *    both` applies the 0% frame during the delay. So an animation that is
 *    *declared* but never *starts* - a stalled stylesheet, an engine that does
 *    not support the property, a tab restored from bfcache mid-delay - would
 *    strand elements at opacity 0 forever. Checking after two frames and
 *    forcing `.is-in` turns that from a blank page into a page that simply
 *    did not animate.
 *
 * Deliberately not an IntersectionObserver: this is a page-load sequence, and
 * everything it touches is above the fold on arrival.
 */
export function AppearMotion() {
  useEffect(() => {
    const appears = Array.from(document.querySelectorAll<HTMLElement>(".appear"));
    if (appears.length === 0) return;

    const cleanups = appears.map((el) => {
      const onEnd = () => el.classList.add("is-in");
      el.addEventListener("animationend", onEnd, { once: true });
      return () => el.removeEventListener("animationend", onEnd);
    });

    // Two frames is enough for the compositor to have started anything it was
    // going to start; one is not, on the first paint after hydration.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const running = appears.some((el) => {
          if (typeof el.getAnimations !== "function") return false;
          return el
            .getAnimations()
            .some((a) => a.playState === "running" || a.playState === "finished");
        });
        if (!running) {
          appears.forEach((el) => el.classList.add("is-in"));
        }
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      cleanups.forEach((off) => off());
    };
  }, []);

  return null;
}
