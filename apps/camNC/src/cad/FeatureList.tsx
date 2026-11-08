import { cadVariableValues, type CadDocument } from '@wbcnc/cad';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { designSteps, type DesignStep } from './designSteps';
import { formatCadValue } from './valueExpressions';
import './featureList.css';

const kIcons: Record<DesignStep['kind'] | 'variable', string> = {
  variable: '(x)',
  sketch: '✎',
  extrude: '▮',
  faceSketch: '✎',
  cut: '⌴',
  copy: '⧉',
  pattern: '⋯',
  partCut: '⊟',
};

/** A row of the list: a design variable, or a step of how the design is built. */
export type FeatureEntry = { kind: 'variable'; id: string } | { kind: 'step'; step: DesignStep };
export type FeatureAction = 'edit' | 'editSketch' | 'rename' | 'suppress' | 'delete';

/** What each row's menu offers, and why an item isn't there for it. */
function menuItems(entry: FeatureEntry): { action: FeatureAction; label: string; disabled?: boolean }[] {
  if (entry.kind === 'variable')
    return [
      { action: 'edit', label: 'Edit…' },
      { action: 'delete', label: 'Delete' },
    ];
  const { kind } = entry.step;
  return [
    ...(kind === 'sketch' || kind === 'extrude' ? [{ action: 'rename' as const, label: 'Rename' }] : []),
    { action: 'edit', label: 'Edit…' },
    ...(kind === 'extrude' ? [{ action: 'editSketch' as const, label: 'Edit sketch…' }] : []),
    { action: 'suppress', label: 'Suppress', disabled: kind !== 'cut' },
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
}: {
  document: CadDocument;
  selectedPartId: string | null;
  onSelect: (entry: FeatureEntry) => void;
  onAction: (entry: FeatureEntry, action: FeatureAction) => void;
  /** A part's new name, typed in place of its step's. */
  onRename: (partId: string, name: string) => void;
  /** The step being edited: the ones after it are greyed out, as the design is shown only that far. */
  rollback?: string | null;
}) {
  const { scope } = cadVariableValues(document);
  const entries: FeatureEntry[] = [
    ...(document.variables ?? []).map(variable => ({ kind: 'variable' as const, id: variable.id })),
    ...designSteps(document).map(step => ({ kind: 'step' as const, step })),
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
    const variable = document.variables!.find(candidate => candidate.id === entry.id)!;
    const result = scope[variable.name];
    const unit = result?.kind === 'length' ? ' mm' : result?.kind === 'angle' ? '°' : '';
    return `#${variable.name} = ${result ? `${formatCadValue(result.value)}${unit}` : variable.expression}`;
  };
  const key = (entry: FeatureEntry) => (entry.kind === 'step' ? entry.step.id : entry.id);
  const rollbackAt = rollback ? entries.findIndex(entry => key(entry) === rollback) : -1;
  const open = (entry: FeatureEntry, event: MouseEvent) => {
    event.preventDefault();
    onSelect(entry);
    setMenu({ entry, x: event.clientX, y: event.clientY });
  };
  return (
    <section className="cad-feature-list" aria-label="Features">
      <div className="cad-panel-heading">
        <h2>Features ({entries.length})</h2>
      </div>
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
            <li key={key(entry)} className={rollbackAt >= 0 && index > rollbackAt ? 'cad-feature-rolled-back' : undefined}>
              <button
                type="button"
                aria-current={step && step.partId === selectedPartId ? 'true' : undefined}
                aria-haspopup="menu"
                onClick={() => onSelect(entry)}
                onDoubleClick={() => onAction(entry, 'edit')}
                onContextMenu={event => open(entry, event)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onAction(entry, 'edit');
                  } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    const box = event.currentTarget.getBoundingClientRect();
                    event.preventDefault();
                    onSelect(entry);
                    setMenu({ entry, x: box.left + 24, y: box.bottom });
                  }
                }}>
                <span aria-hidden="true">{kIcons[step ? step.kind : 'variable']}</span>
                <span>{label(entry)}</span>
                {step?.detail && <small>{step.detail}</small>}
              </button>
              {index === rollbackAt && index < entries.length - 1 && (
                <div className="cad-rollback-bar" role="separator" aria-label="Shown up to here" />
              )}
            </li>
          );
        })}
      </ol>
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
          {menuItems(menu.entry).map(item => (
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
