import { cadPartReference, type CadDocument, type CadPart } from '@wbcnc/cad';
import { useCallback, useState } from 'react';
import { builtStudioParts } from './studioParts';

type PartFeature = 'extrude' | 'pattern';

/** Carry physical-copy identity into cut references and refuse unsupported family-only commands. */
export function usePartCutSelection(document: CadDocument, part: CadPart | undefined, setPartId: (partId: string) => void) {
  const [physicalSelection, setPhysicalSelection] = useState<{ partId: string; copyId?: string; references?: string[] } | null>(null);
  const [cutPick, setCutPick] = useState<{ partId: string; seq: number } | null>(null);
  const [cutPicked, setCutPicked] = useState<string[]>([]);
  const showCutPicked = useCallback(
    ({ tools, targets }: { tools: string[]; targets: string[] }) => setCutPicked([...tools, ...targets]),
    []
  );
  const pickForCut = (partId: string, copyId?: string) =>
    setCutPick(previous => ({ partId: cadPartReference(partId, copyId), seq: (previous?.seq ?? 0) + 1 }));
  // `references` are every part a feature row stands for, such as all targets of a Cut, highlighted with the selection.
  const selectPart = (partId: string, copyId?: string, references?: string[]) => {
    setPartId(partId);
    setPhysicalSelection({ partId, copyId, ...(references && references.length > 1 && { references }) });
  };
  const copyId = physicalSelection?.partId === part?.id ? physicalSelection?.copyId : undefined;
  // Suppression keeps raw source copy rows for restoration. Only built physical
  // membership can validate a tool; an absent copy must never become its family.
  const activePart = builtStudioParts(document).find(active => active.id === part?.id);
  const valid = !!activePart && (copyId === undefined || activePart.copies?.some(copy => copy.id === copyId));
  const selectedCopyId = valid ? copyId : undefined;
  const selectedTool = part && valid ? cadPartReference(part.id, selectedCopyId) : undefined;
  const selectedReferences = selectedTool ? physicalSelection?.references : undefined;
  const selectedKey = selectedTool ? (selectedCopyId ? `${part!.id}/${selectedCopyId}` : part!.id) : undefined;
  const transformPart = (open: (partId: string) => void, refuse: (message: string) => void) => {
    // Source transforms precede downstream cuts, so consumed history remains editable.
    // Keep the raw copy ID: a selected or disappeared copy must never become its family.
    if (!part || copyId !== undefined)
      return refuse('Transforming only the selected copy is not supported. Select the source part in Parts to transform its whole family.');
    open(part.id);
  };
  const featurePart = (kind: PartFeature, open: (kind: PartFeature, partId: string) => void, refuse: (message: string) => void) => {
    // Source history stays editable after consumption. A raw copy ID, including an absent slot, must not become its family.
    if (kind === 'pattern' && copyId !== undefined)
      return refuse('Patterning only the selected copy is not supported. Select the source part in Parts to pattern its whole family.');
    if (part) open(kind, part.id);
  };
  return {
    /** The copy picked, unchecked: a command that can't work on one copy refuses any, even a copy that is gone. */
    pickedCopyId: copyId,
    cutPick,
    cutPicked,
    showCutPicked,
    pickForCut,
    selectPart,
    selectedTool,
    selectedKey,
    selectedCopyId,
    selectedReferences,
    transformPart,
    featurePart,
  };
}
