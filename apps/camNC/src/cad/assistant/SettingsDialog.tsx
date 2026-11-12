import { useEffect, useRef, type ReactNode } from 'react';
import './settingsDialog.css';

export interface AssistantSettingsSection {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * Everything about an assistant that isn't the conversation itself: connection, usage and limits, and per-assistant
 * extras. One modal with a section list, so the assistant panels keep only what is used while working.
 */
export function AssistantSettingsDialog({
  open,
  section,
  sections,
  onSection,
  onClose,
}: {
  open: boolean;
  section: string;
  sections: AssistantSettingsSection[];
  onSection: (id: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      // Opened from a link to one section: start in that section's form, not on the close button.
      element.querySelector<HTMLElement>('section:not([hidden]) :is(input, select, textarea)')?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);
  const current = sections.find(item => item.id === section) ?? sections[0]!;
  return (
    <dialog
      ref={dialog}
      className="assistant-settings"
      aria-label="Assistant settings"
      onClose={onClose}
      // Keys typed here are the dialog's own, never editor shortcuts.
      onKeyDown={event => event.stopPropagation()}>
      <header>
        <h2>Assistant settings</h2>
        <button type="button" aria-label="Close settings" onClick={() => dialog.current?.close()}>
          ✕
        </button>
      </header>
      <div className="assistant-settings-body">
        <nav aria-label="Settings sections">
          {sections.map(item => (
            <button key={item.id} type="button" aria-current={item.id === current.id || undefined} onClick={() => onSection(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        {/* Every section stays mounted, so a key typed but not yet saved survives a section switch or closing. */}
        {sections.map(item => (
          <section key={item.id} aria-label={item.label} hidden={item.id !== current.id}>
            {item.content}
          </section>
        ))}
      </div>
    </dialog>
  );
}
