import { useCallback, useRef, type RefObject } from 'react';
import { setPartPattern, type CadDocument } from '@wbcnc/cad';
import type { StudioFeatureDialogState } from './StudioFeatureDialog';

const changes = new WeakMap<object, WeakMap<CadDocument, CadDocument>>();

/** An inline variable is its own accepted operation; identify exactly that source update for the open pattern. */
export function usePatternVariableCommit(
  owner: StudioFeatureDialogState | null,
  document: RefObject<CadDocument>,
  commit: (document: CadDocument) => void
) {
  const latest = useRef({ owner, document, commit });
  latest.current = { owner, document, commit };
  const variableCommit = useCallback((next: CadDocument) => {
    const { owner, document, commit } = latest.current;
    const before = document.current;
    commit(next);
    if (owner?.kind !== 'pattern' || latest.current.owner !== owner || document.current === before) return;
    const sources = changes.get(owner) ?? new WeakMap<CadDocument, CadDocument>();
    sources.set(document.current, before);
    changes.set(owner, sources);
  }, []);
  const normalized = useCallback((before: CadDocument, after: CadDocument) => {
    const { owner, document } = latest.current;
    const sources = owner && changes.get(owner);
    // Only normalization of this opening's known variable command belongs to its source lineage.
    if (owner?.kind === 'pattern' && document.current === before && sources?.has(before)) sources.set(after, before);
  }, []);
  return { commit: variableCommit, normalized };
}

/** Rebase only the pattern and explicit piece names onto a source accepted by that opening's variable field. */
export function rebasePatternVariableSource(owner: object, before: CadDocument, after: CadDocument, draft: CadDocument, partId: string) {
  const sources = changes.get(owner);
  let source: CadDocument | undefined = after;
  while (source && source !== before) source = sources?.get(source);
  if (!source) return null;
  const original = before.parts.find(part => part.id === partId);
  const edited = draft.parts.find(part => part.id === partId);
  if (!original || !edited || !after.parts.some(part => part.id === partId)) return null;
  const names = new Map(
    (edited.copies ?? [])
      .filter(copy => copy.name !== original.copies?.find(candidate => candidate.id === copy.id)?.name)
      .map(copy => [copy.id, copy.name])
  );
  const next = setPartPattern(after, partId, edited.pattern ?? null);
  return {
    ...next,
    parts: next.parts.map(part =>
      part.id !== partId || !part.copies
        ? part
        : {
            ...part,
            copies: part.copies.map(copy => {
              if (!names.has(copy.id)) return copy;
              const { name: _name, ...rest } = copy;
              const name = names.get(copy.id);
              return name === undefined ? rest : { ...rest, name };
            }),
          }
    ),
  };
}
