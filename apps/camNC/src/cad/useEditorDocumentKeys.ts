import { useEffect, type RefObject } from 'react';

/** The editor that most recently claimed the keys focus left on the page; earlier ones wait until it unmounts. */
const owners: HTMLElement[] = [];
/** Keys this hook forwarded, so the document listener never forwards its own copy again. */
const forwarded = new WeakSet<Event>();

/**
 * Open menus, lists, popovers and modal dialogs own the keyboard even once focus has slipped to the page,
 * wherever they are drawn. A non-modal panel such as a tour card doesn't. An editor that a modal has hidden is
 * not the active view.
 */
function keyboardTaken(root: HTMLElement) {
  if (root.closest('[inert], [aria-hidden="true"]')) return true;
  const open = root.ownerDocument.querySelectorAll<HTMLElement>(
    '[role="menu"], [role="listbox"], [aria-modal="true"], [role="alertdialog"], dialog[open], :popover-open'
  );
  // A hidden one, such as a closed panel kept mounted, takes nothing.
  return [...open].some(element => element.checkVisibility({ visibilityProperty: true }));
}

/** A visible step dialog's frame, if one is open. */
const openFeatureDialog = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('.cad-feature-dialog')].filter(dialog => dialog.checkVisibility()).at(-1);

/**
 * Where a key pressed inside the editor would most likely have landed: an open step dialog, then the 3D view,
 * then the editor itself. Their own handlers (a dialog's Escape, the view's Escape while choosing) see it first.
 */
function keyTarget(root: HTMLElement) {
  return openFeatureDialog(root) ?? root.querySelector<HTMLElement>('[data-testid="workspace-3d"]:not([inert], [inert] *)') ?? root;
}

/** Copies a key event, to hand on to where it belongs. */
const copyOf = (event: KeyboardEvent) =>
  new KeyboardEvent('keydown', {
    key: event.key,
    code: event.code,
    location: event.location,
    repeat: event.repeat,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    keyCode: event.keyCode,
    bubbles: true,
    cancelable: true,
    composed: true,
  });

/**
 * Hands the editor the keys pressed while focus is on the page itself rather than any element.
 *
 * The editor's own handlers listen on its root, so they only hear keys while focus is inside it. Focus falls
 * to the page on load, and again whenever the focused control unmounts (a dialog's OK, a review's Apply, a
 * toolbar button that disables itself). Only keys whose target is the page are forwarded: a key from a field,
 * a menu, a dialog or any other control has an owner, and a key from inside the editor was already handled.
 *
 * Escape also goes to an open Mirror, Pattern or Transform dialog from anywhere else in the studio, such as a part
 * just picked for it in the Parts list or the 3D view, as it would from inside the dialog. A field, a menu, a modal or
 * an open sketch keeps its own Escape, and any other Escape passes on untouched.
 */
export function useEditorDocumentKeys(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const document = element.ownerDocument;
    owners.push(element);
    const keyDown = (event: KeyboardEvent) => {
      if (forwarded.has(event) || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.target !== document.body && event.target !== document.documentElement) return;
      if (owners.at(-1) !== element || !element.isConnected || keyboardTaken(element)) return;
      const copy = copyOf(event);
      forwarded.add(copy);
      keyTarget(element).dispatchEvent(copy);
      // A key the editor took stays with it, as it would inside; one it ignored, such as the sidebar's toggle,
      // still reaches the page's own shortcuts.
      if (copy.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || forwarded.has(event) || event.defaultPrevented || event.isComposing) return;
      const target = event.target as HTMLElement;
      const dialog = openFeatureDialog(element);
      // Only a Part Studio step that takes its part from clicks outside it, such as Mirror, Pattern or Transform. An
      // open sketch's dialog is not one: Escape on the drawing cancels a tool or clears the selection, not the sketch.
      if (!dialog?.querySelector('[data-part-pick]') || dialog.contains(target) || keyboardTaken(element)) return;
      if (element.querySelector('[data-testid="cad-canvas"]')?.checkVisibility()) return;
      // Escape in a field, such as a part's new name, or in a menu or list, is that control's own.
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"], [role="dialog"]')) return;
      const copy = copyOf(event);
      forwarded.add(copy);
      dialog.dispatchEvent(copy);
      // The dialog took it: the editor doesn't also act on it, as it wouldn't with focus inside the dialog.
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('keydown', keyDown);
    element.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', keyDown);
      element.removeEventListener('keydown', escape);
      owners.splice(owners.lastIndexOf(element), 1);
    };
  }, [root]);
}
