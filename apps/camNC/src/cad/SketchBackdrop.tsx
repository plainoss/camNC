import type { CadDocument } from '@wbcnc/cad';
import { useMemo } from 'react';
import { ModelViewport, type SketchView } from '@/cam/model/ModelViewport';
import { assemblyModel } from './assemblyModel';

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
}: {
  /** The design as it was before this sketch's part. */
  document: CadDocument;
  view: SketchView;
  hiddenIds?: ReadonlySet<string>;
}) {
  const model = useMemo(() => assemblyModel(document, hiddenIds), [document, hiddenIds]);
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
      />
    </div>
  );
}
