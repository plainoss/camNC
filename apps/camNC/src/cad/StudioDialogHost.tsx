import { addPartCut, removePartCut, updatePartCut, type CadDocument, type CadDrawnOn, type CadValueScope } from '@wbcnc/cad';
import { BooleanDialog, type BooleanChange } from './BooleanDialog';
import { useRef, type ComponentProps } from 'react';
import { ExtrudeDialog, type CadConnectorPick } from './PartFeatureDialogs';
import { FilletDialog } from './FilletDialog';
import { HoleDialog } from './HoleDialog';
import { MirrorDialog } from './MirrorDialog';
import { PartCutDialog } from './PartCutDialog';
import { PlaneDialog } from './PlaneDialog';
import { StudioPatternDialog } from './StudioPatternDialog';
import { TransformDialog } from './TransformDialog';
import { VariableDialog } from './VariableDialog';
import { dialogKey, type StudioDialog } from './studioDialog';
import type { DialogPartPicks } from './useDialogPartPick';
import { prepareStudioPreview } from './useStudioPreview';

type PartCutChange = Parameters<ComponentProps<typeof PartCutDialog>['onSave']>[0];

/** The design with a "cut parts" step added, or the step `id` changed. */
function withPartCut(document: CadDocument, id: string | undefined, change: PartCutChange): CadDocument {
  const { clearance, clearanceExpression, split, consumeTools, cornerRelief, tools, targets } = change;
  const made = id
    ? { document: updatePartCut(document, id, change), id }
    : addPartCut(document, tools, targets, { value: clearance, expression: clearanceExpression }, split);
  return updatePartCut(made.document, made.id, { consumeTools, cornerRelief });
}

/** The design with a Boolean step added, or the step `id` changed. */
function withBoolean(document: CadDocument, id: string | undefined, change: BooleanChange): CadDocument {
  const made = id ? { document, id } : addPartCut(document, change.tools, change.targets, { value: 0 });
  return updatePartCut(made.document, made.id, change);
}

/**
 * The Part Studio's open step dialog. Extrude, Hole and Pattern keep their own acceptance through `onOk` and
 * `onCancel`; the others show an ephemeral candidate in the view, and accepting it alone changes the design.
 */
export function StudioDialogHost({
  dialog,
  document,
  variables,
  change,
  close,
  onOk,
  onCancel,
  onPreview,
  setDirectionPicker,
  pickPoint,
  onConnectorsChange,
  partPicks,
  depthDragging,
  profilePicking,
  onPickProfile,
  onEditSketch,
  cutTool,
  onCutPicked,
}: {
  dialog: StudioDialog;
  /** The design the dialog reads: for an Extrude, Hole or Pattern dialog, with a depth being dragged in the view. */
  document: CadDocument;
  variables: CadValueScope;
  /** Changes the design as it now is. */
  change: (change: (document: CadDocument) => CadDocument) => void;
  /** Closes the dialog, leaving the design as it is. */
  close: () => void;
  onOk: () => void;
  onCancel: () => void;
  onPreview: (document: CadDocument | null) => void;
  /** Hands the view's next plane or face pick to a dialog, or stops it with null. */
  setDirectionPicker: (picker: ((on: CadDrawnOn['on'], datum?: string) => void) | null) => void;
  pickPoint: (picked: ((pick: CadConnectorPick) => void) | null) => void;
  onConnectorsChange?: ComponentProps<typeof TransformDialog>['onConnectorsChange'];
  /** Parts clicked while a dialog is open, for the part field of a new step. */
  partPicks?: DialogPartPicks;
  depthDragging?: boolean;
  profilePicking?: boolean;
  onPickProfile?: () => void;
  onEditSketch?: (partId: string) => void;
  /** The part a new "cut parts" step starts out cutting with. */
  cutTool?: string;
  onCutPicked?: ComponentProps<typeof PartCutDialog>['onPicked'];
}) {
  const opening = useRef({ dialog, generation: 0 });
  // Starting the same feature again still owns a fresh candidate, even if its source document has not changed.
  if (opening.current.dialog !== dialog) opening.current = { dialog, generation: opening.current.generation + 1 };
  const save = (next: CadDocument) => {
    change(() => prepareStudioPreview(next));
    close();
  };
  const part = (id: string) => document.parts.find(candidate => candidate.id === id);
  switch (dialog.kind) {
    case 'extrude':
    case 'hole':
    case 'pattern': {
      const target = part(dialog.partId);
      if (!target) return null;
      const props = { document, part: target, variables, onChange: change, onOk, onCancel };
      if (dialog.kind === 'hole') return <HoleDialog key={dialogKey(dialog)} {...props} />;
      if (dialog.kind === 'extrude')
        return (
          <ExtrudeDialog
            key={dialogKey(dialog)}
            {...props}
            depthDragging={depthDragging}
            profilePicking={!!profilePicking}
            onPickProfile={() => onPickProfile?.()}
            onEditSketch={() => onEditSketch?.(target.id)}
            pickFace={setDirectionPicker}
          />
        );
      return (
        <StudioPatternDialog
          key={`${target.id}:${opening.current.generation}`}
          owner={dialog}
          initialPatternKind={dialog.initialPatternKind}
          {...props}
          onPreview={onPreview}
          pickDirection={setDirectionPicker}
          pickPoint={pickPoint}
          partPicks={partPicks}
        />
      );
    }
    case 'transform': {
      const target = part(dialog.partId);
      return target ? (
        <TransformDialog
          key={dialogKey(dialog)}
          document={document}
          part={target}
          copyId={dialog.copyId}
          move={dialog.move}
          variables={variables}
          onPreview={onPreview}
          onSave={save}
          onCancel={close}
          pickDirection={setDirectionPicker}
          pickPoint={pickPoint}
          onConnectorsChange={onConnectorsChange}
          partPicks={partPicks}
        />
      ) : null;
    }
    case 'mirror':
      return (
        <MirrorDialog
          key={dialogKey(dialog)}
          document={document}
          partId={dialog.partId}
          copyId={dialog.copyId}
          onPreview={onPreview}
          partPicks={partPicks}
          pickPlane={setDirectionPicker}
          onSave={save}
          onCancel={close}
        />
      );
    case 'fillet':
      return (
        <FilletDialog
          key={dialogKey(dialog)}
          document={document}
          variables={variables}
          partId={dialog.partId}
          filletId={dialog.filletId}
          pickEdge={pickPoint}
          onPreview={onPreview}
          onSave={save}
          onCancel={close}
        />
      );
    case 'plane':
      return (
        <PlaneDialog
          key={dialogKey(dialog)}
          document={document}
          planeId={dialog.id}
          preselected={dialog.preselected}
          variables={variables}
          pickPlane={setDirectionPicker}
          onPreview={onPreview}
          onSave={save}
          onCancel={close}
        />
      );
    case 'variable':
      return (
        <VariableDialog
          key={dialogKey(dialog)}
          document={document}
          variableId={dialog.id}
          onPreview={onPreview}
          onSave={save}
          onCancel={close}
        />
      );
    case 'partCut': {
      const { id } = dialog;
      const saved = document.partCuts?.find(step => step.id === id);
      const remove = id
        ? () => {
            change(current => removePartCut(current, id));
            close();
          }
        : undefined;
      if (dialog.boolean || saved?.operation)
        return (
          <BooleanDialog
            key={dialogKey(dialog)}
            document={document}
            onPreview={onPreview}
            step={saved}
            pick={partPicks?.pick}
            onPicked={onCutPicked}
            onClose={close}
            onRemove={remove}
            onSave={made => {
              change(current => prepareStudioPreview(withBoolean(current, id, made)));
              close();
            }}
          />
        );
      return (
        <PartCutDialog
          key={dialogKey(dialog)}
          document={document}
          onPreview={onPreview}
          step={document.partCuts?.find(step => step.id === id)}
          tool={cutTool}
          variables={variables}
          pick={partPicks?.pick}
          onPicked={onCutPicked}
          onClose={close}
          onRemove={
            id
              ? () => {
                  change(current => removePartCut(current, id));
                  close();
                }
              : undefined
          }
          onSave={saved => {
            change(current => prepareStudioPreview(withPartCut(current, id, saved)));
            close();
          }}
        />
      );
    }
  }
}
