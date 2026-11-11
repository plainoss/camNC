import type { CadPart } from '@wbcnc/cad';
import { useRef } from 'react';

/** Isolate one physical instance while retaining the eye choices to restore on the next toggle. */
export function usePartIsolation(
  parts: readonly CadPart[],
  selectedKey: string | undefined,
  hidden: ReadonlySet<string>,
  setHidden: (hidden: ReadonlySet<string>) => void
) {
  const isolation = useRef<{ before: ReadonlySet<string>; hidden: ReadonlySet<string> } | null>(null);
  return () => {
    // A removed copy has no physical selection; never substitute its source or hide the entire assembly.
    if (!selectedKey) return;
    const keys = parts.flatMap(part => [part.id, ...(part.copies ?? []).map(copy => `${part.id}/${copy.id}`)]);
    if (!keys.includes(selectedKey)) return;
    if (isolation.current?.hidden === hidden) {
      setHidden(isolation.current.before);
      isolation.current = null;
    } else {
      const isolated = new Set(keys.filter(key => key !== selectedKey));
      isolation.current = { before: hidden, hidden: isolated };
      setHidden(isolated);
    }
  };
}
