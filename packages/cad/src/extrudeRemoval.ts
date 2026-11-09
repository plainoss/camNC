import { applyPartCuts } from './cutParts';
import { cadSketchFrame } from './usedEdges';
import { cadDrawnOnSupports, effectivePlacement, resolveDrawnPlacements } from './drawnOn';
import { evaluatedPartCopy } from './copies';
import { isCadBody, removalRegions } from './extrudeSteps';
import { regionGroups } from './regionProfile';
import { placePoint } from './placement';
import type { CadDiagnostic, CadDocument, CadPart, EvaluatedCadPart } from './types';

/** Face pockets keep their face-sketch features; positioned extrusions cut with their actual volume. */
export function isSpatialRemoval(part: CadPart): boolean {
  const on = part.drawnOn?.on;
  return (
    !!part.remove &&
    !part.hole &&
    !!on &&
    ('plane' in on ||
      typeof on.face === 'object' ||
      !!part.drawnOn?.offset ||
      part.drawnOn?.inward !== undefined ||
      !!part.symmetric ||
      !!part.upTo ||
      part.remove.targets !== undefined)
  );
}

/** A face Remove grows into its support by default; one on a plane follows the plane's normal. */
export const removalInward = (part: CadPart): boolean => part.drawnOn?.inward ?? !!(part.drawnOn && !('plane' in part.drawnOn.on));

/** Only bodies already made can be cut by this extrusion. An explicit scope stays explicit, even when empty. */
export function removalTargets(document: CadDocument, part: CadPart): CadPart[] {
  const index = document.parts.findIndex(candidate => candidate.id === part.id);
  const on = part.drawnOn?.on;
  const scope = part.remove?.targets ?? (on && 'partId' in on ? [on.partId] : undefined);
  return document.parts.slice(0, index).filter(candidate => isCadBody(document, candidate) && (!scope || scope.includes(candidate.id)));
}

/** Apply positioned Remove volumes through the same intersection and CAM cut path used by cut-parts features. */
export function applyExtrudeRemovals(
  document: CadDocument,
  given: readonly EvaluatedCadPart[]
): {
  parts: EvaluatedCadPart[];
  diagnostics: CadDiagnostic[];
} {
  let parts = [...given];
  const diagnostics: CadDiagnostic[] = [];
  for (const step of document.parts) {
    if (!isSpatialRemoval(step) || step.extrude === false || step.suppressed) continue;
    const targets = removalTargets(document, step).filter(target => parts.some(part => part.partId === target.id));
    const error = (message: string) => diagnostics.push({ code: 'extrude-remove-unresolved', severity: 'error', partId: step.id, message });
    if (!targets.length) {
      error('Pick a part made before this extrusion to cut.');
      continue;
    }
    let thickness = step.upTo ? step.thickness : step.remove!.depth;
    const inward = removalInward(step);
    if (thickness === 'through') {
      const placed = resolveDrawnPlacements(document).document;
      const frame = cadSketchFrame(placed, step);
      if (!frame) {
        error('The sketch’s plane could not be placed.');
        continue;
      }
      const supports = cadDrawnOnSupports(placed);
      const reaches = targets.flatMap(target => {
        const shape = parts.find(part => part.partId === target.id)!;
        const source = placed.parts.find(part => part.id === target.id)!;
        // A board used as a support lives at the origin even without a saved placement. Mirrored copies have their own extents.
        const instances = [
          { placement: effectivePlacement(source, supports), shape },
          ...(source.copies ?? []).map(copy => ({ placement: copy.placement, shape: evaluatedPartCopy(shape, copy) })),
        ];
        return instances.flatMap(({ placement, shape: instance }) =>
          placement
            ? instance.outline.flatMap(point =>
                [0, instance.thickness].map(z => {
                  const world = placePoint(placement, [point.x, point.y, z]);
                  return world.reduce((sum, value, axis) => sum + (value - frame.origin[axis]!) * frame.normal[axis]!, 0);
                })
              )
            : []
        );
      });
      // Through all follows the requested direction, from the offset plane; the extra millimetre clears the last face.
      thickness =
        Math.max(
          0.1,
          ...(step.symmetric ? reaches.map(Math.abs).map(value => value * 2) : reaches.map(value => (inward ? -value : value)))
        ) + 1;
    }
    if (!(thickness > 0)) {
      error('A cut needs some depth.');
      continue;
    }
    const found = removalRegions(document, step);
    if ('error' in found) {
      error(found.error);
      continue;
    }
    const wanted = step.regions ?? found.cut;
    const regions = found.regions.filter(region => wanted.includes(region.id));
    if (new Set(wanted).size !== regions.length) {
      error('A region picked to remove is no longer in its sketch. Pick its regions again.');
      continue;
    }
    const groups = regionGroups(regions);
    if (!groups.length) {
      error('Draw a closed shape to cut it out.');
      continue;
    }
    // A Remove can cut several disconnected pockets. Group adjacent regions without requiring one solid profile.
    const tools: CadPart[] = groups.map((_, index) => {
      const tool: CadPart = {
        ...step,
        id: index ? `${step.id}-region-${index}` : step.id,
        thickness,
        drawnOn: { ...step.drawnOn!, inward },
      };
      delete tool.copies;
      delete tool.pattern;
      return tool;
    });
    const profiles: EvaluatedCadPart[] = groups.map((group, index) => ({
      partId: tools[index]!.id,
      name: step.name,
      thickness,
      outline: group.outline,
      holes: group.holes,
      loops: [
        { id: `${tools[index]!.id}:outline`, kind: 'outer', points: group.outline, entityIds: group.curveIds },
        ...group.holes.map((points, hole) => ({ id: `${tools[index]!.id}:hole-${hole}`, kind: 'hole' as const, points, entityIds: [] })),
      ],
    }));
    const prepared = resolveDrawnPlacements({
      ...document,
      parts: [...document.parts.map(part => (part.id === step.id ? tools[0]! : part)), ...tools.slice(1)],
    }).document;
    const cut = applyPartCuts(
      {
        ...prepared,
        partCuts: [{ id: `remove-${step.id}`, tools: tools.map(tool => tool.id), targets: targets.map(target => target.id), clearance: 0 }],
      },
      [...parts.filter(part => part.partId !== step.id), ...profiles]
    );
    for (const problem of cut.diagnostics)
      error(
        problem.message.replace(
          'A "cut parts" step cuts nothing: none of its tools reach into its targets.',
          'This extrusion cuts nothing: its profile does not reach the selected parts.'
        )
      );
    const byId = new Map(cut.parts.map(part => [part.partId, part]));
    parts = parts.map(part => (part.partId === step.id ? part : (byId.get(part.partId) ?? part)));
  }
  return { parts, diagnostics };
}
