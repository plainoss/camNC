import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { focusSketchCanvas } from './sketchViewport';

interface EditorKeyboardFocusInput {
  root: RefObject<HTMLDivElement | null>;
  svg: RefObject<SVGSVGElement | null>;
  busy: boolean;
  stepDialogOpen: boolean;
  studioSession: boolean;
  showWorkspace: boolean;
  show3D: boolean;
}

/**
 * Where the CAD editor's keyboard goes back to after something took it: the 3D view once a step's dialog closes
 * or a solve finishes, the field of a step's dialog last typed in, or the sketch canvas.
 */
export function useEditorKeyboardFocus({
  root,
  svg,
  busy,
  stepDialogOpen,
  studioSession,
  showWorkspace,
  show3D,
}: EditorKeyboardFocusInput) {
  // When a step's dialog closes, the view has the keyboard again, so its shortcuts work straight away.
  const dialogWasOpen = useRef(false);
  // A view still solving is inert: it takes the keyboard once it's done, unless something else has it by then.
  const viewWantsKeyboard = useRef(false);
  const focusViewIfIdle = useCallback(() => {
    const active = root.current?.ownerDocument.activeElement;
    if (!viewWantsKeyboard.current || (active && active !== root.current?.ownerDocument.body && active.isConnected)) {
      viewWantsKeyboard.current = false;
      return;
    }
    const view = root.current?.querySelector<HTMLElement>('[data-testid="workspace-3d"]');
    if (!view || view.closest('[inert]')) return;
    view.focus();
    viewWantsKeyboard.current = view.ownerDocument.activeElement !== view;
  }, [root]);
  useLayoutEffect(() => {
    const closed = dialogWasOpen.current && !stepDialogOpen;
    dialogWasOpen.current = stepDialogOpen;
    if (!closed || !studioSession || !showWorkspace) return;
    viewWantsKeyboard.current = true;
    // The dialog has left the DOM. A background page may not receive another animation frame.
    focusViewIfIdle();
  }, [stepDialogOpen, studioSession, showWorkspace, focusViewIfIdle]);
  // A sketch opened from the studio takes the keyboard once its drawing shows, so its shortcuts work straight away.
  useEffect(() => {
    if (studioSession && !showWorkspace && !show3D) focusSketchCanvas(svg.current);
    // Only when the studio gives way to the drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWorkspace]);
  const deferredCanvasFocus = useRef<(() => void) | null>(null);
  // The field of a step's dialog last typed in: solving makes the view inert, which drops the keyboard, and it goes back.
  const dialogFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!busy) {
      const restore = deferredCanvasFocus.current;
      deferredCanvasFocus.current = null;
      restore?.();
      const field = dialogFocus.current;
      const active = field?.ownerDocument.activeElement;
      if (field?.isConnected && (!active || active === field.ownerDocument.body)) field.focus();
      else focusViewIfIdle();
    }
  }, [busy, focusViewIfIdle]);
  const restoreCanvasKeyboard = () => {
    const restore = () => {
      const canvas = svg.current,
        active = canvas?.ownerDocument.activeElement;
      // Solves finish before React removes workspace inertness. Focus only after
      // that DOM commit, even when background animation frames are suspended.
      if (canvas?.closest('[inert]')) {
        deferredCanvasFocus.current = restore;
        return;
      }
      deferredCanvasFocus.current = null;
      if (canvas && (!active || active === canvas.ownerDocument.body || canvas.contains(active))) canvas.focus();
    };
    // Keyboard ownership must not wait for a frame in a background tab. Recheck
    // after rendering as well, when a dismissed control may have lost focus.
    restore();
    requestAnimationFrame(restore);
  };
  return { viewWantsKeyboard, focusViewIfIdle, dialogFocus, restoreCanvasKeyboard };
}
