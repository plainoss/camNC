import { parseCadDocument, solveCadDocument, type CadDocument } from '@wbcnc/cad';
import { loadStep } from '@wbcnc/cam';
import occtWasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import { describe, expect, it } from 'vitest';
import { assemblyModel, instanceKey } from '../assemblyModel';
import { studioStep } from './studioStep';

// Every saved fixture design, so a new one is exported as soon as it's added.
const files = import.meta.glob<unknown>(['../../../../../packages/cad-script/fixtures/designs/*.json', '!**/*.report.json'], {
  eager: true,
  import: 'default',
});
const designs = new Map(
  Object.entries(files).map(([file, json]) => [
    file
      .split('/')
      .at(-1)!
      .replace(/\.json$/, ''),
    json,
  ])
);
const names = [...designs.keys()];
async function load(name: string): Promise<CadDocument> {
  const solved = await solveCadDocument(parseCadDocument(structuredClone(designs.get(name))));
  return solved.document;
}

/** Back to the event loop between OCCT reads, so Vitest's worker can answer its runner. */
const yieldToVitest = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function volume(positions: ArrayLike<number>, indices: ArrayLike<number>) {
  let sum = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!].map(i => [
      positions[3 * i]!,
      positions[3 * i + 1]!,
      positions[3 * i + 2]!,
    ]) as [number[], number[], number[]];
    sum += a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) - a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) + a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!);
  }
  return Math.abs(sum / 6);
}

describe('studio STEP export', () => {
  it.each(names)('writes every part of %s as a closed solid where the 3D view has it', async name => {
    const document = await load(name);
    const model = assemblyModel(document);
    const result = studioStep(document, { fileName: `${name}.step` });
    expect(result.problems.filter(problem => /close/.test(problem.message))).toEqual([]);
    // A design whose only part can't be built yet has nothing to write, and says why.
    if (!model.meshes.length) return void expect(result.problems.length).toBeGreaterThan(0);
    const { bodies } = await loadStep(new TextEncoder().encode(result.text), { locateFile: () => occtWasmUrl });
    await yieldToVitest();
    // One body per piece in the view, joined bodies included, and the same material.
    expect(bodies).toHaveLength(model.meshes.length);
    const expected = model.meshes.reduce((sum, mesh) => sum + volume(mesh.positions, mesh.indices), 0),
      read = bodies.reduce((sum, body) => sum + volume(body.mesh.positions, body.mesh.indices), 0);
    expect(read / expected).toBeCloseTo(1, 3);
    // A loop rather than Math.min(...): a large design has more coordinates than a call can take as arguments.
    const bounds = (values: ArrayLike<number>[]) => {
      const box = [0, 1, 2].map(() => [Infinity, -Infinity]);
      for (const positions of values)
        for (let i = 0; i < positions.length; i++) {
          const range = box[i % 3]!;
          range[0] = Math.min(range[0]!, positions[i]!);
          range[1] = Math.max(range[1]!, positions[i]!);
        }
      return box;
    };
    const view = bounds(model.meshes.map(mesh => mesh.positions)),
      file = bounds(bodies.map(body => body.mesh.positions));
    view.forEach(([lo, hi], axis) => {
      expect(file[axis]![0]).toBeCloseTo(lo!, 1);
      expect(file[axis]![1]).toBeCloseTo(hi!, 1);
    });
  });

  it('leaves out hidden parts, and exports one part or copy on its own', async () => {
    const document = await load('patterned-panel-face-selection');
    const model = assemblyModel(document);
    const [first, second] = model.instances;
    expect(second).toBeDefined();
    const one = studioStep(document, { only: first! });
    expect(one.parts).toEqual([first!.name]);
    const hidden = studioStep(document, { hidden: new Set([instanceKey(first!)]) });
    expect(hidden.parts).not.toContain(first!.name);
    expect(hidden.parts).toHaveLength(new Set(model.instances.map(instanceKey)).size - 1);
    expect(hidden.text).toContain(`PRODUCT('${second!.name}'`);
  });

  it('reports only the exported part’s own trouble', async () => {
    const document = await load('extrude-sketch-apart');
    const all = studioStep(document);
    expect(all.problems.length).toBeGreaterThan(0);
    const broken = document.parts.find(part => all.problems.some(problem => problem.name === part.name))!;
    const other = document.parts.find(part => part.id !== broken.id)!;
    expect(studioStep(document, { only: { partId: other.id } }).problems).toEqual([]);
    expect(studioStep(document, { only: { partId: broken.id } }).problems).toHaveLength(all.problems.length);
  });

  it('counts a joined body that can’t be built as trouble of the part it joins', async () => {
    const source = await load('face-extrusion-bracket');
    const joined = source.parts.find(part => part.addTo)!;
    // Its sketch emptied, so the body can't be built.
    const document = {
      ...source,
      parts: source.parts.map(part =>
        part.id === joined.id ? { ...part, sketch: { ...part.sketch, entities: [], constraints: [] } } : part
      ),
    };
    const only = studioStep(document, { only: { partId: joined.addTo! } });
    expect(only.problems.map(problem => problem.name)).toContain(joined.name);
  });

  it('doesn’t report trouble with a hidden part', async () => {
    const document = await load('extrude-sketch-apart');
    const broken = studioStep(document).problems;
    const part = document.parts.find(candidate => broken.some(problem => problem.name === candidate.name))!;
    expect(studioStep(document, { hidden: new Set([part.id]) }).problems).toEqual([]);
  });

  it('writes the chosen unit', async () => {
    const document = await load('plate');
    expect(studioStep(document, { unit: 'in' }).text).toContain("CONVERSION_BASED_UNIT('INCH'");
    expect(studioStep(document).text).toContain('SI_UNIT(.MILLI.,.METRE.)');
  });
});
