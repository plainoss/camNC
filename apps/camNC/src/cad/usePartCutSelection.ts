import { cadPartReference, type CadDocument, type CadPart } from '@wbcnc/cad';
import { useCallback, useState } from 'react';
import { builtStudioParts } from './studioParts';

/** Carry physical-copy identity from list/viewport picks into the persisted cut reference. */
export function usePartCutSelection(document: CadDocument, part: CadPart | undefined, setPartId: (partId: string) => void) {
  const [physicalSelection, setPhysicalSelection] = useState<{ partId: string; copyId?: string } | null>(null);
  const [cutPick, setCutPick] = useState<{ partId: string; seq: number } | null>(null);
  const [cutPicked, setCutPicked] = useState<string[]>([]);
  const showCutPicked = useCallback(
    ({ tools, targets }: { tools: string[]; targets: string[] }) => setCutPicked([...tools, ...targets]),
    []
  );
  const pickForCut = (partId: string, copyId?: string) =>
    setCutPick(previous => ({ partId: cadPartReference(partId, copyId), seq: (previous?.seq ?? 0) + 1 }));
  const selectPart = (partId: string, copyId?: string) => {
    setPartId(partId);
    setPhysicalSelection({ partId, copyId });
  };
  const copyId = physicalSelection?.partId === part?.id ? physicalSelection?.copyId : undefined;
  // Suppression keeps raw source copy rows for restoration. Only built physical
  // membership can validate a tool; an absent copy must never become its family.
  const activePart = builtStudioParts(document).find(active => active.id === part?.id);
  const valid = !!activePart && (copyId === undefined || activePart.copies?.some(copy => copy.id === copyId));
  const selectedCopyId = valid ? copyId : undefined;
  const selectedTool = part && valid ? cadPartReference(part.id, selectedCopyId) : undefined;
  const selectedKey = selectedTool ? (selectedCopyId ? `${part!.id}/${selectedCopyId}` : part!.id) : undefined;
  const transformPart = (open: (partId: string) => void, refuse: (message: string) => void) => {
    // Source transforms precede downstream cuts, so consumed history remains editable.
    // Keep the raw copy ID: a selected or disappeared copy must never become its family.
    if (!part || copyId !== undefined)
      return refuse('Transforming only the selected copy is not supported. Select the source part in Parts to transform its whole family.');
    open(part.id);
  };
  return { cutPick, cutPicked, showCutPicked, pickForCut, selectPart, selectedTool, selectedKey, selectedCopyId, transformPart };
}
