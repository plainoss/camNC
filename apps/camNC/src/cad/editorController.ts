import type { CadDocument } from '@wbcnc/cad';

export interface CadEditorController {
  /** Commit valid open value fields to the draft without accepting it or navigating. */
  prepareDocument: () => CadDocument | null;
  updateSettings: (settings: Pick<CadDocument, 'name' | 'lengthUnit'>) => boolean;
  /** Use the same validation and accepted-session boundary as the Finish button. */
  finish: () => Promise<boolean>;
}
