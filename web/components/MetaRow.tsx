/**
 * The footer strip on each app screen: footnotes on the left, the record label
 * on the right. It is what makes a screen read as a page of a record rather
 * than a view in an application.
 */

export function MetaRow({
  footnote,
  record,
}: {
  footnote: string;
  record: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 24,
        marginTop: 48,
        paddingTop: 16,
        borderTop: "1px solid var(--hairline)",
        flexWrap: "wrap",
      }}
    >
      <span className="label">{footnote}</span>
      <span className="label">{record}</span>
    </div>
  );
}
