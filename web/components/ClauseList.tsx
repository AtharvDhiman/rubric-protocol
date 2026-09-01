/**
 * Sealed clauses, numbered with the section mark.
 *
 * Never bullets and never "1." - the section mark signals that these are binding
 * terms, which here is literally true: they are hashed into a PDA and the judge
 * may not rule on anything else.
 */

export function ClauseList({ clauses }: { clauses: string[] }) {
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {clauses.map((clause, i) => (
        <li
          key={i}
          style={{
            display: "flex",
            gap: 16,
            padding: "16px 0",
            borderBottom:
              i === clauses.length - 1 ? "none" : "1px solid var(--hairline)",
          }}
        >
          <span className="clause-mark" style={{ fontSize: 14, paddingTop: 2 }}>
            {i + 1}
          </span>
          <span style={{ fontSize: 15, lineHeight: 1.6 }}>{clause}</span>
        </li>
      ))}
    </ol>
  );
}
