import {
  cadCopyName,
  detachPartCopy,
  setCopyCutDepth,
  designSteps,
  removeCadFeature,
  removeCadVariable,
  removePartCopy,
  removePartCut,
  setPartPattern,
  setCutDepth,
  setCutSuppressed,
  updatePartCut,
  withFeatureVersion,
  trimCadFolders,
  type CadDocument,
  type CadPart,
  type DesignStep,
} from '@wbcnc/cad';
import type { DesignEdit, ExistingCutEdit, Len, PartCopy, PartEdit, ScriptStepEdit, ScriptStepSettings } from './editTypes';

export class CadScriptError extends Error {}
export const fail = (message: string): never => {
  throw new CadScriptError(message);
};

/**
 * The one item a script means: the only one with this name, else the one with exactly this ID, else the only one whose ID
 * starts with it. `altId` is a second ID an item also answers to.
 */
export function resolveNamed<T extends { id: string }>(
  items: readonly T[],
  query: string,
  what: string,
  nameOf: (item: T) => string | undefined,
  altId?: (item: T) => string
): T {
  const named = items.filter(item => nameOf(item) === query);
  if (named.length > 1) return fail(`More than one ${what} is named ${query}. Use its handle.`);
  if (named[0]) return named[0];
  const ids = (item: T) => (altId ? [item.id, altId(item)] : [item.id]);
  // A whole ID wins over the longer IDs it happens to begin.
  const exact = items.filter(item => ids(item).includes(query));
  if (exact.length === 1) return exact[0]!;
  const matches = items.filter(item => ids(item).some(id => id.startsWith(query)));
  if (matches.length === 1) return matches[0]!;
  return fail(
    matches.length ? `The handle ${query} fits more than one ${what}. Use more of it.` : `There is no ${what} with the handle ${query}.`
  );
}

export function resolveHandle(ids: readonly string[], handle: string, what: string): string {
  return resolveNamed(
    ids.map(id => ({ id })),
    handle,
    what,
    () => undefined
  ).id;
}

export interface EditContext {
  get(): CadDocument;
  set(document: CadDocument): void;
  part(id: string): PartEdit;
  copy(partId: string, copyId: string): PartCopy;
  measure(value: Len, what: string, unit?: 'mm' | 'scalar'): number;
}

/** The parts and steps a folder's script may find; the design itself has no scope and finds everything. */
export interface ExistingScope {
  parts(): CadPart[];
  ownsStep(step: DesignStep): boolean;
  label: string;
}

type ExistingApi = Pick<
  DesignEdit,
  'existingCopy' | 'detachCopy' | 'step' | 'removePart' | 'removeCopy' | 'removePattern' | 'removeStep' | 'removeVariable'
>;
export type ExistingEdit = ExistingApi & { findPart(name: string): CadPart; cut(partId: string, handle: string): ExistingCutEdit };

export function existingDesignEdit(ctx: EditContext, scope?: ExistingScope): ExistingEdit {
  const save = (document: CadDocument) => ctx.set(trimCadFolders(document));
  const getPart = (id: string) => ctx.get().parts.find(part => part.id === id) ?? fail(`Part ${id} no longer exists.`);
  const replacePart = (id: string, update: (part: CadPart) => CadPart) =>
    save({ ...ctx.get(), parts: ctx.get().parts.map(part => (part.id === id ? update(part) : part)) });
  const scopeParts = () => scope?.parts() ?? ctx.get().parts;
  const within = scope ? ` in ${scope.label}` : '';
  const findPart = (name: string): CadPart => resolveNamed(scopeParts(), name, `part${within}`, part => part.name);
  const copies = (parts = ctx.get().parts) =>
    parts.flatMap(part =>
      (part.copies ?? []).map((copy, index) => ({ part, copy, name: cadCopyName(part, index), id: `${part.id}:${copy.id}` }))
    );
  const findCopy = (name: string) =>
    resolveNamed(
      copies(scopeParts()),
      name,
      `copy${within}`,
      copy => copy.name,
      copy => copy.copy.id
    );
  const findStep = (name: string): DesignStep =>
    resolveNamed(
      designSteps(ctx.get()).filter(step => !scope || scope.ownsStep(step)),
      name,
      `step${within}`,
      step => step.label
    );
  const checked = (value: Len, what: string, positive = false, unit: 'mm' | 'scalar' = 'mm') => {
    const number = ctx.measure(value, what, unit);
    if (!Number.isFinite(number) || (positive ? number <= 0 : number < 0))
      fail(`${what} must be ${positive ? 'positive' : 'non-negative'}.`);
    return number;
  };
  const removeStep = (input: ScriptStepEdit | string) => {
    const step = findStep(typeof input === 'string' ? input : input.id);
    const document = ctx.get();
    if (step.kind === 'partCut') save(removePartCut(document, step.id));
    else if (step.kind === 'pattern') save(setPartPattern(document, step.partId, null));
    else if (step.kind === 'copy') {
      const part = getPart(step.partId);
      save(removePartCopy(document, part.id, step.copyId!));
    } else if (step.kind === 'faceSketch' || step.kind === 'cut') save(removeCadFeature(document, step.partId, step.id));
    else if (step.kind === 'fillet')
      replacePart(step.partId, part => ({ ...part, fillets: part.fillets?.filter(fillet => fillet.id !== step.id) }));
    else if (step.kind === 'extrude') replacePart(step.partId, part => ({ ...part, extrude: false }));
    else if (step.kind === 'sketch') removePart(step.partId);
    else if (step.kind === 'move') replacePart(step.partId, ({ moved: _moved, placement: _placement, ...part }) => part);
  };
  const removePart = (input: PartEdit | string) => {
    const part = findPart(typeof input === 'string' ? input : input.id);
    const document = ctx.get();
    // Keep dependent sketches/steps as explicit broken references, rather than silently deleting the user's work.
    save(withFeatureVersion({ ...document, parts: document.parts.filter(candidate => candidate.id !== part.id) }));
  };
  const setStep = (id: string, settings: ScriptStepSettings) => {
    const step = findStep(id);
    const fields: Record<DesignStep['kind'], readonly string[]> = {
      sketch: [],
      faceSketch: [],
      move: [],
      extrude: ['thickness', 'suppressed'],
      cut: ['depth', 'suppressed'],
      copy: ['suppressed'],
      pattern: ['count', 'spacing', 'axis', 'suppressed'],
      partCut: ['tools', 'targets', 'clearance', 'suppressed'],
      fillet: ['radius', 'suppressed'],
    };
    const circularPattern = step.kind === 'pattern' && !!getPart(step.partId).pattern?.circular;
    const allowed = circularPattern ? ['count', 'suppressed'] : fields[step.kind];
    const unknown = Object.keys(settings).find(key => !allowed.includes(key));
    if (unknown)
      fail(
        `${circularPattern ? 'Circular pattern' : step.kind} has no setting ${unknown}. Available settings: ${allowed.join(', ') || '(none)'}.`
      );
    if (settings.suppressed !== undefined && typeof settings.suppressed !== 'boolean') fail('suppressed must be true or false.');
    if (step.kind === 'partCut') {
      const ids = (items: readonly (PartEdit | PartCopy)[], what: string) => {
        if (!Array.isArray(items) || !items.length) return fail(`${what} needs at least one part or copy.`);
        const all = new Set([...ctx.get().parts.map(part => part.id), ...copies().map(copy => copy.id)]);
        return items.map(item => (all.has(item.id) ? item.id : fail(`There is no ${what} part or copy ${item.id}.`)));
      };
      save(
        updatePartCut(ctx.get(), step.id, {
          ...(settings.tools && { tools: ids(settings.tools, 'Tool') }),
          ...(settings.targets && { targets: ids(settings.targets, 'Target') }),
          ...(settings.clearance !== undefined && {
            clearance: checked(settings.clearance, 'Clearance'),
            clearanceExpression: typeof settings.clearance === 'string' ? settings.clearance : undefined,
          }),
          ...(settings.suppressed !== undefined && { suppressed: settings.suppressed ? (true as const) : undefined }),
        })
      );
      return;
    }
    if (step.kind === 'cut') {
      const feature = getPart(step.partId).features?.find(feature => feature.id === step.id);
      if (feature?.type !== 'cut') return fail('This cut no longer exists.');
      if (settings.depth !== undefined) {
        const depth = settings.depth === 'through' ? 'through' : checked(settings.depth, 'Depth', true);
        const expression = typeof settings.depth === 'string' && settings.depth !== 'through' ? settings.depth : undefined;
        const document = feature.copyId
          ? setCopyCutDepth(ctx.get(), step.partId, feature.copyId, feature.sketchId, feature.regionId, depth, expression)
          : setCutDepth(ctx.get(), step.partId, feature.sketchId, feature.regionId, depth, expression);
        save(document);
      }
      if (settings.suppressed !== undefined) save(setCutSuppressed(ctx.get(), step.partId, step.id, settings.suppressed));
      return;
    }
    if (step.kind === 'extrude') {
      if (settings.thickness !== undefined) ctx.part(step.partId).thickness(settings.thickness);
      if (settings.suppressed !== undefined)
        replacePart(step.partId, part => ({ ...part, suppressed: settings.suppressed ? (true as const) : undefined }));
    }
    if (step.kind === 'pattern') {
      const current = getPart(step.partId).pattern!;
      const count = settings.count === undefined ? current.count : Math.floor(checked(settings.count, 'Count', true, 'scalar') + 1e-9);
      const spacing = settings.spacing === undefined ? current.spacing : ctx.measure(settings.spacing, 'Spacing');
      const axis = settings.axis ?? current.axis;
      if (!['x', 'y', 'z'].includes(axis)) fail('Pattern axis must be x, y or z.');
      if (!(count >= 1 && count <= 200)) fail('A part pattern needs 1 to 200 parts.');
      const next = {
        ...current,
        count,
        spacing,
        axis,
        ...(settings.count !== undefined && { countExpression: typeof settings.count === 'string' ? settings.count : undefined }),
        ...(settings.spacing !== undefined && { spacingExpression: typeof settings.spacing === 'string' ? settings.spacing : undefined }),
        ...(settings.suppressed !== undefined && { suppressed: settings.suppressed ? (true as const) : undefined }),
      };
      save(setPartPattern(ctx.get(), step.partId, next));
    }
    if (step.kind === 'copy')
      replacePart(step.partId, part => ({
        ...part,
        copies: part.copies?.map(copy =>
          copy.id === step.copyId
            ? {
                ...copy,
                suppressed: settings.suppressed === undefined ? copy.suppressed : settings.suppressed ? (true as const) : undefined,
              }
            : copy
        ),
      }));
    if (step.kind === 'fillet')
      replacePart(step.partId, part => ({
        ...part,
        fillets: part.fillets?.map(fillet =>
          fillet.id === step.id
            ? {
                ...fillet,
                ...(settings.radius !== undefined && {
                  radius: checked(settings.radius, 'Radius', true),
                  radiusExpression: typeof settings.radius === 'string' ? settings.radius : undefined,
                }),
                ...(settings.suppressed !== undefined && { suppressed: settings.suppressed ? (true as const) : undefined }),
              }
            : fillet
        ),
      }));
  };
  return {
    findPart,
    existingCopy(name) {
      const found = findCopy(name);
      return ctx.copy(found.part.id, found.copy.id);
    },
    step(name) {
      const found = findStep(name);
      return { id: found.id, kind: found.kind, set: settings => setStep(found.id, settings), remove: () => removeStep(found.id) };
    },
    removePart,
    detachCopy(input, name) {
      const found = findCopy(typeof input === 'string' ? input : input.id);
      const result = detachPartCopy(ctx.get(), found.part.id, found.copy.id, name);
      if ('error' in result) return fail(result.error);
      save(result.document);
      return ctx.part(result.partId);
    },
    removeCopy(input) {
      const found = findCopy(typeof input === 'string' ? input : input.id);
      if (found.copy.pattern) return fail('This is a pattern copy. Change the pattern count or detach the copy before removing it.');
      save(removePartCopy(ctx.get(), found.part.id, found.copy.id));
    },
    removePattern(input) {
      const part = findPart(typeof input === 'string' ? input : input.id);
      if (!part.pattern) return fail(`${part.name} has no pattern.`);
      save(setPartPattern(ctx.get(), part.id, null));
    },
    removeStep,
    removeVariable(name) {
      const variable = resolveNamed(ctx.get().variables ?? [], name, 'variable', variable => variable.name);
      const result = removeCadVariable(ctx.get(), variable.id);
      if ('error' in result) return fail(result.error);
      save(result.document);
    },
    cut(partId, handle) {
      const id = resolveHandle(
        (getPart(partId).features ?? []).filter(feature => feature.type === 'cut').map(feature => feature.id),
        handle,
        'cut'
      );
      return {
        id,
        depth: value => setStep(id, { depth: value }),
        suppress: value => setStep(id, { suppressed: value }),
        remove: () => removeStep(id),
      };
    },
  };
}
