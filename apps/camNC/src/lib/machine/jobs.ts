import { saveMachinePlacement } from '@/cam/machine/saveMachinePlacement';
import { getCncApi } from '@/lib/fluidnc/machine';
import { useStore, getMachineBounds } from '@/store/store';
import { Vector3 } from 'three';
import { signal } from '@preact/signals-react';
import { toast } from '@wbcnc/ui/components/sonner';
import { useEffect } from 'react';
import {
  invalidateJobRecovery,
  JobRecord,
  readJobRecordHead,
  saveJobRecordAtHead,
  sameJobExecution,
  type JobRecordHead,
} from './jobRecord';
import { isDemoMode } from '../demo/demo-mode';
import {
  applyRecord,
  InterruptedJob,
  interruptedJob,
  noteJobStopRequested,
  recoveryPending,
  runningJobName,
  showRecordedNativeRun,
} from './jobRecovery';
import type { Macro } from './macros';
import { buildResumeProgram, parseProgram, programBounds } from './resume';
import { checkPosition, checkTravel, getJobChecklist } from './workflow';
import { isManufacturingLocked, pinManufacturingRun, useCamMachine } from '@/cam/machine/camMachine';
import { recordNativeRun } from '@/cam/machine/nativeRunHistory';
import {
  NativePreparationFailure,
  prepareNativeRun,
  rollbackNativePreparation,
  type NativePreparationReceipt,
} from '@/cam/machine/nativeRunPreparation';
import { cleanupRetiredExecutionFiles, retireExecutionFiles } from './executionFiles';
import { executionReference, sameExecutionReference, type ExecutionReference } from './executionOwnership';
import { isKnownExecutionFile, isKnownExecutionProgram, rememberExecutionProgram } from './executionProgram';
import { matchesResumableSetup, type ManufacturingSnapshot } from '@/cam/machine/manufacturingSnapshot';

export function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/** Legacy shared filename, retained only to recognize older controller files. */
export const kJobFileName = 'camnc.gcode';
/** Legacy resume filename. New dispatches use an execution-specific UUID. */
export const kResumeFileName = 'camnc-resume.gcode';

/** Whether an SD file (`/sd/camnc.gcode`) is one camNC uploaded for the loaded toolpath. */
export function isCamncJobFile(file: string) {
  return (
    [kJobFileName, kResumeFileName].some(name => file === name || file.endsWith(`/${name}`)) ||
    /(?:^|\/)camnc(?:-resume)?-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.gcode$/i.test(file)
  );
}

/** One immutable SD object per dispatch prevents another tab's losing upload from changing its bytes. */
export const executionJobFileName = (executionId: string, resume = false) => `camnc${resume ? '-resume' : ''}-${executionId}.gcode`;

/** Whether the SD file running is a camNC job of `gcode`, rather than of a file opened since it started. */
export function isJobOfToolpath(file: string, gcode: string) {
  return isCamncJobFile(file) && isKnownExecutionProgram(file, gcode);
}

/**
 * What to call the running job: the name of the toolpath camNC started it from (a CAM program is named after the
 * job, board, side and step, see CamQueueCard), else the SD file name. Without the `.gcode` extension.
 */
export function runningJobTitle(file: string | undefined, toolpathName: string | null) {
  const name = file && isCamncJobFile(file) && isKnownExecutionFile(file) && toolpathName ? toolpathName : file?.split('/').pop();
  return name?.replace(/\.(gcode|nc|ngc|gc|tap)$/i, '');
}

/** Feed hold first so the position is kept, then reset to flush the planner. */
export async function stopJob() {
  const api = getCncApi();
  noteJobStopRequested();
  api.feedHold();
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !(api.state.value === 'Hold' && api.status.value?.subState === 0)) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  api.softReset();
}

/** Shows where the program would run from the zero on the controller, while the user looks at running from there. */
export const machineZeroPreview = signal(false);
/** Shows the way the bit would go, in machine coordinates, while the user points at a move. */
export const moveTargetPreview = signal<{ x: number; y: number } | null>(null);

/** Set the machine's work XY zero to where the toolpath is placed on the camera view. */
export function setXYZeroFromToolpath(move = false) {
  if (isManufacturingLocked()) return Promise.resolve();
  const api = getCncApi();
  const { x, y } = useStore.getState().toolpathOffset;
  const promise = move ? api.setWorkspaceXYZeroAndMove(x, y) : api.setWorkspaceXYZero(x, y);
  toast.promise(promise, {
    loading: 'Setting XY zero…',
    success: `XY zero set to ${x.toFixed(2)}, ${y.toFixed(2)}`,
    error: err => `Setting XY zero failed: ${errorText(err)}`,
  });
  return promise.catch(() => {});
}

function assertEffectiveXYZero(
  workspace: { x: number; y: number } | null | undefined,
  effective: { x: number; y: number } | null | undefined
) {
  if (workspace && effective && (Math.abs(workspace.x - effective.x) > 0.01 || Math.abs(workspace.y - effective.y) > 0.01))
    throw new Error('The effective XY offset differs from the workspace zero. Review or clear G92 offsets before starting.');
}

/** The effective work offset once its XY reports `target`, or null when the controller never reports it. */
async function reportedXYZero(api: ReturnType<typeof getCncApi>, target: { x: number; y: number }, assertCurrent: () => void) {
  const deadline = Date.now() + 5000;
  for (;;) {
    assertCurrent();
    const wco = api.status.value?.wco;
    if (wco && Math.abs(target.x - wco.x) <= 0.01 && Math.abs(target.y - wco.y) <= 0.01) return structuredClone(wco);
    if (Date.now() >= deadline) return null;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

/** Table replies may precede the effective-offset status report after G10. */
async function confirmedXYZero(api: ReturnType<typeof getCncApi>, assertCurrent: () => void) {
  const zero = await api.getCurrentZero();
  const wco = await reportedXYZero(api, zero, assertCurrent);
  if (!wco) {
    assertEffectiveXYZero(zero, api.status.value?.wco);
    throw new Error('Wait for a machine position report before using its zero.');
  }
  return { zero, wco };
}

/** Save the physical placement before preparation can lock the editor's deferred drag save. */
export async function moveToolpathToMachineZero() {
  if (isManufacturingLocked()) return false;
  const api = getCncApi();
  const host = api.host.value;
  const machine = useCamMachine.getState();
  const stillCurrent = () =>
    !isManufacturingLocked() &&
    api === getCncApi() &&
    api.host.value === host &&
    useCamMachine.getState().jobId === machine.jobId &&
    useCamMachine.getState().active === machine.active;
  let zero: Awaited<ReturnType<typeof api.getCurrentZero>>;
  try {
    ({ zero } = await confirmedXYZero(api, () => {
      if (!stillCurrent()) throw new Error('The machine or setup changed before its zero was confirmed.');
    }));
    await saveMachinePlacement(zero.x, zero.y, stillCurrent);
  } catch (error) {
    toast.error('Unable to move the job to the machine zero', { description: errorText(error) });
    return false;
  }
  if (!stillCurrent()) return false;
  const store = useStore.getState();
  store.setIsToolpathDragging(true);
  store.setToolpathOffset(new Vector3(zero.x, zero.y, zero.z));
  setTimeout(() => useStore.getState().setIsToolpathDragging(false));
  toast.success('Toolpath moved to the machine zero', { description: `${zero.x.toFixed(2)}, ${zero.y.toFixed(2)}` });
  return true;
}

/** Zero XY at the bit, and the toolpath follows: what's drawn stays where it will cut. */
export async function zeroXYAtBit() {
  if (isManufacturingLocked()) return;
  try {
    await getCncApi().zeroAxes(['x', 'y']);
  } catch (err) {
    toast.error('Zeroing failed', { description: errorText(err) });
    return;
  }
  await moveToolpathToMachineZero();
}

const kUploadToast = 'upload-gcode';

async function step<T>(promise: Promise<T>, loading: string, success: string) {
  toast.promise(promise, { id: kUploadToast, loading, success, error: err => `${loading.replace('…', '')} failed: ${errorText(err)}` });
  return promise;
}

interface RunContext {
  api: ReturnType<typeof getCncApi>;
  host: string;
  demo: boolean;
  executionId: string;
  reference: ExecutionReference;
  previousReference: ExecutionReference | null;
  resumeReference?: ExecutionReference | null;
  setup: Pick<JobRecord, 'toolpathOffset' | 'stockHeight' | 'toolDiameter' | 'wco' | 'homed' | 'zZeroedAt'>;
}
function captureRunContext(
  api: ReturnType<typeof getCncApi>,
  view: { toolpathOffset: { x: number; y: number; z: number }; stockHeight: number; toolDiameter: number } = useStore.getState()
): RunContext {
  const host = api.host.value,
    wco = api.status.value?.wco;
  if (!host || !wco) throw new Error('Wait for a machine position report before starting the job.');
  const executionId = crypto.randomUUID();
  return {
    api,
    host,
    demo: isDemoMode(),
    executionId,
    reference: { host, startedAt: Date.now(), executionId },
    previousReference: useCamMachine.getState().runRecord,
    setup: {
      toolpathOffset: { x: view.toolpathOffset.x, y: view.toolpathOffset.y, z: view.toolpathOffset.z },
      stockHeight: view.stockHeight,
      toolDiameter: view.toolDiameter,
      wco: structuredClone(wco),
      homed: api.homed.value,
      zZeroedAt: api.zZeroedAt.value,
    },
  };
}
function ownsPreparation(context: RunContext) {
  const state = useCamMachine.getState();
  if (state.preparingExecutionId !== context.executionId) return false;
  return state.runRecord
    ? sameExecutionReference(state.runRecord, context.reference) ||
        sameExecutionReference(state.runRecord, context.previousReference) ||
        sameExecutionReference(state.runRecord, context.resumeReference)
    : context.previousReference === null;
}
/** The status report of a controller that is idle with no job; test doubles may omit the activity signals. */
function idleStatus(api: ReturnType<typeof getCncApi>) {
  const status = api.status.value;
  if (!status || status.job || api.jobProgress?.value != null || api.jobStartedAt?.value != null) return null;
  return (api.state?.value ?? status.state) === 'Idle' ? status : null;
}
const sessionChanged = (context: RunContext) =>
  getCncApi() !== context.api || context.api.host.value !== context.host || isDemoMode() !== context.demo || !ownsPreparation(context);
function assertRunContext(context: RunContext, awaitingXYReport = false) {
  const status = idleStatus(context.api);
  if (
    !status ||
    (!awaitingXYReport && (Math.abs(status.wco.x - context.setup.wco.x) > 0.01 || Math.abs(status.wco.y - context.setup.wco.y) > 0.01)) ||
    Math.abs(status.wco.z - context.setup.wco.z) > 0.01
  )
    throw new Error('The controller position or activity changed while preparing. Execution was not requested.');
  if (sessionChanged(context)) throw new Error('The machine or session changed while preparing this program. Execution was not requested.');
}
class ReceiptConflict extends Error {}
interface Preparation {
  record: JobRecord;
  original: JobRecordHead | null;
  stored: boolean;
}
/** A prepared head is never eligible to recover. It carries only the previous safe eligible receipt. */
async function recordJob(
  context: RunContext,
  fields: Pick<JobRecord, 'gcode' | 'sdFile' | 'toolpathName'> & { camSnapshot?: ManufacturingSnapshot },
  head: JobRecordHead | null
): Promise<Preparation> {
  assertRunContext(context);
  const record: JobRecord = {
    ...fields,
    ...context.setup,
    ...context.reference,
    execution: 'prepared',
    previousRecord: head?.record ?? undefined,
  };
  try {
    if (!head) throw new Error('Recovery storage could not be read.');
    if (!(await saveJobRecordAtHead(head, record)))
      throw new ReceiptConflict('Another execution replaced this recovery receipt. Execution was not requested.');
    return { record, original: head, stored: true };
  } catch (error) {
    if (fields.camSnapshot || error instanceof ReceiptConflict) throw error;
    assertRunContext(context);
    await invalidateJobRecovery(context.host, context.demo);
    if (interruptedJob.value?.record.host === context.host) interruptedJob.value = null;
    toast.warning('Job recovery is unavailable', { description: 'The program can run, but its progress cannot be saved in this browser.' });
    return { record, original: head, stored: false };
  }
}
/** Promotion is the final awaited operation before the synchronous dispatch preflight. */
async function activateReceipt(context: RunContext, preparation: Preparation) {
  const active: JobRecord = { ...preparation.record, execution: 'requested' };
  delete active.previousRecord;
  if (preparation.stored) {
    const head = await readJobRecordHead(context.host, context.demo);
    assertRunContext(context);
    if (
      !head.stored ||
      head.stored.executionId !== context.executionId ||
      head.stored.execution !== 'prepared' ||
      !(await saveJobRecordAtHead(head, active))
    )
      throw new ReceiptConflict('Another execution replaced this preparation. Execution was not requested.');
  }
  return active;
}
/** Both identity and phase are compared so old rollback cannot erase a promoted or newer execution. */
async function restoreRecoveryRecord(context: RunContext, preparation: Preparation, phase: 'prepared' | 'requested') {
  if (!preparation.stored) return;
  const head = await readJobRecordHead(context.host, context.demo);
  if (!head.stored || head.stored.executionId !== context.executionId || head.stored.execution !== phase) return;
  await saveJobRecordAtHead(head, preparation.original?.record ?? null);
}
function retainFailedPreparation(context: RunContext, snapshot: ManufacturingSnapshot, message: string) {
  if (!ownsPreparation(context)) return;
  useCamMachine.setState({
    runSnapshot: snapshot,
    runReview: 'requested',
    runRecord: context.reference,
    runPreparationError: `Execution was not requested. ${message} Review this original setup before replacing it.`,
  });
}

/** Set XY zero and dispatch as one protected preparation, before any upload or receipt. */
export async function zeroAndRun() {
  return startProgram(true);
}

/** Keep the controller's zero. Recovery has its own dispatch and never calls the zeroing path. */
export async function uploadAndRun() {
  return startProgram(false);
}

interface Dispatch {
  gcode: string;
  sdFile: string;
  toolpathName: string | null;
  camSnapshot?: ManufacturingSnapshot;
  /** A resumed native run must still have its started sheet before the physical preparation. */
  requireStartedSheet?: boolean;
  startedMessage: string;
  /** Everything that must hold before the upload. Resolves to the recovery receipt head the dispatch replaces. */
  confirmSetup(): Promise<JobRecordHead | null>;
  /** After the controller accepted the start: retire what this execution replaced. */
  onStarted(replaced: JobRecord | null | undefined): void;
  /** Undo what the caller showed for this dispatch, after a clean rollback. */
  restoreSetup(): void;
}

/**
 * The one transaction that starts a program: upload, prepared receipt, native preparation, receipt promotion and
 * runFile, with the run context checked after every await. Until runFile is requested, any failure rolls all of it back.
 */
async function dispatchExecution(context: RunContext, dispatch: Dispatch) {
  const { api } = context,
    { gcode, sdFile, toolpathName, camSnapshot } = dispatch;
  useCamMachine.setState({ preparingRun: true, preparingExecutionId: context.executionId, runPreparationError: null });
  let startRequested = false,
    uploadStarted = false,
    uploadVerified = false,
    preparation: Preparation | null = null,
    activated = false,
    nativePreparation: NativePreparationReceipt | null = null;
  try {
    const head = await dispatch.confirmSetup();
    assertRunContext(context);
    uploadStarted = true;
    await step(api.uploadGcode(gcode, sdFile, { fresh: true }), 'Uploading…', 'Uploaded and verified');
    uploadVerified = true;
    assertRunContext(context);
    preparation = await recordJob(context, { gcode, sdFile, toolpathName, camSnapshot }, head);
    assertRunContext(context);
    if (camSnapshot) {
      if (dispatch.requireStartedSheet) await recordNativeRun(camSnapshot, false, true);
      nativePreparation = await prepareNativeRun(camSnapshot, context.executionId);
    }
    assertRunContext(context);
    const record = await activateReceipt(context, preparation);
    activated = true;
    assertRunContext(context);
    useCamMachine.setState({ ...(camSnapshot && { runReview: 'requested' as const }), runRecord: executionReference(record) });
    runningJobName.value = toolpathName;
    rememberExecutionProgram(sdFile, gcode);
    startRequested = true;
    await step(api.runFile(sdFile), 'Starting job…', dispatch.startedMessage);
    dispatch.onStarted(preparation.original?.record);
  } catch (error) {
    if (!startRequested) {
      if (error instanceof NativePreparationFailure) nativePreparation = error.receipt;
      if (uploadStarted) retireExecutionFiles(context.host, [sdFile], context.demo, { pendingUpload: !uploadVerified });
      let rollbackError: unknown;
      try {
        if (nativePreparation && !(await rollbackNativePreparation(nativePreparation)))
          throw new Error('The original physical preparation could not be released.');
        if (preparation) await restoreRecoveryRecord(context, preparation, activated ? 'requested' : 'prepared');
      } catch (failure) {
        rollbackError = failure;
      }
      if (ownsPreparation(context)) {
        if (camSnapshot && rollbackError) retainFailedPreparation(context, camSnapshot, errorText(rollbackError ?? error));
        else dispatch.restoreSetup();
      }
    }
    throw error;
  } finally {
    if (ownsPreparation(context)) useCamMachine.setState({ preparingRun: false, preparingExecutionId: null });
    if (!startRequested) void cleanupRetiredExecutionFiles(api, { demo: context.demo }).catch(() => {});
  }
}

async function startProgram(setXYZero: boolean) {
  const api = getCncApi();
  const { toolpath, toolpathName } = useStore.getState();
  if (!toolpath?.gcode) throw new Error('No toolpath loaded');
  if (isManufacturingLocked()) throw new Error('Review or dismiss the original machine job before starting another program.');
  assertInsideTravel();
  const context = captureRunContext(api),
    pendingZero = api.currentZero?.value,
    awaitingXYReport =
      !!pendingZero && (Math.abs(pendingZero.x - context.setup.wco.x) > 0.01 || Math.abs(pendingZero.y - context.setup.wco.y) > 0.01),
    previousSnapshot = useCamMachine.getState().runSnapshot;
  const camSnapshot = pinManufacturingRun(toolpath.gcode);
  await dispatchExecution(context, {
    gcode: toolpath.gcode,
    sdFile: executionJobFileName(context.executionId),
    toolpathName,
    camSnapshot,
    startedMessage: 'Job started',
    async confirmSetup() {
      let head: JobRecordHead | null;
      try {
        head = await readJobRecordHead(context.host, context.demo);
      } catch (error) {
        if (camSnapshot) throw error;
        head = null;
      }
      assertRunContext(context, awaitingXYReport);
      const unreviewed = head?.stored?.camSnapshot ? head.stored : head?.record?.camSnapshot ? head.record : null;
      if (unreviewed) {
        useCamMachine.setState({ preparingRun: false, preparingExecutionId: null });
        await showRecordedNativeRun(api, unreviewed, context.demo);
        throw new Error('Review the original machine setup before starting another program.');
      }
      const confirmed = await confirmedXYZero(api, () => assertRunContext(context, awaitingXYReport));
      // Only a zero already awaiting its status report may replace the captured XY.
      if (awaitingXYReport) assertEffectiveXYZero(pendingZero, confirmed.wco);
      context.setup.wco = confirmed.wco;
      if (setXYZero) {
        assertRunContext(context);
        const { x, y } = context.setup.toolpathOffset;
        await step(api.setWorkspaceXYZero(x, y), 'Setting XY zero…', `XY zero set to ${x.toFixed(2)}, ${y.toFixed(2)}`);
        // G10's acknowledgement is not a position report. Wait for the actual effective WCO;
        // an optimistic UI zero must never become the recovery receipt's machine zero.
        const wco = await reportedXYZero(api, { x, y }, () => {
          if (sessionChanged(context))
            throw new Error('The machine or session changed while setting XY zero. Execution was not requested.');
          const status = idleStatus(api);
          if (!status) throw new Error('The controller activity changed while setting XY zero. Execution was not requested.');
          if (Math.abs(status.wco.z - context.setup.wco.z) > 0.01)
            throw new Error('Z zero changed while setting XY zero. Execution was not requested.');
        });
        if (!wco) throw new Error('The controller did not confirm the requested XY zero. Execution was not requested.');
        context.setup.wco = wco;
      }
      return head;
    },
    onStarted(replaced) {
      if (!replaced) return;
      retireExecutionFiles(context.host, [replaced.sdFile], context.demo);
      if (interruptedJob.value && sameJobExecution(interruptedJob.value.record, replaced)) interruptedJob.value = null;
    },
    restoreSetup: () => useCamMachine.setState({ runSnapshot: previousSnapshot }),
  });
}

/**
 * FluidNC 3.9 checks every axis on every move: from a position outside the travel even the first Z lift stops with a
 * soft limit alarm. Refuse to start then, with what to do instead.
 */
function assertInsideTravel() {
  const api = getCncApi();
  const mpos = api.status.value?.mpos;
  const travel = api.travel.value;
  if (!mpos || !travel) return;
  const check = checkPosition(mpos, travel);
  if (!check.blocking) return;
  const message = [check.label, ...(check.details ?? [])].join('. ');
  toast.error(message);
  throw new Error(message);
}

/** Machine Z to retract to before moving over the restart point: just below the top of the Z travel. */
export function resumeSafeZ() {
  const api = getCncApi();
  const z = api.travel.value?.z;
  return z ? z.max - 1 : (api.status.value?.mpos.z ?? null);
}

/** The program that resumes `job` at `line` (0-based), checked against the machine travel. */
export function prepareResume(job: InterruptedJob, line: number) {
  const api = getCncApi();
  const safeZMachine = resumeSafeZ();
  if (safeZMachine === null) throw new Error('The machine position is not known yet');
  const resume = buildResumeProgram(parseProgram(job.record.gcode), { line, safeZMachine, name: job.record.toolpathName ?? undefined });
  const travel = api.travel.value;
  const wco = api.status.value?.wco;
  const check =
    travel && wco
      ? checkTravel({ toolpathBounds: programBounds(parseProgram(resume.gcode)), workOffset: wco, travel, gcode: resume.gcode })
      : null;
  return { ...resume, travel: check };
}

/** Upload and run the program that resumes an interrupted job, and show it as the loaded toolpath. */
export async function runResume(job: InterruptedJob, line: number) {
  const api = getCncApi(),
    machine = useCamMachine.getState();
  if (machine.preparingRun || recoveryPending.value || api.jobProgress?.value != null || api.jobStartedAt?.value != null)
    throw new Error('A program is running or preparing. Wait before resuming another job.');
  if (isManufacturingLocked() && (machine.runReview === 'finished' || !matchesResumableSetup(machine, job.record.camSnapshot)))
    throw new Error('Review the original machine setup before resuming a different job.');
  if (api.host.value !== job.record.host) throw new Error('Reconnect to the original controller before resuming this job.');
  const resume = prepareResume(job, line);
  if (resume.travel?.blocking) throw new Error(resume.travel.details?.join(' ') ?? resume.travel.label);
  assertInsideTravel();
  const name = `${job.record.toolpathName ?? 'Job'} (from line ${line + 1})`,
    store = useStore.getState();
  const previousView = {
    toolpath: store.toolpath,
    toolpathName: store.toolpathName,
    toolpathOffset: store.toolpathOffset,
    stockHeight: store.stockHeight,
    stockHeightCheck: store.stockHeightCheck,
    toolDiameter: store.toolDiameter,
  };
  const previousSetup = {
    jobId: machine.jobId,
    active: machine.active,
    loadedSnapshot: machine.loadedSnapshot,
    runSnapshot: machine.runSnapshot,
    overlay: machine.overlay,
    runReview: machine.runReview,
    runRecord: machine.runRecord,
  };
  const context = captureRunContext(api, {
    ...store,
    toolpathOffset: job.record.toolpathOffset,
    stockHeight: job.record.stockHeight,
    toolDiameter: job.record.toolDiameter,
  });
  await dispatchExecution(context, {
    gcode: resume.gcode,
    sdFile: executionJobFileName(context.executionId, true),
    toolpathName: name,
    camSnapshot: job.record.camSnapshot,
    requireStartedSheet: true,
    startedMessage: 'Job resumed: Resume once the bit is clear',
    async confirmSetup() {
      applyRecord(api, { ...job.record, gcode: resume.gcode, toolpathName: name }, { machineState: false });
      context.resumeReference = useCamMachine.getState().runRecord;
      const head = await readJobRecordHead(context.host, context.demo);
      const durableResume = !!(job.record.executionId || job.record.camSnapshot);
      if (
        head.stored?.execution === 'prepared' ||
        head.record?.execution === 'finished' ||
        (head.stored && (!head.record || !sameJobExecution(head.stored, job.record))) ||
        (durableResume && (!head.stored || !head.record || !sameJobExecution(head.record, job.record)))
      )
        throw new ReceiptConflict('The interrupted execution receipt was removed, replaced, or still needs preparation review.');
      return head;
    },
    onStarted() {
      retireExecutionFiles(context.host, [job.record.sdFile], context.demo);
      if (interruptedJob.value && sameExecutionReference(interruptedJob.value.record, job.record)) interruptedJob.value = null;
    },
    restoreSetup() {
      useStore.setState(previousView);
      useCamMachine.setState(previousSetup);
    },
  });
}

export async function runMacro(macro: Macro) {
  const promise = getCncApi().runMacro(macro);
  toast.promise(promise, {
    loading: `Running ${macro.name}…`,
    success: `${macro.name} done`,
    error: err => `${macro.name}: ${errorText(err)}`,
  });
  return promise.catch(() => {});
}

/** Pre-job checklist for the loaded toolpath, live from the store and the machine signals. */
export function useJobChecklist() {
  'use no memo';
  const api = getCncApi();
  const toolpath = useStore(s => s.toolpath);
  const offset = useStore(s => s.toolpathOffset);
  const homed = api.homed.value;
  const zZeroed = api.zZeroedAt.value !== null;
  const machineZero = api.currentZero.value;
  const workOffset = api.status.value?.wco ?? null;
  const travel = api.travel.value;
  const idle = api.isConnected.value && api.state.value === 'Idle';
  // Read the travel once per connection, while idle.
  useEffect(() => {
    if (toolpath && idle) api.ensureTravel();
  }, [api, toolpath, idle]);
  if (!toolpath) return [];
  const bounds = toolpath.getBounds();
  return getJobChecklist({
    gcode: toolpath.gcode,
    homed,
    zZeroed,
    toolpathBounds: { min: bounds.min, max: bounds.max },
    toolpathOffset: offset,
    machineZero,
    machineBounds: getMachineBounds() ?? undefined,
    toolpathBounds3: { min: bounds.min, max: bounds.max },
    workOffset,
    travel,
    machinePosition: api.status.value?.mpos ?? null,
  });
}
