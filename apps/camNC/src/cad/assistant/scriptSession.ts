import type { CadDocument } from '@wbcnc/cad';
import {
  assistantDataArray,
  buildAssistantRecipe,
  plainAssistantData,
  type AssistantRecipeName,
  type AssistantRecipeParameters,
} from './recipeCatalog';

export interface AssistantScriptPatch {
  oldText: string;
  newText: string;
}
export type AssistantScriptInput =
  | { source: string }
  | { recipe: AssistantRecipeName; parameters?: Record<string, unknown> }
  | { scriptId: string; expectedHash?: string; patches?: AssistantScriptPatch[] };
export interface AssistantScriptRecord {
  readonly scriptId: string;
  readonly hash: string;
  readonly source: string;
  readonly baseId: string;
  readonly baseRevision: number;
  readonly recipe?: AssistantRecipeName;
  readonly parameters?: AssistantRecipeParameters;
}
export interface AssistantScriptSessionOptions {
  maxScripts?: number;
  maxSourceBytes?: number;
  maxPatches?: number;
  maxPatchBytes?: number;
}

const encoder = new TextEncoder();
async function sourceHash(source: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(source)));
  return `sha256:${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Immutable, per-run scripts. Every resolved source is still checked against the caller's original base. */
export function createAssistantScriptSession(base: CadDocument, options: AssistantScriptSessionOptions = {}) {
  const initialBase = structuredClone(base);
  const snapshot = JSON.stringify(initialBase);
  const limits = { maxScripts: 20, maxSourceBytes: 256_000, maxPatches: 20, maxPatchBytes: 64_000, ...options };
  if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 1))
    throw new Error('Script session limits must be positive integers.');
  const scripts = new Map<string, AssistantScriptRecord>();
  const assertBase = (current: CadDocument) => {
    // Revision is part of the snapshot: editing and then undoing must not revive an earlier script session.
    if (JSON.stringify(current) !== snapshot)
      throw new Error('The design revision changed. Start a new script session against the current design.');
  };
  const sourceSize = (source: unknown): source is string => {
    if (typeof source !== 'string' || !source.trim()) throw new Error('A script needs nonempty JavaScript source.');
    if (encoder.encode(source).length > limits.maxSourceBytes) throw new Error('The script exceeds the source byte limit.');
    return true;
  };
  const get = (id: unknown, current = base): AssistantScriptRecord => {
    assertBase(current);
    if (typeof id !== 'string' || !scripts.has(id)) throw new Error('Unknown scriptId in this design session.');
    return scripts.get(id)!;
  };
  const resolve = async (input: unknown, current = base): Promise<AssistantScriptRecord> => {
    assertBase(current);
    const request = plainAssistantData(input, 'Script request');
    const kinds = ['source', 'recipe', 'scriptId'].filter(key => Object.hasOwn(request, key));
    if (kinds.length !== 1) throw new Error('Choose exactly one of source, recipe, or scriptId.');
    const allowed =
      kinds[0] === 'source' ? ['source'] : kinds[0] === 'recipe' ? ['recipe', 'parameters'] : ['scriptId', 'expectedHash', 'patches'];
    if (Object.keys(request).some(key => !allowed.includes(key)))
      throw new Error(`Unexpected script request field. Available: ${allowed.join(', ')}.`);
    let source: string;
    let provenance: Pick<AssistantScriptRecord, 'recipe' | 'parameters'> = {};
    if (kinds[0] === 'source') {
      sourceSize(request.source);
      source = request.source as string;
    } else if (kinds[0] === 'recipe') {
      const recipe = buildAssistantRecipe(request.recipe, request.parameters);
      source = recipe.source;
      provenance = { recipe: recipe.recipe, parameters: recipe.parameters };
    } else {
      const previous = get(request.scriptId, current);
      if (request.expectedHash !== undefined && request.expectedHash !== previous.hash)
        throw new Error('Script hash does not match this immutable revision.');
      if (request.patches === undefined) return previous;
      if (request.expectedHash !== previous.hash) throw new Error('Patches require the expectedHash of the script being repaired.');
      const patches = assistantDataArray(request.patches, 'Script patches');
      if (patches.length < 1 || patches.length > limits.maxPatches)
        throw new Error(`Use between 1 and ${limits.maxPatches} exact-match patches.`);
      let patchBytes = 0;
      source = previous.source;
      for (const inputPatch of patches) {
        const patch = plainAssistantData(inputPatch, 'Script patch');
        if (
          Object.keys(patch).some(key => !['oldText', 'newText'].includes(key)) ||
          typeof patch.oldText !== 'string' ||
          !patch.oldText ||
          typeof patch.newText !== 'string'
        )
          throw new Error('Each patch needs nonempty oldText and string newText, with no other fields.');
        patchBytes += encoder.encode(patch.oldText).length + encoder.encode(patch.newText).length;
        if (patchBytes > limits.maxPatchBytes) throw new Error('The patches exceed the patch byte limit.');
        const at = source.indexOf(patch.oldText);
        if (at < 0 || source.indexOf(patch.oldText, at + 1) >= 0)
          throw new Error('Patch oldText must match exactly once; include more unchanged context.');
        source = source.slice(0, at) + patch.newText + source.slice(at + patch.oldText.length);
        sourceSize(source);
      }
      // An arbitrary repair is no longer guaranteed to retain its original recipe parameter meanings.
    }
    sourceSize(source);
    if (scripts.size >= limits.maxScripts) throw new Error('The script session has reached its stored script limit.');
    const hash = await sourceHash(source);
    assertBase(current);
    if (scripts.size >= limits.maxScripts) throw new Error('The script session has reached its stored script limit.');
    const record = Object.freeze({
      scriptId: `script-${crypto.randomUUID()}`,
      hash,
      source,
      baseId: initialBase.id,
      baseRevision: initialBase.revision,
      ...provenance,
    });
    scripts.set(record.scriptId, record);
    return record;
  };
  return Object.freeze({ resolve, get });
}
