import { t as translate } from '@wbcnc/i18n';
import type { ComponentProps, Dispatch, ReactNode, RefObject, SetStateAction } from 'react';
import type { CadPart, CadSketch } from '@wbcnc/cad';
import { dimensionAnchor } from '@wbcnc/cad-editor/dimensionGeometry';
import { transitionModification } from '@wbcnc/cad-editor/modificationWorkflow';
import { numeric, type ConstraintTool, type NumericConstraint, type Point, type Tool } from './cadEditorShared';
import type { SketchEditorInput } from './sketchEditorInput';
import type { StudioNavigationInput } from './studioNavigation';
import type { StudioCommand } from './StudioToolbar';
import type { SearchCommand } from './CommandSearch';
import { CommandSearch } from './CommandSearch';
import { creationValueAt } from './creationValues';
import { CreationValueControls } from './CreationValueControls';
import { SketchConicRhoForm, SketchDimensionEditor, SketchPolygonForm, SketchShapeSizeForm } from './SketchValueForms';
import { SelectionReadout } from './SelectionReadout';
import { withRegionDepth } from './cutRegions';
import { RegionDepthField } from './RegionDepthField';
import { sketchTools as tools, type SketchTool } from './sketchTools';
import { ModificationControls } from './ModificationControls';
import { ShortcutList } from './ShortcutList';
import { sketchShortcutTabs, studioShortcuts } from './shortcuts';
import { sketchSearchCommands } from './sketchSearchCommands';
import { StudioCommandSearch } from './StudioCommandSearch';
import { creationEditorPositions, sketchValuePosition } from './sketchViewport';

// The controls laid over CadEditor's sketch canvas, split out of it: the value fields placed beside the drawing, the
// shortcut list, the command palettes and the canvas footer. Each reads the editor's values by their names there.

type SketchOverlayProps = Pick<
  SketchEditorInput,
  | 'acceptOffset'
  | 'addShape'
  | 'cancelDimensionEdit'
  | 'chooseTool'
  | 'commit'
  | 'conicEditing'
  | 'creationInput'
  | 'creationValues'
  | 'currentDimension'
  | 'cursor'
  | 'dimensionFlow'
  | 'dimensionInput'
  | 'dimensionSelection'
  | 'doc'
  | 'documentRef'
  | 'drawingGroup'
  | 'fit'
  | 'height'
  | 'lengthText'
  | 'lengthUnit'
  | 'markerScale'
  | 'modification'
  | 'offsetInput'
  | 'offsetPreview'
  | 'pending'
  | 'polygonCountGesture'
  | 'polygonSides'
  | 'polygonTool'
  | 'radius'
  | 'rho'
  | 'rhoInput'
  | 'selectionHints'
  | 'setCreationValues'
  | 'setMessage'
  | 'setModification'
  | 'setPalette'
  | 'setPolygonSides'
  | 'setRegionField'
  | 'setRho'
  | 'setSelected'
  | 'sketchBackdrop'
  | 'svg'
  | 'variableScope'
  | 'width'
> &
  Pick<StudioNavigationInput, 'root' | 'showWorkspace' | 'studioSession'> & {
    part: CadPart | undefined;
    sketch: CadSketch | undefined;
    tool: Tool;
    /** The dimension Offset places, whose value field sits beside it. */
    offsetDimension: NumericConstraint | undefined;
    regionField: { entry: Parameters<typeof withRegionDepth>[2]; anchor: Point } | null;
    applyConicRho: () => void;
    applyCreationValue: (options?: { advance?: boolean }) => void;
    applyDimensionValue: () => void;
    beginDimension: () => void;
    constrain: (type: ConstraintTool) => void;
    toggleConstruction: () => void;
    toggleFix: () => void;
    formatLength: (value: number) => string;
    setWidth: Dispatch<SetStateAction<string>>;
    setHeight: Dispatch<SetStateAction<string>>;
    setRadius: Dispatch<SetStateAction<string>>;
    polygonInput: RefObject<HTMLInputElement | null>;
    shortcutsOpen: boolean;
    setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
    palette: boolean;
    searchMode: boolean;
    setSearchHighlight: Dispatch<SetStateAction<SearchCommand['id'] | null>>;
    studioDisabled: Partial<Record<StudioCommand, string>>;
    studioCommand: ComponentProps<typeof StudioCommandSearch>['onCommand'];
    /** The open command's own controls, shown between the polygon form and the conic form. */
    commandControls: ReactNode;
  };

/** The fields, palettes and footer over the sketch canvas. */
export function CadSketchOverlays({
  acceptOffset,
  addShape,
  applyConicRho,
  applyCreationValue,
  applyDimensionValue,
  beginDimension,
  cancelDimensionEdit,
  chooseTool,
  commandControls,
  commit,
  conicEditing,
  constrain,
  creationInput,
  creationValues,
  currentDimension,
  cursor,
  dimensionFlow,
  dimensionInput,
  dimensionSelection,
  doc,
  documentRef,
  drawingGroup,
  fit,
  formatLength,
  height,
  lengthText,
  lengthUnit,
  markerScale,
  modification,
  offsetDimension,
  offsetInput,
  offsetPreview,
  palette,
  part,
  pending,
  polygonCountGesture,
  polygonInput,
  polygonSides,
  polygonTool,
  radius,
  regionField,
  rho,
  rhoInput,
  root,
  searchMode,
  selectionHints,
  setCreationValues,
  setHeight,
  setMessage,
  setModification,
  setPalette,
  setPolygonSides,
  setRadius,
  setRegionField,
  setRho,
  setSearchHighlight,
  setSelected,
  setShortcutsOpen,
  setWidth,
  shortcutsOpen,
  showWorkspace,
  sketch,
  sketchBackdrop,
  studioCommand,
  studioDisabled,
  studioSession,
  svg,
  toggleConstruction,
  toggleFix,
  tool,
  variableScope,
  width,
}: SketchOverlayProps) {
  const valuePosition = (anchor: Point | null, desiredWidth = 216, topOffset = 12) =>
    sketchValuePosition(anchor, svg.current, drawingGroup.current, desiredWidth, topOffset);
  const dimensionEditorPosition =
    currentDimension && numeric(currentDimension) && sketch
      ? valuePosition(dimensionAnchor(currentDimension, sketch, markerScale))
      : undefined;
  const creationPositions = creationEditorPositions(creationValues, sketch, markerScale, valuePosition);
  const offsetPosition =
    offsetDimension && offsetPreview?.ok
      ? valuePosition(
          dimensionAnchor(offsetDimension, offsetPreview.sketch, markerScale),
          modification.phase === 'offset' && modification.editing ? 250 : 140,
          -14
        )
      : undefined;
  return (
    <>
      <ModificationControls
        state={modification}
        inputRef={offsetInput}
        position={offsetPosition}
        error={offsetPreview && !offsetPreview.ok ? offsetPreview.message : undefined}
        onText={text => setModification(previous => transitionModification(previous, { type: 'text', text }))}
        onEdit={() => setModification(previous => transitionModification(previous, { type: 'edit' }))}
        onAccept={acceptOffset}
        onCancel={() => {
          chooseTool('select');
          setSelected([]);
          svg.current?.focus();
        }}
        onMirrorPicking={picking => {
          setModification(previous => transitionModification(previous, { type: 'mirrorPicking', picking }));
          setMessage(
            picking === 'axis'
              ? translate('Select the mirror line.')
              : translate('Select entities to mirror; Shift-click adds to selection.')
          );
          svg.current?.focus();
        }}
      />
      {creationValues && creationValues.partId === part?.id && sketch && (
        <CreationValueControls
          inputRef={creationInput}
          state={creationValues}
          sketch={sketch}
          positions={creationPositions}
          onChange={text => setCreationValues({ ...creationValues, text })}
          onStart={index => {
            const value = creationValueAt(creationValues, sketch, index);
            if (value)
              setCreationValues({ ...creationValues, index, editing: true, text: lengthText(value.constraint.value), selectAll: true });
          }}
          onAccept={applyCreationValue}
          onCancel={() => {
            setCreationValues(null);
            svg.current?.focus();
          }}
        />
      )}
      {regionField && part && (
        <RegionDepthField
          key={regionField.entry.region.id}
          style={valuePosition(regionField.anchor, 280)}
          depth={regionField.entry.depth}
          expression={regionField.entry.cut?.depthExpression}
          thickness={part.thickness - regionField.entry.from}
          variables={variableScope}
          onClose={() => {
            setRegionField(null);
            svg.current?.focus();
          }}
          onChoose={(depth, expression) => {
            const next = withRegionDepth(documentRef.current, part.id, regionField.entry, depth, expression);
            if (next !== documentRef.current) commit(next);
            setRegionField(null);
            svg.current?.focus();
          }}
        />
      )}
      <ShortcutList
        tabs={studioSession ? studioShortcuts : sketchShortcutTabs}
        initial={studioSession && showWorkspace ? 'General' : 'Sketch'}
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
      {palette && !searchMode && (
        <div className="cad-command-palette cad-quick-tools">
          <h3>{translate('Sketch tools')}</h3>
          {tools.map(t => (
            <button type="button" key={t.id} onClick={() => chooseTool(t.id)}>
              {t.label}
              <kbd>{t.key}</kbd>
            </button>
          ))}
        </div>
      )}
      {palette && searchMode && studioSession && showWorkspace && (
        // In the studio the search is of its commands; in a sketch, of the sketch's tools.
        <StudioCommandSearch
          disabled={studioDisabled}
          workspace={root}
          onOpenChange={setPalette}
          onCommand={studioCommand}
          onHighlight={setSearchHighlight}
        />
      )}
      {palette && searchMode && !(studioSession && showWorkspace) && (
        <CommandSearch
          commands={sketchSearchCommands}
          onHighlight={setSearchHighlight}
          onClose={(restoreFocus = true) => {
            setPalette(false);
            if (restoreFocus) svg.current?.focus();
          }}
          onChoose={id => {
            setPalette(false);
            if (id === 'construction') toggleConstruction();
            else if (id === 'fix') toggleFix();
            else if (id === 'fit') fit();
            else if (tools.some(t => t.id === id)) {
              if (id === 'dimension') beginDimension();
              else chooseTool(id as SketchTool);
            } else constrain(id as ConstraintTool);
            svg.current?.focus();
          }}
        />
      )}
      {polygonTool && (
        <SketchPolygonForm
          inputRef={polygonInput}
          sides={polygonSides}
          canCreate={!!pending[1]}
          onSides={value => {
            setPolygonSides(value);
            if (pending[0])
              polygonCountGesture.current = {
                sides: Number(value),
                radius: Math.hypot(cursor.x - pending[0].x, cursor.y - pending[0].y),
              };
          }}
          onCreate={() => {
            if (pending[1]) addShape(pending[1]);
          }}
          onEscape={() => chooseTool('select')}
        />
      )}
      {commandControls}
      {conicEditing && (
        <SketchConicRhoForm inputRef={rhoInput} rho={rho} onRho={setRho} onApply={applyConicRho} onClose={() => chooseTool('select')} />
      )}
      {currentDimension && numeric(currentDimension) && (
        <SketchDimensionEditor
          dimension={currentDimension}
          inputRef={dimensionInput}
          style={dimensionEditorPosition}
          onApply={applyDimensionValue}
          onCancel={cancelDimensionEdit}
        />
      )}
      {pending[0] && (tool === 'rectangle' || tool === 'centerRectangle' || tool === 'circle') && (
        <SketchShapeSizeForm
          from={pending[0]}
          rectangle={tool === 'rectangle' || tool === 'centerRectangle'}
          width={width}
          height={height}
          radius={radius}
          onWidth={setWidth}
          onHeight={setHeight}
          onRadius={setRadius}
          onCreate={() => addShape()}
        />
      )}
      <div className="cad-canvas-footer">
        <span>
          {formatLength(cursor.x)}, {formatLength(cursor.y)} {lengthUnit}
        </span>
        <span>
          {sketchBackdrop
            ? translate(
                'Scroll to zoom · middle-drag to pan · right-drag to turn · N to look straight at it · U uses parts’ edges and vertices'
              )
            : translate('Scroll to zoom · right-drag to pan')}
        </span>
        {sketch && (
          <SelectionReadout
            sketch={sketch}
            document={doc}
            part={part}
            selectedIds={dimensionSelection}
            picks={dimensionFlow.phase === 'idle' ? selectionHints.current : dimensionFlow.pickHints}
          />
        )}
      </div>
    </>
  );
}
