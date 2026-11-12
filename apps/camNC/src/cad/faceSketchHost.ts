import { addCopyFaceSketch, addFaceSketch, cadFaceSketches, type CadDocument, type CadPart, type CadFaceRef } from '@wbcnc/cad';
import { hasOutline } from './editorHelpers';
import { faceSketchScene, partViewSnapshot, type FaceSketchScene, type PartViewSnapshot } from './faceSketchScene';
import type { StudioCameraRef } from './studioCamera';
import { assemblyModel } from './assemblyModel';
import { physicalCopyMirrored } from './studioGeometryReaders';
import { partCameraFromAssembly } from './partAssemblyCamera';

/** All routed face-editor entry points must transfer the visible camera, including editing an existing sketch. */
export function faceSketchHost(context: {
  part?: CadPart;
  copyId?: string;
  prepare: () => CadDocument | null | undefined;
  commit: (document: CadDocument) => void;
  read: () => CadDocument;
  onEdit?: (document: CadDocument, partId: string, sketchId: string, scene?: FaceSketchScene, fromStudio?: boolean) => void;
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
    const local = placement ? partCameraFromAssembly(camera, placement, physicalCopyMirrored(document, partId, copyId)) : camera;
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
      context.onEdit(
        context.read(),
        id,
        added.sketchId,
        carried && faceSketchScene(prepared, id, face, carried, copyId),
        context.workspace
      );
    },
    /** Opens a face sketch to edit, from the studio's feature list or view (`fromStudio`), or from the part's own view. */
    edit(partId: string, sketchId: string, fromStudio = context.workspace) {
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
        face && carried ? faceSketchScene(prepared, partId, face.on, carried, face.copyId) : undefined,
        fromStudio
      );
    },
  };
}
