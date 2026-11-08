import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cadFaceSketches, parseCadDocument } from '@wbcnc/cad';
import { describe, expect, it, onTestFinished } from 'vitest';
import { design, editCad, inspectCadDocument, renderCadSvg, shortHandles, type CadScript } from './index';
import { typeErrors } from './typecheck';

const examples = fileURLToPath(new URL('../examples/', import.meta.url));
const plate: CadScript = d => {
  const part = d.part('Plate', { thickness: 18 });
  part.profile.rect({ at: [0, 0], w: 100, h: 80 });
};
const codes = (issues: { code: string }[]) => issues.map(issue => issue.code);

describe('example parts', () => {
  it.each(['plate', 'shelf-side', 'tray', 'bracket'])('%s meets what it expects of itself', async name => {
    const { default: script } = await import(`../examples/${name}.cad.ts`);
    const result = await editCad(null, script);
    expect(result.report.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(typeErrors(path.join(examples, `${name}.cad.ts`))).toEqual([]);
  });

  it('covers every example file', async () => {
    expect((await readdir(examples)).sort()).toEqual(['bracket.cad.ts', 'plate.cad.ts', 'shelf-side.cad.ts', 'tray.cad.ts']);
  });

  it('sends a floor cut to CAM below the pocket it sits in', async () => {
    const { default: tray } = await import('../examples/tray.cad');
    const { report } = await editCad(null, tray);
    expect(report.parts[0]!.cuts.map(({ from, to }) => [from, to])).toEqual([
      [0, 8],
      [8, 14],
    ]);
    expect(report.parts[0]!.cam).toEqual({ pockets: 2, throughHoles: 0 });
  });
});

describe('toolpath summary', () => {
  it('plans each part as the app would, without handing out a program', async () => {
    const { default: tray } = await import('../examples/tray.cad');
    const { report } = await editCad(null, tray);
    const toolpaths = report.parts[0]!.toolpaths!;
    expect(toolpaths.bit).toBe(3.175);
    expect(toolpaths.blocked).toEqual([]);
    expect(toolpaths.minutes).toBeGreaterThan(0);
    expect(toolpaths.operations.map(op => op.label)).toEqual([
      '1 pocket 8 deep',
      '1 pocket 14 deep, from 8',
      'Outline: rough + final pass',
    ]);
    expect(JSON.stringify(report)).not.toMatch(/gcode|G0 |G1 /i);
  });

  it('can be left out', async () => {
    const { default: plate } = await import('../examples/plate.cad');
    const { document } = await editCad(null, plate);
    const { report } = await inspectCadDocument(document, new Map(), { toolpaths: false });
    expect(report.parts[0]!.toolpaths).toBeUndefined();
    expect(report.parts[0]!.cam).toEqual({ pockets: 1, throughHoles: 4 });
  });
});

describe('editing a design', () => {
  it('produces a document the app can load', async () => {
    const { default: tray } = await import('../examples/tray.cad');
    const { document } = await editCad(null, tray);
    expect(document.version).toBe(2);
    expect(parseCadDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });

  it('keeps what was already there, so hand edits and IDs survive', async () => {
    const first = await editCad(null, plate);
    const before = first.document.parts[0]!;
    const second = await editCad(first.document, d => {
      d.part('Plate').profile.circle({ at: [50, 40], d: 10 });
    });
    const after = second.document.parts[0]!;
    expect(second.ok).toBe(true);
    expect(second.document.id).toBe(first.document.id);
    expect(after.id).toBe(before.id);
    expect(after.sketch.entities.map(e => e.id).slice(0, before.sketch.entities.length)).toEqual(before.sketch.entities.map(e => e.id));
    expect(second.document.revision).toBe(first.document.revision + 1);
    expect(second.report.parts[0]!.holes).toBe(1);
  });

  it('finds things by the handles in the report', async () => {
    const first = await editCad(null, plate);
    const edge = first.report.parts[0]!.sketches[0]!.entities[0]!.ref;
    const result = await editCad(first.document, d => {
      const { profile } = d.part('Plate');
      expect(profile.find(edge).id.startsWith(edge)).toBe(true);
    });
    expect(result.ok).toBe(true);
  });

  it('removes a cut', async () => {
    let cut: { id: string };
    const first = await editCad(null, d => {
      const part = d.part('Plate');
      part.profile.rect({ at: [0, 0], w: 100, h: 80 });
      const top = part.sketchOn('top');
      top.rect({ at: [10, 10], w: 20, h: 20 });
      cut = part.cut(top.regionAt(20, 20), { depth: 3 });
    });
    const second = await editCad(first.document, d => d.part('Plate').remove(cut));
    expect(second.report.parts[0]!.cuts).toEqual([]);
  });

  it('adds a depth to an inner loop, which stops it being a through-hole', async () => {
    const { report } = await editCad(null, d => {
      const part = d.part('Plate');
      part.profile.rect({ at: [0, 0], w: 100, h: 80 });
      part.profile.circle({ at: [50, 40], d: 20 });
      part.cut(part.profile.regionAt(50, 40), { depth: 5 });
    });
    expect(report.parts[0]).toMatchObject({ holes: 0, cam: { pockets: 1, throughHoles: 0 } });
  });
});

describe('constraining by hand', () => {
  it('gives the handles a free curve needs, and reaches a fully constrained slot', async () => {
    const { default: bracket } = await import('../examples/bracket.cad');
    const { report } = await editCad(null, bracket);
    expect(report.parts[0]!.sketches[0]!.freedom).toBe(0);
    expect(report.warnings).toEqual([]);
  });

  it('holds a line to a set length', async () => {
    const { report } = await editCad(null, d => {
      const { profile } = d.part('Plate');
      const line = profile.line([0, 0], [10, 0]);
      profile.distance(line.start, line.end, 25);
    });
    const entity = report.parts[0]!.sketches[0]!.entities[0]! as { a: number[]; b: number[] };
    expect(Math.hypot(entity.b[0]! - entity.a[0]!, entity.b[1]! - entity.a[1]!)).toBeCloseTo(25, 3);
  });
});

describe('picking regions', () => {
  it('picks the innermost region, as a click does', async () => {
    const { report } = await editCad(null, d => {
      const part = d.part('Plate');
      part.profile.rect({ at: [0, 0], w: 100, h: 80 });
      const top = part.sketchOn('top');
      top.rect({ at: [10, 10], w: 80, h: 60 });
      top.rect({ at: [40, 30], w: 20, h: 20 });
      part.cut(top.regionAt(50, 40), { depth: 2 });
    });
    expect(report.parts[0]!.cuts[0]).toMatchObject({ at: [40, 30], size: [20, 20] });
  });

  it('leaves out an island when the pick is outside it', async () => {
    const { parts } = await editCad(null, d => {
      const part = d.part('Plate');
      part.profile.rect({ at: [0, 0], w: 100, h: 80 });
      const top = part.sketchOn('top');
      top.rect({ at: [10, 10], w: 80, h: 60 });
      top.rect({ at: [40, 30], w: 20, h: 20 });
      part.cut(top.regionAt(20, 20), { depth: 2 });
    });
    expect(parts[0]!.cuts![0]!.islands).toHaveLength(1);
  });

  it('says so when nothing is there, and leaves the design alone', async () => {
    const first = await editCad(null, plate);
    const result = await editCad(first.document, d => {
      const part = d.part('Plate');
      part.profile.circle({ at: [50, 40], d: 10 });
      part.cut(part.sketchOn('top').regionAt(500, 500), { depth: 2 });
    });
    expect(result.ok).toBe(false);
    expect(result.scriptError).toMatch(/no region at 500, 500/);
    expect(result.document.revision).toBe(first.document.revision);
    expect(result.report.parts[0]!.holes).toBe(0);
  });
});

describe('reporting problems', () => {
  it('fails a design that is valid but not what was meant', async () => {
    const result = await editCad(null, d => {
      const part = d.part('Plate');
      part.profile.rect({ at: [0, 0], w: 100, h: 80 });
      part.expect({ size: [100, 90], thickness: 12, holes: 1, pockets: 1, depths: [5] });
    });
    expect(result.ok).toBe(false);
    expect(result.report.errors.map(e => e.message.split(':')[0])).toEqual(['size', 'thickness', 'holes', 'pockets', 'depths']);
  });

  it('reports a cut deeper than the material, in terms a script can act on', async () => {
    const { ok, report } = await editCad(null, d => {
      const part = d.part('Plate', { thickness: 10 });
      part.profile.rect({ at: [0, 0], w: 100, h: 80 });
      const top = part.sketchOn('top');
      top.rect({ at: [10, 10], w: 20, h: 20 });
      part.cut(top.regionAt(20, 20), { depth: 12 });
    });
    expect(ok).toBe(false);
    expect(codes(report.errors)).toEqual(['cut-too-deep']);
    expect(report.errors[0]).toMatchObject({ part: 'Plate' });
  });

  it('reports conflicting dimensions', async () => {
    const { ok, report } = await editCad(null, d => {
      const { profile } = d.part('Plate');
      const { edges, corners } = profile.rect({ at: [0, 0], w: 100, h: 80 });
      profile.distance(corners[0]!, corners[1]!, 50, 'x');
      expect(edges.bottom.id).toBeTruthy();
    });
    expect(ok).toBe(false);
    expect(report.status).not.toBe('solved');
  });

  it('warns about geometry left free, without failing', async () => {
    const { ok, report } = await editCad(null, d => {
      const { profile } = d.part('Plate');
      profile.rect({ at: [0, 0], w: 100, h: 80 });
      profile.line([10, 10], [20, 20]);
    });
    expect(report.parts[0]!.sketches[0]!.freedom).toBeGreaterThan(0);
    expect(codes(report.warnings)).toContain('underconstrained');
    expect(ok).toBe(report.errors.length === 0);
  });

  it('warns when a floor cut reaches beyond its pocket', async () => {
    const { report } = await editCad(null, d => {
      const part = d.part('Plate', { thickness: 20 });
      part.profile.rect({ at: [0, 0], w: 100, h: 80 });
      const top = part.sketchOn('top');
      top.rect({ at: [10, 10], w: 30, h: 30 });
      const floor = part.sketchOn({ floorOf: part.cut(top.regionAt(25, 25), { depth: 5 }) });
      floor.rect({ at: [30, 30], w: 40, h: 40 });
      part.cut(floor.regionAt(50, 50), { depth: 5 });
    });
    expect(codes(report.warnings)).toContain('cut-outside-floor');
  });

  it('says underside cuts go to a second side, which the report leaves out', async () => {
    const { report } = await editCad(null, d => {
      const part = d.part('Plate');
      part.profile.rect({ at: [0, 0], w: 100, h: 80 });
      // Seen from below, X runs the other way.
      const under = part.sketchOn('underside');
      under.rect({ at: [-30, 10], w: 20, h: 20 });
      part.cut(under.regionAt(-20, 20), { depth: 3 });
    });
    expect(codes(report.warnings)).toContain('cam-underside');
    expect(report.parts[0]!.cam).toBeUndefined();
  });

  it('gives the largest radius when a fillet does not fit', async () => {
    const result = await editCad(null, d => {
      const { profile } = d.part('Plate');
      const { corners } = profile.polygon([
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ]);
      profile.fillet(corners, 50);
    });
    expect(result.scriptError).toMatch(/largest radius that fits/);
  });

  it('applies the editor’s relation rules', async () => {
    const result = await editCad(null, d => {
      const { profile } = d.part('Plate');
      profile.relate('tangent', profile.line([0, 0], [10, 0]), profile.line([0, 5], [10, 5]));
    });
    expect(result.scriptError).toMatch(/line and a circular curve/);
  });

  it('rejects impossible shapes up front', async () => {
    const reasons = await Promise.all(
      [
        (d: Parameters<CadScript>[0]) => d.part('P').profile.rect({ at: [0, 0], w: -1, h: 5 }),
        (d: Parameters<CadScript>[0]) => d.part('P').profile.rect({ w: 1, h: 5 }),
        (d: Parameters<CadScript>[0]) => d.part('P').profile.circle({ at: [0, 0], d: 0 }),
        (d: Parameters<CadScript>[0]) =>
          d.part('P').profile.polygon([
            [0, 0],
            [1, 1],
          ]),
        (d: Parameters<CadScript>[0]) => d.part('P').thickness(0),
        (d: Parameters<CadScript>[0]) => d.part('P').profile.find('nope'),
      ].map(script => editCad(null, script).then(result => result.scriptError))
    );
    expect(reasons.every(Boolean)).toBe(true);
  });

  it('lets a bug in the script itself surface as a bug', async () => {
    await expect(
      editCad(null, () => {
        throw new TypeError('script bug');
      })
    ).rejects.toThrow('script bug');
  });
});

describe('typecheck', () => {
  it('reports API misuse with its line', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cad-script-'));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'bad.cad.ts');
    await writeFile(
      file,
      `import { design } from '@wbcnc/cad-script';\nexport default design(d => {\n  d.part('P').profile.circle({ at: [0, 0], radius: 5 });\n});\n`
    );
    const errors = typeErrors(file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^line 3: .*radius/);
  });
});

describe('shortHandles', () => {
  it('uses just enough of an ID to tell it apart', () => {
    const handles = shortHandles(['abcd1111', 'abcd2222', 'ffff0000']);
    expect([...handles.values()]).toEqual(['abcd1', 'abcd2', 'ffff']);
  });
});

describe('renderCadSvg', () => {
  it('draws each part with its cuts labelled', async () => {
    const { default: script } = await import('../examples/plate.cad');
    const { parts } = await editCad(null, script);
    const svg = renderCadSvg(parts);
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('Plate, 18 mm');
    expect(svg).toContain('6 mm</text>');
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  it('draws nothing for nothing', () => {
    expect(renderCadSvg([])).not.toMatch(/NaN|Infinity|<path/);
  });
});

describe('inspectCadDocument', () => {
  it('reports on a document the same way an edit does', async () => {
    const edited = await editCad(null, design(plate));
    const { report } = await inspectCadDocument(edited.document);
    expect(report).toEqual(edited.report);
  });
});

it('applies a multi-curve concentric relation through the script API', async () => {
  const result = await editCad(null, d => {
    const part = d.part('Plate');
    part.profile.rect({ at: [0, 0], w: 120, h: 100 });
    const sketch = part.sketchOn('top');
    const a = sketch.arc({ at: [20, 20], r: 5, from: 0, to: 180 });
    const b = sketch.arc({ at: [50, 40], r: 10, from: 0, to: 180 });
    const c = sketch.arc({ at: [80, 60], r: 15, from: 0, to: 180 });
    sketch.relate('concentric', a, b, c);
  });
  expect(result.scriptError).toBeUndefined();
  expect(cadFaceSketches(result.document.parts[0]!)[0]!.sketch.constraints.filter(c => c.label === 'Concentric')).toHaveLength(2);
});

it('applies a general curve symmetry relation through the script API', async () => {
  const result = await editCad(null, d => {
    const part = d.part('Plate');
    part.profile.rect({ at: [0, 0], w: 120, h: 100 });
    const sketch = part.sketchOn('top');
    const axis = sketch.line([60, 10], [60, 90]);
    sketch.relate('symmetric', axis, sketch.line([80, 30], [100, 50]), sketch.line([20, 30], [40, 50]));
  });
  expect(result.scriptError).toBeUndefined();
  expect(cadFaceSketches(result.document.parts[0]!)[0]!.sketch.constraints.filter(c => c.type === 'symmetricCurves')).toHaveLength(1);
});
