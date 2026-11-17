import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A blue information line at the top of the view, with a cross to close it: news about a step that stays valid, such
 * as an Add that changes nothing. A new message shows again after closing an earlier one.
 */
export function ViewInfoBanner({ message }: { message: string | null }) {
  const [closed, setClosed] = useState<string | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(window.document.querySelector<HTMLElement>('.cad-editor main.cad-drawing')), []);
  if (!message || closed === message || !host) return null;
  return createPortal(
    <p className="cad-notice cad-view-info" role="status">
      <span className="cad-view-info-icon" aria-hidden="true">
        i
      </span>
      {message}
      <button type="button" aria-label="Close message" onClick={() => setClosed(message)}>
        ×
      </button>
    </p>,
    host
  );
}
