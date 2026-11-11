import { isJoinedBody, type CadDocument, type CadLengthUnit } from '@wbcnc/cad';
import { brepProblems, partBrep, writeStep, type StepProduct } from '@wbcnc/cam';
import { Matrix4 } from 'three';
import { assemblyModel, instanceKey, type AssemblyInstance } from '../assemblyModel';

export interface StudioStepResult {
  text: string;
  /** The parts in the file, by name. */
  parts: string[];
  /** Parts left out, and why: one that can't be built, or whose solid doesn't close. */
  problems: { name: string; message: string }[];
}

/**
 * The studio's parts as a STEP file, each where the 3D view shows it. Hidden parts and sketches not yet extruded are
 * left out; a copy is a part of its own; bodies joined by Extrude → Add are solids of the part, or copy, they join.
 * `only` limits it to one part or copy, by its assembly key.
 */
export function studioStep(
  document: CadDocument,
  options: {
    hidden?: ReadonlySet<string>;
    only?: Pick<AssemblyInstance, 'partId' | 'copyId'>;
    unit?: CadLengthUnit;
    fileName?: string;
  } = {}
): StudioStepResult {
  const model = assemblyModel(document, options.hidden);
  const byId = new Map(document.parts.map(part => [part.id, part]));
  /** The part, or copy, a piece belongs to: a joined body's is the one it's joined to, through any chain of Adds. */
  const owner = (instance: AssemblyInstance) => {
    let part = byId.get(instance.partId);
    for (let guard = 0; part && isJoinedBody(document, part) && guard < document.parts.length; guard++) part = byId.get(part.addTo!);
    return { partId: part?.id ?? instance.partId, copyId: instance.copyId };
  };
  const products = new Map<string, StepProduct>(),
    problems: StudioStepResult['problems'] = model.problems.map(({ name, message }) => ({ name, message }));
  model.instances.forEach((instance, i) => {
    const belongs = owner(instance),
      key = instanceKey(belongs);
    if (options.only && key !== instanceKey(options.only)) return;
    const { entry, below } = model.solids[i]!;
    const brep = partBrep(entry.features, below);
    const open = brepProblems(brep);
    if (open.length)
      return void problems.push({ name: instance.name, message: 'Its solid doesn’t close, so it can’t be written exactly.' });
    // The mesh's `flat` takes it back from the assembly to its own frame; the solid goes the other way.
    const matrix = new Matrix4().fromArray(model.meshes[i]!.flat!).invert().toArray();
    const name = model.instances.find(candidate => instanceKey(candidate) === key)?.name ?? instance.name;
    const product = products.get(key) ?? products.set(key, { name, solids: [] }).get(key)!;
    product.solids.push({ brep, matrix });
  });
  const list = [...products.values()];
  return {
    text: writeStep(list, { unit: options.unit, fileName: options.fileName }),
    parts: list.map(product => product.name),
    problems,
  };
}
