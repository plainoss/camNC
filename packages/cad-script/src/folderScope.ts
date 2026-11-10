import {
  cadCopyName,
  cadFolderIssue,
  createCadFolder,
  createCadPart,
  designSteps,
  newCadId,
  renameCadExpressionVariables,
  trimCadFolders,
  type CadDocument,
  type CadFolder,
} from '@wbcnc/cad';
import { fail, resolveHandle } from './editExisting';
import type { CadScript, DesignEdit, PartCopy, ScriptStepEdit } from './editTypes';

interface ScopeContext {
  get(): CadDocument;
  set(document: CadDocument): void;
}
export interface ScriptFolderRef {
  id: string;
  name: string;
}

/** Name substitution only changes expression tokens; no generator or binding registry is saved. */
function translated(value: unknown, names: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return renameCadExpressionVariables(value, names);
  if (Array.isArray(value)) return value.map(item => translated(item, names));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        ['id', 'name', 'sketchId', 'regionId', 'partId', 'axis', 'x', 'y'].includes(key) || (key === 'depth' && item === 'through')
          ? item
          : translated(item, names),
      ])
    );
  return value;
}

export function runFolderScope(ctx: ScopeContext, root: DesignEdit, name: string, script: CadScript, existing = false): ScriptFolderRef {
  if (typeof name !== 'string' || !name.trim()) return fail('A script folder needs a name.');
  if (typeof script !== 'function') return fail('A folder needs a script callback.');
  let folder: CadFolder;
  if (existing) {
    const folders = ctx.get().folders ?? [];
    const named = folders.filter(folder => folder.name === name);
    if (named.length > 1) return fail(`Several folders are named ${name}; use its handle.`);
    const id =
      named[0]?.id ??
      resolveHandle(
        folders.map(folder => folder.id),
        name,
        'folder'
      );
    folder = folders.find(folder => folder.id === id)!;
  } else {
    let unique = name.trim(),
      suffix = 2;
    while (ctx.get().folders?.some(folder => folder.name === unique)) unique = `${name.trim()} ${suffix++}`;
    const result = createCadFolder(ctx.get(), { name: unique, partIds: [] });
    if ('error' in result) return fail(result.error);
    ctx.set(result.document);
    folder = result.document.folders!.find(folder => folder.id === result.id)!;
  }
  const folderId = folder.id;
  const current = () => ctx.get().folders?.find(folder => folder.id === folderId) ?? fail('The script folder no longer exists.');
  const update = (patch: Partial<CadFolder>) =>
    ctx.set({ ...ctx.get(), folders: ctx.get().folders!.map(folder => (folder.id === folderId ? { ...folder, ...patch } : folder)) });
  const ownedParts = () => ctx.get().parts.filter(part => current().partIds.includes(part.id));
  const names = new Map<string, string>();
  for (const variable of ctx.get().variables?.filter(variable => variable.folderId === folderId) ?? []) {
    names.set(variable.name, variable.name);
    // The displayed globally unique name remains usable; an unsuffixed alias is used only when it is unambiguous here.
    const base = variable.name.replace(/_\d+$/, '');
    if (base !== variable.name && !names.has(base)) names.set(base, variable.name);
  }
  const wrap = <T extends object>(value: T): T =>
    new Proxy(value, {
      get(target, key, receiver) {
        const entry = Reflect.get(target, key, receiver);
        if (typeof entry !== 'function') return entry && typeof entry === 'object' && !Array.isArray(entry) ? wrap(entry) : entry;
        return (...args: unknown[]) => {
          const unchanged = ['find', 'face', 'sketch', 'sketchOn', 'existingCut', 'remove'].includes(String(key));
          const mapped = unchanged
            ? args
            : key === 'drawOn' || key === 'relate'
              ? [args[0], ...args.slice(1).map(argument => translated(argument, names))]
              : args.map(argument => translated(argument, names));
          const returned = Reflect.apply(entry, target, mapped);
          return Array.isArray(returned)
            ? returned.map(item => (item && typeof item === 'object' ? wrap(item) : item))
            : returned && typeof returned === 'object'
              ? wrap(returned)
              : returned;
        };
      },
    });
  const findPart = (name: string) => {
    const parts = ownedParts(),
      matches = parts.filter(part => part.name === name);
    if (matches.length > 1) return fail(`Several parts in ${current().name} are named ${name}; use a handle.`);
    const id =
      matches[0]?.id ??
      resolveHandle(
        parts.map(part => part.id),
        name,
        `part in ${current().name}`
      );
    return parts.find(part => part.id === id)!;
  };
  const part = (name: string, options?: Parameters<DesignEdit['part']>[1]) =>
    wrap(root.part(findPart(name).id, translated(options, names) as typeof options));
  const findCopy = (name: string): PartCopy => {
    const copies = ownedParts().flatMap(part =>
      (part.copies ?? []).map((copy, index) => ({ id: `${part.id}:${copy.id}`, copyId: copy.id, name: cadCopyName(part, index) }))
    );
    const matches = copies.filter(copy => copy.name === name);
    if (matches.length > 1) return fail(`Several copies in ${current().name} are named ${name}; use a handle.`);
    return wrap(
      root.existingCopy(
        matches[0]?.id ??
          resolveHandle(
            copies.flatMap(copy => [copy.id, copy.copyId]),
            name,
            `copy in ${current().name}`
          )
      )
    );
  };
  const step = (name: string): ScriptStepEdit => {
    const all = designSteps(ctx.get()).filter(step =>
      step.kind === 'partCut' ? current().partCutIds?.includes(step.id) : current().partIds.includes(step.partId)
    );
    const matches = all.filter(step => step.label === name);
    if (matches.length > 1) return fail(`Several steps in ${current().name} are named ${name}; use a handle.`);
    return wrap(
      root.step(
        matches[0]?.id ??
          resolveHandle(
            all.map(step => step.id),
            name,
            `step in ${current().name}`
          )
      )
    );
  };
  const scoped: DesignEdit = {
    part,
    newPart(name, options) {
      if (!name.trim()) return fail('A new part needs a name.');
      if (ownedParts().some(part => part.name === name)) return fail(`There is already a part named ${name} in ${current().name}.`);
      const made = { ...createCadPart(name, 18), id: newCadId() };
      const document = ctx.get(),
        members = current().partIds;
      const last = Math.max(-1, ...members.map(id => document.parts.findIndex(part => part.id === id)));
      const parts = [...document.parts];
      // Append within the existing run, so editing an earlier folder cannot split the next one.
      parts.splice(last < 0 ? parts.length : last + 1, 0, made);
      ctx.set({ ...document, parts });
      update({ partIds: [...members, made.id] });
      return part(made.id, options);
    },
    existingCopy: findCopy,
    detachCopy(input, name) {
      return wrap(root.detachCopy(findCopy(typeof input === 'string' ? input : input.id), name));
    },
    step,
    removePart(input) {
      root.removePart(findPart(typeof input === 'string' ? input : input.id).id);
      ctx.set(trimCadFolders(ctx.get()));
    },
    removeCopy(input) {
      root.removeCopy(findCopy(typeof input === 'string' ? input : input.id));
    },
    removePattern(input) {
      root.removePattern(findPart(typeof input === 'string' ? input : input.id).id);
    },
    removeStep(input) {
      root.removeStep(step(typeof input === 'string' ? input : input.id));
      ctx.set(trimCadFolders(ctx.get()));
    },
    removeVariable(input) {
      const actual = names.get(input) ?? input;
      const variable = ctx
        .get()
        .variables?.find(variable => variable.folderId === folderId && (variable.name === actual || variable.id.startsWith(input)));
      if (!variable) return fail(`No variable ${input} in ${current().name}.`);
      root.removeVariable(variable.id);
      for (const [alias, value] of names) if (value === variable.name) names.delete(alias);
    },
    variable(name, expression) {
      let actual = names.get(name) ?? ctx.get().variables?.find(variable => variable.folderId === folderId && variable.name === name)?.name;
      if (!actual) {
        actual = name;
        let suffix = 2;
        while (ctx.get().variables?.some(variable => variable.name === actual)) actual = `${name}_${suffix++}`;
        names.set(name, actual);
      }
      root.variable(actual, translated(expression, names) as string);
      ctx.set({
        ...ctx.get(),
        variables: ctx.get().variables!.map(variable => (variable.name === actual ? { ...variable, folderId } : variable)),
      });
      return actual;
    },
    cutParts(targets, options) {
      const before = new Set(ctx.get().partCuts?.map(cut => cut.id));
      root.cutParts(targets, translated(options, names) as typeof options);
      update({
        partCutIds: [...(current().partCutIds ?? []), ...(ctx.get().partCuts ?? []).filter(cut => !before.has(cut.id)).map(cut => cut.id)],
      });
    },
    value(expression) {
      return root.value(translated(expression, names) as typeof expression);
    },
    folder() {
      return fail('Folders cannot be nested; open another scope on the design.');
    },
    existingFolder() {
      return fail('Folders cannot be nested; open another scope on the design.');
    },
  };
  script(scoped);
  const issue = cadFolderIssue(ctx.get());
  if (issue) return fail(issue);
  const indexes = designSteps(ctx.get()).flatMap((step, index) =>
    step.kind === 'partCut'
      ? current().partCutIds?.includes(step.id)
        ? [index]
        : []
      : current().partIds.includes(step.partId)
        ? [index]
        : []
  );
  if (indexes.some((at, index) => index > 0 && at !== indexes[index - 1] + 1))
    return fail('A script folder must remain a neighbouring run of steps.');
  return { id: folderId, name: current().name };
}
