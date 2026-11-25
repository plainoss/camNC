import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { cadCopyName, createCadPart, type CadDocument, type CadPart, type CadSketchSolveStatus, cadVariableProblems } from '@wbcnc/cad';
import type { CadHistoryMark } from '@wbcnc/cad-editor/session';
import type { CadEditorProps } from './CadEditor.types';
import type { SketchEditorInput } from './sketchEditorInput';
import type { StudioNavigationInput } from './studioNavigation';
import type { StudioDialog } from './studioDialog';
import type { FeatureAction, FeatureEntry } from './FeatureList';
import type { useFeaturePreview } from './useFeaturePreview';
import type { useStudioPreview } from './useStudioPreview';
import { PartsList } from './PartsList';
import { StudioFeatureList } from './StudioFeatureList';
import { CadVariablesPanel } from './CadVariablesPanel';
import { SketchPartProperties } from './SketchPartProperties';
import { detachStudioCopy } from './detachStudioCopy';
import { renamedStudioPart } from './renamedStudioPart';
import { partTrouble } from './partTrouble';
import { toggledKey } from './toggledKey';
import { pendingRow } from './drawnOnName';
import { featureRowParts, picksFeatureRows, selectStudioFeature } from './studioFeatureSelection';

// CadEditor's sidebar and status footer, split out of it: the parts list, the studio's feature list, the open sketch's
// part properties, and the status line under the drawing. Each reads the editor's values by their names there.

type PartsPanelProps = Pick<
  StudioNavigationInput,
  | 'studioSession'
  | 'part'
  | 'commit'
  | 'setPartId'
  | 'setSelected'
  | 'chooseTool'
  | 'userRollback'
  | 'onEditFaceSketch'
  | 'faceEditor'
  | 'documentRef'
  | 'setStudioRefusal'
  | 'cutSelection'
  | 'setSelectedFace'
  | 'showWorkspace'
> &
  Pick<SketchEditorInput, 'doc' | 'faceSketch'> & {
    physicalPartCount: number;
    builtParts: CadPart[];
    hiddenParts: ReadonlySet<string>;
    setHiddenParts: Dispatch<SetStateAction<ReadonlySet<string>>>;
    transparentParts: ReadonlySet<string>;
    setTransparentParts: Dispatch<SetStateAction<ReadonlySet<string>>>;
    variableProblems: ReturnType<typeof cadVariableProblems>;
    sketchStatuses: Record<string, CadSketchSolveStatus>;
    partPicking: boolean;
  };

/** The Parts heading and list: each part, or in the studio each physical instance, with an eye to show or hide it. */
export function CadPartsPanel({
  doc,
  studioSession,
  physicalPartCount,
  part,
  commit,
  setPartId,
  setSelected,
  chooseTool,
  userRollback,
  onEditFaceSketch,
  faceEditor,
  documentRef,
  setStudioRefusal,
  faceSketch,
  builtParts,
  cutSelection,
  hiddenParts,
  setHiddenParts,
  transparentParts,
  setTransparentParts,
  variableProblems,
  sketchStatuses,
  setSelectedFace,
  partPicking,
  showWorkspace,
}: PartsPanelProps) {
  return (
    <>
      <div className="cad-panel-heading" hidden={!!faceSketch}>
        <h2>Parts ({studioSession ? physicalPartCount : doc.parts.length})</h2>
        {!studioSession && (
          <button
            type="button"
            aria-label="Add part"
            onClick={() => {
              const added = createCadPart(`Part ${doc.parts.length + 1}`, part?.thickness ?? 18);
              commit({ ...doc, parts: [...doc.parts, added] });
              setPartId(added.id);
              setSelected([]);
              chooseTool('select');
            }}>
            ＋
          </button>
        )}
      </div>
      <PartsList
        document={doc}
        rolledTo={userRollback}
        onSketchCopy={onEditFaceSketch && ((partId, copyId, face) => faceEditor.create(face, undefined, { partId, copyId }))}
        onDetachCopy={(partId, copyId) => {
          const result = detachStudioCopy(documentRef.current, partId, copyId);
          if ('error' in result) return setStudioRefusal(result.error);
          commit(result.document);
          setPartId(result.partId);
        }}
        hidden={!!faceSketch}
        studio={studioSession}
        rows={(studioSession ? builtParts : doc.parts).flatMap(p => [
          { key: p.id, part: p, name: p.name },
          // In the studio every copy is a part of its own in the list, as the reference lists them, with its own eye.
          ...(studioSession
            ? (p.copies ?? []).map((copy, index) => ({ key: `${p.id}/${copy.id}`, part: p, name: cadCopyName(p, index) }))
            : []),
        ])}
        selectedKey={cutSelection.selectedKey}
        hiddenParts={hiddenParts}
        transparent={studioSession ? [transparentParts, setTransparentParts] : undefined}
        onToggleHidden={key => setHiddenParts(previous => toggledKey(previous, key))}
        trouble={id => partTrouble(doc, variableProblems, sketchStatuses, id)}
        onPick={(partId, copyId) => {
          setSelectedFace(null);
          if (partPicking && showWorkspace) return cutSelection.pickForCut(partId, copyId);
          cutSelection.selectPart(partId, copyId);
          setSelected([]);
          chooseTool('select');
        }}
        onRename={(partId, copyId, name) => commit(renamedStudioPart(documentRef.current, partId, copyId, name))}
        onEdit={change => commit(change(documentRef.current))}
      />
    </>
  );
}

type SidebarProps = Pick<
  StudioNavigationInput,
  | 'studioSession'
  | 'documentRef'
  | 'commit'
  | 'setStudioRefusal'
  | 'showWorkspace'
  | 'part'
  | 'profiles'
  | 'setSketchRowPicked'
  | 'setSelectedFace'
  | 'cutSelection'
  | 'setSelected'
  | 'setRolledTo'
  | 'selectedPlane'
  | 'choosingFace'
  | 'userRollback'
  | 'variableScope'
  | 'svg'
  | 'setDirectionPicker'
  | 'setPartId'
  | 'chooseTool'
  | 'onEditFaceSketch'
  | 'faceEditor'
> &
  Pick<
    SketchEditorInput,
    | 'faceSketch'
    | 'doc'
    | 'setHoveredConstraintEntities'
    | 'tool'
    | 'placingDimension'
    | 'dimension'
    | 'dimensionMode'
    | 'applyDimensionEvent'
    | 'selected'
    | 'setRho'
    | 'setConicEditing'
  > & {
    selectedStepId: CadEditorProps['selectedStepId'];
    dialog: StudioDialog | null;
    featureAction: (entry: FeatureEntry, action: FeatureAction) => void;
    rollbackStep: ReturnType<typeof useFeaturePreview>['rollbackStep'];
    setHoveredStepParts: Dispatch<SetStateAction<string[] | null>>;
    pickPlane: (plane: string) => void;
    newSketchOn: (plane: string) => void;
    featureShown: (id: string) => boolean;
    featureProblems: Readonly<Record<string, string>> | undefined;
    studioPreview: ReturnType<typeof useStudioPreview>;
    setFeatureVisibility: Dispatch<SetStateAction<Readonly<Record<string, boolean>>>>;
    partsPanel: ReactNode;
    variableProblems: ReturnType<typeof cadVariableProblems>;
    setThicknessValid: Dispatch<SetStateAction<boolean>>;
    showConstraints: boolean;
    setShowConstraints: Dispatch<SetStateAction<boolean>>;
  };

/** The sidebar beside the drawing: the studio's feature list, the variables, the parts and the open part's properties. */
export function CadEditorSidebar({
  faceSketch,
  studioSession,
  documentRef,
  commit,
  setStudioRefusal,
  showWorkspace,
  doc,
  part,
  selectedStepId,
  profiles,
  setSketchRowPicked,
  setSelectedFace,
  dialog,
  cutSelection,
  setSelected,
  featureAction,
  rollbackStep,
  setRolledTo,
  setHoveredStepParts,
  selectedPlane,
  pickPlane,
  newSketchOn,
  featureShown,
  featureProblems,
  choosingFace,
  userRollback,
  studioPreview,
  setFeatureVisibility,
  partsPanel,
  variableScope,
  variableProblems,
  svg,
  setThicknessValid,
  setDirectionPicker,
  setPartId,
  chooseTool,
  onEditFaceSketch,
  faceEditor,
  showConstraints,
  setShowConstraints,
  setHoveredConstraintEntities,
  tool,
  placingDimension,
  dimension,
  dimensionMode,
  applyDimensionEvent,
  selected,
  setRho,
  setConicEditing,
}: SidebarProps) {
  return (
    <aside className="cad-sidebar" aria-label="Parts and sketch properties">
      {faceSketch && (
        <div className="cad-properties">
          <h3>Sketch on the {faceSketch.label.toLowerCase()}</h3>
          <p className="cad-muted">
            Draw lines or shapes across the part to mark out regions. Finish the sketch, then click a region to set its depth.
          </p>
        </div>
      )}
      {studioSession && (
        <StudioFeatureList
          currentDocument={documentRef}
          commit={commit}
          onRefusal={setStudioRefusal}
          workspace={showWorkspace}
          document={doc}
          selectedPartId={part?.id ?? null}
          initialSelection={selectedStepId}
          onSelect={selectStudioFeature(doc, profiles.pickSketch, {
            sketch: setSketchRowPicked,
            face: () => setSelectedFace(null),
            part: picksFeatureRows(dialog) ? cutSelection.pickForCut : cutSelection.selectPart,
            entities: () => setSelected([]),
          })}
          onAction={featureAction}
          rollback={rollbackStep}
          onRollTo={showWorkspace ? setRolledTo : undefined}
          onHover={entry => setHoveredStepParts(entry?.kind === 'step' ? featureRowParts(doc, entry.step) : null)}
          {...(showWorkspace && { selectedPlane, onPickPlane: pickPlane, onNewSketch: newSketchOn })}
          {...{ shown: featureShown, featureProblems, pending: pendingRow(doc, dialog, choosingFace, userRollback) }}
          preview={dialog?.kind === 'fillet' || dialog?.kind === 'chamfer' ? studioPreview.document : undefined}
          onToggleShown={id => setFeatureVisibility(previous => ({ ...previous, [id]: !featureShown(id) }))}
        />
      )}
      {!faceSketch && !studioSession && <CadVariablesPanel document={doc} onChange={commit} />}
      {!studioSession && partsPanel}
      {part && !faceSketch && !(studioSession && showWorkspace) && (
        <SketchPartProperties
          document={doc}
          documentRef={documentRef}
          part={part}
          studio={studioSession}
          commit={commit}
          variables={variableScope}
          variableProblems={variableProblems}
          focusCanvas={() => svg.current?.focus()}
          onThicknessValidity={setThicknessValid}
          pickDirection={picked => setDirectionPicker(() => picked)}
          setPartId={setPartId}
          setSelected={setSelected}
          chooseTool={chooseTool}
          faceEditor={onEditFaceSketch && faceEditor}
          showConstraints={showConstraints}
          onShowConstraints={shown => {
            setShowConstraints(shown);
            setHoveredConstraintEntities([]);
          }}
          showDimensionMode={tool === 'dimension' || placingDimension || dimension !== null}
          dimensionMode={dimensionMode}
          onDimensionMode={mode => applyDimensionEvent({ type: 'mode', mode })}
          selected={selected}
          tool={tool}
          onEditConic={(id, rho) => {
            setRho(String(rho));
            setConicEditing(id);
          }}
        />
      )}
      {studioSession && (
        <section className="cad-parts-panel" aria-label="Parts panel">
          {partsPanel}
        </section>
      )}
    </aside>
  );
}

type StatusFooterProps = Pick<StudioNavigationInput, 'studioSession' | 'showWorkspace' | 'busy' | 'commit'> &
  Pick<SketchEditorInput, 'solving'> & {
    openSketchProblems: string[];
    inProgress: boolean;
    displayStatus: string;
    colorNotice: string | undefined;
    cancelledSketch: { document: CadDocument; partId: string; before: CadHistoryMark } | null;
    openSketch: (stepPartId: string, before?: CadHistoryMark) => void;
    acceptanceNotice: string | null | undefined;
    message: string;
    saveStatus: CadEditorProps['saveStatus'];
  };

/** The status line under the drawing: the sketch's check, Restore for a cancelled sketch, the instruction, and saving. */
export function CadStatusFooter({
  openSketchProblems,
  inProgress,
  studioSession,
  showWorkspace,
  solving,
  displayStatus,
  colorNotice,
  cancelledSketch,
  busy,
  commit,
  openSketch,
  acceptanceNotice,
  message,
  saveStatus,
}: StatusFooterProps) {
  return (
    <footer className="cad-status">
      <span className={openSketchProblems.length && !inProgress ? 'cad-error' : ''}>
        {studioSession && showWorkspace ? (
          // In the studio, a sketch's freedom isn't what's being worked on.
          solving ? (
            'Checking sketch…'
          ) : (
            ''
          )
        ) : (
          <>
            {solving ? 'Checking sketch…' : displayStatus}
            {colorNotice && ` · ${colorNotice}`}
          </>
        )}
      </span>
      {cancelledSketch && (
        // Its own status, outside the instruction line that narrow windows hide, so Restore is always there.
        <span className="cad-restore-sketch" role="status">
          Sketch cancelled.{' '}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (busy) return;
              commit(cancelledSketch.document);
              openSketch(cancelledSketch.partId, cancelledSketch.before);
            }}>
            Restore
          </button>
        </span>
      )}
      <span className="cad-instruction" role="status">
        {cancelledSketch || acceptanceNotice || (studioSession && showWorkspace) ? '' : message}
      </span>
      <span>{saveStatus ?? 'Draft'}</span>
    </footer>
  );
}
