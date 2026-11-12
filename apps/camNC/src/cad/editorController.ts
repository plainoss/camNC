import type { CadDocument } from '@wbcnc/cad';

export interface CadEditorController {
  /** Commit valid open value fields to the draft without accepting it or navigating. */
  prepareDocument: () => CadDocument | null;
  /** The step the rollback bar was moved to sit after, which the view stops at; null at the end. */
  rolledTo: () => string | null;
  updateSettings: (settings: Pick<CadDocument, 'name' | 'lengthUnit'>) => boolean;
  /** Use the same validation and accepted-session boundary as the Finish button. */
  finish: () => Promise<boolean>;
}
