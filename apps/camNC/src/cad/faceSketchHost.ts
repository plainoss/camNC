import {
  addCopyFaceSketch,
  addFaceSketch,
  cadFaceSketches,
  rotateVector,
  type CadDocument,
  type CadPart,
  type CadFaceRef,
} from '@wbcnc/cad';
import { hasOutline } from './editorHelpers';
import { faceSketchScene, partViewSnapshot, type FaceSketchScene, type PartViewSnapshot } from './faceSketchScene';
import type { StudioCameraRef } from './studioCamera';
import { assemblyModel } from './assemblyModel';

/** All routed face-editor entry points must transfer the visible camera, including editing an existing sketch. */
export function faceSketchHost(context: {
  part?: CadPart;
  copyId?: string;
  prepare: () => CadDocument | null | undefined;
  commit: (document: CadDocument) => void;
  read: () => CadDocument;
  onEdit?: (document: CadDocument, partId: string, sketchId: string, scene?: FaceSketchScene) => void;
  root: { current: HTMLElement | null };
  partCamera: StudioCameraRef;
  studioCamera: StudioCameraRef;
  workspace: boolean;
  partView: boolean;
}) {
  const snapshot = (document: CadDocument, partId: string, copyId?: string): PartViewSnapshot | undefined => {
    if (!context.workspace) return partViewSnapshot(context.partCamera, context.root.current, context.partView);
    const camera = context.studioCamera.current;
    const bounds = context.root.current?.querySelector('[data-testid="workspace-3d"] canvas')?.getBoundingClientRect();
    if (!camera || !bounds?.height) return;
    // Include the visible row placement of parts not yet attached to an assembly plane.
    const placement = assemblyModel(document).placements.get(copyId ? `${partId}/${copyId}` : partId);
    const inverse =
      placement &&
      ([-placement.rotation[0], -placement.rotation[1], -placement.rotation[2], placement.rotation[3]] as [number, number, number, number]);
    const local =
      placement && inverse
        ? {
            ...camera,
            center: rotateVector(
              inverse,
              camera.center.map((value, axis) => value - placement.position[axis]!) as [number, number, number]
            ),
            back: rotateVector(inverse, camera.back),
            up: rotateVector(inverse, camera.up),
          }
        : camera;
    context.partCamera.current = { ...local, key: partId, seq: undefined };
    return { cameraState: context.partCamera, aspect: bounds.width / bounds.height };
  };
  return {
    create(face: CadFaceRef, given?: PartViewSnapshot, target?: { partId: string; copyId?: string }) {
      if ((!context.part && !target) || !context.onEdit) return;
      // Validate before adding a feature: refusal must not leave an empty face sketch behind.
      const prepared = context.prepare(),
        id = target?.partId ?? context.part!.id;
      const copyId = target?.copyId ?? context.copyId;
      if (!prepared || !hasOutline(prepared, id)) return;
      const carried = given ?? snapshot(prepared, id, copyId);
      const added = copyId ? addCopyFaceSketch(prepared, id, copyId, face) : addFaceSketch(prepared, id, face);
      context.commit(added.document);
      context.onEdit(context.read(), id, added.sketchId, carried && faceSketchScene(prepared, id, face, carried, copyId));
    },
    edit(partId: string, sketchId: string) {
      if (!context.onEdit) return;
      const prepared = context.prepare();
      if (!prepared || !hasOutline(prepared, partId)) return;
      const part = prepared.parts.find(part => part.id === partId)!;
      const face = cadFaceSketches(part).find(face => face.sketch.id === sketchId);
      const carried = snapshot(prepared, partId, face?.copyId);
      context.onEdit(
        prepared,
        partId,
        sketchId,
        face && carried ? faceSketchScene(prepared, partId, face.on, carried, face.copyId) : undefined
      );
    },
  };
}
