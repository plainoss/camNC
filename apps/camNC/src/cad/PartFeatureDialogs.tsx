import { useState } from 'react';
import {
  addPartCopy,
  setPartCopyOffset,
  setPartPattern,
  renamePartCopy,
  type CadCutDepth,
  type CadDocument,
  type CadPart,
  type CadValueScope,
} from '@wbcnc/cad';
import { CadCopyNames } from './CadCopyNames';
import { CadDrawnOnField } from './CadDrawnOnField';
import { CadPartPatternField } from './CadPartPatternField';
import { CadReliefField } from './CadReliefField';
import { CadThicknessField } from './CadThicknessField';
import { FeatureDialog } from './FeatureDialog';
import { formatCadValue, parseCadValue } from './valueExpressions';
import { CadValueInput } from './CadValueInput';

interface PartDialogProps {
  document: CadDocument;
  part: CadPart;
  variables?: CadValueScope;
  /** Applies a change to the design as it's made, so the view shows it. */
  onChange: (change: (document: CadDocument) => CadDocument) => void;
  onOk: () => void;
  /** Leaves the design as it was when the dialog opened. */
  onCancel: () => void;
}

const changePart = (document: CadDocument, partId: string, change: (part: CadPart) => CadPart): CadDocument => ({
  ...document,
  parts: document.parts.map(part => (part.id === partId ? change(part) : part)),
});

/** How deep Extrude → Remove cuts, as typed. */
export interface ExtrudeRemoval {
  depth: CadCutDepth;
  depthExpression?: string;
}

/**
 * A part's sketch pushed out into a board: how thick, where it starts from its plane or face, and which way it grows.
 * Drawn on a board's top or underside, it can instead be removed from that board, as a pocket or a hole.
 */
export function ExtrudeDialog({
  document,
  part,
  variables,
  onChange,
  onOk,
  onCancel,
  onEditSketch,
  removal,
  onRemoval,
}: PartDialogProps & {
  onEditSketch: () => void;
  /** Set while the sketch is cut into the board it's drawn on, rather than made a part. */
  removal?: ExtrudeRemoval | null;
  /** Switches to Remove with a depth, or back to New; says why not when it can't. Left out where Remove can't apply. */
  onRemoval?: (removal: ExtrudeRemoval | null) => string | null;
}) {
  const [removeDepthText, setRemoveDepthText] = useState(() =>
    removal && removal.depth !== 'through' ? (removal.depthExpression ?? formatCadValue(removal.depth)) : '6'
  );
  const [removeError, setRemoveError] = useState<string | null>(null);
  /** Remove with the depth as typed, or all the way through. Whether it was taken. */
  const remove = (through: boolean, text = removeDepthText) => {
    if (!onRemoval) return false;
    if (through) {
      const refused = onRemoval({ depth: 'through' });
      setRemoveError(refused);
      return !refused;
    }
    const parsed = parseCadValue(text, { unit: 'mm', variables });
    const refused = 'error' in parsed ? parsed.error : onRemoval({ depth: parsed.value, depthExpression: parsed.expression });
    setRemoveError(refused);
    return !refused;
  };
  // A thickness that can't be used keeps the dialog open until it's fixed or cancelled.
  const [thicknessValid, setThicknessValid] = useState(true);
  const [depthError, setDepthError] = useState<string | null>(null);
  const [depthText, setDepthText] = useState(part.thin ? (part.thin.depthExpression ?? formatCadValue(part.thin.depth)) : '100');
  const setThin = (thin: CadPart['thin'] | null) =>
    onChange(document =>
      changePart(document, part.id, p => {
        const next = { ...p };
        if (thin) next.thin = thin;
        else delete next.thin;
        return next;
      })
    );
  /** Takes the typed depth, or says why not. Whether it was taken. */
  const applyDepth = () => {
    const parsed = parseCadValue(depthText, { unit: 'mm', variables });
    const refused = 'error' in parsed ? parsed.error : parsed.value <= 0 ? 'A thin board needs some depth.' : null;
    setDepthError(refused);
    if ('error' in parsed || refused) return false;
    setThin({
      ...part.thin,
      depth: parsed.value,
      ...(parsed.expression ? { depthExpression: parsed.expression } : { depthExpression: undefined }),
    });
    return true;
  };
  return (
    <FeatureDialog
      title={`Extrude · ${part.name}`}
      okDisabled={removal ? !!removeError : !thicknessValid || !!depthError}
      onOk={onOk}
      onCancel={onCancel}>
      {onRemoval && (
        // New makes the sketch a part of its own; Remove cuts it out of the board it's drawn on.
        <div className="cad-feature-tabs" role="tablist" aria-label="Extrude operation">
          <button
            type="button"
            role="tab"
            aria-selected={!removal}
            onClick={() => {
              setRemoveError(null);
              onRemoval(null);
            }}>
            New
          </button>
          <button type="button" role="tab" aria-selected={!!removal} onClick={() => removal || remove(false)}>
            Remove
          </button>
        </div>
      )}
      {removal ? (
        <>
          <div className="cad-feature-selection">
            <small>Sketch to cut</small>
            <span>{part.name}’s sketch</span>
            <button type="button" onClick={onEditSketch}>
              Edit sketch
            </button>
          </div>
          <label className="cad-number-field">
            End type
            <select value={removal.depth === 'through' ? 'through' : 'blind'} onChange={event => remove(event.target.value === 'through')}>
              <option value="blind">Blind</option>
              <option value="through">Through all</option>
            </select>
          </label>
          {removal.depth !== 'through' && (
            <label className="cad-number-field">
              Depth
              <span>
                <CadValueInput
                  bare
                  aria-label="Cut depth"
                  value={removeDepthText}
                  spellCheck={false}
                  aria-invalid={removeError ? true : undefined}
                  onChange={event => setRemoveDepthText(event.target.value)}
                  onBlur={() => remove(false)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !remove(false)) {
                      event.preventDefault();
                      event.stopPropagation();
                    }
                  }}
                />
              </span>
              mm
            </label>
          )}
          {removeError && (
            <p role="alert" className="cad-thickness-error">
              {removeError}
            </p>
          )}
        </>
      ) : (
        <>
          {removeError && (
            <p role="alert" className="cad-thickness-error">
              {removeError}
            </p>
          )}
          {part.drawnOn && (
            // Solid pushes the sketch's face out by the thickness; Thin stands a board on a line drawn edge-on.
            <div className="cad-feature-tabs" role="tablist" aria-label="Extrude type">
              <button type="button" role="tab" aria-selected={!part.thin} onClick={() => setThin(null)}>
                Solid
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!!part.thin}
                onClick={() => {
                  const parsed = parseCadValue(depthText, { unit: 'mm', variables });
                  setThin({ depth: 'error' in parsed || parsed.value <= 0 ? 100 : parsed.value, midPlane: true });
                }}>
                Thin
              </button>
            </div>
          )}
          <div className="cad-feature-selection">
            <small>Sketch to extrude</small>
            <span>{part.name}’s sketch</span>
            <button type="button" onClick={onEditSketch}>
              Edit sketch
            </button>
          </div>
          <CadThicknessField
            key={`${part.id}:thickness`}
            value={part.thickness}
            expression={part.thicknessExpression}
            variables={variables}
            onValidityChange={setThicknessValid}
            onCommit={(thickness, thicknessExpression) =>
              onChange(document =>
                changePart(document, part.id, p => {
                  const next = { ...p, thickness, thicknessExpression };
                  if (thicknessExpression === undefined) delete next.thicknessExpression;
                  return next;
                })
              )
            }
          />
          {part.thin && (
            <>
              <label className="cad-number-field">
                Depth
                <span>
                  <CadValueInput
                    bare
                    aria-label="Depth"
                    value={depthText}
                    spellCheck={false}
                    aria-invalid={depthError ? true : undefined}
                    onChange={event => setDepthText(event.target.value)}
                    onBlur={applyDepth}
                    onKeyDown={event => {
                      // A depth that isn't taken keeps the dialog open to fix it, rather than Enter keeping the old one.
                      if (event.key === 'Enter' && !applyDepth()) {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                    }}
                  />
                </span>
                mm
              </label>
              {depthError && (
                <p role="alert" className="cad-thickness-error">
                  {depthError}
                </p>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={!!part.thin.midPlane}
                  onChange={event => setThin({ ...part.thin!, midPlane: event.target.checked })}
                />
                Mid plane
              </label>
            </>
          )}
          {part.drawnOn && (
            <CadDrawnOnField
              key={`${part.id}:drawn-on`}
              document={document}
              part={part as CadPart & { drawnOn: NonNullable<CadPart['drawnOn']> }}
              variables={variables}
              onChange={drawnOn => onChange(document => changePart(document, part.id, p => ({ ...p, drawnOn })))}
            />
          )}
          <CadReliefField
            key={`${part.id}:relief`}
            relief={part.cornerRelief}
            variables={variables}
            onChange={cornerRelief =>
              onChange(document =>
                changePart(document, part.id, p => {
                  const next = { ...p, cornerRelief };
                  if (!cornerRelief) delete next.cornerRelief;
                  return next;
                })
              )
            }
          />
        </>
      )}
    </FeatureDialog>
  );
}

/** Copies of a whole part in a row, and what each piece is called. */
export function PartPatternDialog({ part, variables, onChange, onOk, onCancel }: PartDialogProps) {
  return (
    <FeatureDialog title={`Linear pattern · ${part.name}`} onOk={onOk} onCancel={onCancel}>
      <div className="cad-feature-selection">
        <small>Part to pattern</small>
        <span>{part.name}</span>
      </div>
      <CadPartPatternField
        key={`${part.id}:pattern`}
        pattern={part.pattern}
        variables={variables}
        onChange={pattern => onChange(document => setPartPattern(document, part.id, pattern))}
      />
      <CadCopyNames part={part} onRename={(copyId, name) => onChange(document => renamePartCopy(document, part.id, copyId, name))} />
    </FeatureDialog>
  );
}

const kAxisLabels = ['X', 'Y', 'Z'] as const;

/**
 * A copy of a whole part, moved along the studio's axes, as the reference's transform with "Copy part": the copy follows
 * the part, and each distance can use variables. It can be the part's mirror image, as a left side is of a right one.
 */
export function TransformDialog({
  document,
  part,
  copyId,
  variables,
  onSave,
  onCancel,
}: {
  document: CadDocument;
  part: CadPart;
  /** The transformed copy being changed, or none for a new one. */
  copyId?: string;
  variables?: CadValueScope;
  onSave: (document: CadDocument) => void;
  onCancel: () => void;
}) {
  const copy = part.copies?.find(candidate => candidate.id === copyId);
  const typed = (axis: number) =>
    copy?.offset ? (copy.offset.positionExpressions?.[axis] ?? formatCadValue(copy.offset.position[axis]!)) : '0';
  const [text, setText] = useState([typed(0), typed(1), typed(2)]);
  const [mirrored, setMirrored] = useState(!!copy?.mirrored);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const parsed = text.map(value => parseCadValue(value, { unit: 'mm', variables }));
    const failed = parsed.find(result => 'error' in result);
    if (failed && 'error' in failed) return setError(failed.error);
    const values = parsed as { value: number; expression?: string }[];
    const offset = {
      position: values.map(result => result.value) as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
      ...(values.some(result => result.expression) && {
        positionExpressions: values.map(result => result.expression ?? null) as [string | null, string | null, string | null],
      }),
    };
    onSave(
      copy
        ? setPartCopyOffset(document, part.id, copy.id, { offset, mirrored })
        : addPartCopy(document, part.id, { offset, mirrored }).document
    );
  };
  return (
    <FeatureDialog title={`Transform · ${part.name}`} onOk={save} onCancel={onCancel}>
      <div className="cad-feature-selection">
        <small>Part to copy</small>
        <span>{part.name}</span>
      </div>
      <p className="cad-feature-hint">Translate by X, Y and Z</p>
      {kAxisLabels.map((label, axis) => (
        <label key={label} className="cad-number-field">
          {label}
          <span>
            <CadValueInput
              bare
              aria-label={label}
              value={text[axis]}
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              onChange={event => setText(values => values.map((value, index) => (index === axis ? event.target.value : value)))}
            />
          </span>
          mm
        </label>
      ))}
      <label>
        <input type="checkbox" checked={mirrored} onChange={event => setMirrored(event.target.checked)} />
        Mirror image
      </label>
      {error && (
        <p role="alert" className="cad-thickness-error">
          {error}
        </p>
      )}
    </FeatureDialog>
  );
}
