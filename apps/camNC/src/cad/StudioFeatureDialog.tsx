import type { CadDocument, CadDrawnOn, CadValueScope } from '@wbcnc/cad';
import { useRef } from 'react';
import { ExtrudeDialog, type CadConnectorPick } from './PartFeatureDialogs';
import { HoleDialog } from './HoleDialog';
import { StudioPatternDialog } from './StudioPatternDialog';
import type { PartPatternKind } from './partPatternKind';

export interface StudioFeatureDialogState {
  kind: 'extrude' | 'pattern' | 'hole';
  partId: string;
  before: CadDocument;
  initialPatternKind?: PartPatternKind;
}

/** Shared step wiring, keeping each dialog's own preview and acceptance behavior. */
export function StudioFeatureDialog({
  state,
  document,
  variables,
  onChange,
  onOk,
  onCancel,
  onPreview,
  depthDragging,
  profilePicking,
  onPickProfile,
  onEditSketch,
  pickDirection,
  pickPoint,
}: {
  state: StudioFeatureDialogState;
  document: CadDocument;
  variables: CadValueScope;
  onChange: (change: (document: CadDocument) => CadDocument) => void;
  onOk: () => void;
  onCancel: () => void;
  onPreview: (document: CadDocument | null) => void;
  depthDragging?: boolean;
  profilePicking: boolean;
  onPickProfile: () => void;
  onEditSketch: (partId: string) => void;
  pickDirection: (picked: ((on: CadDrawnOn['on']) => void) | null) => void;
  pickPoint: (picked: ((pick: CadConnectorPick) => void) | null) => void;
}) {
  const opening = useRef({ state, generation: 0 });
  // Starting the same feature again still owns a fresh candidate, even if its source document has not changed.
  if (opening.current.state !== state) opening.current = { state, generation: opening.current.generation + 1 };
  const target = document.parts.find(candidate => candidate.id === state.partId);
  if (!target) return null;
  const props = { document, part: target, variables, onChange, onOk, onCancel };
  if (state.kind === 'hole') return <HoleDialog key={target.id} {...props} />;
  if (state.kind === 'extrude')
    return (
      <ExtrudeDialog
        key={target.id}
        {...props}
        depthDragging={depthDragging}
        profilePicking={profilePicking}
        onPickProfile={onPickProfile}
        onEditSketch={() => onEditSketch(target.id)}
        pickFace={pickDirection}
      />
    );
  return (
    <StudioPatternDialog
      key={`${target.id}:${opening.current.generation}`}
      owner={state}
      initialPatternKind={state.initialPatternKind}
      {...props}
      onPreview={onPreview}
      pickDirection={pickDirection}
      pickPoint={pickPoint}
    />
  );
}
