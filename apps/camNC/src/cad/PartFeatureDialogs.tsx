import { useEffect, useId, useRef, useState } from 'react';
import { type CadDrawnOn, setPartPattern, renamePartCopy, type CadDocument, type CadPart, type CadValueScope } from '@wbcnc/cad';
import { CadCopyNames } from './CadCopyNames';
import { CadPartPatternField } from './CadPartPatternField';
import { FeatureDialog } from './FeatureDialog';
import { CircularPartPatternField } from './CircularPartPatternField';
import { partPatternForKind } from './partPatternKind';
import { DialogPartField } from './DialogPartField';
import type { useDialogPartPick } from './useDialogPartPick';

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

export { TransformDialog, type CadConnectorPick } from './TransformDialog';
import type { CadConnectorPick } from './TransformDialog';

export { ExtrudeDialog } from './ExtrudeDialog';

/** Copies of a whole part in a row or around an axis, and what each piece is called. */
export function PartPatternDialog({
  document,
  part,
  variables,
  onChange,
  onOk,
  onCancel,
  pickDirection,
  pickPoint,
  blockedReason,
  initiallyPatterned,
  partPick,
}: PartDialogProps & {
  pickDirection?: (picked: ((on: CadDrawnOn['on']) => void) | null) => void;
  /** Starts picking in the view, for an edge to pattern along. Null stops it. */
  pickPoint?: (picked: ((pick: CadConnectorPick) => void) | null) => void;
  /** A stale studio transaction cannot replace a newer source, even if its local fields are valid. */
  blockedReason?: string | null;
  /** The opening source can have no pattern even when a studio draft starts in the requested kind. */
  initiallyPatterned?: boolean;
  /** A new pattern's part, which a part clicked while its field is active replaces. */
  partPick?: ReturnType<typeof useDialogPartPick> | null;
}) {
  const id = useId();
  const hadPattern = useRef(initiallyPatterned ?? !!part.pattern);
  const [problem, setProblem] = useState<string | null>(null);
  const circular = part.pattern?.circular;
  const latestPickDirection = useRef(pickDirection);
  latestPickDirection.current = pickDirection;
  // Closed while picking, the view stops picking.
  useEffect(
    () => () => {
      pickPoint?.(null);
      latestPickDirection.current?.(null);
    },
    [pickPoint]
  );
  return (
    <FeatureDialog
      title={`${circular ? 'Circular' : 'Linear'} pattern · ${part.name}`}
      onOk={onOk}
      onCancel={onCancel}
      okDisabled={!!problem || !!blockedReason}
      okReason={blockedReason ?? problem}>
      {blockedReason && <p role="alert">{blockedReason}</p>}
      <label htmlFor={`${id}-type`} className="cad-number-field">
        Pattern type
        <span>
          <select
            id={`${id}-type`}
            value={circular ? 'circular' : 'linear'}
            onChange={event => {
              pickPoint?.(null);
              pickDirection?.(null);
              setProblem(null);
              const kind = event.currentTarget.value === 'circular' ? 'circular' : 'linear';
              const pattern = partPatternForKind(kind, part.pattern, hadPattern.current);
              onChange(document => setPartPattern(document, part.id, pattern));
            }}>
            <option value="linear">Linear</option>
            <option value="circular">Circular</option>
          </select>
        </span>
      </label>
      <DialogPartField
        label="Part to pattern"
        name={part.name}
        pick={partPick ?? null}
        onActivate={() => {
          pickPoint?.(null);
          pickDirection?.(null);
          partPick?.activate();
        }}
      />
      {circular && part.pattern ? (
        <CircularPartPatternField
          key={`${part.id}:circular-pattern`}
          pattern={{ ...part.pattern, circular }}
          variables={variables}
          // Starting another pick in the view takes it away from the part field.
          pickPoint={
            pickPoint &&
            (picked => {
              if (picked) partPick?.deactivate();
              pickPoint(picked);
            })
          }
          onValidityChange={setProblem}
          onChange={pattern => onChange(document => setPartPattern(document, part.id, pattern))}
        />
      ) : (
        <CadPartPatternField
          key={`${part.id}:pattern`}
          ready
          pattern={part.pattern}
          document={document}
          pickDirection={
            pickDirection &&
            (picked => {
              pickPoint?.(null);
              partPick?.deactivate();
              pickDirection(picked);
            })
          }
          pickEdge={
            pickPoint &&
            (picked => {
              pickDirection?.(null);
              partPick?.deactivate();
              pickPoint(pick => picked(pick.edge ?? null));
            })
          }
          variables={variables}
          onValidityChange={setProblem}
          onChange={pattern => onChange(document => setPartPattern(document, part.id, pattern))}
        />
      )}
      <CadCopyNames part={part} onRename={(copyId, name) => onChange(document => renamePartCopy(document, part.id, copyId, name))} />
    </FeatureDialog>
  );
}
