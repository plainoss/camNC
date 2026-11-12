import { useState } from 'react';

/** Open state and the section shown, for the button that opens the dialog and the links that jump into it. */
export function useAssistantSettings(initial = 'connection') {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState(initial);
  return {
    open,
    section,
    setSection,
    show: (id?: string) => {
      if (id) setSection(id);
      setOpen(true);
    },
    close: () => setOpen(false),
  };
}
