/**
 * The lock.
 *
 * A lever-tumbler lock cannot open unless every tumbler's gate is lifted to
 * exactly the right height, so the bolt's fence can pass through all of them at
 * once. That is Rubric's rule, mechanically: approved only if every clause
 * passes. This component is that mechanism drawn at engineering scale.
 *
 * Three movements:
 *
 *   SEAL   the rubric hash draws itself as a stepped bitting profile, then the
 *          tumblers drop onto it. The stack is now cut to this hash and nothing
 *          can recut it.
 *   RULE   each tumbler lifts to its ruled height. A passing clause lands with
 *          its gate exactly on the fence line; a failing clause lands 9px off.
 *   THROW  the brass fence travels across the stack. Every gate aligned and it
 *          passes clean through. One gate off and it stops dead against solid
 *          metal, and THE BLOCKING TUMBLER IS THE CITATION - the clause that
 *          caused the rejection is literally the thing that arrested the bolt.
 *
 * The same component runs on the landing with a scripted verdict and on
 * /task/[id] with the real one, so the marketing visual and the product are the
 * same object rather than a picture of it.
 *
 * Nothing here animates anything but `transform`, `opacity` and
 * `stroke-dashoffset`. Under reduced motion every part renders at its terminal
 * state, which costs nothing: the still frame is a complete state diagram, and
 * the motion was only ever the explanation of how it got there.
 */

export type TumblerState = "pass" | "fail" | "undetermined";

export interface LockMechanismProps {
  /** One entry per clause, in clause order. */
  states: TumblerState[];
  /** Hex digest. Its nibbles cut the bitting profile. */
  hash?: string;
  /** Labels drawn beside each tumbler. Defaults to clause numbers. */
  labels?: string[];
  /** Engineering part label under the drawing. */
  partLabel?: string;
  className?: string;
}

const PITCH = 40; // tumbler spacing, mm on the drawing
const LEVER_W = 300;
const FENCE_X = 232; // where the fence rides, in drawing units
const GATE_W = 16;
const OFF = 9; // how far a failing gate sits off the fence line

/** Map hash nibbles onto a stepped bitting profile: the key's cut. */
function bittingPath(hash: string | undefined, steps: number, width: number, height: number) {
  const clean = (hash ?? "").replace(/[^0-9a-f]/gi, "");
  const points: string[] = [];
  const stepW = width / steps;
  for (let i = 0; i < steps; i++) {
    // Two nibbles per step so a one-character edit visibly moves the profile.
    const a = parseInt(clean[(i * 2) % clean.length] || "8", 16);
    const b = parseInt(clean[(i * 2 + 1) % clean.length] || "8", 16);
    const depth = ((a * 16 + b) / 255) * height;
    const x = i * stepW;
    points.push(`${x},${height - depth}`, `${x + stepW},${height - depth}`);
  }
  return `M0,${height} L${points.join(" L")} L${width},${height}`;
}

export function LockMechanism({
  states,
  hash,
  labels,
  partLabel,
  className,
}: LockMechanismProps) {
  const n = Math.max(states.length, 1);
  const height = n * PITCH + 60;

  // Where the fence is stopped, if it is. The FIRST tumbler that is not aligned
  // arrests it — which is exactly the clause a rejection must cite.
  const blockingIndex = states.findIndex((s) => s !== "pass");
  const arrested = blockingIndex !== -1;
  const heldOnly = arrested && states[blockingIndex] === "undetermined";

  // A clean throw travels the full width. An arrest stops at the blocking
  // tumbler's gate, hard.
  const arrestX = arrested ? FENCE_X - 6 : LEVER_W + 40;

  const label =
    partLabel ??
    `FENCE / ${n} TUMBLER${n === 1 ? "" : "S"} / ${arrested ? (heldOnly ? "ARRESTED — INDETERMINATE" : "ARRESTED") : "THROWN"}`;

  return (
    <figure className={`lock ${className ?? ""}`} data-arrested={arrested ? "true" : "false"}>
      <svg
        viewBox={`0 0 ${LEVER_W + 90} ${height}`}
        role="img"
        aria-label={
          arrested
            ? `Lock arrested at clause ${blockingIndex + 1} of ${n}.`
            : `Lock thrown. All ${n} clauses aligned.`
        }
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {/* --- the bitting profile: the hash, cut as a key --- */}
        <path
          className="lock-bitting"
          d={bittingPath(hash, 16, LEVER_W, 26)}
          transform={`translate(0 ${height - 30})`}
          fill="none"
          stroke="var(--text)"
          strokeWidth="1.5"
          strokeLinejoin="miter"
        />

        {/* --- the tumbler stack --- */}
        {states.map((state, i) => {
          const y = 18 + i * PITCH;
          const lift = state === "pass" ? 0 : state === "undetermined" ? OFF / 2 : OFF;
          const colour =
            state === "pass"
              ? "var(--text)"
              : state === "undetermined"
                ? "var(--warning)"
                : "var(--negative)";
          return (
            <g
              key={i}
              className="lock-tumbler"
              style={{
                ["--i" as string]: String(i),
                ["--lift" as string]: `${lift}px`,
              }}
            >
              {/* the lever itself */}
              <rect
                x="0"
                y={y}
                width={LEVER_W}
                height="22"
                fill="none"
                stroke={colour}
                strokeWidth="1.5"
              />
              {/* the gate slot — the notch the fence must pass through */}
              <rect
                x={FENCE_X - GATE_W / 2}
                y={y - 1}
                width={GATE_W}
                height="24"
                fill="var(--surface)"
                stroke={colour}
                strokeWidth="1.5"
              />
              {/* clause number, set in mono beside its lever */}
              <text
                x={LEVER_W + 12}
                y={y + 16}
                className="lock-num"
                fill={colour}
                fontSize="13"
              >
                {labels?.[i] ?? String(i + 1)}
              </text>
            </g>
          );
        })}

        {/* --- the fence: the only brass thing, because it is the part that moves --- */}
        <rect
          className="lock-fence"
          style={{ ["--arrest-x" as string]: `${arrestX}px` }}
          x="-6"
          y="8"
          width="6"
          height={n * PITCH + 4}
          fill="var(--accent)"
        />

        {/* dimension tick at the fence line, as on a drawing */}
        <line
          x1={FENCE_X}
          y1="4"
          x2={FENCE_X}
          y2={n * PITCH + 16}
          stroke="var(--accent)"
          strokeWidth="0.75"
          strokeDasharray="2 4"
          opacity="0.7"
        />
      </svg>

      <figcaption className="lock-label data">
        {label}
        {arrested && (
          <>
            {" · "}
            <span style={{ color: heldOnly ? "var(--warning)" : "var(--negative)" }}>
              AT CLAUSE {blockingIndex + 1}
            </span>
          </>
        )}
      </figcaption>
    </figure>
  );
}
