/** The part field: a button to make active while the part can still change, or the part's name otherwise. */
export function DialogPartField({
  label,
  name,
  pick,
  onActivate,
}: {
  label: string;
  name: string;
  pick: { active: boolean; problem: string | null } | null;
  onActivate: () => void;
}) {
  if (!pick)
    return (
      <div className="cad-feature-selection">
        <small>{label}</small>
        <span>{name}</span>
      </div>
    );
  return (
    <>
      <button
        type="button"
        className="cad-feature-selection"
        aria-label={label}
        // Marks a dialog whose part is picked outside it, so Escape from there still reaches it.
        data-part-pick=""
        data-active={pick.active ? '' : undefined}
        onClick={onActivate}>
        <small>{label}</small>
        <span>{name}</span>
        {pick.active && <span className="cad-feature-hint">Click a part in the view or the parts list</span>}
      </button>
      {pick.problem && <p role="alert">{pick.problem}</p>}
    </>
  );
}
