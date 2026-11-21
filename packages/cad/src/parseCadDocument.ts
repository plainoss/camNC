import { validateExtrudeSettings } from './validateExtrudeSettings';
import { cadVariableNameError } from './valueExpressions';
import { nestedDeeperThan } from './nestingDepth';
import { validPartCutSplit } from './partCutSplit';
import { CAD_DOCUMENT_VERSION, type CadDocument, type CadSketch } from './types';
import { withSplineHandleSegments } from './splineHandles';
import { cadFolderIssue, cadFolderStepIssue } from './folderModel';
import { designSteps } from './designSteps';
import { constructionShapeIssue } from './constructionShape';
import { migrateDesignUnitNumbers } from './lengthUnits';
import { partCutReliefIssue } from './partCutRelief';
import { copyOperationSourceIssue } from './copyOperationSource';
import { number, reference } from './parseCadChecks';
import { checkCadPartSetup } from './parseCadPart';
import { checkCadSketch } from './parseCadSketch';

/** Reject invalid source shapes early when loading portable documents. Geometric errors stay editable. */
export function parseCadDocument(input: unknown): CadDocument {
  // Saved designs nest about ten levels; far deeper input is not one, and would overflow the stack while loading.
  if (!input || typeof input !== 'object' || nestedDeeperThan(input, 64)) throw new Error('Invalid CAD document');
  const d = input as CadDocument;
  if (
    // Writers save version 1; retain files from the previously supported reader versions.
    !Number.isInteger(d.version) ||
    d.version < CAD_DOCUMENT_VERSION ||
    d.version > 7 ||
    typeof d.id !== 'string' ||
    typeof d.name !== 'string' ||
    (d.lengthUnit !== undefined && !['mm', 'cm', 'm', 'in', 'ft'].includes(d.lengthUnit)) ||
    !Number.isSafeInteger(d.revision) ||
    d.revision < 0 ||
    !Array.isArray(d.parts)
  )
    throw new Error('Invalid CAD document');
  const constructionIssue = constructionShapeIssue(d.constructions);
  if (constructionIssue) throw new Error(constructionIssue);
  const ids = new Set<string>([d.id]);
  const addId = (id: unknown, into = ids) => {
    if (typeof id !== 'string' || !id || into.has(id)) throw new Error('CAD IDs must be unique nonempty strings');
    into.add(id);
  };
  if (d.variables !== undefined) {
    if (!Array.isArray(d.variables)) throw new Error('Invalid CAD variables');
    const names = new Set<string>();
    for (const variable of d.variables) {
      if (!variable || typeof variable !== 'object') throw new Error('Invalid CAD variable');
      addId(variable.id);
      if (typeof variable.name !== 'string' || cadVariableNameError(variable.name) || names.has(variable.name))
        throw new Error('Invalid CAD variable name');
      if (typeof variable.expression !== 'string') throw new Error('Invalid CAD variable');
      if (variable.before !== undefined && typeof variable.before !== 'string') throw new Error('Invalid CAD variable');
      if (variable.suppressed !== undefined && variable.suppressed !== true) throw new Error('Invalid CAD variable');
      for (const key of ['after', 'description'] as const)
        if (variable[key] !== undefined && typeof variable[key] !== 'string') throw new Error('Invalid CAD variable');
      names.add(variable.name);
    }
  }
  if (d.planes !== undefined) {
    if (!Array.isArray(d.planes)) throw new Error('Invalid CAD planes');
    for (const plane of d.planes) {
      if (!plane || typeof plane !== 'object' || typeof plane.name !== 'string') throw new Error('Invalid CAD plane');
      addId(plane.id);
      const on = plane.on;
      if (!on || typeof on !== 'object' || ('plane' in on ? !['top', 'front', 'right'].includes(on.plane) : typeof on.partId !== 'string'))
        throw new Error('Invalid CAD plane');
      if (plane.offsetExpression !== undefined && typeof plane.offsetExpression !== 'string') throw new Error('Invalid CAD plane');
      number(plane.offset);
    }
  }
  if (d.partCuts !== undefined) {
    if (!Array.isArray(d.partCuts)) throw new Error('Invalid CAD part cuts');
    for (const step of d.partCuts) {
      if (!step || typeof step !== 'object' || !Array.isArray(step.tools) || !Array.isArray(step.targets))
        throw new Error('Invalid CAD part cut');
      addId(step.id);
      [...step.tools, ...step.targets].forEach(reference);
      number(step.clearance);
      if (!validPartCutSplit(step.split)) throw new Error('Invalid CAD part cut');
      if (step.clearanceExpression !== undefined && typeof step.clearanceExpression !== 'string') throw new Error('Invalid CAD part cut');
      if (step.consumeTools !== undefined && step.consumeTools !== true) throw new Error('Invalid CAD part cut');
      if (step.operation !== undefined && !['union', 'subtract', 'intersect'].includes(step.operation))
        throw new Error('Invalid CAD part cut');
      const reliefIssue = partCutReliefIssue(step.cornerRelief);
      if (reliefIssue) throw new Error(reliefIssue);
    }
  }
  const operationIssue = copyOperationSourceIssue(d);
  if (operationIssue) throw new Error(operationIssue);
  for (const move of d.copyTransforms ?? []) addId(move.id);
  for (const p of d.parts) {
    if (!p || typeof p !== 'object' || !p.sketch || typeof p.sketch !== 'object') throw new Error('Invalid CAD part');
    addId(p.id);
    if (
      typeof p.name !== 'string' ||
      typeof p.thickness !== 'number' ||
      !Array.isArray(p.sketch.entities) ||
      !Array.isArray(p.sketch.constraints)
    )
      throw new Error('Invalid CAD part');
    number(p.thickness);
    validateExtrudeSettings(p, number, reference);
    checkCadPartSetup(p, d, addId);
    if (p.features !== undefined && !Array.isArray(p.features)) throw new Error('Invalid CAD features');
    // A shared sketch, and a Remove step's sketch on the board it cuts, are copies: their IDs are the original's, so
    // they're checked against IDs of their own. Loading migrates every sketch, so each is checked.
    const sketches: [CadSketch, boolean][] = [[p.sketch, !p.sketchOf]];
    for (const f of p.features ?? []) {
      if (!f || typeof f !== 'object') throw new Error('Invalid CAD feature');
      addId(f.id);
      if (f.copyId !== undefined) reference(f.copyId);
      if (f.type === 'sketch') {
        if (!f.sketch || typeof f.sketch !== 'object' || !Array.isArray(f.sketch.entities) || !Array.isArray(f.sketch.constraints))
          throw new Error('Invalid CAD feature');
        if (f.on !== 'top' && f.on !== 'underside' && (typeof f.on !== 'object' || !f.on)) throw new Error('Invalid CAD feature');
        if (typeof f.on === 'object') reference(f.on.floorOf);
        if (f.removedBy !== undefined) reference(f.removedBy);
        sketches.push([f.sketch, f.removedBy === undefined]);
      } else if (f.type === 'cut') {
        reference(f.sketchId);
        reference(f.regionId);
        if (f.depth !== 'through') number(f.depth);
        if (f.suppressed !== undefined && typeof f.suppressed !== 'boolean') throw new Error('Invalid CAD feature');
        if (f.depthExpression !== undefined && (typeof f.depthExpression !== 'string' || f.depth === 'through'))
          throw new Error('Invalid CAD feature');
      } else throw new Error('Invalid CAD feature');
    }
    for (const [sketch, own] of sketches) {
      const scope = own ? ids : new Set<string>();
      const add = (id: unknown) => addId(id, scope);
      add(sketch.id);
      checkCadSketch(sketch, add);
    }
  }
  const folderIssue = cadFolderIssue(d) || cadFolderStepIssue(d, designSteps(d));
  if (folderIssue) throw new Error(folderIssue);
  for (const folder of d.folders ?? []) addId(folder.id);
  for (const plan of d.constructions ?? []) {
    addId(plan.id);
    for (const connection of plan.connections) addId(connection.id);
    for (const hardware of plan.hardware) addId(hardware.id);
  }
  const parsed = structuredClone(d);
  parsed.version = CAD_DOCUMENT_VERSION;
  for (const part of parsed.parts) {
    part.sketch = withSplineHandleSegments(part.sketch);
    for (const feature of part.features ?? []) if (feature.type === 'sketch') feature.sketch = withSplineHandleSegments(feature.sketch);
  }
  return migrateDesignUnitNumbers(parsed);
}
