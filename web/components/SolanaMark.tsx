/**
 * The Solana brand mark: three sheared bars.
 *
 * One of exactly two places per screen where the purple->green gradient is
 * allowed to appear (the other is the primary button). Geometry is specified in
 * web/DESIGN.md and derived from `size` so the mark stays proportional.
 */

export function SolanaMark({
  size = 20,
  glow = false,
  className,
}: {
  size?: number;
  /** Landing-page hero only: adds the per-bar colour bloom. */
  glow?: boolean;
  className?: string;
}) {
  const gap = size / 8;
  const barHeight = size / 4.4;

  const bar = (index: number): React.CSSProperties => {
    const isMiddle = index === 1;
    return {
      height: barHeight,
      width: "100%",
      background: isMiddle
        ? "linear-gradient(90deg,#14F195,#9945FF)"
        : "linear-gradient(90deg,#9945FF,#14F195)",
      clipPath: isMiddle
        ? "polygon(0 0, 78% 0, 100% 100%, 22% 100%)"
        : "polygon(22% 0, 100% 0, 78% 100%, 0 100%)",
      boxShadow: glow
        ? `0 0 24px ${isMiddle ? "rgba(20,241,149,.55)" : "rgba(153,69,255,.55)"}`
        : undefined,
    };
  };

  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap,
        width: size,
        flex: "0 0 auto",
      }}
    >
      <span style={bar(0)} />
      <span style={bar(1)} />
      <span style={bar(2)} />
    </span>
  );
}
