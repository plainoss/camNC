import type { CadDocument } from '@wbcnc/cad';

/**
 * A design as a file: the whole document, with every part's features, sketches, variables and planes. It opens again
 * as a new project (Projects → Open, or dropped on the page), and specs and scripts load it the same way.
 */
export function designFileText(document: CadDocument): string {
  return `${JSON.stringify(document, null, 1)}\n`;
}

/** The design's name, kept to characters every file system takes, as a `.json` file. */
export function designFileName(document: Pick<CadDocument, 'name'>): string {
  const name = document.name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '');
  return `${name || 'design'}.json`;
}

/** Hand the design to the browser as a download. */
export function downloadDesignFile(document: CadDocument) {
  const a = window.document.createElement('a');
  a.href = URL.createObjectURL(new Blob([designFileText(document)], { type: 'application/json' }));
  a.download = designFileName(document);
  a.click();
  // Revoke after the download has been triggered.
  setTimeout(() => URL.revokeObjectURL(a.href));
}
