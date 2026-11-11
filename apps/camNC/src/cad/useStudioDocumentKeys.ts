import { useEffect, type RefObject } from 'react';

/** The editor that most recently claimed the keys focus left on the page; earlier ones wait until it unmounts. */
const owners: HTMLElement[] = [];
/** Keys this hook forwarded, so the document listener never forwards its own copy again. */
const forwarded = new WeakSet<Event>();

/**
 * Open menus, lists and modal dialogs own the keyboard even once focus has slipped to the page, wherever they
 * are drawn. So does a popover or dialog portaled outside the editor; the editor's own feature dialogs don't, as
 * keys pressed in them reach its shortcuts too. An editor that a modal has hidden is not the active view.
 */
function keyboardTaken(root: HTMLElement) {
  if (root.closest('[inert], [aria-hidden="true"]')) return true;
  const open = root.ownerDocument.querySelectorAll<HTMLElement>(
    '[role="menu"], [role="listbox"], [aria-modal="true"], [role="alertdialog"], dialog:modal, [role="dialog"]'
  );
  // A hidden one, such as a closed panel kept mounted, takes nothing.
  return [...open].some(
    element =>
      element.checkVisibility() &&
      (element.getAttribute('role') !== 'dialog' || element.matches('[aria-modal="true"]') || !root.contains(element))
  );
}

/**
 * Hands the editor the keys pressed while focus is on the page itself rather than any element.
 *
 * The editor's own handlers listen on its root, so they only hear keys while focus is inside it. Focus falls
 * to the page on load, and again whenever the focused control unmounts (a dialog's OK, a review's Apply, a
 * toolbar button that disables itself). Only keys whose target is the page are forwarded: a key from a field,
 * a menu, a dialog or any other control has an owner, and a key from inside the editor was already handled.
 */
export function useStudioDocumentKeys(root: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const element = root.current;
    if (!enabled || !element) return;
    const document = element.ownerDocument;
    owners.push(element);
    const keyDown = (event: KeyboardEvent) => {
      if (forwarded.has(event) || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.target !== document.body && event.target !== document.documentElement) return;
      if (owners.at(-1) !== element || !element.isConnected || keyboardTaken(element)) return;
      const copy = new KeyboardEvent('keydown', {
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
      forwarded.add(copy);
      element.dispatchEvent(copy);
      // The editor stops every key it hears from reaching the page's own shortcuts; the original must not either.
      event.stopPropagation();
      if (copy.defaultPrevented) event.preventDefault();
    };
    document.addEventListener('keydown', keyDown);
    return () => {
      document.removeEventListener('keydown', keyDown);
      owners.splice(owners.lastIndexOf(element), 1);
    };
  }, [root, enabled]);
}
