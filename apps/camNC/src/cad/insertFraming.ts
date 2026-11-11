import type { CadDocument } from '@wbcnc/cad';
import type { ViewRequest } from '@/cam/model/ModelViewport';
import { assemblyModel, instanceKey } from './assemblyModel';
import type { StudioCameraState } from './studioCamera';
import { listedStudioParts } from './studioParts';

type Box = { min: [number, number, number]; max: [number, number, number] };

/** Within this share of the view's half width and height counts as in view, so a part touching the edge is refitted. */
const kInView = 0.97;

// The click that applies a change measures the design after it, which is the design before the next one.
const measured = new WeakMap<CadDocument, Map<string, Box>>();

/** Every part and copy the 3D view draws, by `instanceKey`, with its box in assembly space (unplaced ones in their row). */
export function instanceBoxes(document: CadDocument): Map<string, Box> {
  const known = measured.get(document);
  if (known) return known;
  const model = assemblyModel(document);
  const boxes = new Map<string, Box>();
  model.meshes.forEach((mesh, index) => {
    const box: Box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < mesh.positions.length; i += 3)
      for (let axis = 0; axis < 3; axis++) {
        box.min[axis] = Math.min(box.min[axis]!, mesh.positions[i + axis]!);
        box.max[axis] = Math.max(box.max[axis]!, mesh.positions[i + axis]!);
      }
    if (mesh.positions.length) boxes.set(instanceKey(model.instances[index]!), box);
  });
  measured.set(document, boxes);
  return boxes;
}

function outsideView(box: Box, camera: StudioCameraState & { aspect: number }) {
  const [bx, by, bz] = camera.back;
  const [ux, uy, uz] = camera.up;
  // The view's right is up × back; the view is orthographic, so depth along back doesn't matter.
  const right = [uy * bz - uz * by, uz * bx - ux * bz, ux * by - uy * bx];
  const halfHeight = (camera.height / 2) * kInView,
    halfWidth = halfHeight * camera.aspect;
  for (const x of [box.min[0], box.max[0]])
    for (const y of [box.min[1], box.max[1]])
      for (const z of [box.min[2], box.max[2]]) {
        const corner = [x - camera.center[0], y - camera.center[1], z - camera.center[2]];
        const dot = (axis: readonly number[]) => corner[0]! * axis[0]! + corner[1]! * axis[1]! + corner[2]! * axis[2]!;
        if (Math.abs(dot(right)) > halfWidth || Math.abs(dot(camera.up)) > halfHeight) return true;
      }
  return false;
}

/**
 * Whether applying `after` over `before` should fit the view to the whole design, as F does. Into a design with
 * nothing listed yet, as soon as the change adds a listed part, since there is no framing to keep. Otherwise only when
 * a part or copy the view didn't draw before would sit outside the current view, so a view framed on purpose stays put
 * while the new pieces are in sight, and a change that adds none never moves the camera.
 */
export function framesInsert(before: CadDocument, after: CadDocument, camera: StudioCameraState | null): boolean {
  if (!listedStudioParts(before).length) return listedStudioParts(after).length > 0;
  const old = instanceBoxes(before);
  const added = [...instanceBoxes(after)].filter(([key]) => !old.has(key)).map(([, box]) => box);
  if (!added.length) return false;
  // Without a known assembled view (none drawn yet, or the exploded view moves parts), fitting is the safe choice.
  if (!camera?.aspect || (camera.key !== undefined && camera.key !== 'assembled')) return true;
  return added.some(box => outsideView(box, { ...camera, aspect: camera.aspect! }));
}

/** Apply a reviewed change, then fit the view to the design when `framesInsert` says the change needs it. */
export function applyFramed(
  before: CadDocument,
  after: CadDocument,
  camera: StudioCameraState | null,
  apply: (document: CadDocument) => void,
  request: (update: (previous: ViewRequest | undefined) => ViewRequest) => void
) {
  // Decided before applying: a failure here must not read as a failed Apply, so it falls back to fitting.
  let fit = true;
  try {
    fit = framesInsert(before, after, camera);
  } catch {
    // Fitting shows the whole design, so it can't hide the change.
  }
  apply(after);
  if (fit) request(previous => ({ name: 'fit', seq: (previous?.seq ?? 0) + 1 }));
}
