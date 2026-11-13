import { sketchRegions, type CadDocument, type CadPoint } from '@wbcnc/cad';
import { useMemo } from 'react';

/** Closed CAD faces remain visible while unrelated geometry is open or unsuitable for machining, one shape per region. */
function closedRegionPaths(document: CadDocument, partId: string | undefined): { id: string; path: string }[] {
  const part = document.parts.find(candidate => candidate.id === partId);
  if (!part) return [];
  const loop = (points: CadPoint[]) => points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ') + ' Z';
  return sketchRegions(part.sketch).map(region => ({ id: region.id, path: loop(region.points) }));
}

export function SketchRegion({ document, partId, verified }: { document: CadDocument; partId: string | undefined; verified: boolean }) {
  const paths = useMemo(() => (verified ? closedRegionPaths(document, partId) : []), [document, partId, verified]);
  return paths.map(({ id, path }) => (
    <path
      key={id}
      data-sketch-region={partId}
      className="cad-sketch-region"
      d={path}
      fillRule="nonzero"
      pointerEvents="none"
      aria-hidden="true"
    />
  ));
}
