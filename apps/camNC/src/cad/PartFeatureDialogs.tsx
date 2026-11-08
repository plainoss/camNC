import { useState } from 'react';
import {
  addPartCopy,
  setPartCopyOffset,
  setPartPattern,
  renamePartCopy,
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

/** A part's sketch pushed out into a board: how thick, where it starts from its plane or face, and which way it grows. */
export function ExtrudeDialog({
  document,
  part,
  variables,
  onChange,
  onOk,
  onCancel,
  onEditSketch,
}: PartDialogProps & { onEditSketch: () => void }) {
  // A thickness that can't be used keeps the dialog open until it's fixed or cancelled.
  const [thicknessValid, setThicknessValid] = useState(true);
  return (
    <FeatureDialog title={`Extrude · ${part.name}`} okDisabled={!thicknessValid} onOk={onOk} onCancel={onCancel}>
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
