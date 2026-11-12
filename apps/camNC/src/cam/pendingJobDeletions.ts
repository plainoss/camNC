import { toast } from '@wbcnc/ui/components/sonner';
import { useSyncExternalStore } from 'react';
import { deleteJob } from './jobDb';

/**
 * Projects deleted from the list but still stored, while their Undo toast is shown.
 *
 * The set lives in memory only, and nothing is written to storage until the deletion is committed. A reload or a
 * closed tab during the Undo window therefore keeps the project, whole, rather than losing it or leaving half of it.
 */
/** How long a deleted project can be brought back, as the duration of its Undo toast. */
export const kUndoDeleteMs = 10_000;

let hidden: ReadonlySet<string> = new Set();
/** Hidden projects whose removal from storage has started: Undo can no longer bring them back. */
const committing = new Set<string>();
const listeners = new Set<() => void>();

const setHidden = (next: Set<string>) => {
  hidden = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The ids of projects to leave out of the list: deleted, but not yet removed from storage. */
export const useHiddenJobIds = () => useSyncExternalStore(subscribe, () => hidden);

/** Hide a project until {@link commitJobDeletion} removes it for good, or {@link undoJobDeletion} brings it back. */
export function markJobDeleted(id: string) {
  setHidden(new Set(hidden).add(id));
}

/** Bring a project back, unless its removal already started. Returns whether it came back. */
export function undoJobDeletion(id: string): boolean {
  if (!hidden.has(id) || committing.has(id)) return false;
  show(id);
  return true;
}

const show = (id: string) => {
  const next = new Set(hidden);
  next.delete(id);
  setHidden(next);
};

/**
 * Remove a hidden project from storage. `removed` runs before the project leaves the hidden set, so that the list can
 * drop it first instead of showing it again for a moment. A failed removal shows the project again, since it is still
 * stored.
 */
export async function commitJobDeletion(id: string, removed?: () => unknown): Promise<void> {
  // Only once: auto-close and dismiss may both report the same toast, and an undone deletion must stay undone.
  if (!hidden.has(id) || committing.has(id)) return;
  committing.add(id);
  try {
    await deleteJob(id);
    await removed?.();
  } finally {
    committing.delete(id);
    show(id);
  }
}

/**
 * Delete a project with an Undo toast: it disappears from the list at once, and is removed from storage only when the
 * toast closes. `removed` runs after the removal, to refresh the list.
 */
export function deleteJobWithUndo({ id, name }: { id: string; name: string }, removed?: () => unknown) {
  markJobDeleted(id);
  const commit = () =>
    commitJobDeletion(id, removed).catch((e: unknown) =>
      toast.error(`${name} could not be deleted`, { description: e instanceof Error ? e.message : String(e) })
    );
  toast(`Deleted ${name}`, {
    duration: kUndoDeleteMs,
    action: { label: 'Undo', onClick: () => undoJobDeletion(id) },
    onAutoClose: () => void commit(),
    onDismiss: () => void commit(),
  });
}
