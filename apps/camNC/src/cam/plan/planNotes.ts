import { readOutlineNotchNote } from '@wbcnc/cam/outlineNotchNote';

/** The CAM core's notes, in words a user can act on. */
export function friendly(w: string) {
  const corners = w.match(/left in corners\/narrow spots with D=([\d.]+)/);
  if (corners)
    return `Inside corners stay rounded to the bit radius (${+(+corners[1] / 2).toFixed(2)} mm). A second, smaller bit doesn’t clean them up yet.`;
  const notches = readOutlineNotchNote(w);
  if (notches) {
    // The board names the part in front: `Front: outline 1: …`.
    const part = /^(.*): outline \d+:/.exec(w)?.[1];
    const these = notches.notches === 1 ? 'a notch' : `${notches.notches} notches`;
    return `${part ? `${part}: ` : ''}${these} about ${notches.width} mm wide, such as a finger joint’s fingers, ${notches.notches === 1 ? 'is' : 'are'} narrower than the ⌀${notches.diameter} bit and won’t be cut: the outline runs straight across. Choose a smaller bit, or make the fingers wider.`;
  }
  if (w.includes('no tool fits')) return `${w.split(':')[0]}: narrower than the bit, choose a smaller bit.`;
  if (w.includes('flipped')) return 'Features on the bottom face are not cut: they need a second, flipped setup.';
  if (w.includes('sloped')) return 'Small sloped faces (chamfers, fillets) come out square.';
  const flutes = w.match(/bit D=([\d.]+) cuts ([\d.]+) mm deep from the stock top, its flutes are ([\d.]+) mm long/);
  if (flutes)
    return `The ⌀${flutes[1]} bit cuts ${flutes[2]} mm deep but its flutes are only ${flutes[3]} mm long: the shank would rub. Use a longer bit or thinner stock.`;
  return w;
}
