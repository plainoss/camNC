import { detectFlat, extractFeatures, flatMatrix, type FlatPart, type PartFeatures } from '@wbcnc/cam';

/**
 * A part milled lying on its widest faces rather than on its sketch: a profile drawn on a side plane and extruded
 * further than it is high, as a board's end profile pushed out to its width, is milled from the top, with the
 * profile's height as the stock's thickness. Null when the sketch's own face is already the one to lie on.
 * `positions` and `indices` are the solid in its sketch's frame, extruded along +Z by `thickness`.
 */
export function laidFlat(
  name: string,
  positions: Float64Array,
  indices: Uint32Array,
  thickness: number
): { part: FlatPart; features: PartFeatures; flat: number[] } | null {
  // Each triangle a face of its own: lying flat is decided by which planar faces have the most area.
  const faceRanges = Array.from({ length: indices.length / 3 }, (_, t) => ({ first: t, last: t }));
  const part = detectFlat({ name, mesh: { positions, indices, faceRanges } });
  if (part.thickness >= thickness - 1e-6) return null;
  return { part, features: extractFeatures(part.mesh, part.thickness), flat: flatMatrix(part) };
}
