import { useEffect } from 'react';
import { releaseSvgAssets } from './svgAssets';

interface SvgAssetSession {
  owners: number;
  generation: number;
}
const sessions = new Map<string, SvgAssetSession>();

/** Own imported source for the document editor, independently of whether its
 * assistant dock is open. Multiple views of the same document share ownership.
 */
function retainSvgAssetSession(documentId: string): () => void {
  let session = sessions.get(documentId);
  if (!session) {
    session = { owners: 0, generation: 0 };
    sessions.set(documentId, session);
  }
  session.owners++;
  session.generation++;
  let retained = true;
  return () => {
    if (!retained) return;
    retained = false;
    session.owners--;
    if (session.owners) return;
    const generation = ++session.generation;
    // StrictMode replays effects synchronously. Wait for a possible reacquisition
    // before clearing source, while still releasing departed documents promptly.
    queueMicrotask(() => {
      if (session.owners || session.generation !== generation) return;
      sessions.delete(documentId);
      releaseSvgAssets(documentId);
    });
  };
}

export function useSvgAssetSession(documentId: string): void {
  useEffect(() => retainSvgAssetSession(documentId), [documentId]);
}
