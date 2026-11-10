import { useEffect } from 'react';
import { type CadDrawnOn, setPartPattern, renamePartCopy, type CadDocument, type CadPart, type CadValueScope } from '@wbcnc/cad';
import { CadCopyNames } from './CadCopyNames';
import { CadPartPatternField } from './CadPartPatternField';
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

export { TransformDialog, type CadConnectorPick } from './TransformDialog';
import type { CadConnectorPick } from './TransformDialog';

export { ExtrudeDialog } from './ExtrudeDialog';

/** Copies of a whole part in a row, and what each piece is called. */
export function PartPatternDialog({
  document,
  part,
  variables,
  onChange,
  onOk,
  onCancel,
  pickDirection,
  pickPoint,
}: PartDialogProps & {
  pickDirection?: (picked: (on: CadDrawnOn['on']) => void) => void;
  /** Starts picking in the view, for an edge to pattern along. Null stops it. */
  pickPoint?: (picked: ((pick: CadConnectorPick) => void) | null) => void;
}) {
  // Closed while picking, the view stops picking.
  useEffect(() => () => pickPoint?.(null), [pickPoint]);
  return (
    <FeatureDialog title={`Linear pattern · ${part.name}`} onOk={onOk} onCancel={onCancel}>
      <div className="cad-feature-selection">
        <small>Part to pattern</small>
        <span>{part.name}</span>
      </div>
      <CadPartPatternField
        key={`${part.id}:pattern`}
        ready
        pattern={part.pattern}
        document={document}
        pickDirection={pickDirection}
        pickEdge={pickPoint && (picked => pickPoint(pick => picked(pick.edge ?? null)))}
        variables={variables}
        onChange={pattern => onChange(document => setPartPattern(document, part.id, pattern))}
      />
      <CadCopyNames part={part} onRename={(copyId, name) => onChange(document => renamePartCopy(document, part.id, copyId, name))} />
    </FeatureDialog>
  );
}
