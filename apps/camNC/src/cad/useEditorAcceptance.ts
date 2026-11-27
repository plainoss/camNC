import { withCadLengthUnit, type CadDocument } from '@wbcnc/cad';
import { acceptCadSession, endCadSession, restoreCadSession, type CadSession } from '@wbcnc/cad-editor/session';
import { useImperativeHandle, type RefObject } from 'react';
import type { CadEditorProps } from './CadEditor.types';
import type { Point } from './cadEditorShared';

type AcceptanceCallbacks = Pick<CadEditorProps, 'onFinish' | 'onCancel' | 'onFinishBlocked'>;

interface EditorAcceptanceInput {
  controller: CadEditorProps['controller'];
  session: CadSession;
  docId: string;
  documentRef: RefObject<CadDocument>;
  callbacks: RefObject<AcceptanceCallbacks>;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  solving: boolean;
  finishing: RefObject<boolean>;
  preparingDimension: RefObject<boolean>;
  thicknessValid: boolean;
  /** Why what's being drawn or picked keeps the sketch from finishing, if it does. */
  pendingFinishReason: string | null;
  /** Applies what's still being typed or previewed; returns why it couldn't be applied, if it couldn't. */
  applyPendingValues: () => string | null | undefined | false;
  lineContinuation: boolean;
  setPending: (pending: Point[]) => void;
  setFinishError: (error: string | null) => void;
  setMessage: (message: string) => void;
  requestSketchCheck: () => void;
  restoreCanvasKeyboard: () => void;
  publish: (next: CadDocument) => void;
  commit: (next: CadDocument) => void;
  userRollback: string | null;
}

/**
 * How the CAD editor hands its design back: preparing it (applying what's still being typed, or saying why it can't
 * finish yet), finishing it to the host, cancelling back to the design as it opened, and the host's controller.
 */
export function useEditorAcceptance({
  controller,
  session,
  docId,
  documentRef,
  callbacks,
  busy,
  setBusy,
  solving,
  finishing,
  preparingDimension,
  thicknessValid,
  pendingFinishReason,
  applyPendingValues,
  lineContinuation,
  setPending,
  setFinishError,
  setMessage,
  requestSketchCheck,
  restoreCanvasKeyboard,
  publish,
  commit,
  userRollback,
}: EditorAcceptanceInput) {
  const prepareDocument = (): CadDocument | null => {
    const blocked = (reason: string) => {
      setFinishError(reason);
      setMessage(reason);
      callbacks.current.onFinishBlocked?.(reason);
      return null;
    };
    if (busy || solving || finishing.current || preparingDimension.current) return blocked('Wait for the current sketch check to finish.');
    const reason = !thicknessValid ? 'Enter a valid part thickness before finishing the sketch.' : pendingFinishReason;
    if (reason) {
      return blocked(reason);
    }
    try {
      const error = applyPendingValues();
      if (error) return blocked(error);
    } catch (error) {
      return blocked(error instanceof Error ? error.message : String(error));
    }
    if (lineContinuation) setPending([]);
    return documentRef.current;
  };
  const finish = async (): Promise<boolean> => {
    const prepared = prepareDocument();
    if (!prepared) return false;
    finishing.current = true;
    setFinishError(null);
    setBusy(true);
    try {
      await callbacks.current.onFinish(prepared);
      acceptCadSession(session, prepared);
      return true;
    } catch (error) {
      setFinishError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      finishing.current = false;
      setBusy(false);
      // Acceptance owns normalization while it runs. Resume ordinary draft checks
      // if the editor stays mounted after a blocked acceptance or a host callback.
      requestSketchCheck();
      // Going inert dropped keyboard focus, and the editor can stay mounted, so shortcuts need it back.
      restoreCanvasKeyboard();
    }
  };
  useImperativeHandle(controller, () => ({
    finish,
    prepareDocument,
    rolledTo: () => userRollback,
    updateSettings: settings => {
      const prepared = settings.lengthUnit === documentRef.current.lengthUnit ? documentRef.current : prepareDocument();
      if (!prepared) return false;
      commit({ ...withCadLengthUnit(prepared, settings.lengthUnit ?? 'mm'), name: settings.name });
      return true;
    },
  }));
  const cancel = async () => {
    setBusy(true);
    try {
      publish(restoreCadSession(session, { document: session.entry, past: [], future: [] }));
      await callbacks.current.onCancel();
      endCadSession(docId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return { prepareDocument, finish, cancel };
}
