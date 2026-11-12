/** A file name the browser and every OS accept, from a part or design name. */
export function exportFileName(name: string, extension: string) {
  const base = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '');
  return `${base || 'export'}.${extension}`;
}

/** Hand text to the browser as a download. */
export function downloadText(text: string, fileName: string, type: string) {
  const a = window.document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = fileName;
  a.click();
  // Revoke after the download has been triggered.
  setTimeout(() => URL.revokeObjectURL(a.href));
}
