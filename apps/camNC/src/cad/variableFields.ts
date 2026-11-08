import { useEffect, useSyncExternalStore } from 'react';

/** The design's variables, as a value field offers them after `#`, and a way to make or change one from a field. */
export interface CadVariableFields {
  variables: { name: string; shown: string }[];
  /** Sets `#name = expression` as typed in a field: the variable is made, or changed if it's there. Returns why not. */
  define: (name: string, expression: string) => string | null;
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

/** Offers the editor's variables to every value field while it's open. */
export function useProvideCadVariableFields(fields: CadVariableFields) {
  useEffect(() => {
    publish(fields);
    return () => {
      if (current === fields) publish(null);
    };
  }, [fields]);
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
