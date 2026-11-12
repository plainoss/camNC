import { plannedReliefBit } from '@/cam/planSettings';
import { ReliefBitContext } from '@/cad/reliefBit';
import { DesignName, DesignSettings, type DesignSettingsValue } from '@/cam/DesignSettings';
import { useEffect, useRef, useState } from 'react';
import {
  cadFaceSketches,
  evaluateCadFeatures,
  faceIsUnderside,
  flipUnderside,
  evaluateCadPart,
  faceSketchDocument,
  removeCadFeature,
  withFaceSketchDocument,
  type CadDocument,
} from '@wbcnc/cad';
import { createFileRoute, Navigate, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@wbcnc/ui/components/button';
import { CamPage } from '@/cam/CamPage';
import { CamJobBar, type CamStageDestination } from '@/cam/CamJobBar';
import { camKeys, useCamJob } from '@/cam/camQueries';
import { acceptDesign, saveDesignDraft } from '@/cam/cadDesign';
import { noteDocumentChange, trackPending } from '@/lib/settled';
import {
  acknowledgePendingDesignDraft,
  discardPendingDesignDraft,
  keepPendingDesignDraft,
  pendingDesignDraft,
} from '@/cam/designDraftRecovery';
import { createDesignJob, getJob, type CamJobV1 } from '@/cam/jobDb';
import type { FaceSketchScene } from '@/cad/faceSketchScene';
import type { StudioCameraRef } from '@/cad/studioCamera';
import { CadEditor, type CadEditorController } from '@/cad/CadEditor';
import { acknowledgeCadSession, cadSession, endCadSession, replaceCadSession, syncCadSession } from '@wbcnc/cad-editor/session';
import { openAtMachine } from '@/cam/machine/openAtMachine';
import { downloadDesignFile } from '@/cam/designFile';
import { StudioExportButton } from '@/cad/export/StudioExportButton';
import { Download } from 'lucide-react';
import { useSvgAssetSession } from '@/cad/svg/useSvgAssetSession';

const designContextSchema = z.object({
  returnTo: z.enum(['boards', 'plan', 'machine']).optional(),
  board: z.string().min(1).optional(),
  part: z.string().min(1).optional(),
});
type DesignContext = z.infer<typeof designContextSchema>;
const draftConflictMessage = 'This design changed in another view. Your local sketch is kept; save a copy or use the saved sketch.';
const draftKeptNotice = (message: string) => {
  const reason = message.trim().split(/(?<=[.!?])\s+/u)[0];
  return `Draft kept: ${reason.charAt(0).toLowerCase()}${reason.slice(1).replace(/[.!?]$/, '')}.`;
};

export const Route = createFileRoute('/cam/$jobId/design')({
  component: DesignStep,
  validateSearch: zodValidator(designContextSchema),
});

function DesignStep() {
  const { jobId } = useParams({ from: '/cam/$jobId/design' });
  const context = useSearch({ from: '/cam/$jobId/design' });
  const { data: job, isPending } = useCamJob(jobId);
  if (isPending)
    return (
      <CamPage className="h-app">
        <p className="p-6">Opening design…</p>
      </CamPage>
    );
  if (!job)
    return (
      <CamPage className="h-app">
        <p className="p-6">This design no longer exists.</p>
      </CamPage>
    );
  if (!job.design) return <Navigate to="/cam/$jobId/model" params={{ jobId }} replace />;
  return <DesignSession key={job.id} initialJob={job} context={context} />;
}

/** Serialize draft writes and acceptance so a late autosave can never replace newer geometry. */
function DesignSession({ initialJob, context }: { initialJob: CamJobV1; context: DesignContext }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [recovery] = useState(() => pendingDesignDraft(initialJob.id, initialJob.design!.draft));
  const [session, setSession] = useState(() => {
    const session = cadSession(initialJob.design!.draft);
    if (recovery) {
      syncCadSession(session, recovery.document);
      if (recovery.conflict) {
        acknowledgeCadSession(session, recovery.checkpoint);
        session.conflict = { incoming: initialJob.design!.draft };
      }
    }
    return session;
  });
  // The Studio toolbar unmounts while editing a sketch; the document still owns its imported source.
  useSvgAssetSession(session.document.id);
  // The editor joins the recovered session using its durable checkpoint, so it does not acknowledge unsaved work.
  const [editorDocument, setEditorDocument] = useState(initialJob.design!.draft);
  const [editorEpoch, setEditorEpoch] = useState(0);
  // Back from a face sketch, the editor opens where the sketch was opened: the Part Studio with its step selected, or
  // the part's own view, where its new regions are cut.
  const [returnTo, setReturnTo] = useState<{ partId: string; studio: boolean; stepId?: string } | null>(null);
  const [faceEdit, setFaceEdit] = useState<{
    base: CadDocument;
    partId: string;
    sketchId: string;
    scene?: FaceSketchScene;
    fromStudio?: boolean;
  } | null>(null);
  const partCameraState = useRef<StudioCameraRef['current']>(null);
  const studioCameraState = useRef<StudioCameraRef['current']>(null);
  const [conflicted, setConflicted] = useState(!!session.conflict);
  const [recovering, setRecovering] = useState(false);
  const activeSession = useRef(session);
  const recoveryInProgress = useRef(false);
  const persisted = useRef(initialJob);
  const queue = useRef(Promise.resolve());
  const failure = useRef<Error | null>(session.conflict ? new Error(draftConflictMessage) : null);
  const editor = useRef<CadEditorController>(null);
  const [settings, setSettings] = useState<DesignSettingsValue>(session.document);
  const unitPreference = useRef(session.document.lengthUnit);
  const updateSettings = (value: DesignSettingsValue) => editor.current?.updateSettings(value) ?? false;
  const stageDestination = useRef<CamStageDestination | null>(null);
  const [navigationPending, setNavigationPending] = useState(false);
  const [status, setStatus] = useState('Draft saved');
  const [error, setError] = useState<string | null>(session.conflict ? draftConflictMessage : null);
  const returnToContext = async (jobId: string, destination = context) => {
    if (destination.returnTo === 'machine') {
      const to = openAtMachine(jobId, destination.board);
      await navigate(to === '/start' ? { to, search: { for: 'cam', job: jobId, board: destination.board } } : { to });
    } else {
      await navigate({
        to: destination.returnTo === 'plan' ? '/cam/$jobId/plan' : '/cam/$jobId/boards',
        params: { jobId },
        search: destination.board ? { board: destination.board } : undefined,
      });
    }
  };
  const show = (job: CamJobV1) => {
    persisted.current = job;
    acknowledgeCadSession(session, job.design!.draft);
    acknowledgePendingDesignDraft(job.id, job.design!.draft);
    queryClient.setQueryData(camKeys.job(job.id), job);
    void queryClient.invalidateQueries({ queryKey: camKeys.jobs });
  };
  const draft = (document: CadDocument) => {
    if (recoveryInProgress.current || activeSession.current !== session) return;
    if (!keepPendingDesignDraft(initialJob.id, session.saved, document))
      setError('Reload recovery is unavailable. Wait for Draft saved before reloading.');
    setSettings({ name: document.name, lengthUnit: document.lengthUnit });
    if (unitPreference.current !== document.lengthUnit) {
      unitPreference.current = document.lengthUnit;
      setEditorDocument(document);
      setFaceEdit(previous => (previous ? { ...previous, base: document } : null));
      setEditorEpoch(epoch => epoch + 1);
    }
    noteDocumentChange();
    setStatus('Saving draft…');
    queue.current = trackPending(
      'save',
      queue.current
        .then(async () => {
          if (activeSession.current !== session) return;
          const source = JSON.stringify(persisted.current.design!.draft);
          if (source !== JSON.stringify(document) || source !== JSON.stringify(session.saved))
            show(await saveDesignDraft(persisted.current, document, session.saved));
          else acknowledgePendingDesignDraft(initialJob.id, document);
          failure.current = null;
          setError(null);
          setStatus('Draft saved');
        })
        .catch((cause: unknown) => {
          if (activeSession.current !== session) return;
          const problem = cause instanceof Error ? cause : new Error(String(cause));
          if (problem.name === 'CadDraftConflict') setConflicted(true);
          failure.current = problem;
          setError(problem.message);
          setStatus('Draft could not be saved');
        })
    );
  };
  useEffect(() => {
    if (recovery && !recovery.conflict) draft(recovery.document);
    // Resume the interrupted queue once on opening, using the durable source as the optimistic checkpoint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finish = async (document: CadDocument) => {
    draft(document);
    await queue.current;
    if (failure.current) throw failure.current;
    setStatus('Finishing sketch…');
    try {
      const saved = await acceptDesign(persisted.current, document);
      show(saved);
      const destination = stageDestination.current;
      await returnToContext(saved.id, destination ? { returnTo: destination.stage, board: destination.board } : context);
    } catch (cause) {
      setStatus('Draft saved');
      setError(draftKeptNotice(cause instanceof Error ? cause.message : String(cause)));
      throw cause;
    }
  };
  const cancel = async () => {
    // CadEditor first restores its entry checkpoint through onDraftChange.
    await queue.current;
    if (failure.current) throw failure.current;
    if (!context.returnTo && !persisted.current.design?.accepted) await navigate({ to: '/cam' });
    else await returnToContext(initialJob.id);
  };
  const recoverCopy = async () => {
    const prepared = editor.current?.prepareDocument();
    if (!prepared || recoveryInProgress.current) return;
    // A face editor holds one sketch, so the copy needs the rest of the design around it.
    const document = faceEdit ? withFaceSketchDocument(faceEdit.base, faceEdit.partId, faceEdit.sketchId, prepared) : prepared;
    recoveryInProgress.current = true;
    setRecovering(true);
    try {
      // Preparation applies valid pending values through the same guarded draft queue.
      // A rejected original write does not prevent preserving the local source in a new job.
      await queue.current;
      const name = `${document.name} (recovered copy)`;
      const empty = await createDesignJob(name);
      const copy = { ...structuredClone(document), id: empty.design!.draft.id, name };
      const saved = await saveDesignDraft(empty, copy);
      queryClient.setQueryData(camKeys.job(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: camKeys.jobs });
      await navigate({ to: '/cam/$jobId/design', params: { jobId: saved.id } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      recoveryInProgress.current = false;
      setRecovering(false);
    }
  };
  /** The design as it is on screen, open values included, so a file shows exactly what was being edited. */
  /** The whole design as edited so far. A face editor holds one sketch, so it needs the rest of the design around it. */
  const currentDesign = () => {
    const prepared = editor.current?.prepareDocument();
    if (!prepared) return session.document;
    return faceEdit ? withFaceSketchDocument(faceEdit.base, faceEdit.partId, faceEdit.sketchId, prepared) : prepared;
  };
  const saveToFile = () => downloadDesignFile(currentDesign());
  const restoreSaved = async () => {
    if (recoveryInProgress.current) return;
    recoveryInProgress.current = true;
    setRecovering(true);
    try {
      await queue.current;
      const current = await getJob(initialJob.id);
      if (!current?.design) throw new Error('This design no longer exists. Save your local sketch as a copy.');
      discardPendingDesignDraft(initialJob.id);
      endCadSession(session.document.id);
      if (faceEdit) endCadSession(faceSketchDocument(faceEdit.base, faceEdit.partId, faceEdit.sketchId).id);
      setFaceEdit(null);
      const nextSession = cadSession(current.design.draft);
      activeSession.current = nextSession;
      persisted.current = current;
      failure.current = null;
      setSession(nextSession);
      setSettings(nextSession.document);
      unitPreference.current = nextSession.document.lengthUnit;
      setEditorDocument(current.design.draft);
      setReturnTo(null);
      setEditorEpoch(epoch => epoch + 1);
      setConflicted(false);
      setError(null);
      setStatus('Draft saved');
      queryClient.setQueryData(camKeys.job(current.id), current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      recoveryInProgress.current = false;
      setRecovering(false);
    }
  };
  const navigateStage = async (destination: CamStageDestination) => {
    if (destination.newTab) {
      setError('Finish the sketch before opening CAM in another tab.');
      return;
    }
    if (faceEdit) {
      setError('Finish or cancel this face sketch first.');
      return;
    }
    if (stageDestination.current || !editor.current) return;
    stageDestination.current = destination;
    setNavigationPending(true);
    setError(null);
    try {
      if (!(await editor.current.finish()))
        setError(
          previous => previous ?? 'Draft kept: complete the current sketch command or resolve the sketch issue before continuing to CAM.'
        );
    } finally {
      stageDestination.current = null;
      setNavigationPending(false);
    }
  };
  const leaveFaceSketch = (document: CadDocument) => {
    const { base, partId, sketchId, fromStudio } = faceEdit!,
      isEmpty = (source: CadDocument) => {
        const face = source.parts.find(part => part.id === partId)?.features?.find(f => f.type === 'sketch' && f.sketch.id === sketchId);
        return face?.type === 'sketch' && !face.sketch.entities.some(entity => entity.type !== 'point') ? face : null;
      },
      empty = isEmpty(document),
      // Adding a new sketch was already one undo step, so finishing it isn't another.
      isNew = !!isEmpty(base);
    // A sketch left empty leaves nothing behind.
    const next = empty ? { ...removeCadFeature(document, partId, empty.id), revision: document.revision + 1 } : document;
    if (next !== document) draft(next);
    if (empty && isNew) session.past.pop();
    replaceCadSession(session, next, isNew ? null : base);
    endCadSession(faceSketchDocument(base, partId, sketchId).id);
    setEditorDocument(session.document);
    const stepId = next.parts.find(part => part.id === partId)?.features?.find(f => f.type === 'sketch' && f.sketch.id === sketchId)?.id;
    setReturnTo({ partId, studio: !!fromStudio, ...(stepId && { stepId }) });
    setEditorEpoch(epoch => epoch + 1);
    setFaceEdit(null);
  };
  const facePartSource = faceEdit && faceEdit.base.parts.find(part => part.id === faceEdit.partId)!,
    facePart = facePartSource && evaluateCadPart(facePartSource).part,
    faceOn = facePartSource && cadFaceSketches(facePartSource).find(face => face.sketch.id === faceEdit!.sketchId)?.on,
    faceBelow = !!facePartSource && !!faceOn && faceIsUnderside(facePartSource, faceOn),
    faceFloor =
      facePartSource && facePart && typeof faceOn === 'object'
        ? evaluateCadFeatures(facePartSource, facePart).part.cuts?.find(cut => cut.id === (faceOn as { floorOf: string }).floorOf)?.outline
        : undefined;
  return (
    <ReliefBitContext.Provider value={plannedReliefBit(initialJob.plan)}>
      <CamPage className="h-app">
        <CamJobBar
          job={initialJob}
          title={<DesignName name={settings.name} onRename={name => updateSettings({ ...settings, name })} />}
          onStageNavigate={destination => void navigateStage(destination)}
          navigationPending={navigationPending}
          tools={
            <>
              <DesignSettings value={settings} onSave={updateSettings} />
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                title="Save the whole design, with its sketches and features, as a .json file. Open it again from Projects."
                onClick={saveToFile}>
                <Download /> Save to file
              </Button>
              <StudioExportButton design={currentDesign} rolledTo={() => editor.current?.rolledTo() ?? null} />
            </>
          }
        />
        <div className="relative min-h-0 flex-1">
          {conflicted && (
            <div
              role="alert"
              className="absolute left-4 right-4 top-12 z-50 flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-background p-3 shadow-md">
              <p className="flex-1 text-sm">{error ?? draftConflictMessage}</p>
              <Button size="sm" disabled={recovering} onClick={() => void recoverCopy()}>
                Save sketch copy
              </Button>
              <Button size="sm" variant="outline" disabled={recovering} onClick={() => void restoreSaved()}>
                Use saved sketch
              </Button>
            </div>
          )}
          {faceEdit && facePart ? (
            <CadEditor
              key={`${faceEdit.sketchId}:${editorEpoch}`}
              document={faceSketchDocument(faceEdit.base, faceEdit.partId, faceEdit.sketchId)}
              faceSketch={{
                outline: faceBelow ? flipUnderside(facePart.outline) : facePart.outline,
                floor: faceBelow && faceFloor ? flipUnderside(faceFloor) : faceFloor,
                label: `${faceFloor ? 'Pocket floor' : faceBelow ? 'Underside' : 'Top face'}${faceBelow ? ', seen from below' : ''}`,
                below: faceBelow,
                scene: faceEdit.scene,
              }}
              onDraftChange={edited => {
                const merged = withFaceSketchDocument(faceEdit.base, faceEdit.partId, faceEdit.sketchId, edited);
                if (activeSession.current === session) syncCadSession(session, merged);
                draft(merged);
              }}
              onFinish={edited => leaveFaceSketch(withFaceSketchDocument(faceEdit.base, faceEdit.partId, faceEdit.sketchId, edited))}
              onCancel={() => {
                const { base } = faceEdit;
                // Cancel first saves the sketch as it was. Carrying on from that saved draft, rather than the copy taken on
                // entry, keeps the next save's checkpoint in step with what's stored.
                void queue.current.then(() => leaveFaceSketch(failure.current ? base : persisted.current.design!.draft));
              }}
              saveStatus={status}
              notice={conflicted ? null : error}
              controller={editor}
            />
          ) : (
            <CadEditor
              key={editorEpoch}
              document={editorDocument}
              editSession={session}
              partCameraState={partCameraState}
              studioCameraState={studioCameraState}
              startIn3D={returnTo && !returnTo.studio ? 'part' : true}
              {...(returnTo?.studio && returnTo.stepId && { selectedStepId: returnTo.stepId })}
              onEditFaceSketch={(base, partId, sketchId, scene, fromStudio) => {
                draft(base);
                setFaceEdit({ base, partId, sketchId, scene, fromStudio });
              }}
              preferredPartId={returnTo?.partId ?? context.part}
              onDraftChange={draft}
              onFinish={finish}
              onCancel={cancel}
              onFinishBlocked={reason => setError(draftKeptNotice(reason))}
              saveStatus={status}
              notice={conflicted ? null : error}
              controller={editor}
            />
          )}
        </div>
      </CamPage>
    </ReliefBitContext.Provider>
  );
}
