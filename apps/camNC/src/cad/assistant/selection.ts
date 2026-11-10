import { cadCopyName, type CadDocument } from '@wbcnc/cad';

export interface AssistantSelection {
  partId: string;
  copyId?: string;
  name: string;
  folder?: { id: string; name: string };
}

export function assistantSelection(document: CadDocument, selected?: { partId: string; copyId?: string }): AssistantSelection | undefined {
  const part = document.parts.find(part => part.id === selected?.partId);
  if (!part) return;
  const index = selected?.copyId ? (part.copies?.findIndex(copy => copy.id === selected.copyId) ?? -1) : -1;
  const folder = document.folders?.find(folder => folder.partIds.includes(part.id));
  return {
    partId: part.id,
    ...(index >= 0 && { copyId: selected!.copyId }),
    name: index >= 0 ? cadCopyName(part, index) : part.name,
    ...(folder && { folder: { id: folder.id, name: folder.name } }),
  };
}
