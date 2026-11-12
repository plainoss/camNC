import type { OutlineNotches } from '@wbcnc/cam';
import { describeOutlineNotches } from '@wbcnc/cam/outlineNotchNote';

/** The CAM core's notes, in words a user can act on. */
export function friendly(w: string) {
  const corners = w.match(/left in corners\/narrow spots with D=([\d.]+)/);
  if (corners)
    return `Inside corners stay rounded to the bit radius (${+(+corners[1] / 2).toFixed(2)} mm). A second, smaller bit doesn’t clean them up yet.`;
  if (w.includes('no tool fits')) return `${w.split(':')[0]}: narrower than the bit, choose a smaller bit.`;
  if (w.includes('flipped')) return 'Features on the bottom face are not cut: they need a second, flipped setup.';
  if (w.includes('sloped')) return 'Small sloped faces (chamfers, fillets) come out square.';
  const flutes = w.match(/bit D=([\d.]+) cuts ([\d.]+) mm deep from the stock top, its flutes are ([\d.]+) mm long/);
  if (flutes)
    return `The ⌀${flutes[1]} bit cuts ${flutes[2]} mm deep but its flutes are only ${flutes[3]} mm long: the shank would rub. Use a longer bit or thinner stock.`;
  return w;
}

/**
 * What the outline and hole paths of a board leave uncut, one line per part however many copies of it are on the
 * board, side B's after side A's. `nameOf`: a body's part name, from its instance id.
 */
export function uncutNotes(
  plan: { outlineNotches?: OutlineNotches[]; sideB?: { outlineNotches?: OutlineNotches[] } },
  nameOf: (instance: string) => string | undefined
): string[] {
  const lines = (notches: OutlineNotches[] | undefined, prefix: string) =>
    (notches ?? []).map(n => {
      const name = n.part ? nameOf(n.part) : undefined;
      return `${prefix}${name ? `${name}: ` : ''}${describeOutlineNotches(n)}`;
    });
  return [...new Set([...lines(plan.outlineNotches, ''), ...lines(plan.sideB?.outlineNotches, 'Side B: ')])];
}
