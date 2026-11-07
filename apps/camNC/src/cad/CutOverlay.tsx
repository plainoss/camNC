import type { CadPart } from '@wbcnc/cad';
import { useId, useMemo } from 'react';
import { cutRegionPath, cutRegions } from './cutRegions';

/** Shows each cut on the drawing, darker as it gets deeper. Parts without features draw nothing here. */
export function CutOverlay({ part, millimetresPerPixel: scale }: { part: CadPart | undefined; millimetresPerPixel: number }) {
  const hatch = useId();
  const entries = useMemo(() => (part?.features?.length ? cutRegions(part) : []), [part]);
  if (!part || !entries.length) return null;
  return (
    <g data-cut-regions={part.id} pointerEvents="none" aria-hidden="true">
      <defs>
        <pattern id={hatch} width={8 * scale} height={8 * scale} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={8 * scale} stroke="#7a5526" strokeWidth={1.2 * scale} />
        </pattern>
      </defs>
      {entries.map(({ region, cut, inProfile }) => {
        const depth = cut?.depth ?? (inProfile ? 'through' : 0),
          center = region.points.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y }), { x: 0, y: 0 }),
          count = region.points.length;
        return (
          <g key={region.id} data-cut-region={region.id} data-cut-depth={depth}>
            <path
              d={cutRegionPath(region)}
              fillRule="evenodd"
              fill={depth === 'through' ? `url(#${hatch})` : depth === 0 ? 'none' : '#c99a5b'}
              fillOpacity={depth === 'through' || depth === 0 ? undefined : Math.min(0.95, 0.25 + 0.75 * (depth / part.thickness))}
              stroke={depth === 0 ? '#7f8c96' : '#7a5526'}
              strokeWidth={scale}
              strokeDasharray={depth === 0 ? `${4 * scale} ${3 * scale}` : undefined}
            />
            {cut && depth !== 'through' && depth !== 0 && (
              <text
                x={center.x / count}
                y={-center.y / count + 14 * scale}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={12 * scale}
                fill="#2a2015">
                {depth}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
