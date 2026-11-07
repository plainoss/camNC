import { cadCuts, cadFaceSketches, cadSketchRegions, evaluateCadPart, type CadFaceSketch, type CadPart } from '@wbcnc/cad';

const faceName = (face: CadFaceSketch) => (face.on === 'top' ? 'Top face' : face.on === 'underside' ? 'Underside' : 'Pocket floor');

/** The part's sketches and cuts, where a cut that lost its region can be seen and removed. */
export function PartFeatureList({
  part,
  onRemove,
  onEdit,
  onNew,
}: {
  part: CadPart;
  onRemove: (featureId: string) => void;
  onEdit?: (sketchId: string) => void;
  onNew?: () => void;
}) {
  const faces = cadFaceSketches(part),
    outline = evaluateCadPart(part).part?.outline,
    regionIds = new Set(
      [part.sketch.id, ...faces.map(face => face.sketch.id)].flatMap(id => cadSketchRegions(part, id, outline).map(r => r.id))
    );
  return (
    <div className="cad-feature-list">
      <h3>Sketches and cuts</h3>
      <ul>
        {faces.map((face, i) => (
          <li key={face.id}>
            <span>
              Sketch {i + 1} <small className="cad-muted">{faceName(face)}</small>
            </span>
            {onEdit && (
              <button type="button" disabled={!outline} onClick={() => onEdit(face.sketch.id)}>
                Edit
              </button>
            )}
            <button type="button" aria-label={`Remove sketch ${i + 1}`} onClick={() => onRemove(face.id)}>
              ×
            </button>
          </li>
        ))}
        {cadCuts(part).map((cut, i) => (
          <li key={cut.id}>
            <span>
              Cut {i + 1}{' '}
              <small className="cad-muted">
                {!regionIds.has(cut.regionId)
                  ? 'Region lost'
                  : cut.depth === 'through'
                    ? 'Through'
                    : cut.depth === 0
                      ? 'No cut'
                      : `${cut.depth} mm`}
              </small>
            </span>
            <button type="button" aria-label={`Remove cut ${i + 1}`} onClick={() => onRemove(cut.id)}>
              ×
            </button>
          </li>
        ))}
      </ul>
      {onNew && (
        <button type="button" disabled={!outline} onClick={onNew}>
          New sketch on top
        </button>
      )}
      {(onNew || onEdit) && !outline && <small className="cad-muted">Close the outline before sketching on a face.</small>}
    </div>
  );
}
