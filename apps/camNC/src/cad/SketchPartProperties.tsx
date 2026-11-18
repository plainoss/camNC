import {
  moveFaceSketch,
  removeCadFeature,
  renamePartCopy,
  setCutDepth,
  setCutSuppressed,
  setPartPattern,
  withFeatureVersion,
  type CadDiagnostic,
  type CadDocument,
  type CadDrawnOn,
} from '@wbcnc/cad';
import type { RefObject } from 'react';
import type { DimensionMode, Tool } from './cadEditorShared';
import { CadCopyNames } from './CadCopyNames';
import { CadDrawnOnField } from './CadDrawnOnField';
import { CadPartPatternField } from './CadPartPatternField';
import { CadReliefField } from './CadReliefField';
import { CadThicknessField } from './CadThicknessField';
import { replacePart } from './editorHelpers';
import type { faceSketchHost } from './faceSketchHost';
import { PartFeatureList } from './PartFeatureList';
import type { useEditorVariableFields } from './useEditorVariableFields';

type CadPart = CadDocument['parts'][number];

/** The sketch editor's sidebar for the open part: its name, board values, features and the sketch's display options. */
export function SketchPartProperties({
  document: doc,
  documentRef,
  part,
  studio,
  commit,
  variables,
  variableProblems,
  focusCanvas,
  onThicknessValidity,
  pickDirection,
  setPartId,
  setSelected,
  chooseTool,
  faceEditor,
  showConstraints,
  onShowConstraints,
  showDimensionMode,
  dimensionMode,
  onDimensionMode,
  selected,
  tool,
  onEditConic,
}: {
  document: CadDocument;
  documentRef: RefObject<CadDocument>;
  part: CadPart;
  studio: boolean;
  commit: (next: CadDocument) => void;
  variables: ReturnType<typeof useEditorVariableFields>;
  variableProblems: readonly CadDiagnostic[];
  /** Hands the keyboard back to the drawing once a field is done. */
  focusCanvas: () => void;
  onThicknessValidity: (valid: boolean) => void;
  pickDirection: (picked: (on: CadDrawnOn['on'], datum?: string) => void) => void;
  setPartId: (id: string) => void;
  setSelected: (ids: string[]) => void;
  chooseTool: (tool: Tool) => void;
  /** Present when the host can edit a part's face sketches. */
  faceEditor: ReturnType<typeof faceSketchHost> | undefined;
  showConstraints: boolean;
  onShowConstraints: (shown: boolean) => void;
  showDimensionMode: boolean;
  dimensionMode: DimensionMode;
  onDimensionMode: (mode: DimensionMode) => void;
  selected: readonly string[];
  tool: Tool;
  onEditConic: (id: string, rho: number) => void;
}) {
  const sketch = part.sketch;
  return (
    <div className="cad-properties">
      <h3>{part.name} · Sketch</h3>
      <label htmlFor="cad-part-name">Part name</label>
      <input
        id="cad-part-name"
        key={`${part.id}:${part.name}`}
        defaultValue={part.name}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
            event.preventDefault();
            event.currentTarget.blur();
            focusCanvas();
          }
          if (event.key === 'Escape') {
            event.currentTarget.value = part.name;
            event.currentTarget.blur();
            focusCanvas();
          }
        }}
        onBlur={event => {
          const name = event.currentTarget.value.trim();
          if (name && name !== part.name) commit(replacePart(doc, part.id, p => ({ ...p, name })));
        }}
      />
      {!studio && (
        <>
          <CadThicknessField
            key={part.id}
            value={part.thickness}
            expression={part.thicknessExpression}
            variables={variables}
            onValidityChange={onThicknessValidity}
            onDone={focusCanvas}
            onCommit={(thickness, thicknessExpression) =>
              commit(
                replacePart(doc, part.id, p => {
                  const next = { ...p, thickness, thicknessExpression };
                  if (thicknessExpression === undefined) delete next.thicknessExpression;
                  return next;
                })
              )
            }
          />
          {part.drawnOn && (
            <CadDrawnOnField
              key={`${part.id}:drawn-on`}
              document={doc}
              part={part as typeof part & { drawnOn: NonNullable<typeof part.drawnOn> }}
              variables={variables}
              onDone={focusCanvas}
              onChange={drawnOn => commit(replacePart(documentRef.current, part.id, p => ({ ...p, drawnOn })))}
            />
          )}
          <CadReliefField
            key={`${part.id}:relief`}
            relief={part.cornerRelief}
            variables={variables}
            onDone={focusCanvas}
            onChange={cornerRelief =>
              commit(
                replacePart(documentRef.current, part.id, p => {
                  const next = { ...p, cornerRelief };
                  if (!cornerRelief) delete next.cornerRelief;
                  return next;
                })
              )
            }
          />
          <CadPartPatternField
            key={`${part.id}:pattern`}
            pattern={part.pattern}
            document={doc}
            pickDirection={pickDirection}
            variables={variables}
            onDone={focusCanvas}
            onChange={pattern => commit(setPartPattern(documentRef.current, part.id, pattern))}
          />
          <CadCopyNames part={part} onRename={(copyId, name) => commit(renamePartCopy(documentRef.current, part.id, copyId, name))} />
        </>
      )}
      {variableProblems
        .filter(problem => problem.partId === part.id)
        .map((problem, index) => (
          <p key={index} className="cad-variable-problem" role="alert">
            Can’t follow the variables, so this part keeps its last good shape. {problem.message}
          </p>
        ))}
      <button
        type="button"
        className="cad-delete-part"
        onClick={() => {
          const parts = doc.parts.filter(p => p.id !== part.id);
          commit(withFeatureVersion({ ...doc, parts }));
          setPartId(parts[0]?.id ?? '');
          setSelected([]);
          chooseTool('select');
        }}>
        Delete part
      </button>
      {(!!part.features?.length || (faceEditor && part.extrude !== false)) && (
        <PartFeatureList
          part={part}
          onRemove={featureId => commit(removeCadFeature(documentRef.current, part.id, featureId))}
          onSwitchCut={(cutId, on) => commit(setCutSuppressed(documentRef.current, part.id, cutId, !on))}
          onEdit={faceEditor && (sketchId => faceEditor.edit(part.id, sketchId))}
          variables={variables}
          onCutDepth={(cut, depth, expression) =>
            commit(setCutDepth(documentRef.current, part.id, cut.sketchId, cut.regionId, depth, expression))
          }
          onMoveToTop={sketchId => commit(moveFaceSketch(documentRef.current, part.id, sketchId, 'top'))}
          onNew={faceEditor && (face => faceEditor.create(face))}
        />
      )}
      <div className="cad-divider" />
      {!studio && (
        <label className="cad-show-constraints">
          <input type="checkbox" checked={showConstraints} onChange={event => onShowConstraints(event.target.checked)} />
          Show constraints
        </label>
      )}
      {showDimensionMode && (
        <>
          <label className="cad-dimension-mode" htmlFor="cad-dimension-mode">
            Dimension type
            <select id="cad-dimension-mode" value={dimensionMode} onChange={event => onDimensionMode(event.target.value as DimensionMode)}>
              <option value="auto">Automatic</option>
              <option value="distance">Length</option>
              <option value="distanceX">Horizontal distance</option>
              <option value="distanceY">Vertical distance</option>
              <option value="angle">Angle</option>
            </select>
          </label>
        </>
      )}
      <p className="cad-muted">Select a constraint and press Delete to remove it. Double-click a dimension to edit its value.</p>
      {selected.length === 1 &&
        sketch?.entities.some(entity => entity.id === selected[0] && entity.type === 'conic') &&
        tool === 'select' && (
          <button
            type="button"
            onClick={() => {
              const curve = sketch.entities.find(entity => entity.id === selected[0]);
              if (curve?.type === 'conic') onEditConic(curve.id, curve.rho);
            }}>
            Edit conic rho
          </button>
        )}
    </div>
  );
}
