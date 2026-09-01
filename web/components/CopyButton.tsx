"use client";

import { useState } from "react";

/**
 * Copy a hash or address. The point of this app is that people can check things
 * themselves, so anything verifiable is copyable.
 */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="label copy-btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // Clipboard permission denied. Not worth interrupting anyone over.
        }
      }}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "2px 4px",
        color: copied ? "var(--positive)" : "var(--accent)",
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
