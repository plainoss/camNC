import { t } from '@wbcnc/i18n';
import type { ReactNode } from 'react';

/** Localized editor status, independent of the drawing/session state machine. */
export function CadStatus({
  error,
  studioWorkspace,
  solving,
  displayStatus,
  colorNotice,
  cancelled,
  busy,
  onRestore,
  hideInstruction,
  message,
  saveStatus,
}: {
  error: boolean;
  studioWorkspace: boolean;
  solving: boolean;
  displayStatus: string;
  colorNotice?: string;
  cancelled: boolean;
  busy: boolean;
  onRestore: () => void;
  hideInstruction: boolean;
  message: string;
  saveStatus?: ReactNode;
}) {
  return (
    <footer className="cad-status">
      <span className={error ? 'cad-error' : ''}>
        {studioWorkspace ? (
          solving ? (
            t('Checking sketch…')
          ) : (
            ''
          )
        ) : (
          <>
            {solving ? t('Checking sketch…') : displayStatus}
            {colorNotice && t(' · {{colorNotice}}', { colorNotice })}
          </>
        )}
      </span>
      {cancelled && (
        <span className="cad-restore-sketch" role="status">
          {t('Sketch cancelled.')}{' '}
          <button type="button" disabled={busy} onClick={onRestore}>
            {t('Restore ')}
          </button>
        </span>
      )}
      <span className="cad-instruction" role="status">
        {hideInstruction ? '' : message}
      </span>
      <span>{saveStatus ?? t('Draft')}</span>
    </footer>
  );
}
