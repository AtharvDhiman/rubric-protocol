"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Fire an animation when an element scrolls into view, once.
 *
 * DESIGN.md: the hero animates on load, everything below the fold animates on
 * scroll. Firing everything at mount makes the whole page twitch at once and
 * then sit dead - this is what stops that.
 *
 * The "no IntersectionObserver" fallback is handled in the initial state rather
 * than by calling setState inside the effect, which would trigger a second
 * render pass on every mount.
 */
export function useInView<T extends HTMLElement = HTMLDivElement>(
  threshold = 0.2
) {
  const ref = useRef<T | null>(null);

  // Lazy initializer: in an environment without IntersectionObserver (older
  // browsers, some test runners) everything is simply visible from the start.
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver === "undefined"
  );

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
          }
        }
      },
      { threshold }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, inView };
}
