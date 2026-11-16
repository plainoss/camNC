import {
  cadFolderIssue,
  createCadFolder,
  createCadPart,
  designSteps,
  newCadId,
  renameCadExpressionVariables,
  type CadDocument,
  type CadFolder,
} from '@wbcnc/cad';
import { fail, resolveNamed, type ExistingEdit, type ExistingScope } from './editExisting';
import type { CadScript, DesignEdit } from './editTypes';
import { scopedConstruction } from './constructionApi';

interface ScopeContext {
  get(): CadDocument;
  set(document: CadDocument): void;
  /** The design's find and remove calls, limited to what the scope owns. */
  existing(scope: ExistingScope): ExistingEdit;
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
    folder = resolveNamed(ctx.get().folders ?? [], name, 'folder', folder => folder.name);
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
  const {
    findPart,
    cut: _cut,
    removeVariable: _removeVariable,
    ...found
  } = ctx.existing({
    parts: ownedParts,
    ownsStep: step => (step.kind === 'partCut' ? !!current().partCutIds?.includes(step.id) : current().partIds.includes(step.partId)),
    label: folder.name,
  });
  // Only what these return goes through `wrap`: wrapping the calls themselves would rename a part, copy or step name that
  // happens to equal a local variable.
  const existingApi = Object.fromEntries(
    Object.entries(found).map(([key, method]) => [
      key,
      (...args: never[]) => {
        const result = (method as (...args: never[]) => unknown)(...args);
        return result && typeof result === 'object' ? wrap(result) : result;
      },
    ])
  ) as typeof found;
  const part = (name: string, options?: Parameters<DesignEdit['part']>[1]) =>
    wrap(root.part(findPart(name).id, translated(options, names) as typeof options));
  const scoped: DesignEdit = {
    ...existingApi,
    construction: options => root.construction(scopedConstruction(options, folderId, names, ownedParts(), ctx.get().constructions ?? [])),
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
