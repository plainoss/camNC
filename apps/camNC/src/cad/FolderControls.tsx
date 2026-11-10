import {
  cadFolderSteps,
  deleteCadFolder,
  dissolveCadFolder,
  setCadFolderCollapsed,
  setCadFolderSuppressed,
  type CadDocument,
  type CadFolder,
} from '@wbcnc/cad';
import { useCallback, useState } from 'react';
import { CadVariablesPanel } from './CadVariablesPanel';
import { FeatureDialog } from './FeatureDialog';
import { PartRowMenu } from './PartRowMenu';
import { FolderNameDialog } from './FolderNameDialog';

/** Folder controls edit ordinary metadata; no action reruns an insertion script. */
export function useFolderControls({
  document,
  onChange,
  onRollTo,
  selectedPartId,
}: {
  document: CadDocument;
  onChange?: (document: CadDocument) => void;
  onRollTo?: (stepId: string | null) => void;
  selectedPartId: string | null;
}) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'new' | 'rename' | 'settings'; id?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const apply = (result: { document: CadDocument } | { error: string }) => {
    if ('error' in result) setError(result.error);
    else {
      setError(null);
      onChange?.(result.document);
    }
  };
  const folder = document.folders?.find(folder => folder.id === menu?.id);
  const edited = document.folders?.find(folder => folder.id === dialog?.id);
  return {
    newFolder: () => setDialog({ kind: 'new' }),
    openMenu: (id: string, x: number, y: number) => setMenu({ id, x, y }),
    settings: (id: string) => setDialog({ kind: 'settings', id }),
    toggle: (folder: CadFolder) => apply(setCadFolderCollapsed(document, folder.id, !folder.collapsed)),
    controls: (
      <>
        {error && (
          <p role="alert" className="cad-folder-error">
            {error}
          </p>
        )}
        {menu && folder && (
          <PartRowMenu
            name={folder.name}
            x={menu.x}
            y={menu.y}
            onClose={closeMenu}
            items={[
              { label: 'Settings…', onSelect: () => setDialog({ kind: 'settings', id: folder.id }) },
              { label: 'Rename', onSelect: () => setDialog({ kind: 'rename', id: folder.id }) },
              {
                label: folder.suppressed ? 'Unsuppress' : 'Suppress',
                onSelect: () => apply(setCadFolderSuppressed(document, folder.id, !folder.suppressed)),
              },
              ...(onRollTo
                ? [
                    {
                      label: 'Roll to here',
                      onSelect: () => {
                        const last = cadFolderSteps(document, folder.id).at(-1);
                        if (last) onRollTo(last.id);
                      },
                    },
                  ]
                : []),
              { label: 'Unpack folder', onSelect: () => apply({ document: dissolveCadFolder(document, folder.id) }) },
              { label: 'Delete folder and contents', onSelect: () => apply(deleteCadFolder(document, folder.id)) },
            ]}
          />
        )}
        {dialog && dialog.kind !== 'settings' && onChange && (
          <FolderNameDialog
            key={dialog.id ?? 'new'}
            document={document}
            folder={edited}
            selectedPartId={selectedPartId}
            onChange={onChange}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === 'settings' && edited && onChange && (
          <FeatureDialog title={edited.name} onOk={() => setDialog(null)} onCancel={() => setDialog(null)}>
            <CadVariablesPanel document={document} folderId={edited.id} onChange={onChange} />
          </FeatureDialog>
        )}
      </>
    ),
  };
}
