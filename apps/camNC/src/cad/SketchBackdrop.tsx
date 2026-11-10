import type { CadDocument } from '@wbcnc/cad';
import { useEffect, useMemo } from 'react';
import { ModelViewport, type SketchView, type ViewPlane } from '@/cam/model/ModelViewport';
import { assemblyModel } from './assemblyModel';
import { partEdgesOnPlane, type PartEdge } from './partEdges';

const always = () => true;
const nothing = () => {};

/**
 * The design's parts behind an open sketch, seen straight at the sketch's plane as its drawing is, so what's drawn sits
 * among the parts already there, as in the reference's normal view.
 */
export default function SketchBackdrop({
  document,
  view,
  hiddenIds,
  onEdges,
  planes,
}: {
  /** The design as it was before this sketch's part. */
  document: CadDocument;
  view: SketchView;
  hiddenIds?: ReadonlySet<string>;
  /** The parts' edges as the sketch's plane sees them, for it to use or snap to. */
  onEdges?: (edges: PartEdge[]) => void;
  planes?: ViewPlane[];
}) {
  const model = useMemo(() => assemblyModel(document, hiddenIds), [document, hiddenIds]);
  // Only where the plane is matters to the edges, not what part of it is in view.
  const plane = JSON.stringify([view.origin, view.x, view.y, view.normal]);
  useEffect(() => {
    const [origin, x, y, normal] = JSON.parse(plane) as [SketchView['origin'], SketchView['x'], SketchView['y'], SketchView['normal']];
    onEdges?.(partEdgesOnPlane(model.meshes, { origin, x, y, normal }, model.instances));
  }, [model, plane, onEdges]);
  return (
    <div className="cad-sketch-backdrop" aria-hidden="true">
      <ModelViewport
        meshes={model.meshes}
        parts={model.parts}
        view="assembled"
        selectedId={null}
        milled={always}
        onSelect={nothing}
        sketchView={view}
        palette="studio"
        display="edges"
        planes={planes}
      />
    </div>
  );
}
