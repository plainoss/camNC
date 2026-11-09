import { cadVariableValues, type CadDocument } from '@wbcnc/cad';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { kBasePlanes } from './basePlanes';
import { designSteps, type DesignStep } from './designSteps';
import { formatCadValue } from './valueExpressions';
import './featureList.css';

const kIcons: Record<DesignStep['kind'] | 'variable' | 'plane', string> = {
  variable: '(x)',
  plane: '▱',
  sketch: '✎',
  extrude: '▮',
  move: '⇥',
  faceSketch: '✎',
  cut: '⌴',
  copy: '⧉',
  pattern: '⋯',
  partCut: '⊟',
};

/** A row of the list: a design variable, a plane made to sketch on, or a step of how the design is built. */
export type FeatureEntry = { kind: 'variable'; id: string } | { kind: 'plane'; id: string } | { kind: 'step'; step: DesignStep };
export type FeatureAction = 'edit' | 'editSketch' | 'rename' | 'suppress' | 'rollTo' | 'rollToEnd' | 'delete';

/** What each row's menu offers, and why an item isn't there for it. */
function menuItems(entry: FeatureEntry, rolledBack = false): { action: FeatureAction; label: string; disabled?: boolean }[] {
  if (entry.kind === 'variable' || entry.kind === 'plane')
    return [
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
  onSelect,
  onAction,
  onRename,
  rollback,
  onRollTo,
  onHover,
  selectedPlane,
  onPickPlane,
}: {
  document: CadDocument;
  selectedPartId: string | null;
  onSelect: (entry: FeatureEntry) => void;
  onAction: (entry: FeatureEntry, action: FeatureAction) => void;
  /** A part's new name, typed in place of its step's. */
  onRename: (partId: string, name: string) => void;
  /** The step being edited: the ones after it are greyed out, as the design is shown only that far. */
  rollback?: string | null;
  /**
   * Moves the rollback bar to just after a step, or to the end with null, as dragging it, stepping it with the arrow keys
   * or Roll to here does in the reference. Without it the bar only shows while a step is edited.
   */
  onRollTo?: (stepId: string | null) => void;
  /** A row hovered, for the view to highlight what it made; null when the pointer leaves. */
  onHover?: (entry: FeatureEntry | null) => void;
  /** The base plane picked, in the list or the view, and picking one, as the reference lists them first. */
  selectedPlane?: string | null;
  onPickPlane?: (plane: string) => void;
}) {
  const { scope } = cadVariableValues(document);
  const blank = new Set(
    document.parts
      .filter(part => !part.drawnOn && part.sketch.entities.every(entity => entity.type === 'point' && entity.fixed))
      .map(part => part.id)
  );
  const entries: FeatureEntry[] = [
    ...(document.variables ?? []).map(variable => ({ kind: 'variable' as const, id: variable.id })),
    ...(document.planes ?? []).map(plane => ({ kind: 'plane' as const, id: plane.id })),
    // A part with nothing drawn yet, such as a new design's, isn't a feature until it's sketched.
    ...designSteps(document)
      .filter(step => !blank.has(step.partId))
      .map(step => ({ kind: 'step' as const, step })),
  ];
  const [menu, setMenu] = useState<{ entry: FeatureEntry; x: number; y: number } | null>(null);
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
  const label = (entry: FeatureEntry) => {
    if (entry.kind === 'step') return entry.step.label;
    if (entry.kind === 'plane') return document.planes!.find(candidate => candidate.id === entry.id)!.name;
    const variable = document.variables!.find(candidate => candidate.id === entry.id)!;
    const result = scope[variable.name];
    const unit = result?.kind === 'length' ? ' mm' : result?.kind === 'angle' ? '°' : '';
    return `#${variable.name} = ${result ? `${formatCadValue(result.value)}${unit}` : variable.expression}`;
  };
  const key = (entry: FeatureEntry) => (entry.kind === 'step' ? entry.step.id : entry.id);
  const rollbackAt = rollback ? entries.findIndex(entry => key(entry) === rollback) : -1;
  // With the bar movable it's always there: after the step it's rolled to, or at the end.
  const barAt = rollbackAt >= 0 ? rollbackAt : onRollTo ? entries.length - 1 : -1;
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
    onSelect(entry);
    setMenu({ entry, x: event.clientX, y: event.clientY });
  };
  return (
    <section className="cad-studio-features" aria-label="Features" tabIndex={-1}>
      <div className="cad-panel-heading">
        <h2>Features ({entries.length})</h2>
      </div>
      {onPickPlane && (
        <ul className="cad-default-geometry" aria-label="Default geometry">
          {kBasePlanes.map(({ plane, label: name }) => (
            <li key={plane}>
              <button type="button" aria-pressed={selectedPlane === plane} onClick={() => onPickPlane(plane)}>
                <span aria-hidden="true">▱</span>
                <span>{name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <ol>
        {entries.map((entry, index) => {
          const step = entry.kind === 'step' ? entry.step : null;
          if (step && renaming === step.id) {
            const part = document.parts.find(candidate => candidate.id === step.partId);
            return (
              <li key={key(entry)}>
                <input
                  className="cad-feature-rename"
                  aria-label="New name"
                  defaultValue={part?.name ?? ''}
                  autoFocus
                  onFocus={event => event.currentTarget.select()}
                  onBlur={event => {
                    const name = event.currentTarget.value.trim();
                    if (name && part && name !== part.name) onRename(part.id, name);
                    setRenaming(null);
                  }}
                  onKeyDown={event => {
                    event.stopPropagation();
                    if (event.key === 'Enter') event.currentTarget.blur();
                    else if (event.key === 'Escape') {
                      event.currentTarget.value = part?.name ?? '';
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
              onDragOver={event => {
                if (onRollTo && entry.kind === 'step' && event.dataTransfer.types.includes('text/x-cad-rollback')) event.preventDefault();
              }}
              onDrop={event => {
                if (!event.dataTransfer.types.includes('text/x-cad-rollback')) return;
                event.preventDefault();
                rollToIndex(index);
              }}
              className={
                [rollbackAt >= 0 && index > rollbackAt && 'cad-feature-rolled-back', step?.suppressed && 'cad-feature-suppressed']
                  .filter(Boolean)
                  .join(' ') || undefined
              }>
              <button
                type="button"
                aria-current={step && step.partId === selectedPartId ? 'true' : undefined}
                aria-pressed={entry.kind === 'plane' ? selectedPlane === entry.id : undefined}
                aria-haspopup="menu"
                onClick={() => {
                  // A plane is picked to sketch on, as a base plane is.
                  if (entry.kind === 'plane') onPickPlane?.(entry.id);
                  onSelect(entry);
                }}
                onDoubleClick={() => onAction(entry, 'edit')}
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
                    onSelect(entry);
                    setMenu({ entry, x: box.left + 24, y: box.bottom });
                  }
                }}>
                <span aria-hidden="true">{kIcons[step ? step.kind : (entry.kind as 'variable' | 'plane')]}</span>
                <span>{label(entry)}</span>
                {step?.detail && <small>{step.detail}</small>}
              </button>
              {index === barAt && (index < entries.length - 1 || onRollTo) && (
                <div
                  className="cad-rollback-bar"
                  role="separator"
                  aria-label="Shown up to here"
                  aria-orientation="horizontal"
                  tabIndex={onRollTo ? 0 : undefined}
                  draggable={!!onRollTo}
                  title={
                    onRollTo ? 'Drag, or use the arrow keys, to show the design up to a step. Right-click to roll to the end.' : undefined
                  }
                  onDragStart={event => {
                    event.dataTransfer.setData('text/x-cad-rollback', '');
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onKeyDown={event => {
                    if (!onRollTo || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const to = event.key === 'ArrowUp' ? index - 1 : index + 1;
                    if (to >= 0 && to < entries.length) rollToIndex(to);
                  }}
                  onContextMenu={event => {
                    if (!onRollTo) return;
                    event.preventDefault();
                    setBarMenu({ x: event.clientX, y: event.clientY });
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>
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
    </section>
  );
}
