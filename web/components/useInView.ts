"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Fire an animation when an element scrolls into view, once.
 *
 * DESIGN.md: the hero animates on load, everything below the fold animates on
 * scroll. Firing everything at mount makes the whole page twitch at once and
 * then sit dead - this is what stops that.
 *
 * The initial state is `false` on BOTH server and client, deliberately. An
 * earlier version used a lazy initializer that checked for IntersectionObserver,
 * which is absent on the server and present in the browser - so the server sent
 * `class="reveal in"` and the client hydrated `class="reveal"`, and React
 * reported a hydration mismatch on every load. Any state that differs between
 * server and client is a hydration bug, however reasonable it looks.
 *
 * Without JavaScript nothing here runs at all, so `globals.css` has a `noscript`
 * rule that forces every `.reveal` element visible. The page is readable with
 * JS disabled and readable with motion disabled.
 */
export function useInView<T extends HTMLElement = HTMLDivElement>(
  threshold = 0.2
) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Environments without IntersectionObserver (older browsers, some test
    // runners) get the content immediately rather than never.
    if (typeof IntersectionObserver === "undefined") {
      // A one-shot capability fallback, not derived state: it runs at most once
      // per mount and cannot cascade, because nothing it sets feeds back into
      // this effect. The directive must stay on a single line - if the
      // justification wraps, it attaches to the comment instead of the call.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInView(true);
      return;
    }

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
