import { lengthExpression } from './curveExpressions';
import { prepareEmptyStudio } from './emptyStudio';
import { checkedDesignApi } from './argumentChecks';
import {
  addFaceSketch,
  addCopyFaceSketch,
  setCopyCutDepth,
  addPartCopy,
  addPartCut,
  cadFaceFacing,
  evaluateCadDocument,
  resolveDrawnPlacements,
  setPartPattern,
  CAD_MAX_PART_PATTERN,
  cadFaceSketches,
  cadVariableScope,
  createCadDocument,
  createCadPart,
  migrateDesignUnitNumbers,
  newCadId,
  parseCadValue,
  removeCadFeature,
  setCadVariable,
  setCutDepth,
  type CadDocument,
  type CadFaceRef,
  type CadDrawnOn,
  type CadPart,
  type CadPlacement,
  type CadSketch,
  cadCopyName,
  resolvePartPatterns,
  initializeCadSolver,
  solveCadDocumentNow,
} from '@wbcnc/cad';
import { inspectCadDocument, shortHandles, type CadExpectation, type CadInspection } from './inspect';
import { CadScriptError, fail, resolveHandle, existingDesignEdit, type EditContext, type ExistingScope } from './editExisting';
import { runFolderScope } from './folderScope';
import { createSketchEdit, type SketchEditContext } from './editSketch';
import { declareScriptConstruction } from './constructionApi';

export type * from './editTypes';
import type { Xy, Len, CadAxis, SketchEdit, PartEdit, PartCopy, CadPlaceOptions, DesignEdit, CadScript } from './editTypes';

/** Identity, so a design file gets the API's types without importing them by hand. */
export const design = (script: CadScript) => script;

const axes: Record<CadAxis, [number, number, number]> = {
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+y': [0, 1, 0],
  '-y': [0, -1, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
};

/** The turn that takes the part's x, y and z to these directions, as a unit quaternion x, y, z, w. */
function rotationTo(ex: readonly number[], ey: readonly number[]): CadPlacement['rotation'] {
  const ez = [ex[1]! * ey[2]! - ex[2]! * ey[1]!, ex[2]! * ey[0]! - ex[0]! * ey[2]!, ex[0]! * ey[1]! - ex[1]! * ey[0]!];
  const [m00, m10, m20] = ex as [number, number, number],
    [m01, m11, m21] = ey as [number, number, number],
    [m02, m12, m22] = ez as [number, number, number];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

function createDesignEdit(start: CadDocument, expectations: Map<string, CadExpectation[]>) {
  const initial = prepareEmptyStudio(start);
  let document = initial.document;
  let variablesDirty = false;
  const solveForQuery = () => {
    if (!variablesDirty) return;
    // Variable edits change dimension values before they move vertices. A geometric pick must see the solved shape.
    const solved = solveCadDocumentNow(document, { sketchOnly: true });
    if (solved.status !== 'solved')
      fail(
        `The design could not be solved before this geometric query: ${solved.diagnostics.find(d => d.severity === 'error')?.message ?? solved.status}`
      );
    document = solved.document;
    variablesDirty = false;
  };
  const closures: { partId: string; sketchId: string; edgeId: string; from: Xy; to: Xy }[] = [];
  const measure = (value: Len, what: string, unit: 'mm' | 'scalar' | 'deg' = 'mm'): number => {
    if (typeof value === 'number') return value;
    // Scripts measure in mm whatever the design's unit; `editCad` writes the mm out where the design isn't in mm.
    const result = parseCadValue(value, { unit, variables: cadVariableScope(document), lengthUnit: 'mm' });
    return 'error' in result ? fail(`${what} "${value}": ${result.error}`) : result.value;
  };
  const lengthTerm = (value: Len) => lengthExpression(value, cadVariableScope(document));
  const expressionOf = (value: Len) => (typeof value === 'string' ? { expression: value } : {});
  const placementOf = ({ at, x = '+x', y = '+y' }: CadPlaceOptions): CadPlacement => {
    const ex = axes[x],
      ey = axes[y];
    if (!ex || !ey) fail(`Axes are written like '+x' or '-z', not ${x} and ${y}.`);
    if (ex.some((value, i) => value !== 0 && ey[i] !== 0)) fail(`The part's x and y can't both point along ${x[1]}.`);
    const position = at.map((value, i) => measure(value, `Position ${'xyz'[i]}`)) as [number, number, number];
    const expressions = at.map(value => (typeof value === 'string' ? value : null)) as [string | null, string | null, string | null];
    return { position, rotation: rotationTo(ex, ey), ...(expressions.some(Boolean) && { positionExpressions: expressions }) };
  };
  const replacePart = (partId: string, edit: (part: CadPart) => CadPart) => {
    document = { ...document, parts: document.parts.map(part => (part.id === partId ? edit(part) : part)) };
  };
  const partOf = (partId: string) => document.parts.find(part => part.id === partId)!;
  // A cut-parts tool `<partId>:<copyId>` cuts with that one copy.
  // An unnamed copy is named by its place among the part's copies, which later copies can change.
  const copyHandle = (partId: string, copyId: string): PartCopy => ({
    id: `${partId}:${copyId}`,
    get name() {
      const part = partOf(partId);
      return cadCopyName(part, part.copies?.findIndex(copy => copy.id === copyId) ?? -1);
    },
    sketchOn(face) {
      const on: CadFaceRef = typeof face === 'object' ? { floorOf: face.floorOf.id } : face;
      try {
        const result = addCopyFaceSketch(document, partId, copyId, on);
        document = result.document;
        return sketchEdit(partId, result.sketchId);
      } catch (error) {
        return fail(error instanceof Error ? error.message : 'This copy cannot be sketched on.');
      }
    },
    cut({ sketchId, regionId }, { depth }) {
      const mm = depth === 'through' ? depth : measure(depth, 'Depth');
      if (mm !== 'through' && !(mm > 0)) return fail('A cut needs a positive depth or through.');
      try {
        document = setCopyCutDepth(
          document,
          partId,
          copyId,
          sketchId,
          regionId,
          mm,
          typeof depth === 'string' && depth !== 'through' ? depth : undefined
        );
        return {
          id: partOf(partId).features!.find(
            feature => feature.type === 'cut' && feature.copyId === copyId && feature.sketchId === sketchId && feature.regionId === regionId
          )!.id,
        };
      } catch (error) {
        return fail(error instanceof Error ? error.message : 'This copy cannot be cut.');
      }
    },
  });
  const sketchOf = (partId: string, sketchId: string): CadSketch => {
    const part = partOf(partId);
    return part.sketch.id === sketchId ? part.sketch : cadFaceSketches(part).find(face => face.sketch.id === sketchId)!.sketch;
  };
  const setSketch = (partId: string, sketchId: string, sketch: CadSketch) =>
    replacePart(partId, part =>
      part.sketch.id === sketchId
        ? (() => {
            // Drawing into the starter uses its original implicit extrude, just as editing it in the studio does.
            const next = { ...part, sketch };
            if (part.id === initial.starterPartId && sketch.entities.some(entity => entity.type !== 'point')) delete next.extrude;
            return next;
          })()
        : { ...part, features: part.features?.map(f => (f.type === 'sketch' && f.sketch.id === sketchId ? { ...f, sketch } : f)) }
    );

  const sketchContext: SketchEditContext = {
    document: () => document,
    partOf,
    sketchOf,
    setSketch,
    measure,
    lengthTerm,
    expressionOf,
    solveForQuery,
    closures,
  };
  const sketchEdit = (partId: string, sketchId: string): SketchEdit => createSketchEdit(sketchContext, partId, sketchId);

  const partEdit = (partId: string): PartEdit => ({
    id: partId,
    name: partOf(partId).name,
    profile: sketchEdit(partId, partOf(partId).sketch.id),
    thickness(mm) {
      const value = measure(mm, 'Thickness');
      if (!(value > 0)) fail(`A part needs a positive thickness, not ${value}.`);
      replacePart(partId, ({ thicknessExpression: _thicknessExpression, ...part }) => ({
        ...part,
        thickness: value,
        ...(typeof mm === 'string' && { thicknessExpression: mm }),
      }));
    },
    relief(diameter) {
      if (diameter === null) {
        replacePart(partId, ({ cornerRelief: _cornerRelief, ...part }) => part);
        return;
      }
      const value = measure(diameter, 'Relief');
      if (!(value > 0)) fail(`Corner relief needs a positive bit diameter, not ${value}.`);
      replacePart(partId, part => ({
        ...part,
        cornerRelief: { diameter: value, ...(typeof diameter === 'string' && { diameterExpression: diameter }) },
      }));
    },
    sketchOn(face) {
      const on: CadFaceRef = typeof face === 'object' ? { floorOf: face.floorOf.id } : face;
      const result = addFaceSketch(document, partId, on);
      document = result.document;
      return sketchEdit(partId, result.sketchId);
    },
    sketch(handle) {
      const ids = cadFaceSketches(partOf(partId)).map(face => face.sketch.id);
      return sketchEdit(partId, resolveHandle(ids, handle, 'face sketch'));
    },
    cut({ sketchId, regionId }, { depth }) {
      const mm = depth === 'through' ? depth : measure(depth, 'Depth');
      if (mm !== 'through' && !(mm > 0))
        fail(`A cut needs some depth, not ${mm} mm${typeof depth === 'string' ? ` from '${depth}'` : ''}.`);
      document = setCutDepth(
        document,
        partId,
        sketchId,
        regionId,
        mm,
        typeof depth === 'string' && depth !== 'through' ? depth : undefined
      );
      const cut = partOf(partId).features!.find(f => f.type === 'cut' && f.sketchId === sketchId && f.regionId === regionId)!;
      return { id: cut.id };
    },
    remove(feature) {
      document = removeCadFeature(document, partId, feature.id);
    },
    existingCut(handle) {
      return existing.cut(partId, handle);
    },
    expect(expectation) {
      expectations.set(partId, [...(expectations.get(partId) ?? []), expectation]);
    },
    place(options) {
      const placement = placementOf(options);
      replacePart(partId, part => ({ ...part, placement }));
    },
    copy({ mirrored, name, ...options }) {
      const placement = placementOf(options);
      const added = addPartCopy(document, partId, { mirrored });
      document = added.document;
      replacePart(partId, part => ({
        ...part,
        copies: part.copies?.map(copy => (copy.id === added.id ? { ...copy, placement, ...(name && { name }) } : copy)),
      }));
      // Copies placed by hand go ahead of a pattern's, as they will in the design, so names read now stay right.
      document = resolvePartPatterns(document);
      return copyHandle(partId, added.id);
    },
    face(which) {
      solveForQuery();
      if (which === 'top' || which === 'underside') return { partId, face: which };
      const found = cadFaceFacing(document, partId, which);
      return 'error' in found ? fail(found.error) : { partId, face: found.face };
    },
    drawOn(on, { offset = 0, inward } = {}) {
      if (typeof on === 'object' && on.partId === partId) fail(`${partOf(partId).name} can't be drawn on itself.`);
      if (!partOf(partId).sketch.entities.some(e => e.type !== 'point'))
        fail(`Draw ${partOf(partId).name}’s profile before drawing it on a plane or face.`);
      const drawnOn: CadDrawnOn = {
        on: typeof on === 'string' ? { plane: on } : { partId: on.partId, face: on.face },
        offset: measure(offset, 'Offset'),
        ...(typeof offset === 'string' && { offsetExpression: offset }),
        ...(inward && { inward: true }),
      };
      replacePart(partId, part => ({ ...part, drawnOn }));
      // Placed now, so a face of this part can be picked by the way it looks.
      document = resolveDrawnPlacements(document, evaluateCadDocument(document).parts).document;
    },
    pattern({ axis, count, spacing }) {
      if (partOf(partId).pattern?.circular)
        fail(
          'This part has a circular pattern. Edit its count with d.step(...).set({ count }), or removePattern before creating a linear pattern.'
        );
      const total = Math.floor(measure(count, 'Count', 'scalar') + 1e-9);
      if (!(total >= 1)) fail(`A part pattern needs at least one part, not ${total}.`);
      if (total > CAD_MAX_PART_PATTERN) fail(`A part pattern makes at most ${CAD_MAX_PART_PATTERN} parts, not ${total}.`);
      document = setPartPattern(document, partId, {
        axis,
        count: total,
        spacing: measure(spacing, 'Spacing'),
        ...(typeof count === 'string' && { countExpression: count }),
        ...(typeof spacing === 'string' && { spacingExpression: spacing }),
      });
      // A pattern of one makes no copies, and the part may have none.
      return (partOf(partId).copies ?? []).filter(copy => copy.pattern).map(copy => copyHandle(partId, copy.id));
    },
  });

  const existingContext: EditContext = {
    get: () => document,
    set: next => {
      document = next;
    },
    part: partEdit,
    copy: copyHandle,
    measure,
  };
  const existing = existingDesignEdit(existingContext);
  const optionsOnPart = (partId: string, options?: { thickness?: Len; relief?: Len }) => {
    const edit = partEdit(partId);
    if (options?.thickness !== undefined) edit.thickness(options.thickness);
    if (options?.relief !== undefined) edit.relief(options.relief);
    return edit;
  };
  const { findPart: _findPart, cut: _cut, ...existingApi } = existing;
  const folderContext = {
    get: () => document,
    set: (next: CadDocument) => {
      document = next;
      variablesDirty = true;
    },
    existing: (scope: ExistingScope) => existingDesignEdit(existingContext, scope),
  };
  const edit: DesignEdit = {
    folder(name, script) {
      return runFolderScope(folderContext, edit, name, script);
    },
    existingFolder(name, script) {
      return runFolderScope(folderContext, edit, name, script, true);
    },
    ...existingApi,
    construction(options) {
      const result = declareScriptConstruction(document, options);
      document = result.document;
      return { id: result.id };
    },
    part(name, options) {
      return optionsOnPart(existing.findPart(name).id, options);
    },
    newPart(name, options) {
      if (!name.trim()) return fail('A new part needs a name.');
      if (document.parts.some(part => part.name === name)) return fail(`There is already a part named ${name}. Use part() to edit it.`);
      const part = { ...createCadPart(name, 18), id: newCadId() };
      document = { ...document, parts: [...document.parts, part] };
      return optionsOnPart(part.id, options);
    },
    variable(name, expression) {
      const existing = document.variables?.find(variable => variable.name === name);
      const result = setCadVariable(
        document,
        { id: existing?.id, name, expression },
        { lengthUnit: 'mm', spellOutLengths: (document.lengthUnit ?? 'mm') !== 'mm' }
      );
      if ('error' in result) return fail(`The variable ${name}: ${result.error}`);
      document = resolvePartPatterns(result.document);
      variablesDirty = true;
      return name;
    },
    cutParts(targets, { with: tools, clearance = 0, split, cornerRelief }) {
      const ids = (parts: PartEdit | PartCopy | readonly (PartEdit | PartCopy)[]) =>
        'id' in parts ? [parts.id] : parts.map(part => part.id);
      const value = measure(clearance, 'Clearance');
      if (value < 0) fail(`A clearance can't be negative: ${value} mm.`);
      const fingers = typeof split === 'object' ? measure(split.fingers, 'Fingers', 'scalar') : undefined;
      if (fingers !== undefined && !(Number.isInteger(fingers) && fingers >= 2))
        fail(`A finger joint needs a whole number of fingers, at least 2, not ${fingers}.`);
      const dogbone = typeof cornerRelief === 'object' ? measure(cornerRelief.dogbone, 'Cutter diameter') : undefined;
      if (dogbone !== undefined && !(dogbone > 0)) fail(`A dogbone needs a cutter diameter greater than zero, not ${dogbone} mm.`);
      document = addPartCut(
        document,
        ids(tools),
        ids(targets),
        { value, ...(typeof clearance === 'string' && { expression: clearance }) },
        typeof split === 'object'
          ? { fingers: fingers!, ...(typeof split.fingers === 'string' && { fingersExpression: split.fingers }) }
          : split,
        cornerRelief === 'off'
          ? null
          : typeof cornerRelief === 'object'
            ? {
                diameter: dogbone!,
                ...(typeof cornerRelief.dogbone === 'string' && { diameterExpression: cornerRelief.dogbone }),
              }
            : undefined
      ).document;
    },
    value(expression) {
      // A count or ratio, such as `'(height - 2*margin)/pitch'`, has no unit.
      if (
        typeof expression === 'string' &&
        !('error' in parseCadValue(expression, { unit: 'scalar', variables: cadVariableScope(document) }))
      )
        return measure(expression, 'Value', 'scalar');
      return measure(expression, 'Value');
    },
  };
  return {
    edit,
    document: () => document,
    closures,
  };
}

export interface CadEditResult extends CadInspection {
  ok: boolean;
  /** Why the script stopped. The design is then returned as it was before the script. */
  scriptError?: string;
}

/**
 * Runs a script against a design, or a new one, then solves and reports on the result. The output is an ordinary
 * document and the script isn't kept, so hand edits later have nothing to fight with.
 */
export async function editCad(
  start: CadDocument | null,
  script: CadScript,
  options: { name?: string; toolpaths?: boolean } = {}
): Promise<CadEditResult> {
  const base = start ?? createCadDocument(options.name);
  await initializeCadSolver();
  const expectations = new Map<string, CadExpectation[]>();
  const session = createDesignEdit(base, expectations);
  let scriptError: string | undefined;
  try {
    script(checkedDesignApi(session.edit));
  } catch (error) {
    if (!(error instanceof CadScriptError)) throw error;
    scriptError = error.message;
  }
  // A failed script leaves the design as it was: half of an intent is worse than none of it.
  // A script's plain numbers are mm. In a design measured in another unit they're saved saying so (`t + 1 mm`), so they
  // keep their size when edited in the app, where a plain number is in the design's unit.
  const edited = scriptError ? base : migrateDesignUnitNumbers({ ...session.document(), revision: base.revision + 1 });
  const inspected = await inspectCadDocument(edited, expectations, { toolpaths: options.toolpaths });
  if (!scriptError)
    for (const closure of session.closures) {
      const part = inspected.document.parts.find(part => part.id === closure.partId);
      const sketch =
        part && [part.sketch, ...cadFaceSketches(part).map(face => face.sketch)].find(sketch => sketch.id === closure.sketchId);
      if (!sketch?.entities.some(entity => entity.id === closure.edgeId)) continue;
      const ref = shortHandles(sketch.entities.map(entity => entity.id)).get(closure.edgeId)!;
      inspected.report.warnings.push({
        code: 'close-straight',
        part: part!.name,
        entities: [ref],
        message: `Path ${ref}: close() adds a straight edge from ${closure.from.join(', ')} to ${closure.to.join(', ')}. Use close({ straight: true }) if intended.`,
      });
    }
  // A new design that failed is empty, and saying so would only hide the script's error.
  if (scriptError && !base.parts.length) inspected.report.errors = inspected.report.errors.filter(error => error.code !== 'no-parts');
  return { ...inspected, ok: inspected.report.ok && !scriptError, ...(scriptError && { scriptError }) };
}
