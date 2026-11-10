import type { PartEdge } from './partEdges';
import { partVertices } from './partVertices';

/** Vertices follow edges in paint order so a corner can be picked without selecting its incident edge. */
export function PartReferenceGeometry({ edges, picked, pixelScale }: { edges: PartEdge[]; picked: string[]; pixelScale: number }) {
  return (
    <g className="cad-part-edges" aria-label="Edges and vertices of the parts behind the sketch">
      {edges.map(edge => (
        <line
          key={edge.key}
          data-part-edge={edge.key}
          className={picked.includes(edge.key) ? 'cad-part-edge is-picked' : 'cad-part-edge'}
          x1={edge.x1}
          y1={-edge.y1}
          x2={edge.x2}
          y2={-edge.y2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {partVertices(edges).map(vertex => (
        <circle
          key={vertex.key}
          data-part-edge={vertex.key}
          data-part-vertex={vertex.key}
          className={picked.includes(vertex.key) ? 'cad-part-vertex is-picked' : 'cad-part-vertex'}
          cx={vertex.x}
          cy={-vertex.y}
          r={6 / pixelScale}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}
