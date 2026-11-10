import type { CadDocument, CadPoint } from '@wbcnc/cad';
import type { Ref } from 'react';
import type { FaceSketchScene } from './faceSketchScene';
import type { StudioCameraRef } from './studioCamera';

export interface CadEditorController {
  /** Commit valid open value fields to the draft without accepting it or navigating. */
  prepareDocument: () => CadDocument | null;
  /** Use the same validation and accepted-session boundary as the Finish button. */
  finish: () => Promise<boolean>;
}

export interface CadEditorProps {
  document: CadDocument;
  onDraftChange: (document: CadDocument) => void;
  onFinish: (document: CadDocument) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  onFinishBlocked?: (reason: string) => void;
  saveStatus?: string;
  notice?: string | null;
  preferredPartId?: string;
  controller?: Ref<CadEditorController>;
  /** Hosts that can open a face sketch offer drawing on the part's top face. */
  onEditFaceSketch?: (document: CadDocument, partId: string, sketchId: string, scene?: FaceSketchScene) => void;
  partCameraState?: StudioCameraRef;
  /** Editing one face sketch, with the part's outline shown behind it. It can be open, and it isn't a profile. */
  faceSketch?: { outline: CadPoint[]; floor?: CadPoint[]; label: string; below?: boolean; scene?: FaceSketchScene };
  /** Open in 3D, when there's an outline to show: the whole design, or with `'part'` the selected part on its own. */
  startIn3D?: boolean | 'part';
}
