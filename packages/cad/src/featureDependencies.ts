import { designSteps } from './designSteps';
import type { CadDocument, CadPart } from './types';
import { visitTypedValues } from './typedValues';
import { cadExpressionNames } from './valueExpressions';

/**
 * What each feature list entry builds on, directly: keyed by step id or variable id, the step ids and variable ids it
 * uses. A sketch uses the part it's drawn on and the variables its dimensions name; an extrude uses its sketch, the
 * variables its values name and the parts it joins, cuts or reaches up to; a step on a part, such as a fillet, uses the
 * part's extrude; a variable uses the variables its expression names.
 */
export function featureUses(document: CadDocument): Map<string, Set<string>> {
  const steps = designSteps(document);
  const ids = new Set(steps.map(step => step.id));
  const byName = new Map((document.variables ?? []).map(variable => [variable.name, variable.id]));
  const parts = new Map(document.parts.map(part => [part.id, part]));
  /** The step that makes a part's body: its own extrude, or the one it was made with. */
  const body = (partId: string | undefined): string | undefined => {
    const part = partId ? parts.get(partId) : undefined;
    if (!part) return undefined;
    if (ids.has(`${part.id}:extrude`)) return `${part.id}:extrude`;
    return part.extrudedWith && ids.has(`${part.extrudedWith}:extrude`) ? `${part.extrudedWith}:extrude` : undefined;
  };
  const uses = new Map<string, Set<string>>();
  const at = new Map(steps.map((step, index) => [step.id, index]));
  // Only what comes before: a part records the later steps cut into it, which build on it, not it on them.
  const add = (from: string | undefined, to: string | undefined) => {
    if (!from || !to || to === from) return;
    if (at.has(from) && at.has(to) && at.get(to)! > at.get(from)!) return;
    const set = uses.get(from) ?? new Set<string>();
    set.add(to);
    uses.set(from, set);
  };
  const variablesIn = (expression: string | undefined) =>
    expression ? cadExpressionNames(expression).flatMap(name => byName.get(name) ?? []) : [];
  const sketchOf = (part: CadPart) => {
    const id = `${part.sketchOf ?? part.id}:sketch`;
    return ids.has(id) ? id : undefined;
  };
  // A part keeps copies of the cuts later steps made into it, named for their own part: those belong to that step.
  const own: CadDocument = {
    ...document,
    parts: document.parts.map(part =>
      part.features?.some(feature => parts.has(feature.id.split(':')[0]!) && feature.id.split(':')[0] !== part.id)
        ? {
            ...part,
            features: part.features.filter(feature => !parts.has(feature.id.split(':')[0]!) || feature.id.split(':')[0] === part.id),
          }
        : part
    ),
  };
  // Values typed with variables: a sketch dimension's belong to the sketch, the rest to the extrude.
  visitTypedValues(own, {
    value: (typed, _kind, owner) => {
      const part = owner.partId ? parts.get(owner.partId) : undefined;
      if (!part) return;
      const step = owner.constraintId ? sketchOf(part) : body(part.id);
      for (const variable of variablesIn(typed.expression)) add(step, variable);
    },
    pattern: (pattern, owner) => {
      const part = owner.partId ? parts.get(owner.partId) : undefined;
      const step = part && sketchOf(part);
      for (const expression of Object.values(pattern.expressions)) for (const variable of variablesIn(expression)) add(step, variable);
    },
  });
  for (const variable of document.variables ?? []) for (const used of variablesIn(variable.expression)) add(variable.id, used);
  const supportOf = (part: CadPart) => {
    const on = part.drawnOn?.on as { partId?: unknown } | undefined;
    return typeof on?.partId === 'string' ? on.partId : undefined;
  };
  for (const step of steps) {
    const part = parts.get(step.partId);
    if (!part) continue;
    if (step.kind === 'sketch') add(step.id, body(supportOf(part)));
    else if (step.kind === 'extrude') {
      add(step.id, sketchOf(part));
      // A sketch on a face of a part, extruded into or out of that part, builds on it.
      if (part.faceProfile || part.remove || part.addTo !== undefined || part.intersect) add(step.id, body(supportOf(part)));
      // Every other part it names: what it adds to, reaches up to or cuts.
      const { sketch: _sketch, drawnOn: _drawnOn, ...rest } = part;
      const named = JSON.stringify(rest);
      for (const other of document.parts) if (other.id !== part.id && named.includes(`"${other.id}"`)) add(step.id, body(other.id));
    } else add(step.id, body(part.id));
  }
  return uses;
}

/** The entries `key` builds on (its parents) and the ones built on it (its children), each in feature list order. */
export function featureDependencies(document: CadDocument, key: string): { parents: string[]; children: string[] } {
  const uses = featureUses(document);
  const order = [...(document.variables ?? []).map(variable => variable.id), ...designSteps(document).map(step => step.id)];
  const ordered = (keys: Set<string>) => order.filter(id => keys.has(id));
  const children = new Set([...uses].filter(([, used]) => used.has(key)).map(([from]) => from));
  return { parents: ordered(uses.get(key) ?? new Set()), children: ordered(children) };
}
