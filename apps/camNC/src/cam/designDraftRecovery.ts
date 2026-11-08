import type { CadDocument } from '@wbcnc/cad';
import { getRehearsalId, isDemoMode } from '@/lib/demo/demo-mode';

interface PendingDraft {
  document: CadDocument;
  // A reload may interrupt any queued write, including after its transaction committed but before acknowledgement.
  sources: string[];
}

const key = (jobId: string) => `camnc-pending-design:${isDemoMode() ? 'demo' : 'normal'}:${jobId}`;
const same = (a: CadDocument, b: CadDocument) => JSON.stringify(a) === JSON.stringify(b);

function read(jobId: string): PendingDraft | null {
  // Rehearsals deliberately restart from their handoff snapshot on reload.
  if (getRehearsalId()) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(key(jobId)) ?? 'null') as PendingDraft | null;
    return value?.document &&
      Array.isArray(value.sources) &&
      value.sources.length > 0 &&
      value.sources.every(source => typeof source === 'string' && JSON.parse(source)?.id === value.document.id)
      ? value
      : null;
  } catch {
    return null;
  }
}

/** Keep the newest edit synchronously, in this tab only, until IndexedDB acknowledges it. */
export function keepPendingDesignDraft(jobId: string, saved: CadDocument, document: CadDocument): boolean {
  if (getRehearsalId()) return true;
  try {
    const pending = read(jobId);
    const sources = new Set(pending?.document.id === document.id ? pending.sources : []);
    sources.add(JSON.stringify(saved));
    sources.add(JSON.stringify(document));
    sessionStorage.setItem(key(jobId), JSON.stringify({ document, sources: [...sources] }));
    return true;
  } catch {
    // Storage can be disabled or full; the normal IndexedDB save must still run.
    return false;
  }
}

export function pendingDesignDraft(jobId: string, saved: CadDocument) {
  const pending = read(jobId);
  if (!pending || pending.document.id !== saved.id) return null;
  if (same(pending.document, saved)) {
    // The transaction may have committed just before reload, without delivering its acknowledgement.
    discardPendingDesignDraft(jobId);
    return null;
  }
  return {
    document: pending.document,
    conflict: !pending.sources.includes(JSON.stringify(saved)),
    checkpoint: JSON.parse(pending.sources[0]!) as CadDocument,
  };
}

export function acknowledgePendingDesignDraft(jobId: string, saved: CadDocument) {
  const pending = read(jobId);
  // An older queued save must never erase the newest edit's recovery record.
  if (pending && same(pending.document, saved)) discardPendingDesignDraft(jobId);
}

export function discardPendingDesignDraft(jobId: string) {
  try {
    sessionStorage.removeItem(key(jobId));
  } catch {
    // The durable source remains authoritative when browser storage is unavailable.
  }
}
