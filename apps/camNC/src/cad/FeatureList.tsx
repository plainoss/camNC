import { useDesignUnits } from './designUnits';
import { cadFolderSteps, cadVariableValues, moveCadFolder, type CadDocument } from '@wbcnc/cad';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { kBasePlanes } from './basePlanes';
import type { DesignStep } from '@wbcnc/cad';
import { PartRowMenu } from './PartRowMenu';
import { formatCadValue } from './valueExpressions';
import { useFolderControls } from './FolderControls';
import { RollbackBar } from './RollbackBar';
import { useStepDrop, type StepDropCheck } from './stepDrop';
import { folderFeatureEntries, folderOfFeature, type ListedFeatureEntry } from './folderFeatureEntries';
import './featureList.css';

const kIcons: Record<DesignStep['kind'] | 'variable' | 'plane', string> = {
  variable: '(x)',
  plane: '▱',
  sketch: '✎',
  extrude: '▮',
  move: '⇥',
  faceSketch: '✎',
  cut: '⌴',
  fillet: '◜',
  copy: '⧉',
  pattern: '⋯',
  partCut: '⊟',
};

/** The eye on a row whose feature shows in the view: a sketch, a plane or the origin. */
function Eye({ name, shown, onToggle }: { name: string; shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="cad-feature-eye"
      // Named for what it does only, so the row keeps its name to itself; its title says which feature.
      aria-label={shown ? 'Hide' : 'Show'}
      title={`${shown ? 'Hide' : 'Show'} ${name} in the view`}
      aria-pressed={shown}
      onClick={event => {
        event.stopPropagation();
        onToggle();
      }}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        {shown ? <circle cx="12" cy="12" r="3" /> : <path d="M4 4l16 16" />}
      </svg>
    </button>
  );
}

/** A row of the list: a design variable, a plane made to sketch on, or a step of how the design is built. */
export type FeatureEntry = { kind: 'variable'; id: string } | { kind: 'plane'; id: string } | { kind: 'step'; step: DesignStep };
export type FeatureAction = 'edit' | 'editSketch' | 'rename' | 'suppress' | 'rollTo' | 'rollToEnd' | 'delete' | 'newSketch' | 'export';

/** What each row's menu offers, and why an item isn't there for it. */
function menuItems(entry: FeatureEntry, rolledBack = false): { action: FeatureAction; label: string; disabled?: boolean }[] {
  if (entry.kind === 'variable' || entry.kind === 'plane')
    return [
      ...(entry.kind === 'plane' ? [{ action: 'newSketch' as const, label: 'New sketch' }] : []),
      { action: 'edit', label: 'Edit…' },
      { action: 'delete', label: 'Delete' },
    ];
  const { kind } = entry.step;
  return [
    ...(kind === 'sketch' || kind === 'extrude' ? [{ action: 'rename' as const, label: 'Rename' }] : []),
    { action: 'edit', label: 'Edit…' },
    ...(kind === 'extrude' ? [{ action: 'editSketch' as const, label: 'Edit sketch…' }] : []),
    // Sketches aren't suppressed on their own: their extrude is.
    ...(kind === 'sketch' || kind === 'faceSketch' || kind === 'move'
      ? []
      : [{ action: 'suppress' as const, label: entry.step.suppressed ? 'Unsuppress' : 'Suppress' }]),
    { action: 'rollTo', label: 'Roll to here' },
    ...(kind === 'sketch' || kind === 'faceSketch' ? [{ action: 'export' as const, label: 'Export as DXF/SVG…' }] : []),
    // A step past the bar also takes the design back to its end, as the reference's menu does.
    ...(rolledBack ? [{ action: 'rollToEnd' as const, label: 'Roll to end' }] : []),
    { action: 'delete', label: 'Delete', disabled: kind === 'faceSketch' || kind === 'copy' },
  ];
}

/**
 * The design's features as one list, as it's built: its variables (`#name = value`), then each step. Click a row to
 * select it, double-click it to edit it, and right-click it for what else can be done with it.
 */
export function FeatureList({
  document,
  selectedPartId,
  initialSelection,
  onSelect,
  onAction,
  onRename,
  rollback,
  onRollTo,
  onReorder,
  reorderDrop,
  onHover,
  selectedPlane,
  onPickPlane,
  shown,
  onToggleShown,
  onNewSketch,
  onChange,
}: {
  document: CadDocument;
  selectedPartId: string | null;
  /** The row selected when the list first shows, such as a step just finished elsewhere. */
  initialSelection?: string;
  onSelect: (entry: FeatureEntry) => void;
  onAction: (entry: FeatureEntry, action: FeatureAction) => void;
  /** A step's new name, typed in place of its row. It names that feature only, never the part it makes. */
  onRename: (step: DesignStep, name: string) => void;
  /** The step being edited: the ones after it are greyed out, as the design is shown only that far. */
  rollback?: string | null;
  /**
   * Moves the rollback bar to just after a step, or to the end with null, as dragging it, stepping it with the arrow keys
   * or Roll to here does in the reference. Without it the bar only shows while a step is edited.
   */
  onRollTo?: (stepId: string | null) => void;
  /** A step dragged onto another, to go just before it. */
  onReorder?: (stepId: string, beforeStepId: string) => void;
  /** Where a step dragged over another would land, or why it can't go there, to show before it's dropped. */
  reorderDrop?: StepDropCheck;
  /** A row hovered, for the view to highlight what it made; null when the pointer leaves. */
  onHover?: (entry: FeatureEntry | null) => void;
  /** The base plane picked, in the list or the view, and picking one, as the reference lists them first. */
  selectedPlane?: string | null;
  onPickPlane?: (plane: string) => void;
  /**
   * Whether a sketch (by its step's id), a plane or the origin shows in the view, and switching it, with the eye each
   * such row has. Hidden, its row is greyed.
   */
  shown?: (id: string) => boolean;
  onToggleShown?: (id: string) => void;
  /** New sketch, from a base plane's right-click menu, as the reference's. */
  onNewSketch?: (plane: string) => void;
  onChange?: (document: CadDocument) => void;
}) {
  const { formatLength, lengthUnit } = useDesignUnits();
  const { scope } = cadVariableValues(document);
  const entries = folderFeatureEntries(document);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(initialSelection ?? null);
  const folders = useFolderControls({ document, onChange, onRollTo, selectedPartId });
  const select = (entry: FeatureEntry) => {
    setSelectedEntry(entry.kind === 'step' ? entry.step.id : entry.id);
    onSelect(entry);
  };
  const [menu, setMenu] = useState<{ entry: FeatureEntry; x: number; y: number } | null>(null);
  const [planeMenu, setPlaneMenu] = useState<{ plane: string; name: string; x: number; y: number } | null>(null);
  const closePlaneMenu = useCallback(() => setPlaneMenu(null), []);
  const [renaming, setRenaming] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLElement>('[role=menuitem]:not([aria-disabled])')?.focus();
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [menu]);
  const label = (entry: ListedFeatureEntry) => {
    if (entry.kind === 'folder') return document.folders!.find(folder => folder.id === entry.id)!.name;
    if (entry.kind === 'step') return entry.step.label;
    if (entry.kind === 'plane') return document.planes!.find(candidate => candidate.id === entry.id)!.name;
    const variable = document.variables!.find(candidate => candidate.id === entry.id)!;
    const result = scope[variable.name];
    const unit = result?.kind === 'length' ? ` ${lengthUnit}` : result?.kind === 'angle' ? '°' : '';
    return `#${variable.name} = ${result ? `${result.kind === 'length' ? formatLength(result.value) : formatCadValue(result.value)}${unit}` : variable.expression}`;
  };
  /** What a row's eye shows or hides: a sketch, by its step's id, or a plane. */
  const visibilityId = (entry: FeatureEntry) =>
    entry.kind === 'plane' ? entry.id : entry.kind === 'step' && entry.step.kind === 'sketch' ? entry.step.id : null;
  const key = (entry: ListedFeatureEntry) => (entry.kind === 'step' ? entry.step.id : entry.id);
  const rollbackAt = rollback ? entries.findIndex(entry => key(entry) === rollback) : -1;
  // With the bar movable it's always there: after the step it's rolled to, or at the end.
  const barAt = rollbackAt;
  const [barMenu, setBarMenu] = useState<{ x: number; y: number } | null>(null);
  const stepIds = entries.flatMap(entry => (entry.kind === 'step' ? [entry.step.id] : []));
  /** Rolls to just after the entry at an index; past the last step is the end. */
  const rollToIndex = (index: number) => {
    const entry = entries[index];
    if (!onRollTo || !entry || entry.kind !== 'step') return;
    onRollTo(entry.step.id === stepIds.at(-1) ? null : entry.step.id);
  };
  const open = (entry: FeatureEntry, event: MouseEvent) => {
    event.preventDefault();
    select(entry);
    setMenu({ entry, x: event.clientX, y: event.clientY });
  };
  const stepDrop = useStepDrop(reorderDrop);
  /** The row a line is drawn at while a step is dragged: the folder's own when it lands just ahead of the folder or in it, closed. */
  const dropRow = (index: number) => {
    const entry = entries[index];
    if (!entry || entry.kind === 'folder') return entry && key(entry);
    const folder = document.folders?.find(candidate => candidate.id === folderOfFeature(document, entry));
    const dragged = entries.find(candidate => candidate.kind === 'step' && candidate.step.id === stepDrop.drop?.stepId);
    // The folder's variables and planes come before its steps, so the first step needn't follow the folder's row.
    const first = !entries
      .slice(0, index)
      .some(candidate => candidate.kind === 'step' && folderOfFeature(document, candidate) === folder?.id);
    if (folder && (folder.collapsed || (first && (!dragged || folderOfFeature(document, dragged) !== folder.id)))) return folder.id;
    return key(entry);
  };
  const landing = stepDrop.drop?.before;
  const dropBefore = landing ? dropRow(entries.findIndex(entry => key(entry) === landing)) : undefined;
  const dropClasses = (rowKey: string) => [
    rowKey === dropBefore && 'cad-feature-drop-before',
    stepDrop.drop?.error && stepDrop.drop.onto === rowKey && 'cad-feature-drop-refused',
  ];
  const brokenCount = entries.filter(entry => entry.kind === 'step' && entry.step.broken).length;
  return (
    <section className="cad-studio-features" aria-label="Features" tabIndex={-1}>
      <div className="cad-panel-heading">
        <h2>
          Features ({entries.filter(entry => entry.kind !== 'folder').length})
          {brokenCount > 0 && (
            <span
              className="cad-feature-error-badge"
              role="status"
              aria-label={`${brokenCount} with errors`}
              title={`${brokenCount} with errors`}>
              {brokenCount}
            </span>
          )}
        </h2>
        {onChange && (
          <button type="button" aria-label="New folder" title="Group neighbouring parts and planes in a folder" onClick={folders.newFolder}>
            ＋
          </button>
        )}
      </div>
      {/* Listed in a sketch too, as in the reference, to show or hide; a plane is picked to sketch on from the studio. */}
      {(onPickPlane || onToggleShown) && (
        <ul className="cad-default-geometry" aria-label="Default geometry">
          {onToggleShown && (
            <li className={shown?.('origin') === false ? 'cad-feature-hidden' : undefined}>
              <span className="cad-default-origin">
                <span aria-hidden="true">⊙</span>
                <span>Origin</span>
              </span>
              <Eye name="Origin" shown={shown?.('origin') ?? true} onToggle={() => onToggleShown('origin')} />
            </li>
          )}
          {kBasePlanes.map(({ plane, label: name }) => (
            <li key={plane} className={shown?.(plane) === false ? 'cad-feature-hidden' : undefined}>
              <button
                type="button"
                aria-pressed={selectedPlane === plane}
                aria-haspopup={onNewSketch ? 'menu' : undefined}
                onClick={() => onPickPlane?.(plane)}
                onContextMenu={event => {
                  if (!onNewSketch && !onToggleShown) return;
                  event.preventDefault();
                  setPlaneMenu({ plane, name, x: event.clientX, y: event.clientY });
                }}>
                <span aria-hidden="true">▱</span>
                <span>{name}</span>
              </button>
              {onToggleShown && <Eye name={name} shown={shown?.(plane) ?? true} onToggle={() => onToggleShown(plane)} />}
            </li>
          ))}
        </ul>
      )}
      <ol
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) stepDrop.leave();
        }}>
        {entries.map((entry, index) => {
          if (entry.kind === 'folder') {
            const folder = document.folders!.find(folder => folder.id === entry.id)!;
            const contained = cadFolderSteps(document, folder.id);
            const rollbackInside = !!rollback && contained.some(step => step.id === rollback);
            return (
              <li
                key={folder.id}
                className={[folder.suppressed && 'cad-feature-suppressed', 'cad-folder-row', ...dropClasses(folder.id)]
                  .filter(Boolean)
                  .join(' ')}
                onDragOver={event => {
                  if (event.dataTransfer.types.includes('text/x-cad-folder')) event.preventDefault();
                  if (event.dataTransfer.types.includes('text/x-cad-step')) stepDrop.leave();
                }}
                onDrop={event => {
                  const id = event.dataTransfer.getData('text/x-cad-folder');
                  if (!id || !onChange) return;
                  event.preventDefault();
                  const result = moveCadFolder(document, id, folder.partIds[0]);
                  if ('document' in result) onChange(result.document);
                }}>
                <button
                  type="button"
                  className="cad-folder-disclosure"
                  aria-label={`${folder.collapsed ? 'Expand' : 'Collapse'} ${folder.name}`}
                  aria-expanded={!folder.collapsed}
                  onClick={() => folders.toggle(folder)}>
                  <span aria-hidden="true">{folder.collapsed ? '▸' : '▾'}</span>
                </button>
                <button
                  type="button"
                  aria-current={selectedEntry === folder.id ? 'true' : undefined}
                  aria-haspopup="menu"
                  draggable={!!onChange}
                  onDragStart={event => {
                    event.dataTransfer.setData('text/x-cad-folder', folder.id);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => setSelectedEntry(folder.id)}
                  onDoubleClick={() => folders.settings(folder.id)}
                  onContextMenu={event => {
                    event.preventDefault();
                    setSelectedEntry(folder.id);
                    folders.openMenu(folder.id, event.clientX, event.clientY);
                  }}
                  onKeyDown={event => {
                    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                      event.preventDefault();
                      const box = event.currentTarget.getBoundingClientRect();
                      folders.openMenu(folder.id, box.left, box.bottom);
                    }
                  }}>
                  <span aria-hidden="true">▰</span>
                  <span>{folder.name}</span>
                </button>
                {folder.collapsed && rollbackInside && (
                  <RollbackBar
                    stepId={rollback ?? null}
                    stepIds={stepIds}
                    onRollTo={onRollTo}
                    onMenu={(x, y) => setBarMenu({ x, y })}
                    label={`Shown through ${contained.find(step => step.id === rollback)?.label}`}
                  />
                )}
              </li>
            );
          }
          const step = entry.kind === 'step' ? entry.step : null;
          const folderId = folderOfFeature(document, entry);
          const folder = document.folders?.find(folder => folder.id === folderId);
          if (step && renaming === step.id) {
            return (
              <li key={key(entry)}>
                <input
                  className="cad-feature-rename"
                  aria-label="New name"
                  defaultValue={step.label}
                  autoFocus
                  onFocus={event => event.currentTarget.select()}
                  onBlur={event => {
                    const name = event.currentTarget.value.trim();
                    if (name && name !== step.label) onRename(step, name);
                    setRenaming(null);
                  }}
                  onKeyDown={event => {
                    event.stopPropagation();
                    if (event.key === 'Enter') event.currentTarget.blur();
                    else if (event.key === 'Escape') {
                      event.currentTarget.value = step.label;
                      event.currentTarget.blur();
                    }
                  }}
                />
              </li>
            );
          }
          return (
            <li
              key={key(entry)}
              hidden={!!folder?.collapsed}
              onDragOver={event => {
                if (entry.kind !== 'step') return stepDrop.leave();
                if (onRollTo && event.dataTransfer.types.includes('text/x-cad-rollback')) event.preventDefault();
                if (onReorder && event.dataTransfer.types.includes('text/x-cad-step')) stepDrop.over(event, entry.step.id);
                if (onChange && event.dataTransfer.types.includes('text/x-cad-folder')) event.preventDefault();
              }}
              onDrop={event => {
                if (entry.kind !== 'step') return;
                const folderId = event.dataTransfer.getData('text/x-cad-folder');
                if (folderId && onChange) {
                  event.preventDefault();
                  const result = moveCadFolder(document, folderId, entry.step.partId);
                  if ('document' in result) onChange(result.document);
                  return;
                }
                if (event.dataTransfer.types.includes('text/x-cad-step')) {
                  // A step dropped on another goes just before it.
                  event.preventDefault();
                  stepDrop.end();
                  const dragged = event.dataTransfer.getData('text/x-cad-step');
                  if (dragged && dragged !== entry.step.id) onReorder?.(dragged, entry.step.id);
                  return;
                }
                if (!event.dataTransfer.types.includes('text/x-cad-rollback')) return;
                event.preventDefault();
                rollToIndex(index);
              }}
              className={
                [
                  rollbackAt >= 0 && index > rollbackAt && 'cad-feature-rolled-back',
                  folderId && 'cad-folder-child',
                  folder?.suppressed && 'cad-feature-suppressed',
                  step?.suppressed && 'cad-feature-suppressed',
                  step?.broken && 'cad-feature-broken',
                  visibilityId(entry) && shown?.(visibilityId(entry)!) === false && 'cad-feature-hidden',
                  ...dropClasses(key(entry)),
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }>
              <button
                type="button"
                aria-current={key(entry) === selectedEntry ? 'true' : undefined}
                aria-pressed={entry.kind === 'plane' ? selectedPlane === entry.id : undefined}
                aria-haspopup="menu"
                aria-description={step?.broken}
                onClick={() => {
                  // A plane is picked to sketch on, as a base plane is.
                  if (entry.kind === 'plane') onPickPlane?.(entry.id);
                  select(entry);
                }}
                onDoubleClick={() => onAction(entry, 'edit')}
                draggable={!!onReorder && entry.kind === 'step' && entry.step.kind !== 'partCut'}
                onDragStart={event => {
                  if (entry.kind !== 'step') return;
                  event.dataTransfer.setData('text/x-cad-step', entry.step.id);
                  event.dataTransfer.effectAllowed = 'move';
                  stepDrop.start(entry.step.id);
                }}
                onDragEnd={stepDrop.end}
                onContextMenu={event => open(entry, event)}
                onPointerEnter={() => onHover?.(entry)}
                onPointerLeave={() => onHover?.(null)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onAction(entry, 'edit');
                  } else if (event.key === 'Delete' || event.key === 'Backspace') {
                    // Delete removes the step straight away, as in the reference; undo brings it back.
                    event.preventDefault();
                    event.stopPropagation();
                    if (menuItems(entry).find(item => item.action === 'delete')?.disabled) return;
                    // The list keeps the keyboard once the row is gone, so undo works straight away.
                    event.currentTarget.closest<HTMLElement>('section')?.focus();
                    onAction(entry, 'delete');
                  } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    const box = event.currentTarget.getBoundingClientRect();
                    event.preventDefault();
                    select(entry);
                    setMenu({ entry, x: box.left + 24, y: box.bottom });
                  }
                }}>
                <span aria-hidden="true">{kIcons[step ? step.kind : (entry.kind as 'variable' | 'plane')]}</span>
                <span>{label(entry)}</span>
                {step?.detail && <small>{step.detail}</small>}
                {step?.broken && (
                  <span className="cad-feature-warning" role="img" aria-label="Error" title={step.broken}>
                    ⚠
                  </span>
                )}
              </button>
              {/* Below the rollback bar a step is left out of the view, so there's nothing for an eye to show or hide. */}
              {onToggleShown && visibilityId(entry) && !(rollbackAt >= 0 && index > rollbackAt) && (
                <Eye
                  name={label(entry)}
                  shown={shown?.(visibilityId(entry)!) ?? true}
                  onToggle={() => onToggleShown(visibilityId(entry)!)}
                />
              )}
              {step && stepDrop.drop?.error && stepDrop.drop.onto === step.id && (
                <span className={`cad-feature-drop-reason${stepDrop.drop.above ? ' cad-feature-drop-reason-above' : ''}`} role="status">
                  {stepDrop.drop.error}
                </span>
              )}
              {index === barAt && (index < entries.length - 1 || onRollTo) && (
                <RollbackBar stepId={step?.id ?? null} stepIds={stepIds} onRollTo={onRollTo} onMenu={(x, y) => setBarMenu({ x, y })} />
              )}
            </li>
          );
        })}
      </ol>
      {onRollTo && rollbackAt < 0 && (
        <RollbackBar stepId={null} stepIds={stepIds} onRollTo={onRollTo} onMenu={(x, y) => setBarMenu({ x, y })} />
      )}
      {folders.controls}
      {barMenu && onRollTo && (
        <div className="cad-feature-menu" role="menu" aria-label="Rollback bar actions" style={{ left: barMenu.x, top: barMenu.y }}>
          <button
            type="button"
            role="menuitem"
            autoFocus
            onBlur={() => setBarMenu(null)}
            onClick={() => {
              setBarMenu(null);
              onRollTo(null);
            }}>
            Roll to end
          </button>
        </div>
      )}
      {menu && (
        <div
          ref={menuRef}
          className="cad-feature-menu"
          role="menu"
          aria-label={`${label(menu.entry)} actions`}
          style={{ left: menu.x, top: menu.y }}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.key === 'Escape') setMenu(null);
            else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const items = [...menuRef.current!.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled])')];
              const at = items.indexOf(window.document.activeElement as HTMLElement);
              items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
            }
          }}>
          {menuItems(menu.entry, rollbackAt >= 0 && entries.findIndex(entry => key(entry) === key(menu.entry)) > rollbackAt).map(item => (
            <button
              key={item.action}
              type="button"
              role="menuitem"
              aria-disabled={item.disabled || undefined}
              onClick={() => {
                if (item.disabled) return;
                const { entry } = menu;
                setMenu(null);
                if (item.action === 'rename' && entry.kind === 'step') setRenaming(entry.step.id);
                else onAction(entry, item.action);
              }}>
              {item.label}
            </button>
          ))}
        </div>
      )}
      {planeMenu && (
        <PartRowMenu
          name={planeMenu.name}
          x={planeMenu.x}
          y={planeMenu.y}
          onClose={closePlaneMenu}
          items={[
            ...(onNewSketch ? [{ label: 'New sketch', onSelect: () => onNewSketch(planeMenu.plane) }] : []),
            ...(onToggleShown
              ? [{ label: shown?.(planeMenu.plane) === false ? 'Show' : 'Hide', onSelect: () => onToggleShown(planeMenu.plane) }]
              : []),
          ]}
        />
      )}
    </section>
  );
}
