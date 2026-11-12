import type { CadConstruction } from './constructionTypes';
import type { CadDiagnostic, CadDocument } from './types';
import { constructionShapeIssue } from './constructionShape';
import { cadDocumentVersion } from './documentVersion';
import { validateCadDocument } from './geometry';

/** Replace one complete declaration atomically; validation never stores a pass result. */
export function setCadConstruction(document: CadDocument, construction: CadConstruction): CadDocument {
  const inputIssue = constructionShapeIssue([construction]);
  if (inputIssue) throw new Error(inputIssue);
  const constructions = [...(document.constructions ?? []).filter(p => p.id !== construction.id), structuredClone(construction)];
  const issue = constructionShapeIssue(constructions);
  if (issue) throw new Error(issue);
  const next = { ...document, constructions, revision: document.revision + 1 };
  const result = { ...next, version: cadDocumentVersion(next) };
  // Loading refuses a design whose IDs repeat, so a plan reusing a part, folder or other plan's ID could never reopen.
  const duplicates = (value: CadDocument) => validateCadDocument(value).filter(issue => issue.code === 'duplicate-id').length;
  if (duplicates(result) > duplicates(document)) throw new Error('Construction, connection and hardware IDs must be unique in the design.');
  return result;
}

/** Removing construction intent is explicit; removing its members never silently removes it. */
export function removeCadConstruction(document: CadDocument, id: string): CadDocument {
  if (!document.constructions?.some(p => p.id === id)) return document;
  const next = { ...document, revision: document.revision + 1 };
  next.constructions = document.constructions.filter(p => p.id !== id);
  if (!next.constructions.length) delete next.constructions;
  return { ...next, version: cadDocumentVersion(next) };
}

/** Run against the solved source, which includes the current physical pattern instances. */
export function constructionReferenceIssues(document: CadDocument): CadDiagnostic[] {
  const malformed = constructionShapeIssue(document.constructions);
  if (malformed) return [{ code: 'invalid-construction', severity: 'error', message: malformed }];
  const issues: CadDiagnostic[] = [];
  for (const plan of document.constructions ?? []) {
    const missing = (what: string) =>
      issues.push({
        code: 'construction-missing-reference',
        severity: 'warning',
        message: `${plan.recipe}: repair ${what} before offering this construction as complete.`,
      });
    if (!document.folders?.some(f => f.id === plan.folderId)) missing('the construction folder');
    const variables = new Set(document.variables?.map(v => v.id));
    for (const parameter of plan.parameters) if (!variables.has(parameter.variableId)) missing(`parameter ${parameter.name}`);
    const members = new Map(plan.members.map(m => [m.role, m]));
    for (const member of plan.members) {
      const part = document.parts.find(p => p.id === member.partId);
      if (!part || (member.copyId !== undefined && !part.copies?.some(c => c.id === member.copyId)))
        missing(`physical member ${member.role}`);
    }
    const checkRoles = (roles: string[]) => {
      for (const role of roles) if (!members.has(role)) missing(`member role ${role}`);
    };
    for (const material of plan.materials) {
      checkRoles(material.roles);
      if (!variables.has(material.stockVariableId)) missing('the material stock variable');
    }
    const hardwareIds = new Set(plan.hardware.map(h => h.id));
    const checkHardware = (ids: string[]) => {
      for (const id of ids) if (!hardwareIds.has(id)) missing(`purchased hardware ${id}`);
    };
    for (const hardware of plan.hardware) {
      if (!variables.has(hardware.lengthVariableId)) missing(`hardware length ${hardware.id}`);
      for (const anchor of hardware.holes) {
        const member = members.get(anchor.role);
        const part = document.parts.find(p => p.id === member?.partId);
        const sketches = part
          ? [
              part.sketch,
              ...(part.features ?? []).flatMap(f =>
                f.type === 'sketch' && (f.copyId === undefined || f.copyId === member?.copyId) ? [f.sketch] : []
              ),
            ]
          : [];
        const sketch = sketches.find(s => s.id === anchor.sketchId);
        if (!sketch || anchor.entityIds.some(id => !sketch.entities.some(e => e.id === id)))
          missing(`hardware hole ${hardware.id} (${anchor.purpose})`);
      }
    }
    for (const connection of plan.connections) {
      checkRoles(connection.roles);
      checkHardware(connection.hardwareIds);
    }
    if (plan.adhesive) checkRoles(plan.adhesive.roles);
    for (const step of plan.assembly) {
      checkRoles(step.roles);
      checkHardware(step.hardwareIds);
    }
  }
  return issues;
}
