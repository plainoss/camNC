import { createPlateDocument } from '@wbcnc/cad';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setDemoModeForTest } from '@/lib/demo/demo-mode';
import {
  acknowledgePendingDesignDraft,
  discardPendingDesignDraft,
  keepPendingDesignDraft,
  pendingDesignDraft,
} from './designDraftRecovery';

// Reload reads JSON from IndexedDB; optional undefined fields have already been omitted there.
const durableDocument = () => JSON.parse(JSON.stringify(createPlateDocument())) as ReturnType<typeof createPlateDocument>;

beforeEach(() => {
  sessionStorage.clear();
  setDemoModeForTest(false);
});

describe('draft recovery before IndexedDB finishes', () => {
  it('recovers the newest edit whether an older queued write committed or not', () => {
    const saved = durableDocument();
    const first = { ...saved, name: 'First edit', revision: saved.revision + 1 };
    const last = { ...first, name: 'Last edit', revision: first.revision + 1 };
    keepPendingDesignDraft('job', saved, first);
    keepPendingDesignDraft('job', saved, last);
    acknowledgePendingDesignDraft('job', first);
    expect(pendingDesignDraft('job', saved)).toMatchObject({ document: last, conflict: false });
    expect(pendingDesignDraft('job', first)).toMatchObject({ document: last, conflict: false });
    acknowledgePendingDesignDraft('job', last);
    expect(pendingDesignDraft('job', saved)).toBeNull();
  });

  it('keeps local work for recovery without overwriting an unrelated durable edit', () => {
    const saved = durableDocument();
    const local = { ...saved, name: 'Local' };
    keepPendingDesignDraft('job', saved, local);
    expect(pendingDesignDraft('job', { ...saved, name: 'Another view' })).toMatchObject({
      document: local,
      conflict: true,
      checkpoint: saved,
    });
    discardPendingDesignDraft('job');
    expect(pendingDesignDraft('job', saved)).toBeNull();
  });

  it('clears a write committed before reload, so a later external edit is not a false conflict', () => {
    const saved = durableDocument();
    const local = { ...saved, name: 'Committed just before reload' };
    keepPendingDesignDraft('job', saved, local);
    expect(pendingDesignDraft('job', local)).toBeNull();
    expect(pendingDesignDraft('job', { ...local, name: 'Later external edit' })).toBeNull();
  });

  it('isolates jobs, document identities and demo storage', () => {
    const saved = durableDocument();
    keepPendingDesignDraft('job', saved, { ...saved, name: 'Local' });
    expect(pendingDesignDraft('other-job', saved)).toBeNull();
    expect(pendingDesignDraft('job', { ...saved, id: 'other-document' })).toBeNull();
    const replacement = { ...saved, id: 'other-document' };
    keepPendingDesignDraft('job', replacement, { ...replacement, name: 'Replacement edit' });
    expect(pendingDesignDraft('job', replacement)?.conflict).toBe(false);
    setDemoModeForTest(true);
    expect(pendingDesignDraft('job', saved)).toBeNull();
  });

  it('leaves durable saving possible when session storage is full', () => {
    const saved = durableDocument();
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    try {
      expect(keepPendingDesignDraft('job', saved, saved)).toBe(false);
    } finally {
      write.mockRestore();
    }
  });
});
