const kOpposite: Record<string, string> = { Top: 'Bottom', Bottom: 'Top', Front: 'Back', Back: 'Front', Right: 'Left', Left: 'Right' };

/**
 * A section plane's name as its chip shows it: "Section plane 1 (Front)". A base plane moved against its normal, or
 * flipped, faces the other way and takes the opposite side's name, as Front becomes Back.
 */
export function sectionPlaneName(label: string, offset: string, flipped: boolean) {
  const moved = parseFloat(offset.replace(',', '.'));
  const opposite = (Number.isFinite(moved) && moved < 0) !== flipped;
  return `Section plane 1 (${opposite ? (kOpposite[label] ?? label) : label})`;
}
