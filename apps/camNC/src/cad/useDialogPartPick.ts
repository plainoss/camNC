import { cadPartReferenceOwner, type CadDocument } from '@wbcnc/cad';
import { useEffect, useRef, useState } from 'react';

/** Parts clicked in the view or the Parts list while a step's dialog is open, and the editor's selection to follow its pick. */
export interface DialogPartPicks {
  /** The last part clicked, as a part or copy reference. `seq` tells two clicks apart. */
  pick: { partId: string; seq: number } | null;
  /** Selects the part the dialog took, so the list and the view show the part it works on. */
  select: (partId: string) => void;
}

/**
 * The part a dialog works on, as Cut parts takes its parts: while its field is active, the part clicked next replaces
 * it. `take` returns why a part can't be taken, if it can't. Only a new step's part can change.
 */
export function useDialogPartPick({
  document,
  partId,
  picks,
  pickable,
  startActive,
  take,
}: {
  document: CadDocument;
  partId: string;
  picks?: DialogPartPicks;
  pickable: boolean;
  startActive: boolean;
  take?: (partId: string, previous: string) => string | null | void;
}) {
  const [target, setTarget] = useState(partId);
  const [active, setActive] = useState(pickable && startActive);
  const [problem, setProblem] = useState<string | null>(null);
  const pick = picks?.pick;
  // The click that opened the dialog, or any before it, is not a pick for it.
  const seen = useRef(pick?.seq);
  const latest = useRef({ document, take, select: picks?.select, active, target });
  latest.current = { document, take, select: picks?.select, active, target };
  useEffect(() => {
    if (!pick || pick.seq === seen.current) return;
    seen.current = pick.seq;
    const { document, take, select, active, target } = latest.current;
    if (!active) return;
    const source = cadPartReferenceOwner(document, pick.partId);
    if (!source) return;
    // A copy is its family's result: taking its family instead would change a part that wasn't clicked.
    if (source.id !== pick.partId) return setProblem(`Pick ${source.name} itself, not one of its copies.`);
    if (source.id === target) return setProblem(null);
    const refusal = take?.(source.id, target);
    setProblem(refusal || null);
    if (refusal) return;
    setTarget(source.id);
    select?.(source.id);
  }, [pick]);
  return {
    partId: target,
    pickable,
    active,
    problem,
    /** Makes the part field the one the next click fills. The dialog stops its other picks. */
    activate: () => {
      setActive(pickable);
      setProblem(null);
    },
    /** Another of the dialog's picks starts, so a click goes to it rather than to the part. */
    deactivate: () => setActive(false),
  };
}
