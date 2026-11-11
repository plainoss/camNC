import { applyPartCuts } from './cutParts';
import { cadDrawnOnSupports, effectivePlacement } from './drawnOn';
import { isCadBody } from './extrudeSteps';
import { cadPartReference } from './partReferences';
import { physicalTransformMembers, physicalTransformTarget } from './physicalTransformTargets';
import { physicalTransformPose } from './physicalTransformPose';
import { physicalJoinedCopies } from './physicalJoinedCopies';
import { cadVariableValues } from './variables';
import { copyTransformValue } from './copyTransformValues';
import type { CadDocument, CadEvaluation, CadPlacement, EvaluatedCadPart } from './types';

/** A posed projection for one spatial stage. Source creation placements and regenerated pattern copies stay untouched. */
function stageDocument(source: CadDocument, placements: Map<string, CadPlacement>, available: Set<string>): CadDocument {
  // Rebuild every stage from generation, then expand once. Material readers retain these authoritative
  // descriptors within this stage instead of rebasing them against independently rounded moved seeds.
  return physicalJoinedCopies(
    {
      ...source,
      parts: source.parts
        .filter(part => available.has(part.id))
        .map(part => ({
          ...part,
          placement: placements.get(part.id),
          copies: part.copies
            ?.filter(copy => available.has(cadPartReference(part.id, copy.id)))
            .map(copy => ({ ...copy, placement: placements.get(cadPartReference(part.id, copy.id)) })),
        })),
    },
    source
  );
}

/**
 * Generation produces local material once; this stream carries that material through cuts and exact-copy poses.
 * A legacy source-ID prefix is deliberately one fixed-tool batch. All later stages use current occupied material.
 */
export function evaluateCopyOperations(source: CadDocument, initial: EvaluatedCadPart[], through?: string): CadEvaluation {
  const diagnostics: CadEvaluation['diagnostics'] = [],
    available = new Set<string>(),
    placements = new Map<string, CadPlacement>();
  const supports = cadDrawnOnSupports(source);
  const { scope } = cadVariableValues(source);
  for (const part of source.parts) {
    if (!isCadBody(source, part) || !initial.some(shape => shape.partId === part.id)) continue;
    available.add(part.id);
    const at = effectivePlacement(part, supports);
    if (at) placements.set(part.id, at);
    for (const copy of part.copies ?? []) {
      const reference = cadPartReference(part.id, copy.id);
      available.add(reference);
      if (copy.placement) placements.set(reference, copy.placement);
    }
  }
  let parts = initial;
  const cutById = new Map(source.partCuts?.map(cut => [cut.id, cut]));
  const moveById = new Map(source.copyTransforms?.map(move => [move.id, move]));
  const order = source.operationOrder ?? [];
  const end = through === undefined ? order.length : order.indexOf(through) + 1;
  if (through !== undefined && !end)
    return {
      parts: [],
      diagnostics: [{ code: 'copy-operation-prefix-missing', severity: 'error', message: 'This operation is not in the source order.' }],
    };
  const consume = (ids: string[]) => {
    const families = new Set(ids.filter(id => !id.includes(':')));
    // Add generators remain editable source rows, but their material cannot survive its consumed host.
    for (let changed = true; changed; ) {
      changed = false;
      for (const part of source.parts)
        if (part.addTo && families.has(part.addTo) && !families.has(part.id)) {
          families.add(part.id);
          changed = true;
        }
    }
    for (const id of families)
      for (const reference of available) if (reference === id || reference.startsWith(`${id}:`)) available.delete(reference);
  };
  const legacy = (source.legacyPartCutIds ?? []).slice(0, end);
  if (legacy.length) {
    const steps = legacy.flatMap(id => cutById.get(id) ?? []);
    const cut = applyPartCuts({ ...source, partCuts: steps }, parts);
    parts = cut.parts;
    diagnostics.push(...cut.diagnostics);
    for (const step of steps) if (step.consumeTools && !step.split) consume(step.tools);
  }
  for (const id of order.slice(legacy.length, end)) {
    const saved = moveById.get(id);
    if (saved) {
      if (saved.suppressed) continue;
      const value = copyTransformValue(saved, scope);
      if ('error' in value) {
        diagnostics.push({ code: 'variable-value', severity: 'error', partId: saved.partId, message: value.error });
        if (saved.seed === true) break;
        continue;
      }
      const { move } = value;
      const target = physicalTransformTarget(move),
        members = physicalTransformMembers(source, target, available, placements);
      if ('problem' in members) {
        diagnostics.push({
          code: members.problem.code,
          severity: members.problem.severity,
          partId: move.partId,
          message: members.problem.message,
        });
        if (members.problem.severity === 'error') break;
        continue;
      }
      const changed = members.references.map(reference => ({
        reference,
        placement: physicalTransformPose(placements.get(reference)!, move),
      }));
      if (changed.some(change => !change.placement)) {
        diagnostics.push({
          code: target.kind === 'copy' ? 'copy-transform-nonfinite' : 'physical-transform-nonfinite',
          severity: 'error',
          partId: move.partId,
          message: 'This transform exceeds finite model coordinates.',
        });
        if (target.kind === 'seed') break;
        continue;
      }
      // Validate every component first. An overflow or absent component must never leave a partially moved host.
      for (const change of changed) placements.set(change.reference, change.placement!);
      continue;
    }
    // Suppressed or masked cuts are absent from activeDesign, but their order slots remain saved source records.
    const step = cutById.get(id);
    if (!step) continue;
    if (step.consumeTools && step.tools.some(reference => reference.includes(':'))) {
      diagnostics.push({
        code: 'part-cut-copy-consumption-unsupported',
        severity: 'warning',
        message: 'Consuming one physical tool copy is not supported. Keep the tool or consume its source family.',
      });
      continue;
    }
    const document = stageDocument(source, placements, available);
    const missingTools = step.tools.filter(reference => !available.has(reference));
    if (missingTools.length)
      diagnostics.push({
        code: 'part-cut-tool-unavailable',
        severity: 'warning',
        message: 'A cut tool is not available at this operation.',
      });
    const activeStep = { ...step, tools: step.tools.filter(reference => available.has(reference)) };
    const cut = applyPartCuts({ ...document, partCuts: [activeStep] }, parts, { occupiedTools: true });
    parts = cut.parts;
    diagnostics.push(...cut.diagnostics);
    if (step.consumeTools && !step.split) consume(activeStep.tools);
  }
  return {
    parts,
    diagnostics,
    available: [...available],
    placements: Object.fromEntries([...placements].filter(([id]) => available.has(id))),
  };
}
