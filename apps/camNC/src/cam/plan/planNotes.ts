import { t as translate } from '@wbcnc/i18n';
import type { OutlineNotches } from '@wbcnc/cam';
import { describeOutlineNotches } from '@wbcnc/cam/outlineNotchNote';

/** The CAM core's notes, in words a user can act on. */
export function friendly(w: string) {
  const corners = w.match(/left in corners\/narrow spots with D=([\d.]+)/);
  if (corners)
    return translate('Inside corners stay rounded to the bit radius ({{value1}} mm). A second, smaller bit doesn’t clean them up yet.', {
      value1: +(+corners[1] / 2).toFixed(2),
    });
  if (w.includes('no tool fits')) return translate('{{value1}}: narrower than the bit, choose a smaller bit.', { value1: w.split(':')[0] });
  if (w.includes('flipped')) return translate('Features on the bottom face are not cut: they need a second, flipped setup.');
  if (w.includes('sloped')) return translate('Small sloped faces (chamfers, fillets) come out square.');
  const flutes = w.match(/bit D=([\d.]+) cuts ([\d.]+) mm deep from the stock top, its flutes are ([\d.]+) mm long/);
  if (flutes)
    return translate(
      'The ⌀{{value1}} bit cuts {{value2}} mm deep but its flutes are only {{value3}} mm long: the shank would rub. Use a longer bit or thinner stock.',
      { value1: flutes[1], value2: flutes[2], value3: flutes[3] }
    );
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
