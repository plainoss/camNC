import { useDesignUnits } from './designUnits';
import { edgeFilletProblems, type CadDocument, type CadFolder, type CadPart } from '@wbcnc/cad';
import { useCallback, useState } from 'react';
import { PartRowMenu } from './PartRowMenu';
import { MaterialPanel } from './MaterialPanel';
import { PartPropertiesDialog } from './PartPropertiesDialog';
import { replacePart } from './editorHelpers';
import { partMatchesFilter, useFeatureFilter } from './featureFilter';
import { MakeTransparentPanel } from './MakeTransparentPanel';
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
  onEdit,
  document,
  rolledTo,
  folders = document?.folders,
  onSketchCopy,
  onDetachCopy,
  transparent,
}: {
  /** The parts made see-through in the view, and how to change them, as the Part menu's Make transparent does. */
  transparent?: [ReadonlySet<string>, (keys: ReadonlySet<string>) => void];
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
  /** Changes the design as it now is, as assigning a material does. */
  onEdit?: (change: (document: CadDocument) => CadDocument) => void;
}) {
  const { formatLength, lengthUnit } = useDesignUnits();
  const [menu, setMenu] = useState<{ key: string; name: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportTarget | null>(null);
  const [seeThrough, setSeeThrough] = useState(false);
  // The row whose Material panel or Properties dialog is open: a copy's are its part's.
  const [panel, setPanel] = useState<{ kind: 'material' | 'properties'; key: string; name: string } | null>(null);
  const panelRow = panel && rows.find(row => row.key === panel.key);
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
  // The Feature list's filter narrows the parts too: those it drops are one "…".
  const filterText = useFeatureFilter();
  const kept = filterText.trim() ? rows.filter(row => partMatchesFilter(row.part.name, filterText)) : null;
  const listed = kept
    ? [
        ...kept.map(renderRow),
        ...(kept.length < rows.length
          ? [
              <li key="elided" className="cad-feature-elided">
                …
              </li>,
            ]
          : []),
      ]
    : rows.map(row => {
        const folder = folders?.find(folder => folder.partIds.includes(row.part.id));
        if (!folder) return renderRow(row);
        if (grouped.has(folder.id)) return null;
        grouped.add(folder.id);
        return (
          <li key={folder.id} className="cad-parts-folder">
            <details open>
              <summary>{folder.name}</summary>
              <ul aria-label={`${folder.name} parts`}>
                {rows.filter(candidate => folder.partIds.includes(candidate.part.id)).map(renderRow)}
              </ul>
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
            ...(onEdit
              ? [
                  { label: 'Properties…', onSelect: () => setPanel({ kind: 'properties', key: menu.key, name: menu.name }) },
                  { label: 'Assign material…', onSelect: () => setPanel({ kind: 'material', key: menu.key, name: menu.name }) },
                  // With a material, a part has a mass and a center to it.
                  ...(rows.find(row => row.key === menu.key)?.part.material
                    ? [{ label: 'Show center of mass', onSelect: () => setPanel({ kind: 'properties', key: menu.key, name: menu.name }) }]
                    : []),
                ]
              : []),
            { label: hiddenParts.has(menu.key) ? 'Show' : 'Hide', onSelect: () => onToggleHidden(menu.key) },
            ...(transparent
              ? [
                  {
                    label: 'Make transparent…',
                    onSelect: () => {
                      transparent[1](new Set([...transparent[0], menu.key]));
                      setSeeThrough(true);
                    },
                  },
                  // While parts are see-through, any part's menu can end it.
                  ...(transparent[0].size || seeThrough
                    ? [
                        {
                          label: 'Exit make transparent',
                          onSelect: () => {
                            transparent[1](new Set());
                            setSeeThrough(false);
                          },
                        },
                      ]
                    : []),
                ]
              : []),
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
      {panel?.kind === 'material' && panelRow && onEdit && (
        <MaterialPanel
          partName={panel.name}
          material={panelRow.part.material}
          onClose={() => setPanel(null)}
          onAssign={material => {
            onEdit(current =>
              replacePart(current, panelRow.part.id, ({ material: _material, ...part }) => (material ? { ...part, material } : part))
            );
            setPanel(null);
          }}
        />
      )}
      {panel?.kind === 'properties' && panelRow && (
        <PartPropertiesDialog part={panelRow.part} name={panel.name} onClose={() => setPanel(null)} />
      )}
      {transparent && seeThrough && (
        <MakeTransparentPanel
          onClose={() => {
            transparent[1](new Set());
            setSeeThrough(false);
          }}
        />
      )}
    </>
  );
}
