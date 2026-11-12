import type { CadDocument, CadPoint } from '@wbcnc/cad';
import type { Ref } from 'react';
import type { FaceSketchScene } from './faceSketchScene';
import type { StudioCameraRef } from './studioCamera';
import type { CadSession } from '@wbcnc/cad-editor/session';
import type { CadEditorController } from './editorController';
export type { CadEditorController } from './editorController';

export interface CadEditorProps {
  document: CadDocument;
  /** Join the route session without acknowledging a remount as a durable save. */
  editSession?: CadSession;
  onDraftChange: (document: CadDocument) => void;
  onFinish: (document: CadDocument) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  onFinishBlocked?: (reason: string) => void;
  saveStatus?: string;
  notice?: string | null;
  preferredPartId?: string;
  controller?: Ref<CadEditorController>;
  /**
   * Hosts that can open a face sketch offer drawing on the part's top face. `fromStudio` says it was opened from the Part
   * Studio, which finishing it goes back to, rather than from the part's own view.
   */
  onEditFaceSketch?: (document: CadDocument, partId: string, sketchId: string, scene?: FaceSketchScene, fromStudio?: boolean) => void;
  partCameraState?: StudioCameraRef;
  /** Editing one face sketch, with the part's outline shown behind it. It can be open, and it isn't a profile. */
  faceSketch?: { outline: CadPoint[]; floor?: CadPoint[]; label: string; below?: boolean; scene?: FaceSketchScene };
  /** Open in 3D, when there's an outline to show: the whole design, or with `'part'` the selected part on its own. */
  startIn3D?: boolean | 'part';
  /** The step the Part Studio's feature list opens with selected, such as a face sketch just finished. */
  selectedStepId?: string;
}
