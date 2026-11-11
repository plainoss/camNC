import { describe, expect, it } from 'vitest';
import { createCadDocument, createCadPart, evaluateCadDocument, parseCadDocument, polygonArea, solveCadDocument } from '@wbcnc/cad';
import {
  appendSvgToSketch,
  createSvgAssetStore,
  evaluateSegment,
  geometryBounds,
  parseSvgSketch,
  placedSvgSegments,
  SVG_LIMITS,
} from './index';
const svg = (body: string, attrs = 'viewBox="0 0 100 100" width="100mm" height="100mm"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
const square = 'M0 0H100V100H0Z',
  inner = 'M20 20H80V80H20Z',
  reversedInner = 'M20 20V80H80V20Z';
describe('bounded exact SVG geometry', () => {
  it('honors physical units, viewBox origins and CAD Y direction', () => {
    const asset = parseSvgSketch(svg('<rect x="10" y="20" width="96" height="48"/>', 'viewBox="10 20 96 48" width="1in" height="0.5in"'));
    expect(asset.bounds.at[0]).toBeCloseTo(0, 10);
    expect(asset.bounds.at[1]).toBeCloseTo(-12.7, 10);
    expect(asset.bounds.size[0]).toBeCloseTo(25.4, 10);
    expect(asset.bounds.size[1]).toBeCloseTo(12.7, 10);
  });
  it('uses CSS pixels when physical dimensions are absent', () => {
    const asset = parseSvgSketch(svg('<rect width="96" height="48"/>', ''));
    expect(asset.bounds.size[0]).toBeCloseTo(25.4, 10);
    expect(asset.warnings[0]).toMatch(/96 per inch/);
  });
  it('preserves rounded rectangle conics and measured bounds', () => {
    const asset = parseSvgSketch(svg('<rect x="10" y="20" width="80" height="40" rx="10"/>'));
    expect(asset.contours[0].segments.filter(s => s.kind === 'conic')).toHaveLength(4);
    expect(asset.bounds.at).toEqual([10, -60]);
    expect(asset.bounds.size[0]).toBeCloseTo(80, 10);
    expect(asset.bounds.size[1]).toBeCloseTo(40, 10);
  });
  it('retains exact reflected, skewed and anisotropically transformed ellipse arcs', () => {
    const asset = parseSvgSketch(
      svg('<g transform="translate(50 50)"><ellipse cx="0" cy="0" rx="20" ry="10" transform="matrix(-2 0 0.5 3 0 0)"/></g>')
    );
    expect(asset.contours[0].segments).toHaveLength(4);
    expect(asset.contours[0].segments.every(s => s.kind === 'conic')).toBe(true);
    expect(asset.bounds.at[0]).toBeCloseTo(50 - Math.hypot(40, 5), 8);
    expect(asset.bounds.at[1]).toBeCloseTo(-80, 8);
    expect(asset.bounds.size[0]).toBeCloseTo(2 * Math.hypot(40, 5), 8);
    expect(asset.bounds.size[1]).toBeCloseTo(60, 8);
    for (const segment of asset.contours[0].segments)
      for (let t = 0; t <= 1; t += 0.1) {
        const [x, y] = evaluateSegment(segment, t),
          localY = (-y - 50) / 3,
          localX = -(x - 50 - 0.5 * localY) / 2;
        expect((localX / 20) ** 2 + (localY / 10) ** 2).toBeCloseTo(1, 10);
      }
  });
  it('normalizes relative H/V/S/T into quadratic/cubic curves', () => {
    const asset = parseSvgSketch(svg('<path d="m10 50 c0 -20 20 -20 20 0 s20 20 20 0 q10 -20 20 0 t20 0 v40 h-80z"/>'));
    expect(asset.contours[0].segments.filter(s => s.kind === 'bezier').map(s => s.points.length)).toEqual([4, 4, 3, 3]);
  });
  it('closes filled subpaths using SVG implicit fill closure', () => {
    expect(parseSvgSketch(svg('<polygon points="0,0 100,0 50,100"/>')).contours[0].segments).toHaveLength(3);
    expect(parseSvgSketch(svg('<path d="M0 0 L100 0 L50 100"/>')).contours[0].closed).toBe(true);
  });
  it('fits true cubic extrema rather than the control hull', () => {
    const asset = parseSvgSketch(svg('<path d="M0 0 C0 100 100 100 100 0 Z"/>'));
    expect(asset.bounds.size).toEqual([100, 75]);
    const fitted = geometryBounds(placedSvgSegments(asset, { width: 280, height: 190, preserveAspect: false, at: [5, 7] }));
    expect(fitted.at[0]).toBeCloseTo(5, 10);
    expect(fitted.at[1]).toBeCloseTo(7, 10);
    expect(fitted.size[0]).toBeCloseTo(280, 9);
    expect(fitted.size[1]).toBeCloseTo(190, 9);
  });
  it('uniformly contains by default and stretches only explicitly', () => {
    const asset = parseSvgSketch(svg('<rect width="100" height="50"/>'));
    expect(geometryBounds(placedSvgSegments(asset, { width: 280, height: 190 }))).toEqual({ at: [0, 0], size: [280, 140] });
    expect(geometryBounds(placedSvgSegments(asset, { height: 190 })).size).toEqual([380, 190]);
    for (const placement of [{ width: 0 }, { height: Infinity }, { at: [NaN, 0] as [number, number] }])
      expect(() => placedSvgSegments(asset, placement)).toThrow();
  });
});
describe('fill semantics and rejection boundaries', () => {
  it('honors evenodd holes and nonzero winding', () => {
    expect(parseSvgSketch(svg(`<path fill-rule="evenodd" d="${square} ${inner}"/>`)).contours).toHaveLength(2);
    expect(parseSvgSketch(svg(`<path d="${square} ${inner}"/>`)).contours).toHaveLength(1);
    expect(parseSvgSketch(svg(`<path d="${square} ${reversedInner}"/>`)).contours).toHaveLength(2);
  });
  it('unions separate filled elements rather than inventing holes', () => {
    const asset = parseSvgSketch(svg(`<path d="${square}"/><path d="${inner}"/>`));
    expect(asset.contours).toHaveLength(1);
    expect(asset.warnings).toContain('Redundant interior boundaries removed according to SVG fill rules.');
  });
  it('keeps an island nested inside an evenodd hole', () => {
    expect(parseSvgSketch(svg(`<path fill-rule="evenodd" d="${square} ${inner} M40 40H60V60H40Z"/>`)).contours).toHaveLength(3);
  });
  it.each([
    '<path d="M0 0L100 100L0 100L100 0Z"/>',
    '<rect width="60" height="60"/><rect x="40" y="40" width="50" height="50"/>',
    '<rect width="100" height="100"/><rect x="0" y="20" width="20" height="20"/>',
  ])('rejects crossing/touching topology %s', body => expect(() => parseSvgSketch(svg(body))).toThrow(/intersect|touch|degenerate/i));
  it.each([
    '<script>alert(1)</script>',
    '<image href="https://example.org/image.png"/>',
    '<use href="#x"/>',
    '<path style="fill:black" d="M0 0H10V10Z"/>',
    '<text>Tray</text>',
    '<foreignObject/>',
    '<rect width="50%" height="10"/>',
    '<rect width="10" height="10" fill="url(#g)"/>',
    '<rect width="10" height="10" stroke="black"/>',
    '<rect width="10" height="10" fill="none"/>',
    '<rect width="10" height="10" fill="transparent"/>',
    '<rect width="10" height="10" onclick="alert(1)"/>',
    '<g transform="scale(0)"><rect width="10" height="10"/></g>',
    '<rect width="NaN" height="10"/>',
  ])('rejects unsupported resources/paint %s', body => expect(() => parseSvgSketch(svg(body))).toThrow());
  it('rejects malformed XML, DTD and size/command/depth limits', () => {
    expect(() => parseSvgSketch('<!DOCTYPE svg [<!ENTITY x "test">]>' + svg('<rect width="10" height="10"/>'))).toThrow(/declarations/);
    expect(() => parseSvgSketch(svg('<g><rect width="10" height="10"/></svg>'))).toThrow();
    expect(() => parseSvgSketch(' '.repeat(SVG_LIMITS.bytes + 1))).toThrow(/1 MB/);
    expect(() => parseSvgSketch(svg('<g>'.repeat(34) + '<rect width="10" height="10"/>' + '</g>'.repeat(34)))).toThrow(/nesting/);
    expect(() => parseSvgSketch(svg(`<path d="M0 0${'L1 1'.repeat(1025)}Z"/>`))).toThrow(/commands/);
  });
});
it('imports native constrained curves, solves holes and round-trips while preserving existing entities', async () => {
  const asset = parseSvgSketch(svg('<path fill-rule="evenodd" d="M0 0H100V80H0Z M20 20H80V60H20Z"/>'));
  const part = createCadPart('Imported', 18),
    origin = structuredClone(part.sketch.entities[0]);
  part.sketch = appendSvgToSketch(part.sketch, asset, { width: 280, height: 190, preserveAspect: false });
  expect(part.sketch.entities[0]).toEqual(origin);
  expect(part.sketch.entities.every(p => p.type !== 'point' || p.id === origin.id || !p.fixed)).toBe(true);
  const document = { ...createCadDocument('SVG'), parts: [part] };
  const solved = await solveCadDocument(parseCadDocument(JSON.parse(JSON.stringify(document))));
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.sketches[0].dof).toBe(0);
  const evaluated = evaluateCadDocument(solved.document);
  expect(evaluated.diagnostics).toEqual([]);
  expect(evaluated.parts[0].holes).toHaveLength(1);
  expect(Math.abs(polygonArea(evaluated.parts[0].outline))).toBeCloseTo(280 * 190, 5);
});
it('imports native conics/Beziers that remain valid after solving', async () => {
  const asset = parseSvgSketch(svg('<path d="M0 40 C20 0 80 0 100 40 L100 80 A50 20 0 0 1 0 80 Z"/>'));
  const part = createCadPart();
  part.sketch = appendSvgToSketch(part.sketch, asset, { width: 280, height: 190, preserveAspect: false });
  expect(part.sketch.entities.some(e => e.type === 'bezier')).toBe(true);
  expect(part.sketch.entities.some(e => e.type === 'conic')).toBe(true);
  const input = parseCadDocument(JSON.parse(JSON.stringify({ ...createCadDocument(), parts: [part] })));
  const solved = await solveCadDocument(input);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.parts[0].outline.length).toBeGreaterThan(5);
  const changed = structuredClone(solved.document),
    sketch = changed.parts[0].sketch;
  const curve = sketch.entities.find(e => e.type === 'bezier')!;
  if (curve.type !== 'bezier') throw new Error('Expected native Bezier.');
  const controlId = curve.controlPointIds[1],
    dimension = sketch.constraints.find(c => c.type === 'positionY' && c.pointId === controlId)!;
  if (dimension.type !== 'positionY') throw new Error('Expected editable position dimension.');
  const y = dimension.value + 1;
  dimension.value = y;
  const resized = await solveCadDocument(parseCadDocument(JSON.parse(JSON.stringify(changed))));
  expect(resized.status, JSON.stringify(resized.diagnostics)).toBe('solved');
  expect(resized.document.parts[0].sketch.entities.find(e => e.id === controlId)).toMatchObject({ y: expect.closeTo(y, 7) });
  expect(resized.document.parts[0].sketch.entities.map(e => e.id)).toEqual(sketch.entities.map(e => e.id));
});
it('deduplicates session handles and returns isolated geometry copies', () => {
  const store = createSvgAssetStore(),
    source = svg('<rect width="10" height="10"/>'),
    summary = store.register(source, 'Tray');
  expect(store.register(source, 'Other').handle).toBe(summary.handle);
  const copy = store.get(summary.handle);
  copy.contours.length = 0;
  summary.bounds.size[0] = 0;
  expect(store.get(summary.handle).contours).toHaveLength(1);
  expect(store.summary(summary.handle).bounds.size[0]).toBe(10);
  expect(store.list()).toHaveLength(1);
  expect(store.remove(summary.handle)).toBe(true);
  expect(() => store.get(summary.handle)).toThrow(/Unknown SVG/);
  expect(store.register(source).handle).not.toBe(summary.handle);
  store.clear();
  expect(store.list()).toEqual([]);
});

it('rejects root viewport clipping and preserves a single physical dimension ratio', () => {
  expect(() => parseSvgSketch(svg('<rect x="-1" width="20" height="20"/>'))).toThrow(/clipping/);
  expect(() =>
    parseSvgSketch(
      svg('<rect width="100" height="100"/>', 'viewBox="0 0 100 100" width="200mm" height="100mm" preserveAspectRatio="xMidYMid slice"')
    )
  ).toThrow(/clipping/);
  const asset = parseSvgSketch(svg('<rect width="100" height="50"/>', 'viewBox="0 0 100 50" width="280mm"'));
  expect(asset.bounds.size[0]).toBeCloseTo(280, 10);
  expect(asset.bounds.size[1]).toBeCloseTo(140, 10);
});

it('ignores legal zero-length commands without importing hidden descriptive geometry', () => {
  const asset = parseSvgSketch(svg('<path d="M0 0L0 0 A10 10 0 0 1 0 0 H100V100H0Z"/>'));
  expect(asset.contours[0].segments).toHaveLength(4);
  expect(() => parseSvgSketch(svg('<title><rect width="10" height="10"/></title>'))).toThrow(/descriptive/);
});

it('rejects long malformed tag input with a bounded linear preflight', () => {
  expect(() => parseSvgSketch('<svg ' + 'a'.repeat(900000))).toThrow(/incomplete tag/);
  expect(() => parseSvgSketch('<g'.repeat(100000))).toThrow(/Invalid SVG XML tag/);
});

it('rejects invalid or transparent paints instead of changing inherited fill semantics', () => {
  for (const fill of ['banana', 'rgb(,,)', 'rgb(1,2%,3)', 'rgba(0,0,0,0)', 'NONE'])
    expect(() => parseSvgSketch(svg(`<g fill="none"><rect width="20" height="20" fill="${fill}"/></g>`))).toThrow(/paint|Unfilled/);
  for (const fill of ['rebeccapurple', 'rgb(20 30% 40)', 'rgb(0, 20, 255)', '#123abc'])
    expect(parseSvgSketch(svg(`<rect width="20" height="20" fill="${fill}"/>`)).contours).toHaveLength(1);
});
