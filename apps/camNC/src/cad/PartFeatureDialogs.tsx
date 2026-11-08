import { useState } from 'react';
import { setPartPattern, renamePartCopy, type CadDocument, type CadPart, type CadValueScope } from '@wbcnc/cad';
import { CadCopyNames } from './CadCopyNames';
import { CadDrawnOnField } from './CadDrawnOnField';
import { CadPartPatternField } from './CadPartPatternField';
import { CadReliefField } from './CadReliefField';
import { CadThicknessField } from './CadThicknessField';
import { FeatureDialog } from './FeatureDialog';

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
