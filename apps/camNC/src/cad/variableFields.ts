import { useEffect, useSyncExternalStore } from 'react';

/** The design's variables, as a value field offers them after `#`, and a way to make or change one from a field. */
export interface CadVariableFields {
  variables: { name: string; shown: string }[];
  /**
   * Sets `#name = expression` as typed in a field of `unit`: the variable is made, or changed if it's there. Returns why
   * not.
   */
  define: (name: string, expression: string, unit?: 'mm' | 'deg' | 'scalar') => string | null;
}

// The open editor's variables. One editor is open at a time; fields outside one get none.
let current: CadVariableFields | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const publish = (fields: CadVariableFields | null) => {
  current = fields;
  listeners.forEach(listener => listener());
};

// What fields still have to apply, such as a variable made in one, before a dialog that holds them is done.
let settling: Promise<void> = Promise.resolve();

/** Has a dialog wait for `applying` before it's done. */
export const settleField = (applying: Promise<void>) => {
  settling = Promise.all([settling, applying]).then(() => {});
};

/** Once every field has applied what was typed in it. */
export const fieldsSettled = () => settling;

/** Offers the editor's variables to every value field while it's open. */
export function useProvideCadVariableFields(fields: CadVariableFields) {
  useEffect(() => {
    publish(fields);
    return () => {
      if (current === fields) publish(null);
    };
  }, [fields]);
}

/**
 * Resolves once the open editor offers a variable of this name, which is after it has rendered with it, so every field's
 * owner already has it in scope. Gives up after `timeout` ms. It waits on the editor itself, not on animation frames,
 * which a busy or background page slows down.
 */
export function whenVariable(name: string, timeout = 5000): Promise<boolean> {
  const has = () => !!current?.variables.some(variable => variable.name === name);
  if (has()) return Promise.resolve(true);
  return new Promise(resolve => {
    const done = (found: boolean) => {
      clearTimeout(timer);
      listeners.delete(check);
      resolve(found);
    };
    const check = () => {
      if (has()) done(true);
    };
    const timer = setTimeout(() => done(false), timeout);
    listeners.add(check);
  });
}

/** The open editor's variables, for a value field. */
export const useCadVariableFields = () => useSyncExternalStore(subscribe, () => current);

/** `#name = value` typed in a field, to make the variable and use it there, as the reference allows. */
export const variableDefinition = (text: string): { name: string; expression: string } | null => {
  const match = /^\s*#([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\S.*)$/.exec(text);
  return match ? { name: match[1]!, expression: match[2]!.trim() } : null;
};

/** The `#` and partial name being typed just before the caret, if there is one. */
export const variablePrefix = (text: string, caret: number): { start: number; typed: string } | null => {
  const match = /#([A-Za-z_][A-Za-z0-9_]*)?$/.exec(text.slice(0, caret));
  return match ? { start: match.index, typed: match[1] ?? '' } : null;
};
