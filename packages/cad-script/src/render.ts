import type { CadPoint, EvaluatedCadPart } from '@wbcnc/cad';

const n = (value: number) => +value.toFixed(3);
const loop = (points: readonly CadPoint[], dx: number, dy: number) => `M${points.map(p => `${n(p.x + dx)} ${n(dy - p.y)}`).join('L')}Z`;

/** Parts side by side, seen from above with Y up, and darker the deeper a cut goes. For reading, never for machining. */
export function renderCadSvg(parts: readonly EvaluatedCadPart[]): string {
  const boxes = parts.map(part => {
    const xs = part.outline.map(p => p.x),
      ys = part.outline.map(p => p.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
  const height = Math.max(0, ...boxes.map(b => b.y1 - b.y0));
  const unit = Math.max(height, ...boxes.map(b => b.x1 - b.x0), 1) / 40;
  const gap = unit * 4;
  const out: string[] = [];
  let x = gap;
  parts.forEach((part, i) => {
    const box = boxes[i]!,
      dx = x - box.x0,
      dy = gap + height + box.y0;
    out.push(
      `<text x="${n(x)}" y="${n(gap - unit)}" font-size="${n(unit * 1.4)}">${part.name.replace(/[<&]/g, '')}, ${part.thickness} mm</text>`
    );
    const material = `${loop(part.outline, dx, dy)}${part.holes.map(hole => loop(hole, dx, dy)).join('')}`;
    out.push(`<path d="${material}" fill="#e8e4da" fill-rule="evenodd" stroke="#222" stroke-width="${n(unit / 6)}"/>`);
    // Cuts only show over material, so a hole inside a pocket still reads as a hole.
    out.push(`<clipPath id="material-${i}"><path d="${material}" clip-rule="evenodd"/></clipPath>`);
    const unlabelled = new Map<string, number>();
    for (const cut of part.cuts ?? []) {
      const shade = cut.through ? 1 : Math.min(1, cut.to / part.thickness);
      const islands = cut.islands.map(island => loop(island, dx, dy)).join('');
      out.push(
        `<path d="${loop(cut.outline, dx, dy)}${islands}" clip-path="url(#material-${i})" fill="${cut.through ? '#fff' : '#3b6ea5'}" fill-opacity="${n(0.25 + 0.6 * shade)}" fill-rule="evenodd" stroke="#1d3f66" stroke-width="${n(unit / 8)}"${cut.side === 'underside' ? ` stroke-dasharray="${n(unit)}"` : ''}/>`
      );
      const depth = cut.through ? 'through' : `${n(cut.to)} mm`;
      const xs = cut.outline.map(p => Math.max(box.x0, Math.min(box.x1, p.x))),
        ys = cut.outline.map(p => Math.max(box.y0, Math.min(box.y1, p.y)));
      // A label wouldn't fit in a small cut, such as a row of pin holes: those are counted above the part's name.
      if (Math.max(...xs) - Math.min(...xs) < unit * 3 && Math.max(...ys) - Math.min(...ys) < unit * 3) {
        unlabelled.set(depth, (unlabelled.get(depth) ?? 0) + 1);
        continue;
      }
      // At the cut's top-left-most point inside the part, which lies on a rounded cut too, and differs for nested cuts
      // with one centre.
      const corner = cut.outline.map((_, k) => ({ x: xs[k]!, y: ys[k]! })).reduce((best, p) => (p.y - p.x > best.y - best.x ? p : best));
      const lx = corner.x + dx + unit / 2,
        ly = dy - corner.y + unit * 1.2;
      out.push(`<text x="${n(lx)}" y="${n(ly)}" font-size="${n(unit)}">${depth}</text>`);
    }
    if (unlabelled.size)
      out.push(
        `<text x="${n(x)}" y="${n(gap - unit * 2.8)}" font-size="${n(unit)}">${[...unlabelled].map(([depth, count]) => `${count} small × ${depth}`).join(', ')}</text>`
      );
    x += box.x1 - box.x0 + gap;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(x)} ${n(height + 2 * gap)}" font-family="sans-serif">\n${out.join('\n')}\n</svg>\n`;
}
