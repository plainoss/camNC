import { useDesignUnits } from './designUnits';
import { edgeFilletProblems, type CadDocument, type CadFolder, type CadPart } from '@wbcnc/cad';
import { useCallback, useState } from 'react';
import { PartRowMenu } from './PartRowMenu';
import { ExportDialog, type ExportTarget } from './export/ExportDialog';
import { shownPartsTarget } from './export/shownPartsTarget';

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
  document,
  rolledTo,
  folders = document?.folders,
  onSketchCopy,
  onDetachCopy,
}: {
  rows: PartsListRow[];
  folders?: CadFolder[];
  onSketchCopy?: (partId: string, copyId: string, face: 'top' | 'underside') => void;
  onDetachCopy?: (partId: string, copyId: string) => void;
  /** The design: its folders, unless given, and in the studio what a row's Export… writes from. */
  document?: CadDocument;
  /** The step the view's rollback bar sits after, or null at the end: Export… writes the design as it is there. */
  rolledTo?: string | null;
  hidden: boolean;
  studio: boolean;
  selectedKey: string | undefined;
  hiddenParts: ReadonlySet<string>;
  onToggleHidden: (key: string) => void;
  /** What's wrong with a part, shown as a warning on its row. */
  trouble: (partId: string) => string | null | undefined;
  onPick: (partId: string, copyId?: string) => void;
  /** A part, or one of its copies, named anew. */
  onRename: (partId: string, copyId: string | null, name: string) => void;
}) {
  const { formatLength, lengthUnit } = useDesignUnits();
  const [menu, setMenu] = useState<{ key: string; name: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportTarget | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // A Fillet step that leaves corners sharp is a problem with the part too, as the check reports it.
  const problemOf = (part: CadPart) => trouble(part.id) || edgeFilletProblems(part)[0]?.message;
  const renderRow = ({ key, part: p, name }: PartsListRow) => (
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
          onClick={() => onPick(p.id, key === p.id ? undefined : key.slice(p.id.length + 1))}>
          <span aria-hidden="true">▱</span>
          <span>{name}</span>
          {key === p.id && problemOf(p) && (
            <span className="cad-part-trouble" role="img" aria-label={problemOf(p)!} title={problemOf(p)!}>
              ⚠
            </span>
          )}
          <small>
            {formatLength(p.thickness)} {lengthUnit}
          </small>
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
  );
  const grouped = new Set<string>();
  const listed = rows.map(row => {
    const folder = folders?.find(folder => folder.partIds.includes(row.part.id));
    if (!folder) return renderRow(row);
    if (grouped.has(folder.id)) return null;
    grouped.add(folder.id);
    return (
      <li key={folder.id} className="cad-parts-folder">
        <details open>
          <summary>{folder.name}</summary>
          <ul aria-label={`${folder.name} parts`}>{rows.filter(candidate => folder.partIds.includes(candidate.part.id)).map(renderRow)}</ul>
        </details>
      </li>
    );
  });
  return (
    <>
      <ul className="cad-part-list" aria-label="Parts" hidden={hidden}>
        {listed}
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
            ...(() => {
              const row = rows.find(row => row.key === menu.key);
              const exportDocument = studio ? document : undefined;
              if (!row || !exportDocument) return [];
              const copyId = menu.key !== row.part.id ? menu.key.slice(row.part.id.length + 1) : undefined;
              const only = { partId: row.part.id, ...(copyId && { copyId }) };
              return [
                {
                  label: 'Export…',
                  onSelect: () => setExporting(shownPartsTarget(exportDocument, rolledTo, { name: menu.name, only })),
                },
              ];
            })(),
            ...(() => {
              const row = rows.find(row => row.key === menu.key);
              const copyId = row && menu.key !== row.part.id ? menu.key.slice(row.part.id.length + 1) : null;
              if (!row || !copyId) return [];
              return [
                ...(onSketchCopy
                  ? [
                      { label: 'Sketch on this copy’s top', onSelect: () => onSketchCopy(row.part.id, copyId, 'top') },
                      { label: 'Sketch on this copy’s underside', onSelect: () => onSketchCopy(row.part.id, copyId, 'underside') },
                    ]
                  : []),
                ...(onDetachCopy ? [{ label: 'Detach copy', onSelect: () => onDetachCopy(row.part.id, copyId) }] : []),
              ];
            })(),
          ]}
        />
      )}
      <ExportDialog target={exporting} unit={lengthUnit} onClose={() => setExporting(null)} />
    </>
  );
}
