import { loadStep } from '@wbcnc/cam';
import type { FingerprintedPart } from './compare';
import { fingerprintMesh, type FingerprintMesh } from './meshFingerprint';

/** Chord error of the tessellation, mm. Fixed, so fingerprints made at different times compare. */
export const kFingerprintDeflection = 0.01;

/**
 * The one frame every fingerprint is in: millimetres, the Top plane is XY, Z points up, and the origin is the file's
 * own. The reader already gives millimetres whatever unit the STEP file declares (inches included), and both files of
 * a comparison are expected to be written in this frame, so nothing is moved or turned here: two exports of the same
 * part share an origin, and a part that sits somewhere else is a difference rather than something to align away. A
 * file in another convention gets its transform here, and nowhere else.
 */
export function toFingerprintFrame(mesh: FingerprintMesh): FingerprintMesh {
  return mesh;
}

/** Each solid of a STEP file, as the reader returns it, with its fingerprint; named after its STEP product. */
export async function fingerprintStep(data: Uint8Array): Promise<FingerprintedPart[]> {
  const { bodies } = await loadStep(data, { linearDeflection: kFingerprintDeflection });
  return bodies.map(body => {
    const mesh = toFingerprintFrame(body.mesh);
    return { fingerprint: fingerprintMesh(body.name, mesh), mesh };
  });
}
