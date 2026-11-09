import type { CadPart } from '@wbcnc/cad';
import { useCallback, useState } from 'react';
import { PartRowMenu } from './PartRowMenu';

export interface PartsListRow {
  /** A part's ID, or `part/copy` for one of its copies. */
  key: string;
  part: CadPart;
  name: string;
}

/**
 * The Parts list: a row for each part, and in the studio each copy, with its eye. Right-click a row in the studio to
 * rename it in place or hide it, as in the reference.
 */
export function PartsList({
  rows,
  hidden,
  studio,
  selectedKey,
  hiddenParts,
  onToggleHidden,
  trouble,
  onPick,
  onRename,
}: {
  rows: PartsListRow[];
  hidden: boolean;
  studio: boolean;
  selectedKey: string | undefined;
  hiddenParts: ReadonlySet<string>;
  onToggleHidden: (key: string) => void;
  /** What's wrong with a part, shown as a warning on its row. */
  trouble: (partId: string) => string | null | undefined;
  onPick: (partId: string) => void;
  /** A part, or one of its copies, named anew. */
  onRename: (partId: string, copyId: string | null, name: string) => void;
}) {
  const [menu, setMenu] = useState<{ key: string; name: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  return (
    <>
      <ul className="cad-part-list" aria-label="Parts" hidden={hidden}>
        {rows.map(({ key, part: p, name }) => (
          <li key={key}>
            {renaming === key ? (
              <input
                className="cad-feature-rename"
                aria-label={`New name for ${name}`}
                defaultValue={name}
                autoFocus
                onFocus={event => event.currentTarget.select()}
                onBlur={event => {
                  const next = event.currentTarget.value.trim();
                  setRenaming(null);
                  if (next && next !== name) onRename(p.id, key === p.id ? null : key.slice(p.id.length + 1), next);
                }}
                onKeyDown={event => {
                  event.stopPropagation();
                  if (event.key === 'Enter') event.currentTarget.blur();
                  else if (event.key === 'Escape') {
                    event.currentTarget.value = name;
                    event.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <button
                type="button"
                aria-pressed={key === selectedKey}
                onContextMenu={event => {
                  if (!studio) return;
                  event.preventDefault();
                  setMenu({ key, name, x: event.clientX, y: event.clientY });
                }}
                onClick={() => onPick(p.id)}>
                <span aria-hidden="true">▱</span>
                <span>{name}</span>
                {key === p.id && trouble(p.id) && (
                  <span className="cad-part-trouble" role="img" aria-label={trouble(p.id)!} title={trouble(p.id)!}>
                    ⚠
                  </span>
                )}
                <small>{p.thickness} mm</small>
              </button>
            )}
            {studio && (
              <button
                type="button"
                className="cad-part-eye"
                aria-label={`${hiddenParts.has(key) ? 'Show' : 'Hide'} ${name}`}
                title={hiddenParts.has(key) ? 'Show in the view' : 'Hide in the view'}
                aria-pressed={!hiddenParts.has(key)}
                onClick={() => onToggleHidden(key)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                  {hiddenParts.has(key) ? <path d="M4 4l16 16" /> : <circle cx="12" cy="12" r="3" />}
                </svg>
              </button>
            )}
          </li>
        ))}
      </ul>
      {menu && (
        <PartRowMenu
          name={menu.name}
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          items={[
            { label: 'Rename', onSelect: () => setRenaming(menu.key) },
            { label: hiddenParts.has(menu.key) ? 'Show' : 'Hide', onSelect: () => onToggleHidden(menu.key) },
          ]}
        />
      )}
    </>
  );
}
