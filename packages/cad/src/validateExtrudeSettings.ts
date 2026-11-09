import type { CadPart } from './types';

/** Validate extrusion settings before saved geometry is evaluated. */
export function validateExtrudeSettings(p: CadPart, number: (value: unknown) => void, reference: (value: unknown) => void) {
  for (const key of ['thicknessExpression', 'sketchName', 'extrudeName'] as const)
    if (p[key] !== undefined && typeof p[key] !== 'string') throw new Error('Invalid CAD part');
  if (p.thin !== undefined) {
    if (!p.thin || typeof p.thin !== 'object') throw new Error('Invalid thin extrude');
    number(p.thin.depth);
    if (p.thin.depth <= 0) throw new Error('Invalid thin extrude');
    if (p.thin.depthExpression !== undefined && typeof p.thin.depthExpression !== 'string') throw new Error('Invalid thin extrude');
    if (p.thin.midPlane !== undefined && typeof p.thin.midPlane !== 'boolean') throw new Error('Invalid thin extrude');
  }
  for (const regions of [p.regions, p.addedRegions])
    if (regions !== undefined && (!Array.isArray(regions) || !regions.every(id => typeof id === 'string')))
      throw new Error('Invalid CAD part regions');
  if (p.sketchOf !== undefined) reference(p.sketchOf);
  if (p.addTo !== undefined && p.addTo !== '') reference(p.addTo);
  if (
    p.faceProfile !== undefined &&
    (typeof p.faceProfile !== 'boolean' ||
      (p.faceProfile && (!p.drawnOn?.on || typeof p.drawnOn.on !== 'object' || !('partId' in p.drawnOn.on))))
  )
    throw new Error('Invalid CAD face extrusion');
  if (p.remove !== undefined) {
    if (!p.remove || typeof p.remove !== 'object') throw new Error('Invalid extrude remove');
    if (p.remove.targets !== undefined) {
      if (!Array.isArray(p.remove.targets)) throw new Error('Invalid extrude remove targets');
      for (const id of p.remove.targets) reference(id);
    }
    if (p.remove.depth !== 'through') number(p.remove.depth);
    if (p.remove.depthExpression !== undefined && typeof p.remove.depthExpression !== 'string') throw new Error('Invalid extrude remove');
  }
  if (p.cornerRelief !== undefined) {
    if (!p.cornerRelief || typeof p.cornerRelief !== 'object') throw new Error('Invalid corner relief');
    number(p.cornerRelief.diameter);
    if (p.cornerRelief.diameter <= 0) throw new Error('Invalid corner relief');
    if (p.cornerRelief.diameterExpression !== undefined && typeof p.cornerRelief.diameterExpression !== 'string')
      throw new Error('Invalid corner relief');
  }
}
