import { migrateDesignUnitNumbers, type CadDocument } from '@wbcnc/cad';
import { getRehearsalId, isDemoMode } from '@/lib/demo/demo-mode';

interface PendingDraft {
  document: CadDocument;
  // A reload may interrupt any queued write, including after its transaction committed but before acknowledgement.
  // Oldest first: the last acknowledged draft, then each edit queued after it.
  sources: string[];
}

// Edits can outpace IndexedDB. Past this many unacknowledged drafts the oldest are dropped: a reload that lands while
// one of those is the stored draft then opens as a conflict, which keeps both versions, instead of every edit
// rewriting an ever longer history.
const MAX_SOURCES = 8;

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
      value.sources.every(source => typeof source === 'string') &&
      // Only the checkpoint is parsed: each edit reads this record, and its history can hold several full drafts.
      JSON.parse(value.sources[0]!)?.id === value.document.id
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
    sessionStorage.setItem(key(jobId), JSON.stringify({ document, sources: [...sources].slice(-MAX_SOURCES) }));
    return true;
  } catch {
    // Storage can be disabled or full; the normal IndexedDB save must still run.
    return false;
  }
}

/**
 * The record with `migrateDesignUnitNumbers` applied, as the stored job it was kept against now is, so a draft kept
 * before that migration still matches its source instead of opening as a conflict. Stored back when it changed.
 */
function migratedRecord(jobId: string): PendingDraft | null {
  const pending = read(jobId);
  if (!pending) return null;
  let document: CadDocument, sources: string[];
  try {
    document = migrateDesignUnitNumbers(pending.document);
    sources = pending.sources.map(source => JSON.stringify(migrateDesignUnitNumbers(JSON.parse(source) as CadDocument)));
  } catch {
    // A record whose drafts can't be read is dropped, as `read` drops one it can't parse: the stored job still opens.
    discardPendingDesignDraft(jobId);
    return null;
  }
  if (same(document, pending.document) && sources.every((source, index) => source === pending.sources[index])) return pending;
  try {
    sessionStorage.setItem(key(jobId), JSON.stringify({ document, sources }));
  } catch {
    // The migrated record is still used for this load.
  }
  return { document, sources };
}

export function pendingDesignDraft(jobId: string, saved: CadDocument) {
  const pending = migratedRecord(jobId);
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
  if (!pending) return;
  // An older queued save must never erase the newest edit's recovery record.
  if (same(pending.document, saved)) return discardPendingDesignDraft(jobId);
  // Saves land in queue order, so once one is acknowledged no earlier draft can be the stored one again.
  const index = pending.sources.indexOf(JSON.stringify(saved));
  if (index <= 0) return;
  try {
    sessionStorage.setItem(key(jobId), JSON.stringify({ document: pending.document, sources: pending.sources.slice(index) }));
  } catch {
    // Pruning only saves space; the record is still correct.
  }
}

export function discardPendingDesignDraft(jobId: string) {
  try {
    sessionStorage.removeItem(key(jobId));
  } catch {
    // The durable source remains authoritative when browser storage is unavailable.
  }
}
