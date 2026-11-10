import {
  activeDesign,
  cadStepReport,
  designSteps,
  evaluateCadDocument,
  parseCadDocument,
  type CadDocument,
  type DesignStep,
} from '@wbcnc/cad';
import { commitCadSession, type CadSession } from './session';

/** A proposal contains only ordinary source, never a retained script or an apply capability. */
export interface CadProposal {
  base: CadDocument;
  document: CadDocument;
}

export function cadProposal(base: CadDocument, candidate: unknown): CadProposal {
  const document = parseCadDocument(structuredClone(candidate));
  if (document.id !== base.id) throw new Error('A proposal must change the open design.');
  return { base: structuredClone(base), document };
}

export function cadProposalRefusal(session: CadSession, proposal: CadProposal): string | null {
  if (session.conflict) return 'Resolve the incoming design change before applying a proposal.';
  if (proposal.document.id !== session.document.id || proposal.base.id !== session.document.id)
    return 'This proposal belongs to another design.';
  // Revisions alone cannot detect an external replacement or an uncommitted sketch change.
  if (JSON.stringify(proposal.base) !== JSON.stringify(session.document))
    return 'The design has changed. Check the request again against the current design.';
  return null;
}

/** The UI calls this only after the user chooses Apply; refusal never changes undo history. */
export function applyCadProposal(session: CadSession, proposal: CadProposal): CadDocument {
  const refusal = cadProposalRefusal(session, proposal);
  if (refusal) throw new Error(refusal);
  const document = parseCadDocument(structuredClone(proposal.document));
  return commitCadSession(session, document);
}

export interface CadProposalComparison {
  added: { id: string; label: string }[];
  changed: { id: string; label: string }[];
  removed: { id: string; label: string }[];
  costs: string[];
  newWarnings: string[];
  errors: string[];
}

function sourceOf(document: CadDocument, step: DesignStep): unknown {
  const part = document.parts.find(part => part.id === step.partId);
  if (!part) return step;
  if (step.kind === 'partCut') return document.partCuts?.find(cut => cut.id === step.partCutId);
  if (step.kind === 'sketch') return [part.sketch, part.drawnOn, part.sketchOf, part.regions];
  if (step.kind === 'extrude')
    return [
      part.thickness,
      part.thicknessExpression,
      part.suppressed,
      part.extrude,
      part.addTo,
      part.remove,
      part.hole,
      part.placement,
      part.upTo,
      part.upToDatum,
      part.symmetric,
    ];
  if (step.kind === 'move') return [part.moved, part.placement];
  if (step.kind === 'copy') return part.copies?.find(copy => copy.id === step.copyId);
  if (step.kind === 'pattern') return part.pattern;
  return part.features?.find(feature => feature.id === (step.cutId ?? step.sketchId ?? step.id));
}

/** Compare source steps and evaluated material: a valid candidate can still remove useful work. */
export function compareCadProposal(proposal: CadProposal): CadProposalComparison {
  const { base, document } = proposal;
  const visibleSteps = (source: CadDocument) => {
    const empty = new Set(
      source.parts
        .filter(
          part => !part.drawnOn && !part.features?.length && part.sketch.entities.every(entity => entity.type === 'point' && entity.fixed)
        )
        .map(part => part.id)
    );
    return designSteps(source).filter(step => !empty.has(step.partId));
  };
  const before = new Map(visibleSteps(base).map(step => [step.id, step]));
  const after = new Map(visibleSteps(document).map(step => [step.id, step]));
  const result: CadProposalComparison = { added: [], changed: [], removed: [], costs: [], newWarnings: [], errors: [] };
  for (const [id, step] of before) {
    const next = after.get(id);
    if (!next) result.removed.push({ id, label: step.label });
    else if (JSON.stringify([step, sourceOf(base, step)]) !== JSON.stringify([next, sourceOf(document, next)]))
      result.changed.push({ id, label: next.label });
  }
  for (const [id, step] of after) if (!before.has(id)) result.added.push({ id, label: step.label });
  for (const kind of ['variables', 'planes', 'folders'] as const) {
    const oldEntries = new Map((base[kind] ?? []).map(entry => [entry.id, entry]));
    const newEntries = new Map((document[kind] ?? []).map(entry => [entry.id, entry]));
    const label = (name: string) => `${kind === 'variables' ? 'Variable' : kind === 'planes' ? 'Plane' : 'Folder'} · ${name}`;
    for (const [id, entry] of oldEntries) {
      const next = newEntries.get(id);
      if (!next) result.removed.push({ id, label: label(entry.name) });
      else if (JSON.stringify(entry) !== JSON.stringify(next)) result.changed.push({ id, label: label(next.name) });
    }
    for (const [id, entry] of newEntries) if (!oldEntries.has(id)) result.added.push({ id, label: label(entry.name) });
  }
  const oldGeometry = evaluateCadDocument(activeDesign(base));
  const newGeometry = evaluateCadDocument(activeDesign(document));
  const warningsBefore = new Set(oldGeometry.diagnostics.map(issue => `${issue.code}:${issue.partId ?? ''}:${issue.message}`));
  for (const issue of newGeometry.diagnostics) {
    if (issue.severity === 'error') result.errors.push(issue.message);
    else if (!warningsBefore.has(`${issue.code}:${issue.partId ?? ''}:${issue.message}`)) result.newWarnings.push(issue.message);
  }
  const oldJoints = cadStepReport(base, oldGeometry.parts).filter(step => step.kind === 'partCut');
  for (const step of oldJoints) {
    const prefix = `cut-parts:${step.stepId}:`;
    const openings = (parts: typeof oldGeometry.parts) =>
      parts.flatMap(part => (part.cuts ?? []).filter(cut => cut.id.startsWith(prefix)).map(cut => `${part.partId}/${cut.id}`));
    const next = new Set(openings(newGeometry.parts));
    const lost = openings(oldGeometry.parts).filter(key => !next.has(key)).length;
    if (lost) result.costs.push(`Cut parts ${step.stepId}: ${lost} housing or joint opening(s) lost.`);
  }
  for (const part of oldGeometry.parts) {
    const next = newGeometry.parts.find(candidate => candidate.partId === part.partId);
    for (const cut of part.cuts ?? []) {
      if (cut.id.startsWith('cut-parts:')) continue;
      const replacement = next?.cuts?.find(candidate => candidate.id === cut.id);
      if (cut.to > cut.from && (!replacement || replacement.to <= replacement.from))
        result.costs.push(`${part.name}: cut ${cut.id} no longer removes material.`);
    }
    const sharedCuts = new Set(part.cuts?.map(cut => cut.id));
    for (const [copyId, cuts] of Object.entries(part.copyCuts ?? {})) {
      for (const cut of cuts) {
        if (sharedCuts.has(cut.id)) continue;
        const replacement = next?.copyCuts?.[copyId]?.find(candidate => candidate.id === cut.id);
        if (cut.to > cut.from && (!replacement || replacement.to <= replacement.from))
          result.costs.push(`${part.name}, copy ${copyId}: cut ${cut.id} no longer removes material.`);
      }
    }
  }
  return result;
}
