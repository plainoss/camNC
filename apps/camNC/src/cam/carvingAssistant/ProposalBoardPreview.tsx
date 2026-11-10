import { placeItem } from '../carving';
import { carvingPath } from '../carvingView';
import type { CamJobV1 } from '../jobDb';
import type { CarvingProposal } from './proposal';

/** Only checked numeric polygons enter the live SVG; provider markup never does. */
export function ProposalBoardPreview({ job, proposal }: { job: CamJobV1; proposal: CarvingProposal }) {
  const size = job.boards?.[0]?.size;
  if (!size || size.fit) return null;
  const other = job.carving?.items.filter(item => proposal.mode !== 'replace' || item.id !== proposal.item.id) ?? [];
  return (
    <figure>
      <svg
        role="img"
        aria-label="Proposed artwork on the board"
        className="w-full rounded border"
        viewBox={`-2 -2 ${size.w + 4} ${size.h + 4}`}>
        <rect width={size.w} height={size.h} fill="#fde68a" stroke="#92400e" strokeWidth={0.5} />
        {other.map(item => (
          <path key={item.id} d={carvingPath(placeItem(item), size.h)} fill="#78350f" fillRule="nonzero" />
        ))}
        <path d={carvingPath(placeItem(proposal.item), size.h)} fill="#0369a1" fillRule="nonzero" />
      </svg>
      <figcaption className="text-xs">Board placement · proposed artwork in blue</figcaption>
    </figure>
  );
}
