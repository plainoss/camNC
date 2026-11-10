import { newCadId, setCadConstruction, type CadConstruction, type CadDocument, type CadPart } from '@wbcnc/cad';
import { fail } from './editExisting';
import type { CadRef } from './editTypes';

/** Script names are resolved once to stable IDs; persisted declarations contain no name lookups. */
export interface ScriptConstruction extends Omit<CadConstruction, 'id' | 'parameters' | 'members' | 'materials' | 'hardware'> {
  id?: string;
  parameters: { name: string; variable: string }[];
  members: { role: string; member: CadRef }[];
  materials: (Omit<CadConstruction['materials'][number], 'stockVariableId'> & { stockVariable: string })[];
  hardware: (Omit<CadConstruction['hardware'][number], 'lengthVariableId'> & { lengthVariable: string })[];
}

/** Translate only variable tokens. Roles, feature IDs and hardware IDs are data. */
export function scopedConstruction(
  input: ScriptConstruction,
  folderId: string,
  aliases: ReadonlyMap<string, string>,
  owned: CadPart[]
): ScriptConstruction {
  try {
    if (!input || input.folderId !== folderId) return fail('A scoped construction must belong to its current folder.');
    for (const binding of input.members) {
      if (!owned.some(p => binding.member.id === p.id || p.copies?.some(c => binding.member.id === `${p.id}:${c.id}`)))
        return fail(`Construction member ${binding.role} is not in this folder.`);
    }
    const variable = (name: string) => aliases.get(name) ?? name;
    return {
      ...input,
      parameters: input.parameters.map(p => ({ ...p, variable: variable(p.variable) })),
      materials: input.materials.map(m => ({ ...m, stockVariable: variable(m.stockVariable) })),
      hardware: input.hardware.map(h => ({ ...h, lengthVariable: variable(h.lengthVariable) })),
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Invalid scoped construction.');
  }
}

export function declareScriptConstruction(document: CadDocument, input: ScriptConstruction): { document: CadDocument; id: string } {
  try {
    return buildDeclaration(document, input);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Invalid construction declaration.');
  }
}

function buildDeclaration(document: CadDocument, input: ScriptConstruction): { document: CadDocument; id: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('Construction needs an options object.');
  for (const [key, limit] of [
    ['parameters', 64],
    ['members', 512],
    ['materials', 64],
    ['hardware', 512],
  ] as const) {
    const values: unknown = input[key];
    if (!Array.isArray(values) || values.length > limit || !Array.from(values).every(v => v && typeof v === 'object' && !Array.isArray(v)))
      return fail(`Construction ${key} must be a bounded array of objects.`);
  }
  const variableId = (name: string) =>
    document.variables?.find(v => v.id === name || v.name === name)?.id ?? fail(`Construction variable ${String(name)} does not exist.`);
  const id = input.id ?? newCadId();
  const hardwareId = (name: string) => `${id}:hardware:${name}`;
  const { parameters, members, materials, hardware, connections, assembly, ...rest } = input;
  if (!Array.isArray(connections) || connections.length > 512 || !Array.isArray(assembly) || assembly.length > 128)
    return fail('Construction connections and assembly must be bounded arrays.');
  const plan: CadConstruction = {
    ...rest,
    id,
    parameters: parameters.map(({ name, variable, ...extra }) => ({ ...extra, name, variableId: variableId(variable) })),
    members: members.map(({ role, member, ...extra }) => {
      if (!member || typeof member.id !== 'string') return fail(`Construction member ${role} needs a physical part/copy reference.`);
      const source = document.parts.find(p => p.id === member.id);
      const copies = document.parts.flatMap(p =>
        (p.copies ?? []).flatMap(c => (member.id === `${p.id}:${c.id}` ? [{ partId: p.id, copyId: c.id }] : []))
      );
      if ((source ? 1 : 0) + copies.length !== 1)
        return fail(`Construction member ${role} is missing or has an ambiguous physical handle.`);
      return { ...extra, role, ...(source ? { partId: source.id } : copies[0]!) };
    }),
    materials: materials.map(({ stockVariable, ...material }) => ({ ...material, stockVariableId: variableId(stockVariable) })),
    hardware: hardware.map(({ lengthVariable, ...item }) => ({
      ...item,
      id: hardwareId(item.id),
      lengthVariableId: variableId(lengthVariable),
    })),
    connections: connections.map(c => ({ ...c, id: `${id}:connection:${c.id}`, hardwareIds: c.hardwareIds?.map(hardwareId) })),
    assembly: assembly.map(s => ({ ...s, hardwareIds: s.hardwareIds?.map(hardwareId) })),
  };
  try {
    return { document: setCadConstruction(document, plan), id };
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Invalid construction declaration.');
  }
}
