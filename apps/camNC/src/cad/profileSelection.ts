import {
  cadSketchFrame,
  CAD_CHORD_TOLERANCE,
  newCadId,
  newExtrudeOnFace,
  sketchOwnerId,
  sketchRegions,
  resolveDrawnPlacements,
  type CadDocument,
  type CadDrawnOn,
  type CadPart,
} from '@wbcnc/cad';
import type { ViewRegion } from '@/cam/model/ModelViewport';
import { withRegionToggled } from './extrudeRegionViews';

/** Closed visible sketch areas are selectable even when a solid face sits immediately underneath. */
export function sketchSelectionRegions(document: CadDocument, shown: (id: string) => boolean, selected: string | null): ViewRegion[] {
  const placed = resolveDrawnPlacements(document).document;
  return placed.parts
    .filter(part => !part.sketchOf && !part.faceProfile && !part.suppressed && shown(`${part.id}:sketch`))
    .flatMap(part => {
      const frame = cadSketchFrame(placed, part);
      if (!frame) return [];
      return sketchRegions(part.sketch, CAD_CHORD_TOLERANCE).map(region => ({
        id: JSON.stringify([part.id, region.id]),
        frame: { ...frame, origin: frame.origin.map((v, i) => v + frame.normal[i]! * 0.1) as [number, number, number] },
        outline: region.points,
        holes: region.holes,
        picked: part.id === selected,
      }));
    });
}

function dependsOn(document: CadDocument, id: string, target: string, seen = new Set<string>()): boolean {
  if (id === target) return true;
  if (seen.has(id)) return false;
  seen.add(id);
  const part = document.parts.find(p => p.id === id);
  const on = part?.drawnOn?.on;
  const upTo = part?.upTo;
  const datums = [part?.drawnOn?.datum, part?.upToDatum].flatMap(
    id => document.planes?.filter(plane => plane.id === id).map(plane => plane.on) ?? []
  );
  return [
    part?.sketchOf,
    on && 'partId' in on ? on.partId : undefined,
    part?.addTo,
    upTo && 'partId' in upTo ? upTo.partId : undefined,
    ...datums.map(on => ('partId' in on ? on.partId : undefined)),
    ...(part?.sketch.entities.flatMap(entity => (entity.type === 'point' && entity.used ? [entity.used.partId] : [])) ?? []),
  ].some(ref => ref && dependsOn(document, ref, target, seen));
}

/** Retarget the feature while retaining its settings and any independently authored original sketch. */
export function replaceExtrudeProfile(
  document: CadDocument,
  targetId: string,
  selection: { sketch: string; region?: string } | { face: Extract<CadDrawnOn['on'], { partId: string }> }
): CadDocument {
  const target = document.parts.find(p => p.id === targetId);
  if (!target) return document;
  const source = 'sketch' in selection && document.parts.find(p => p.id === selection.sketch);
  const owner = source && document.parts.find(p => p.id === sketchOwnerId(source));
  const reference = owner ? owner.id : 'face' in selection ? selection.face.partId : null;
  if (!reference || (reference !== targetId && dependsOn(document, reference, targetId)))
    throw new Error('Choose a profile that does not depend on this extrusion.');
  if (reference === targetId && 'sketch' in selection) {
    if (selection.region) return withRegionToggled(document, targetId, selection.region);
    if (!target.regions) return document;
    const entireSketch = { ...target };
    delete entireSketch.regions;
    return { ...document, revision: document.revision + 1, parts: document.parts.map(p => (p.id === targetId ? entireSketch : p)) };
  }
  if (reference === targetId) throw new Error('Choose a face of another part.');
  let parts = document.parts;
  if (!target.sketchOf && !target.faceProfile) {
    // The authored sketch remains a distinct feature when its original extrusion chooses another profile.
    const kept: CadPart = {
      id: newCadId(),
      name: `${target.name} sketch`,
      sketch: target.sketch,
      thickness: target.thickness,
      extrude: false,
      ...(target.drawnOn && { drawnOn: target.drawnOn }),
      ...(target.placement && { placement: target.placement }),
    };
    parts = parts.flatMap(p => (p.id === targetId ? [kept, p] : [{ ...p, ...(p.sketchOf === targetId && { sketchOf: kept.id }) }]));
  }
  let next: CadPart;
  if (owner) {
    next = { ...target, sketch: owner.sketch, sketchOf: owner.id };
    delete next.faceProfile;
    delete next.regions;
    delete next.drawnOn;
    delete next.placement;
    if (owner.drawnOn) next.drawnOn = { ...owner.drawnOn, inward: !!target.drawnOn?.inward };
    else if (owner.placement) next.placement = owner.placement;
    if ('sketch' in selection && selection.region) next.regions = [selection.region];
  } else {
    const face = 'face' in selection ? selection.face : null;
    if (!face) return document;
    const generated = newExtrudeOnFace({ ...document, parts: parts.filter(p => p.id !== targetId) }, face, target.name);
    next = { ...target, sketch: generated.sketch, faceProfile: true, drawnOn: { ...generated.drawnOn!, inward: !!target.drawnOn?.inward } };
    delete next.sketchOf;
    delete next.regions;
    delete next.placement;
  }
  return { ...document, revision: document.revision + 1, parts: parts.map(p => (p.id === targetId ? next : p)) };
}
