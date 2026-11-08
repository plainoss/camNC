import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cadFaceSketches, parseCadDocument, setCadVariable, type CadDocument } from '@wbcnc/cad';
import { describe, expect, it, onTestFinished } from 'vitest';
import { design, editCad, inspectCadDocument, renderCadSvg, shortHandles, type CadReport, type CadScript, type DesignEdit } from './index';
import { typeErrors } from './typecheck';

const examples = fileURLToPath(new URL('../examples/', import.meta.url));
const plate: CadScript = d => {
  const part = d.part('Plate', { thickness: 18 });
  part.profile.rect({ at: [0, 0], w: 100, h: 80 });
};
const codes = (issues: { code: string }[]) => issues.map(issue => issue.code);

describe('example parts', () => {
  it.each(['plate', 'shelf-side', 'tray', 'bracket', 'cupboard'])('%s meets what it expects of itself', async name => {
    const { default: script } = await import(`../examples/${name}.cad.ts`);
    const result = await editCad(null, script);
    expect(result.report.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(typeErrors(path.join(examples, `${name}.cad.ts`))).toEqual([]);
  });

  it('covers every example file', async () => {
    expect((await readdir(examples)).sort()).toEqual([
      'bracket.cad.ts',
      'cupboard.cad.ts',
      'plate.cad.ts',
      'shelf-side.cad.ts',
      'tray.cad.ts',
    ]);
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

describe('expressions', () => {
  it('lets a fillet radius follow a variable', async () => {
    const { document } = await editCad(null, d => {
      d.variable('round', '40mm');
      const top = d.part('Top').profile.rect({ at: [0, 0], w: 400, h: 300 });
      d.part('Top').profile.fillet(top.corners.slice(2), 'round');
    });
    const radius = document.parts[0]!.sketch.constraints.find(c => c.type === 'radius')!;
    expect('expression' in radius && [radius.value, radius.expression]).toEqual([40, 'round']);
  });

  it('works out a count as a plain number', async () => {
    let count = 0;
    await editCad(null, d => {
      d.variable('height', '720mm');
      d.variable('pitch', '32mm');
      count = d.value('(height - 160)/pitch');
    });
    expect(count).toBe(17.5);
  });

  it('works out floor, round, min, max and sqrt', async () => {
    const values: number[] = [];
    await editCad(null, d => {
      d.variable('height', '720mm');
      d.variable('pitch', '32mm');
      values.push(d.value('floor((height - 160)/pitch)'), d.value('round(17.5)'));
      values.push(d.value('min(height; 600mm)'), d.value('max(height, 600mm)'));
      values.push(d.value('sqrt(300mm*300mm + 400mm*400mm)'));
    });
    expect(values).toEqual([17, 18, 600, 720, 500]);
  });

  it('refuses a cut whose depth a variable takes to zero', async () => {
    const { scriptError } = await editCad(null, d => {
      d.variable('board', '18mm');
      const plate = d.part('Plate', { thickness: 'board' });
      plate.profile.rect({ at: [0, 0], w: 100, h: 100 });
      const top = plate.sketchOn('top');
      top.rect({ at: [20, 20], w: 20, h: 20 });
      plate.cut(top.regionAt(30, 30), { depth: 'board - 18mm' });
    });
    expect(scriptError).toBe("A cut needs some depth, not 0 mm from 'board - 18mm'.");
  });

  it('patterns a rectangle as its edges', async () => {
    const { report } = await editCad(null, d => {
      const side = d.part('Side');
      side.profile.rect({ at: [0, 0], w: 300, h: 900 });
      const dados = side.sketchOn('top');
      dados.pattern([dados.rect({ at: [20, 200], w: 260, h: 18 })], { count: 3, step: [0, 250] });
    });
    expect(report.errors).toEqual([]);
    expect(report.parts[0]!.sketches[1]!.entities.filter(entity => entity.type === 'line')).toHaveLength(12);
  });
});

describe('review cases', () => {
  const change = (document: CadDocument, name: string, expression: string) => {
    const variable = document.variables!.find(candidate => candidate.name === name)!;
    const changed = setCadVariable(document, { id: variable.id, name, expression });
    if ('error' in changed) throw new Error(changed.error);
    return changed.document;
  };

  it('keeps a hole that starts on the origin following its expression', async () => {
    const { document } = await editCad(null, d => {
      d.variable('offset', '0mm');
      const plate = d.part('Plate');
      plate.profile.rect({ at: [-50, -50], w: 100, h: 100 });
      plate.profile.circle({ at: ['offset', 0], d: 8 });
    });
    const { parts } = await inspectCadDocument(change(document, 'offset', '20mm'), new Map(), { toolpaths: false });
    const hole = parts[0]!.holes[0]!;
    expect(Math.min(...hole.map(p => p.x)) + 4).toBeCloseTo(20, 3);
  });

  it('keeps a path vertex that starts on the origin following its expression', async () => {
    const { document } = await editCad(null, d => {
      d.variable('offset', '0mm');
      d.part('Plate').profile.path([0, 'offset']).lineTo([100, 'offset']).lineTo([100, 'offset + 50']).lineTo([0, 'offset + 50']).close();
    });
    const { report } = await inspectCadDocument(change(document, 'offset', '10mm'), new Map(), { toolpaths: false });
    expect(report.parts[0]!.outline).toEqual({ at: [0, 10], size: [100, 50] });
    expect(report.parts[0]!.sketches[0]!.freedom).toBe(0);
  });

  it('follows a step written backwards', async () => {
    const { document } = await editCad(null, d => {
      d.variable('pitch', '32mm');
      const side = d.part('Side');
      side.profile.rect({ at: [0, 0], w: 100, h: 400 });
      const pins = side.sketchOn('top');
      pins.pattern([pins.circle({ at: [50, 300], d: 5 })], { count: 3, step: [0, '-pitch'] });
    });
    const { report } = await inspectCadDocument(change(document, 'pitch', '40mm'), new Map(), { toolpaths: false });
    expect(report.errors).toEqual([]);
    const ys = report.parts[0]!.sketches[1]!.entities.flatMap(e => (e.type === 'circle' ? [(e as { at: number[] }).at[1]] : []));
    expect(ys.sort()).toEqual([220, 260, 300]);
  });

  it('splits a half circle into quarters even when asked for the long way round', async () => {
    const { report } = await editCad(null, d => {
      d.part('Slot').profile.path([0, 0]).lineTo([40, 0]).arcTo([40, 5], { r: 2.5, large: true }).lineTo([0, 5]).close();
    });
    expect(report.parts[0]!.outline).toEqual({ at: [0, 0], size: [42.5, 5] });
  });

  it("measures a cut against its own sketch's curves only", async () => {
    const { report } = await editCad(null, d => {
      const plate = d.part('Plate');
      plate.profile.rect({ at: [0, 0], w: 100, h: 100 });
      const pocket = plate.sketchOn('top');
      pocket.circle({ at: [50, 50], d: 20 });
      plate.cut(pocket.regionAt(50, 50), { depth: 5 });
      plate.sketchOn('top').circle({ at: [50.2, 50], d: 20 });
    });
    expect(report.parts[0]!.cuts[0]!.size).toEqual([20, 20]);
  });

  it('measures a pocket made from a profile loop against the profile sketch', async () => {
    const { report } = await editCad(null, d => {
      const plate = d.part('Plate');
      plate.profile.rect({ at: [0, 0], w: 100, h: 100 });
      // A slot with round ends, which come out short when only their chords are measured.
      plate.profile
        .path([40, 45])
        .lineTo([60, 45])
        .arcTo([60, 55], { tangent: true })
        .lineTo([40, 55])
        .arcTo([40, 45], { tangent: true })
        .close();
      plate.cut(plate.profile.regionAt(50, 50), { depth: 5 });
    });
    expect(report.parts[0]!.cuts[0]!.size).toEqual([30, 10]);
  });

  it('warns when a cut on the underside fits no tool, though side B then has nothing to cut', async () => {
    const { report } = await editCad(null, d => {
      const plate = d.part('Plate');
      plate.profile.rect({ at: [0, 0], w: 100, h: 80 });
      const under = plate.sketchOn('underside');
      under.circle({ at: [-50, 40], d: 2 });
      plate.cut(under.regionAt(-50, 40), { depth: 3 });
    });
    expect(codes(report.warnings)).toContain('toolpath-missing');
  });
});

describe('corner relief', () => {
  const mortised = (relief: string | number) => (d: DesignEdit) => {
    d.variable('bit', '6mm');
    const seat = d.part('Seat', { thickness: 18, relief });
    seat.profile.rect({ at: [0, 0], w: 200, h: 200 });
    seat.profile.rect({ at: [80, 91], w: 40, h: 18 });
  };

  it('puts dogbones in square inside corners and keeps the diameter as an expression', async () => {
    const { report, document, parts } = await editCad(null, mortised('bit'));
    expect(report.errors).toEqual([]);
    expect(document.parts[0]!.cornerRelief).toEqual({ diameter: 6, diameterExpression: 'bit' });
    // The mortise's four corners each gain a bone; the outline's convex corners don't.
    expect(parts[0]!.holes[0]!.length).toBeGreaterThan(4);
    expect(parts[0]!.outline).toHaveLength(4);
    // Relieved for a 6 mm bit, the 3.175 mm default cuts the bones fully.
    expect(codes(report.warnings)).not.toContain('relief-bit');
  });

  it('measures a dado as drawn, and says how far its bones reach', async () => {
    const { report } = await editCad(null, d => {
      const side = d.part('Side', { thickness: 18, relief: 6 });
      side.profile.rect({ at: [0, 0], w: 300, h: 600 });
      const dado = side.sketchOn('top');
      dado.rect({ at: [20, 200], w: 260, h: 15 });
      side.cut(dado.regionAt(150, 207), { depth: 6 });
    });
    expect(report.errors).toEqual([]);
    const [cut] = report.parts[0]!.cuts;
    expect(cut).toMatchObject({ at: [20, 200], size: [260, 15] });
    expect(cut!.relieved![1]).toBeGreaterThan(15);
  });

  it('warns when the bones are smaller than the bit that cuts them', async () => {
    const { report } = await editCad(null, mortised(2));
    expect(report.warnings.find(warning => warning.code === 'relief-bit')?.message).toMatch(
      /relieved for a ⌀2 bit, but this board is cut with a ⌀3\.175 bit/
    );
  });
});

describe('paths', () => {
  it('draws a slot of tangent arcs, fully constrained', async () => {
    const { ok, report } = await editCad(null, d => {
      const part = d.part('Slot plate');
      part.profile
        .path([0, 0])
        .lineTo([100, 0])
        .arcTo([100, 20], { tangent: true })
        .lineTo([0, 20])
        .arcTo([0, 0], { tangent: true })
        .close();
    });
    expect(report.errors).toEqual([]);
    expect(ok).toBe(true);
    // The ends bulge 10 mm past the straight sides.
    expect(report.parts[0]!.outline).toEqual({ at: [-10, 0], size: [120, 20] });
    expect(report.parts[0]!.sketches[0]!.freedom).toBe(0);
  });

  it('draws arcs of a given radius either way round, and keeps the radius as an expression', async () => {
    const { report, document } = await editCad(null, d => {
      d.variable('round', '30mm');
      const part = d.part('Bracket');
      // A quarter-round corner: up the right side, then round to the top.
      part.profile.path([0, 0]).lineTo([100, 0]).lineTo([100, 70]).arcTo([70, 100], { r: 'round' }).lineTo([0, 100]).close();
      // A clockwise scallop cut into the bottom edge of a second part.
      d.part('Shelf').profile.path([0, 0]).arcTo([60, 0], { r: 40, clockwise: true }).lineTo([60, 50]).lineTo([0, 50]).close();
    });
    expect(report.errors).toEqual([]);
    expect(report.parts[0]!.outline).toEqual({ at: [0, 0], size: [100, 100] });
    expect(report.parts.map(part => part.sketches[0]!.freedom)).toEqual([0, 0]);
    const radius = document.parts[0]!.sketch.constraints.find(c => c.type === 'radius')!;
    expect('expression' in radius && radius.expression).toBe('round');
    // Clockwise from left to right, the arc bows up into the shelf: its centre is below the edge, and it rises 13.5 mm.
    const scallop = report.parts[1]!.sketches[0]!.entities.find(entity => entity.type === 'arc') as { at: number[]; r: number };
    expect(scallop.at[1]).toBeCloseTo(-Math.sqrt(40 ** 2 - 30 ** 2), 3);
    expect(report.parts[1]!.outline!.size).toEqual([60, 50]);
    expect(report.parts[1]!.outline!.at.map(Math.abs)).toEqual([0, 0]);
  });

  it('draws a wavy edge of arcs that run into each other smoothly', async () => {
    const { report } = await editCad(null, d => {
      const path = d.part('Coat rack').profile.path([0, 0]).arcTo([150, 0], { r: 300 });
      for (let x = 300; x <= 900; x += 150) path.arcTo([x, 0], { tangent: true });
      path.lineTo([900, 130]).lineTo([0, 130]).close();
    });
    expect(report.errors).toEqual([]);
    expect(report.parts[0]!.sketches[0]!.freedom).toBe(0);
  });

  it('draws a half circle of a given radius fully constrained, through its top', async () => {
    const { report } = await editCad(null, d => {
      d.part('Keyhole').profile.path([0, 0]).lineTo([40, 0]).arcTo([40, 5], { r: 2.5 }).lineTo([0, 5]).close();
    });
    expect(report.warnings).toEqual([]);
    expect(report.parts[0]!.sketches[0]!.freedom).toBe(0);
    expect(report.parts[0]!.outline).toEqual({ at: [0, 0], size: [42.5, 5] });
  });

  it('draws S-curves whose halves share a center without repeating a constraint', async () => {
    const { report } = await editCad(null, d => {
      const path = d.part('Wave').profile.path([0, 0]);
      // Each half leaves its crest level, so the halves on either side of a crest turn about the same center.
      let previous: [number, number] = [0, 0];
      for (const next of [
        [100, 20],
        [200, -20],
        [300, 20],
      ] as [number, number][]) {
        const middle: [number, number] = [(previous[0] + next[0]) / 2, (previous[1] + next[1]) / 2];
        const [dx, dy] = [middle[0] - previous[0], middle[1] - previous[1]];
        const r = (dx * dx + dy * dy) / (2 * Math.abs(dy)),
          rising = dy > 0;
        path.arcTo(middle, { r, clockwise: !rising }).arcTo(next, { r, clockwise: rising });
        previous = next;
      }
      path.lineTo([300, 120]).lineTo([0, 120]).close();
    });
    expect(report.warnings).toEqual([]);
    expect(report.parts[0]!.sketches[0]!.freedom).toBe(0);
  });

  it('reports sizes from where curves reach, not from the chords they are drawn with', async () => {
    const { report } = await editCad(null, d => {
      const part = d.part('Rack');
      part.profile.path([0, 0]).arcTo([300, 0], { r: 400 }).lineTo([300, 115]).lineTo([0, 115]).close();
      const top = part.sketchOn('top');
      top.circle({ at: [150, 60], d: 14 });
      part.cut(top.regionAt(150, 60), { depth: 5 });
    });
    // The arch dips 400 - √(400² - 150²) below the bottom.
    expect(report.parts[0]!.outline!.size[1]).toBeCloseTo(115 + 400 - Math.sqrt(400 ** 2 - 150 ** 2), 2);
    expect(report.parts[0]!.cuts[0]!.size).toEqual([14, 14]);
  });

  it('says what went wrong', async () => {
    const tooSmall = await editCad(null, d => d.part('A').profile.path([0, 0]).arcTo([100, 0], { r: 20 }));
    expect(tooSmall.scriptError).toBe("A 20 mm radius can't reach 100, 0: it needs at least 50 mm.");
    const ahead = await editCad(null, d => d.part('A').profile.path([0, 0]).lineTo([50, 0]).arcTo([100, 0], { tangent: true }));
    expect(ahead.scriptError).toBe('100, 0 is straight ahead: use lineTo.');
    const first = await editCad(null, d => d.part('A').profile.path([0, 0]).arcTo([100, 0], { tangent: true }));
    expect(first.scriptError).toBe('A tangent arc needs a segment before it to carry on from.');
  });
});

describe('part studio', () => {
  it('draws a part on a face picked by the way it looks, and keeps it there when that part grows', async () => {
    const script = (board: string) => (d: DesignEdit) => {
      d.variable('board', board);
      const side = d.part('Side', { thickness: 'board' });
      side.profile.rect({ at: [0, 0], w: 300, h: 600 });
      side.drawOn('right');
      const cleat = d.part('Cleat', { thickness: 20 });
      cleat.profile.rect({ at: [0, 100], w: 300, h: 40 });
      cleat.drawOn(side.face('+x'));
    };
    const box = (report: CadReport) => report.assembly!.parts.find(part => part.name === 'Cleat')!;
    expect(box((await editCad(null, script('18mm'))).report).at[0]).toBe(18);
    expect(box((await editCad(null, script('25mm'))).report).at[0]).toBe(25);
    const { report } = await editCad(null, script('18mm'));
    const cleat = report.steps!.find(step => step.kind === 'drawnOn' && step.part === 'Cleat')!;
    expect(cleat.frameInWords).toMatch(/^Side's .*: sketch origin at .*looking \+x\.$/);
  });

  it('names the faces a part has when none looks the way asked', async () => {
    const { scriptError } = await editCad(null, d => {
      const gusset = d.part('Gusset');
      gusset.profile.polygon([
        [0, 0],
        [100, 0],
        [0, 100],
      ]);
      gusset.drawOn('top');
      gusset.face('+x');
    });
    expect(scriptError).toBe('Gusset has no face pointing +x. Its faces point +z (top), -z (underside), -y, -x, plus 1 slanted.');
  });

  it('asks for a profile before a part is drawn on a face', async () => {
    const { scriptError } = await editCad(null, d => d.part('Block').drawOn('top'));
    expect(scriptError).toBe('Draw Block’s profile before drawing it on a plane or face.');
  });

  it('cuts one part with another, with room to spare', async () => {
    const { report } = await editCad(null, d => {
      d.variable('fit', '0.2mm');
      const leg = d.part('Leg', { thickness: 18 });
      leg.profile.rect({ at: [0, 0], w: 200, h: 400 });
      leg.drawOn('front');
      // A rail lying across the leg's top end, sunk 9 mm into it.
      const rail = d.part('Rail', { thickness: 18 });
      rail.profile.rect({ at: [-50, -40], w: 300, h: 40 });
      rail.drawOn('top', { offset: '400mm - 9mm' });
      d.cutParts(leg, { with: rail, clearance: 'fit' });
    });
    expect(report.errors).toEqual([]);
    const [opening] = report.steps!.flatMap(step => (step.kind === 'partCut' ? step.cuts : []));
    expect(opening).toMatchObject({ target: 'Leg', tool: 'Rail' });
    expect(report.assembly!.collisions).toEqual([]);
  });

  it('repeats a part in a row that follows a variable', async () => {
    const { report } = await editCad(null, d => {
      d.variable('slats', '5');
      const slat = d.part('Slat', { thickness: 12 });
      slat.profile.rect({ at: [0, 0], w: 40, h: 600 });
      slat.drawOn('top');
      slat.pattern({ axis: 'x', count: 'slats', spacing: '60mm' });
    });
    expect(report.assembly!.parts.map(part => part.at[0])).toEqual([0, 60, 120, 180, 240]);
  });

  it('refuses a part pattern too long for the document to reopen', async () => {
    const result = await editCad(null, d => {
      const slat = d.part('Slat', { thickness: 12 });
      slat.profile.rect({ at: [0, 0], w: 10, h: 100 });
      slat.drawOn('top');
      slat.pattern({ axis: 'x', count: 201, spacing: 20 });
    });
    expect(result.scriptError).toBe('A part pattern makes at most 200 parts, not 201.');
  });
});

describe('variables and assembly', () => {
  const box = (report: { assembly?: { parts: { name: string; at: number[]; size: number[] }[] } }, name: string) =>
    report.assembly!.parts.find(part => part.name === name)!;

  it("places the cupboard's parts where a cabinet maker would", async () => {
    const { cupboard } = await import('../examples/cupboard.cad');
    const { report } = await editCad(null, cupboard());
    expect(report.assembly!.collisions).toEqual([]);
    expect(box(report, 'Side')).toEqual({ name: 'Side', at: [0, 0, 0], size: [18, 300, 720] });
    expect(box(report, 'Right side')).toEqual({ name: 'Right side', at: [582, 0, 0], size: [18, 300, 720] });
    // The right side is the left's mirror image, which CAM cuts as a shape of its own.
    expect(report.parts.find(part => part.name === 'Side')!.pieces).toEqual({ names: ['Side'], mirrored: ['Right side'] });
    expect(box(report, 'Back')).toEqual({ name: 'Back', at: [10, 294, 0], size: [580, 6, 720] });
  });

  it('builds the same cupboard wider and from thicker board', async () => {
    const { cupboard } = await import('../examples/cupboard.cad');
    const { ok, report } = await editCad(null, cupboard({ width: '900mm', board: '19mm' }));
    expect(report.errors).toEqual([]);
    expect(ok).toBe(true);
    expect(box(report, 'Top').size).toEqual([878, 294, 19]);
    // The top and bottom cut their rebates as wide as they are thick.
    const rebates = report.steps!.flatMap(step => (step.kind === 'partCut' ? step.cuts : []));
    expect(rebates.map(cut => [cut.tool, cut.length, cut.depth])).toEqual([
      ['Top', 19, 8],
      ['Bottom', 19, 8],
      ['Back', 720, 8],
    ]);
  });

  it('keeps sizes, placements and rebate depths following changed variables, as a person would change them', async () => {
    const { cupboard } = await import('../examples/cupboard.cad');
    let { document } = await editCad(null, cupboard());
    for (const [name, expression] of [
      ['width', '900mm'],
      ['board', '19mm'],
      ['housing', '9mm'],
    ]) {
      const variable = document.variables!.find(candidate => candidate.name === name)!;
      const changed = setCadVariable(document, { id: variable.id, name: name!, expression: expression! });
      if ('error' in changed) throw new Error(changed.error);
      document = changed.document;
    }
    const { report } = await inspectCadDocument(document, new Map(), { toolpaths: false });
    expect(report.errors).toEqual([]);
    expect(report.parts.find(part => part.name === 'Top')!.outline!.size).toEqual([880, 294]);
    expect(
      report.parts
        .find(part => part.name === 'Side')!
        .cuts.filter(cut => cut.to !== 12)
        .map(cut => cut.to)
    ).toEqual([9, 9, 9]);
    expect(box(report, 'Right side')).toMatchObject({ at: [881, 0, 0], size: [19, 300, 720] });
    expect(box(report, 'Top').at).toEqual([10, 0, 701]);
    expect(report.assembly!.collisions).toEqual([]);
  });

  it('grows and cuts the pin rows with the height and keeps the shelf on its pin', async () => {
    const { cupboard } = await import('../examples/cupboard.cad');
    const { document } = await editCad(null, cupboard());
    const height = document.variables!.find(variable => variable.name === 'height')!;
    const changed = setCadVariable(document, { id: height.id, name: 'height', expression: '900mm' });
    if ('error' in changed) throw new Error(changed.error);
    const { report } = await inspectCadDocument(changed.document, new Map(), { toolpaths: false });
    expect(report.errors).toEqual([]);
    const pins = report.parts.find(part => part.name === 'Side')!.sketches[1]!;
    // (900 - 36 - 160)/32 + 1 = 23 a row, up from 17.
    expect(pins.entities.filter(entity => entity.type === 'circle')).toHaveLength(46);
    // One cut on the first pin covers every copy, including the twelve the taller sides gain.
    const pinCuts = report.parts.find(part => part.name === 'Side')!.cuts.filter(cut => cut.to === 12);
    expect(pinCuts).toHaveLength(46);
    expect(Math.max(...pinCuts.map(cut => cut.at[1]!))).toBeCloseTo(98 + 22 * 32 - 2.5, 1);
    expect(pins.freedom).toBe(0);
    expect(box(report, 'Top').at).toEqual([10, 0, 882]);
    expect(box(report, 'Shelf').at).toEqual([19, 0, 260.5]);
    expect(report.assembly!.collisions).toEqual([]);
  });

  it('drops the pins a shorter cupboard loses, cuts and all', async () => {
    const { cupboard } = await import('../examples/cupboard.cad');
    const { document } = await editCad(null, cupboard());
    const height = document.variables!.find(variable => variable.name === 'height')!;
    const changed = setCadVariable(document, { id: height.id, name: 'height', expression: '400mm' });
    if ('error' in changed) throw new Error(changed.error);
    const { report } = await inspectCadDocument(changed.document, new Map(), { toolpaths: false });
    expect(report.errors).toEqual([]);
    // (400 - 36 - 160)/32 + 1 = 7 a row.
    expect(report.parts.find(part => part.name === 'Side')!.cuts.filter(cut => cut.to === 12)).toHaveLength(14);
  });

  it('reports parts whose numeric placement no longer fits after a change', async () => {
    const { cupboard } = await import('../examples/cupboard.cad');
    const { document } = await editCad(null, cupboard());
    // The right side's copy keeps a typed position, so it stays where it was.
    const pinned = {
      ...document,
      parts: document.parts.map(part =>
        part.name === 'Side'
          ? { ...part, copies: part.copies!.map(copy => ({ ...copy, placement: { ...copy.placement!, positionExpressions: undefined } })) }
          : part
      ),
    };
    const width = document.variables!.find(variable => variable.name === 'width')!;
    const changed = setCadVariable(pinned, { id: width.id, name: 'width', expression: '900mm' });
    if ('error' in changed) throw new Error(changed.error);
    const { report } = await inspectCadDocument(changed.document, new Map(), { toolpaths: false });
    // The panels that reach the stranded side cut it where it now stands; the shelf, which isn't a tool, still hits it.
    expect(report.assembly!.collisions.map(c => c.parts.join(' / '))).toEqual(expect.arrayContaining(['Right side / Shelf']));
    expect(report.errors.map(error => error.code)).toContain('parts-collide');
  });

  it('places a mirrored copy as the mirror image of its part', async () => {
    const { report } = await editCad(null, d => {
      // A bracket with a notch near its left end: the other hand needs it at the right.
      const bracket = d.part('Bracket', { thickness: 18 });
      bracket.profile.rect({ at: [0, 0], w: 200, h: 100 });
      bracket.profile.rect({ at: [20, 40], w: 30, h: 20 });
      bracket.place({ at: [0, 0, 0] });
      // Mirrored, its sketch runs from x = -200 to 0, so it sits 200 further along to land beside the first.
      bracket.copy({ at: [400, 0, 0], mirrored: true });
    });
    expect(report.errors).toEqual([]);
    expect(report.parts[0]!.pieces).toEqual({ names: ['Bracket'], mirrored: ['Bracket 2'] });
    expect(report.assembly!.parts.map(({ name, at, size }) => [name, at, size])).toEqual([
      ['Bracket', [0, 0, 0], [200, 100, 18]],
      ['Bracket 2', [200, 0, 0], [200, 100, 18]],
    ]);
  });

  it('finds a shelf that runs into a side', async () => {
    const { report } = await editCad(null, d => {
      d.variable('board', '18mm');
      const side = d.part('Side', { thickness: 'board' });
      side.profile.rect({ at: [0, 0], w: 300, h: 600 });
      side.place({ at: [0, 0, 0], x: '+y', y: '+z' });
      const shelf = d.part('Shelf', { thickness: 'board' });
      shelf.profile.rect({ at: [0, 0], w: 400, h: 300 });
      shelf.place({ at: ['board - 1mm', 0, 300] });
    });
    expect(report.assembly!.collisions).toMatchObject([{ parts: ['Side', 'Shelf'], at: [17, 0, 300], size: [1, 300, 18], volume: 5400 }]);
    expect(report.ok).toBe(false);
  });

  it('saves expressions so the app keeps following them', async () => {
    const { document } = await editCad(null, d => {
      d.variable('board', '18mm');
      const part = d.part('Panel', { thickness: 'board' });
      part.profile.rect({ center: ['100mm', 50], w: '2*board', h: 40 });
    });
    const part = document.parts[0]!;
    expect(part.thicknessExpression).toBe('board');
    expect(part.sketch.constraints.flatMap(c => ('expression' in c && c.expression ? [[c.type, c.expression]] : []))).toEqual([
      ['distanceX', '2*board'],
      ['positionX', '(100mm) - (2*board)/2'],
    ]);
  });

  it("refuses an expression it can't work out, naming the value", async () => {
    const { scriptError } = await editCad(null, d => d.part('Panel').profile.rect({ at: [0, 0], w: 'depth + 10', h: 40 }));
    expect(scriptError).toMatch(/^Width "depth \+ 10": /);
  });
});

describe('toolpath summary', () => {
  it('counts each pocket on its own and warns when CAM can fit no tool in one', async () => {
    const { report } = await editCad(null, d => {
      const door = d.part('Door', { thickness: 19 });
      door.profile.rect({ at: [0, 0], w: 400, h: 200 });
      const back = door.sketchOn('top');
      back.circle({ at: [40, 50], d: 35 });
      back.circle({ at: [40, 150], d: 35 });
      for (const [x, y] of [
        [40, 50],
        [40, 150],
      ] as const)
        door.cut(back.regionAt(x, y), { depth: 13 });
      door.expect({ pockets: 2 });
      const rack = d.part('Rack', { thickness: 19 });
      rack.profile.rect({ at: [0, 0], w: 200, h: 100 });
      const face = rack.sketchOn('top');
      // A 2 mm pocket: the default 3.175 mm bit doesn't fit in it.
      face.circle({ at: [100, 50], d: 2 });
      rack.cut(face.regionAt(100, 50), { depth: 1.5 });
    });
    expect(report.errors).toEqual([]);
    expect(report.warnings.filter(warning => warning.code === 'toolpath-missing').map(warning => warning.part)).toEqual(['Rack']);
  });

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

  it('plans cuts on the underside as a second side, after turning the board over', async () => {
    const { report } = await editCad(null, d => {
      const door = d.part('Door', { thickness: 19 });
      door.profile.rect({ at: [0, 0], w: 500, h: 300 });
      const front = door.sketchOn('top');
      front.rect({ at: [80, 80], w: 340, h: 140 });
      door.cut(front.regionAt(250, 150), { depth: 3 });
      // Hinge cups on the back. Seen from below, X runs the other way.
      const back = door.sketchOn('underside');
      back.circle({ at: [-22.5, 60], d: 35 });
      back.circle({ at: [-22.5, 240], d: 35 });
      for (const y of [60, 240]) door.cut(back.regionAt(-22.5, y), { depth: 13 });
    });
    expect(report.errors).toEqual([]);
    const door = report.parts[0]!;
    expect(door.cam).toEqual({ pockets: 1, throughHoles: 0, undersidePockets: 1 });
    const labels = door.toolpaths!.operations.map(op => op.label);
    expect(labels.some(label => label.startsWith('Side B: ') && /13 deep/.test(label))).toBe(true);
    expect(labels.some(label => !label.startsWith('Side B: ') && /3 deep/.test(label))).toBe(true);
    expect(door.toolpaths!.blocked).toEqual([]);
  });

  it('says when cuts from the two faces meet', async () => {
    const { report } = await editCad(null, d => {
      const part = d.part('Plate', { thickness: 18 });
      part.profile.rect({ at: [0, 0], w: 100, h: 80 });
      const top = part.sketchOn('top');
      top.rect({ at: [20, 20], w: 30, h: 30 });
      part.cut(top.regionAt(35, 35), { depth: 10 });
      const under = part.sketchOn('underside');
      under.rect({ at: [-60, 25], w: 30, h: 30 });
      part.cut(under.regionAt(-45, 40), { depth: 10 });
    });
    expect(codes(report.errors)).toContain('cam-sides');
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

  it('keeps a hole inside a pocket visible and labels a round cut inside itself', async () => {
    const { parts } = await editCad(null, d => {
      const part = d.part('Coaster', { thickness: 10 });
      part.profile.circle({ at: [45, 45], d: 90 });
      part.profile.rect({ at: [35, 35], w: 20, h: 20 });
      const top = part.sketchOn('top');
      top.circle({ at: [45, 45], d: 80 });
      part.cut(top.regionAt(80, 45), { depth: 2 });
    });
    const svg = renderCadSvg(parts);
    expect(svg).toMatch(/<path d="[^"]*" clip-path="url\(#material-0\)"/);
    const [, x, y] = svg.match(/<text x="([\d.]+)" y="([\d.]+)" font-size="[\d.]+">2 mm/)!;
    // The coaster sits 4 units in from the drawing's edge, and the label must lie inside the recess.
    const unit = 90 / 40;
    expect(Math.hypot(+x! - (4 * unit + 45), +y! - (4 * unit + 45))).toBeLessThan(40);
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
