import type { BodyMesh } from '@/cam/camTypes';
import { instanceKey, type AssemblyModel } from './assemblyModel';
import { sectionGeometry, type SectionPlane } from './sectionGeometry';

/** Index-buffer range occupied by the new cut surface, after the retained original surfaces. */
export interface SectionCapRange {
  start: number;
  count: number;
}
export interface SectionModel extends AssemblyModel {
  sectionCaps: (SectionCapRange | null)[];
  sectionProblems: { instanceKey: string; name: string; message: string }[];
}

/** Clip each physical instance without changing its index, membership, source geometry or cutting handoff. */
export function sectionModel(model: AssemblyModel, plane: SectionPlane | null): SectionModel {
  const empty = () => model.meshes.map(() => null);
  if (!plane) return { ...model, sectionCaps: empty(), sectionProblems: [] };
  const results = model.meshes.map(mesh => sectionGeometry(mesh, plane));
  const sectionProblems = results.flatMap((result, index) =>
    result.problem
      ? [
          {
            instanceKey: instanceKey(model.instances[index]!),
            name: model.instances[index]!.name,
            message: result.problem,
          },
        ]
      : []
  );
  // A partially sectioned assembly could conceal a joint. An invalid boundary leaves the whole model visible with its diagnostic.
  if (sectionProblems.length) return { ...model, sectionCaps: empty(), sectionProblems };
  const sectionCaps: SectionModel['sectionCaps'] = [];
  const meshes = results.map(({ body, cap }): BodyMesh => {
    if (!cap?.indices.length) {
      sectionCaps.push(null);
      return body;
    }
    const positions = new Float32Array(body.positions.length + cap.positions.length);
    positions.set(body.positions);
    positions.set(cap.positions, body.positions.length);
    const indices = new Uint32Array(body.indices.length + cap.indices.length);
    indices.set(body.indices);
    const offset = body.positions.length / 3;
    cap.indices.forEach((index, slot) => {
      indices[body.indices.length + slot] = index + offset;
    });
    sectionCaps.push({ start: body.indices.length, count: cap.indices.length });
    return { ...body, positions, indices };
  });
  return { ...model, meshes, sectionCaps, sectionProblems };
}
