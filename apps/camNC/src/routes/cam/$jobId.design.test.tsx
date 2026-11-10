import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@/style.css';
import { page } from '@vitest/browser/context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addFaceSketch, addLine, cadFaceSketches, createPlateDocument, updateDimension, type CadDocument } from '@wbcnc/cad';
import { useImperativeHandle, useRef, useState, type ComponentType, type Ref, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesignJob, getJob, type CamJobV1 } from '@/cam/jobDb';
import { acknowledgeCadSession, cadSession, commitCadSession, endCadSession, type CadSession } from '@wbcnc/cad-editor/session';
import { keepPendingDesignDraft, pendingDesignDraft } from '@/cam/designDraftRecovery';
import type { CadEditorController } from '@/cad/CadEditor';
import type { CamStageDestination } from '@/cam/CamJobBar';
import { Route } from './$jobId.design';

const state = vi.hoisted(() => ({
  job: null as CamJobV1 | null,
  search: {} as { returnTo?: 'boards' | 'plan' | 'machine'; board?: string; part?: string },
  navigate: vi.fn(),
  openAtMachine: vi.fn<(jobId: string, boardId?: string) => string>(() => '/visualize/2DView'),
  save: vi.fn(),
  accept: vi.fn(),
  editorBlocked: false,
  finishRequests: vi.fn(),
  prepared: undefined as CadDocument | null | undefined,
  blockedReason: undefined as string | undefined,
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => ({ jobId: 'design-job' }),
  useSearch: () => state.search,
  useNavigate: () => state.navigate,
  Navigate: () => null,
}));
vi.mock('@/cam/camQueries', () => ({
  useCamJob: () => ({ data: state.job, isPending: false }),
  camKeys: { job: (id: string) => ['job', id], jobs: ['jobs'] },
}));
vi.mock('@/cam/cadDesign', () => ({
  saveDesignDraft: (...args: unknown[]) => state.save(...args),
  acceptDesign: (...args: unknown[]) => state.accept(...args),
}));
vi.mock('@/cam/machine/openAtMachine', () => ({ openAtMachine: (jobId: string, boardId?: string) => state.openAtMachine(jobId, boardId) }));
vi.mock('@/cam/CamJobBar', () => ({
  CamJobBar: ({
    onStageNavigate,
    navigationPending,
    title,
    tools,
  }: {
    onStageNavigate: (destination: CamStageDestination) => void;
    navigationPending: boolean;
    title?: ReactNode;
    tools?: ReactNode;
  }) => (
    <nav>
      {title}
      {tools}
      {(['boards', 'plan', 'machine'] as const).map(stage => (
        <button key={stage} disabled={navigationPending} onClick={() => onStageNavigate({ stage, board: 'board-c' })}>
          Go {stage}
        </button>
      ))}
      <button onClick={() => onStageNavigate({ stage: 'boards', newTab: true })}>Open Boards in another tab</button>
    </nav>
  ),
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
vi.mock('@/cad/CadEditor', () => ({
  CadEditor: (props: {
    document: CadDocument;
    editSession?: CadSession;
    preferredPartId?: string;
    onDraftChange: (d: CadDocument) => void;
    onFinish: (d: CadDocument) => Promise<void>;
    onCancel: () => Promise<void>;
    onFinishBlocked?: (reason: string) => void;
    onEditFaceSketch?: (document: CadDocument, partId: string, sketchId: string) => void;
    controller?: Ref<CadEditorController>;
    notice?: string | null;
  }) => {
    const [session] = useState(() => props.editSession ?? cadSession(props.document));
    const current = useRef(session.document);
    useImperativeHandle(props.controller, () => ({
      updateSettings: settings => {
        current.current = commitCadSession(session, { ...current.current, ...settings });
        props.onDraftChange(current.current);
        return true;
      },
      prepareDocument: () => (state.prepared === undefined ? current.current : state.prepared),
      finish: async () => {
        state.finishRequests();
        if (state.editorBlocked) {
          if (state.blockedReason) props.onFinishBlocked?.(state.blockedReason);
          return false;
        }
        try {
          await props.onFinish(current.current);
          return true;
        } catch {
          return false;
        }
      },
    }));
    return (
      <>
        {props.notice && <p role="alert">{props.notice}</p>}
        <output data-testid="editor-document">{JSON.stringify(current.current)}</output>
        <output data-testid="preferred-part">{props.preferredPartId}</output>
        <button onClick={() => void props.onFinish(current.current)}>Finish sketch</button>
        <button
          onClick={() => {
            current.current = { ...current.current, revision: current.current.revision + 1 };
            props.onDraftChange(current.current);
          }}>
          Edit draft
        </button>
        <button
          onClick={() => {
            props.onDraftChange(props.document);
            void props.onCancel();
          }}>
          Cancel sketch
        </button>
        {props.onEditFaceSketch && (
          <button
            onClick={() => {
              const partId = current.current.parts[0]!.id,
                added = addFaceSketch(current.current, partId, 'top');
              props.onEditFaceSketch!(added.document, partId, added.sketchId);
            }}>
            Open face sketch
          </button>
        )}
      </>
    );
  },
}));

const Design = (Route as unknown as { options: { component: ComponentType } }).options.component;
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  const document = createPlateDocument();
  state.job = {
    v: 1,
    id: 'design-job',
    name: 'Plate',
    fileName: 'Plate',
    createdAt: 0,
    updatedAt: 0,
    parts: [],
    design: { draft: document, accepted: document, acceptedRevision: 1, partRevisions: {} },
  };
  state.search = {};
  state.editorBlocked = false;
  state.prepared = undefined;
  state.blockedReason = undefined;
  state.openAtMachine.mockReturnValue('/visualize/2DView');
  state.save.mockImplementation(async (job: CamJobV1, document: CadDocument) => ({ ...job, design: { ...job.design!, draft: document } }));
  state.accept.mockImplementation(async (job: CamJobV1) => job);
});
afterEach(cleanup);
const open = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Design />
    </QueryClientProvider>
  );

describe('returning from a design edit', () => {
  it('reserves the phone tabs and follows viewport height changes', async () => {
    const original = { width: window.innerWidth, height: window.innerHeight };
    const view = open();
    const design = view.container.querySelector('.cam-page')!;
    try {
      for (const [width, height] of [
        [390, 720],
        [390, 600],
        [980, 720],
      ]) {
        await page.viewport(width, height);
        expect(design.getBoundingClientRect().height).toBe(width < 768 ? height - 56 : height);
      }
    } finally {
      await page.viewport(original.width, original.height);
    }
  });

  it('recovers the newest edit when reloading interrupts an older queued save', async () => {
    const saved = state.job!.design!.draft;
    state.save.mockImplementation(() => new Promise<CamJobV1>(() => {}));
    const view = open();
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    const latest = { ...saved, revision: saved.revision + 2 };
    expect(pendingDesignDraft(state.job!.id, saved)?.document).toEqual(latest);
    expect(state.save).toHaveBeenCalledTimes(1);
    view.unmount();
    endCadSession(saved.id);
    state.save.mockImplementation(async (job: CamJobV1, document: CadDocument) => ({
      ...job,
      design: { ...job.design!, draft: document },
    }));
    open();
    expect(JSON.parse(screen.getByTestId('editor-document').textContent!)).toEqual(latest);
    await waitFor(() => expect(pendingDesignDraft(state.job!.id, saved)).toBeNull());
    expect(state.save.mock.lastCall![1]).toEqual(latest);
  });

  it('resumes the latest draft after reloading before its IndexedDB save', async () => {
    const saved = state.job!.design!.draft;
    const latest = { ...saved, name: 'Last edit before reload', revision: saved.revision + 1 };
    keepPendingDesignDraft(state.job!.id, saved, latest);
    open();
    expect(JSON.parse(screen.getByTestId('editor-document').textContent!)).toEqual(latest);
    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
    const [base, document, checkpoint] = state.save.mock.calls[0]!;
    expect(base.id).toBe(state.job!.id);
    expect(JSON.stringify(document)).toBe(JSON.stringify(latest));
    expect(JSON.stringify(checkpoint)).toBe(JSON.stringify(saved));
    await waitFor(() => expect(pendingDesignDraft(state.job!.id, saved)).toBeNull());
  });

  it('requires recovery when another view changed the source before reload', async () => {
    const saved = state.job!.design!.draft;
    const latest = { ...saved, name: 'Unsaved local edit' };
    keepPendingDesignDraft(state.job!.id, saved, latest);
    state.job = { ...state.job!, design: { ...state.job!.design!, draft: { ...saved, name: 'Changed elsewhere' } } };
    open();
    expect(JSON.parse(screen.getByTestId('editor-document').textContent!)).toEqual(latest);
    expect(screen.getByRole('button', { name: 'Save sketch copy' })).toBeTruthy();
    expect(state.save).not.toHaveBeenCalled();
    expect(cadSession(state.job!.design!.draft).saved).toEqual(saved);
  });
  it.each(['boards', 'plan', 'machine'] as const)('Finish and Cancel preserve the %s context and board', async returnTo => {
    state.search = { returnTo, board: 'board-b', part: state.job!.design!.draft.parts[0].id };
    open();
    expect(screen.getByTestId('preferred-part').textContent).toBe(state.search.part);
    fireEvent.click(screen.getByRole('button', { name: 'Finish sketch' }));
    const destination =
      returnTo === 'machine'
        ? { to: '/visualize/2DView' }
        : { to: `/cam/$jobId/${returnTo}`, params: { jobId: 'design-job' }, search: { board: 'board-b' } };
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith(destination));
    expect(state.accept).toHaveBeenCalledTimes(1);
    state.navigate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel sketch' }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith(destination));
    expect(state.accept).toHaveBeenCalledTimes(1);
    if (returnTo === 'machine') expect(state.openAtMachine).toHaveBeenCalledWith('design-job', 'board-b');
  });

  it('defaults a newly finished design to Boards', async () => {
    state.job!.design!.accepted = undefined;
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Finish sketch' }));
    await waitFor(() =>
      expect(state.navigate).toHaveBeenCalledWith({ to: '/cam/$jobId/boards', params: { jobId: 'design-job' }, search: undefined })
    );
  });

  it('carries the machine context through bed setup when no machine work area exists yet', async () => {
    state.search = { returnTo: 'machine', board: 'board-b' };
    state.openAtMachine.mockReturnValue('/start');
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Finish sketch' }));
    await waitFor(() =>
      expect(state.navigate).toHaveBeenCalledWith({ to: '/start', search: { for: 'cam', job: 'design-job', board: 'board-b' } })
    );
  });

  it.each(['boards', 'plan', 'machine'] as const)('accepts through the editor before navigating directly to %s', async stage => {
    state.search = { returnTo: 'plan', board: 'board-b' };
    open();
    fireEvent.click(screen.getByRole('button', { name: `Go ${stage}` }));
    const destination =
      stage === 'machine'
        ? { to: '/visualize/2DView' }
        : { to: `/cam/$jobId/${stage}`, params: { jobId: 'design-job' }, search: { board: 'board-c' } };
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith(destination));
    expect(state.finishRequests).toHaveBeenCalledTimes(1);
    expect(state.accept).toHaveBeenCalledTimes(1);
    if (stage === 'machine') expect(state.openAtMachine).toHaveBeenCalledWith('design-job', 'board-c');
  });

  it('keeps an invalid draft in Design and resets the destination for a later ordinary Finish', async () => {
    state.search = { returnTo: 'plan', board: 'board-b' };
    state.accept.mockRejectedValueOnce(new Error('Open profile. Close the outline before cutting.'));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Go boards' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Draft kept: open profile.'));
    expect(state.navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Go boards' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Finish sketch' }));
    await waitFor(() =>
      expect(state.navigate).toHaveBeenCalledWith({
        to: '/cam/$jobId/plan',
        params: { jobId: 'design-job' },
        search: { board: 'board-b' },
      })
    );
  });

  it('honors editor validation and explains guarded new-tab activation without accepting or navigating', async () => {
    state.editorBlocked = true;
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Go boards' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('complete the current sketch command'));
    expect(state.accept).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open Boards in another tab' }));
    expect(screen.getByRole('alert').textContent).toContain('Finish the sketch before opening CAM in another tab');
    expect(state.finishRequests).toHaveBeenCalledTimes(1);
  });

  it('waits for the queued draft write before accepting a stage transition', async () => {
    let release!: (job: CamJobV1) => void;
    state.save.mockImplementationOnce(
      () =>
        new Promise<CamJobV1>(resolve => {
          release = resolve;
        })
    );
    const edited = { ...state.job!.design!.draft, revision: state.job!.design!.draft.revision + 1 };
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Go boards' }));
    expect(state.accept).not.toHaveBeenCalled();
    release({ ...state.job!, design: { ...state.job!.design!, draft: edited } });
    await waitFor(() => expect(state.accept).toHaveBeenCalled());
    expect(state.accept.mock.calls[0]![1]).toEqual(edited);
    expect(state.save).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(state.navigate).toHaveBeenCalled());
  });

  it('keeps a precise input reason instead of replacing it with the generic stage fallback', async () => {
    state.editorBlocked = true;
    state.blockedReason = 'Enter a valid Width before finishing the sketch.';
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Go boards' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Draft kept: enter a valid Width before finishing the sketch.'));
    expect(state.accept).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });
});

async function conflictingView() {
  const actual = await vi.importActual<typeof import('@/cam/cadDesign')>('@/cam/cadDesign');
  const empty = await createDesignJob('Two-view sketch');
  const document = { ...createPlateDocument(), id: empty.design!.draft.id };
  const savedA = await actual.saveDesignDraft(empty, document);
  const session = cadSession(document);
  acknowledgeCadSession(session, document);
  const width = document.parts[0].sketch.constraints.find(c => c.label === 'Width')!;
  const local = commitCadSession(session, updateDimension(document, width.id, 170));
  const other = updateDimension(document, width.id, 180);
  const savedB = await actual.saveDesignDraft(savedA, other);
  state.job = savedB;
  state.save.mockImplementation(actual.saveDesignDraft);
  return { actual, savedB, local, width, session };
}

describe('leaving in the middle of a face sketch', () => {
  it('shows its saved edits on coming back, instead of the design from before them', async () => {
    const start = state.job!.design!.draft;
    endCadSession(start.id);
    const view = open();
    fireEvent.click(screen.getByRole('button', { name: 'Open face sketch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    await waitFor(() => expect(cadFaceSketches(state.save.mock.lastCall![1].parts[0]!)).toHaveLength(1));
    const saved = state.save.mock.lastCall![1] as CadDocument;
    view.unmount();
    expect(cadFaceSketches(cadSession(saved).document.parts[0]!)).toHaveLength(1);
    expect(cadSession(saved).conflict).toBeUndefined();
    endCadSession(start.id);
  });
});

describe('cancelling a face sketch', () => {
  it('keeps saving without a conflict after cancelling saved face edits', async () => {
    const actual = await vi.importActual<typeof import('@/cam/cadDesign')>('@/cam/cadDesign'),
      empty = await createDesignJob('Cancelled face'),
      start = { ...createPlateDocument(), id: empty.design!.draft.id },
      saved = await actual.saveDesignDraft(empty, start);
    state.job = saved;
    state.save.mockImplementation(actual.saveDesignDraft);
    endCadSession(start.id);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Open face sketch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    await waitFor(async () => expect(cadFaceSketches((await getJob(saved.id))!.design!.draft.parts[0]!)).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel sketch' }));
    await waitFor(() => expect(screen.getByTestId('editor-document').textContent).not.toContain(':face:'));
    const before = (await getJob(saved.id))!.design!.draft.revision;
    // A conflict would refuse this save, and leave the stored draft where it was.
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    await waitFor(async () => expect((await getJob(saved.id))!.design!.draft.revision).toBeGreaterThan(before));
    expect(screen.queryByRole('alert')).toBeNull();
    endCadSession(start.id);
  });
});

describe('recovering a conflicting editor source', () => {
  it('rejects its first local edit despite refreshed route data, without replacing either sketch', async () => {
    const f = await conflictingView();
    open();
    expect(screen.getByRole('alert').textContent).toContain('changed in another view');
    expect(JSON.parse(screen.getByTestId('editor-document').textContent!)).toEqual(f.local);
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    await waitFor(() => expect(state.save).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('changed in another view'));
    expect((await getJob(f.savedB.id))!.design!.draft).toEqual(f.savedB.design!.draft);
    expect(f.session.document).toEqual(f.local);
    expect(state.accept).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('creates an editable sketch copy from prepared pending values without cloning manufacturing state', async () => {
    const f = await conflictingView();
    state.prepared = updateDimension(f.local, f.width.id, 185);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Save sketch copy' }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalled());
    const destination = state.navigate.mock.calls.at(-1)![0] as { to: string; params: { jobId: string } };
    expect(destination.to).toBe('/cam/$jobId/design');
    expect(destination.params.jobId).not.toBe(f.savedB.id);
    const copy = (await getJob(destination.params.jobId))!;
    expect(copy.design!.draft.parts).toEqual(state.prepared.parts);
    expect(copy.design!.draft.id).not.toBe(f.savedB.design!.draft.id);
    expect(copy.design!.draft.name).toMatch(/recovered copy/);
    expect(copy.design!.accepted).toBeUndefined();
    expect(copy.boards).toBeUndefined();
    expect((await getJob(f.savedB.id))!.design!.draft).toEqual(f.savedB.design!.draft);
    expect(f.session.document).toEqual(f.local);
  });

  it('leaves both sketches untouched when pending input cannot be prepared for recovery', async () => {
    const f = await conflictingView();
    state.prepared = null;
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Save sketch copy' }));
    expect(state.save).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    expect((await getJob(f.savedB.id))!.design!.draft).toEqual(f.savedB.design!.draft);
    expect(f.session.document).toEqual(f.local);
  });

  it('copies the whole design, with the sketch being edited, from a face editor', async () => {
    const f = await conflictingView();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Open face sketch' }));
    const focused = JSON.parse(screen.getByTestId('editor-document').textContent!) as CadDocument,
      sketch = addLine(focused.parts[0]!.sketch, { x1: 10, y1: 0, x2: 10, y2: 50 });
    state.prepared = { ...focused, parts: [{ ...focused.parts[0]!, sketch }] };
    fireEvent.click(screen.getByRole('button', { name: 'Save sketch copy' }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalled());
    const destination = state.navigate.mock.calls.at(-1)![0] as { params: { jobId: string } },
      copy = (await getJob(destination.params.jobId))!.design!.draft;
    expect(copy.parts[0]!.sketch).toEqual(f.local.parts[0]!.sketch);
    expect(cadFaceSketches(copy.parts[0]!).map(face => face.sketch)).toEqual([sketch]);
  });

  it('leaves a face editor when restoring the saved sketch, so its edits can’t reach the restored design', async () => {
    const f = await conflictingView();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Open face sketch' }));
    expect(screen.getByTestId('editor-document').textContent).toContain(':face:');
    fireEvent.click(screen.getByRole('button', { name: 'Use saved sketch' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(JSON.parse(screen.getByTestId('editor-document').textContent!)).toEqual(f.savedB.design!.draft);
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    await waitFor(() => expect(screen.getByText('Edit draft')).toBeTruthy());
    await waitFor(async () => expect((await getJob(f.savedB.id))!.design!.draft.revision).toBe(f.savedB.design!.draft.revision + 1));
    expect(cadFaceSketches((await getJob(f.savedB.id))!.design!.draft.parts[0]!)).toEqual([]);
  });

  it('explicitly reloads the freshest saved sketch and removes the old session history', async () => {
    const f = await conflictingView();
    open();
    const newest = updateDimension(f.savedB.design!.draft, f.width.id, 190);
    const saved = await f.actual.saveDesignDraft(f.savedB, newest);
    fireEvent.click(screen.getByRole('button', { name: 'Use saved sketch' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(JSON.parse(screen.getByTestId('editor-document').textContent!)).toEqual(saved.design!.draft);
    expect(cadSession(saved.design!.draft).past).toHaveLength(0);
    expect((await getJob(f.savedB.id))!.design!.draft).toEqual(saved.design!.draft);
    expect(f.session.document).toEqual(f.local);
  });
});

it('preserves the durable checkpoint when a unit change remounts the editor before autosave', async () => {
  const actual = await vi.importActual<typeof import('@/cam/cadDesign')>('@/cam/cadDesign');
  state.job = await createDesignJob('Unit checkpoint');
  const source = state.job.design!.draft;
  state.save.mockImplementation(actual.saveDesignDraft);
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Design settings' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Length unit' }), { target: { value: 'in' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Save settings' }).closest('form')!);
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
  expect(state.save.mock.calls[0]![2]).toEqual(source);
  await waitFor(async () => expect((await getJob(state.job!.id))!.design!.draft.lengthUnit).toBe('in'));
  // Wait for the closing animation to release the modal before the next editor action.
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 20_000 });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
  await waitFor(async () => expect((await getJob(state.job!.id))!.design!.draft.revision).toBe(source.revision + 2));
  expect(screen.queryByRole('alert')).toBeNull();
});
