import { useDesignUnits } from './designUnits';
import { useState } from 'react';
import {
  cadCuts,
  cadFaceSketches,
  cadSketchRegions,
  evaluateCadFeatures,
  evaluateCadPart,
  type CadCut,
  type CadFaceSketch,
  type CadPart,
  type CadValueScope,
} from '@wbcnc/cad';

const faceName = (face: CadFaceSketch) => (face.on === 'top' ? 'Top face' : face.on === 'underside' ? 'Underside' : 'Pocket floor');

function CutDepthInput({
  label,
  depth,
  expression,
  variables,
  onChange,
}: {
  label: string;
  depth: number;
  expression?: string;
  variables?: CadValueScope;
  onChange: (depth: number, expression?: string) => void;
}) {
  const { parseCadValue, lengthText, lengthUnit } = useDesignUnits();
  const typed = expression ?? lengthText(depth);
  const [text, setText] = useState(typed);
  const apply = () => {
    const parsed = parseCadValue(text, { unit: 'mm', variables });
    if ('value' in parsed && parsed.value > 0 && (parsed.value !== depth || parsed.expression !== expression))
      onChange(parsed.value, parsed.expression);
    else setText(typed);
  };
  return (
    <small className="cad-muted">
      <input
        className="cad-cut-depth"
        aria-label={label}
        spellCheck={false}
        value={text}
        onChange={event => setText(event.target.value)}
        onBlur={apply}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Enter') apply();
        }}
      />{' '}
      {lengthUnit}
    </small>
  );
}

/** The part's sketches and cuts, where a cut that lost its region can be seen and removed. */
export function PartFeatureList({
  part,
  onRemove,
  onSwitchCut,
  onMoveToTop,
  onCutDepth,
  variables,
  onEdit,
  onNew,
}: {
  part: CadPart;
  onRemove: (featureId: string) => void;
  onSwitchCut?: (cutId: string, on: boolean) => void;
  onMoveToTop?: (sketchId: string) => void;
  /** A cut's region can end up covered by a sketch on its floor, so its depth can be set from here too. */
  onCutDepth?: (cut: CadCut, depth: number, expression?: string) => void;
  /** Design variables a typed depth may use. */
  variables?: CadValueScope;
  onEdit?: (sketchId: string) => void;
  onNew?: (face: 'top' | 'underside') => void;
}) {
  const { formatLength, lengthUnit } = useDesignUnits();
  const faces = cadFaceSketches(part),
    profile = evaluateCadPart(part).part,
    outline = profile?.outline,
    regionIds = new Set(
      [part.sketch.id, ...faces.map(face => face.sketch.id)].flatMap(id => cadSketchRegions(part, id, outline).map(r => r.id))
    );
  const made = new Set(profile ? (evaluateCadFeatures(part, profile).part.cuts ?? []).map(cut => cut.id) : []),
    isLost = (face: CadFaceSketch) => typeof face.on === 'object' && !made.has(face.on.floorOf);
  return (
    <div className="cad-feature-list">
      <h3>Sketches and cuts</h3>
      {!!outline && !cadCuts(part).length && <small className="cad-muted">Click a closed region on the part to set its depth.</small>}
      <ul>
        {faces.map((face, i) => (
          <li key={face.id}>
            <span>
              Sketch {i + 1} <small className="cad-muted">{isLost(face) ? 'Floor lost' : faceName(face)}</small>
            </span>
            {onMoveToTop && isLost(face) && (
              <button type="button" onClick={() => onMoveToTop(face.sketch.id)}>
                Move to top
              </button>
            )}
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
            {onSwitchCut && (
              <input
                type="checkbox"
                aria-label={`Cut ${i + 1} on`}
                checked={!cut.suppressed}
                onChange={event => onSwitchCut(cut.id, event.target.checked)}
              />
            )}
            <span className={cut.suppressed ? 'cad-muted' : undefined}>
              Cut {i + 1}{' '}
              {onCutDepth && regionIds.has(cut.regionId) && typeof cut.depth === 'number' && cut.depth > 0 ? (
                <CutDepthInput
                  key={`${cut.id}:${cut.depth}:${cut.depthExpression}`}
                  label={`Cut ${i + 1} depth`}
                  depth={cut.depth}
                  expression={cut.depthExpression}
                  variables={variables}
                  onChange={(depth, expression) => onCutDepth(cut, depth, expression)}
                />
              ) : (
                <small className="cad-muted">
                  {!regionIds.has(cut.regionId)
                    ? 'Region lost'
                    : cut.depth === 'through'
                      ? 'Through'
                      : cut.depth === 0
                        ? 'No cut'
                        : `${formatLength(cut.depth)} ${lengthUnit}`}
                </small>
              )}
            </span>
            <button type="button" aria-label={`Remove cut ${i + 1}`} onClick={() => onRemove(cut.id)}>
              ×
            </button>
          </li>
        ))}
      </ul>
      {onNew && (
        <>
          <button type="button" disabled={!outline} onClick={() => onNew('top')}>
            New sketch on top
          </button>
          <button type="button" disabled={!outline} onClick={() => onNew('underside')}>
            New sketch on underside
          </button>
        </>
      )}
      {(onNew || onEdit) && !outline && <small className="cad-muted">Close the outline before sketching on a face.</small>}
    </div>
  );
}
