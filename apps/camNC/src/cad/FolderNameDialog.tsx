import { createCadFolder, renameCadFolder, type CadDocument, type CadFolder } from '@wbcnc/cad';
import { useId, useState } from 'react';
import { FeatureDialog } from './FeatureDialog';

export function FolderNameDialog({
  document,
  folder,
  selectedPartId,
  onChange,
  onClose,
}: {
  document: CadDocument;
  folder?: CadFolder;
  selectedPartId: string | null;
  onChange: (document: CadDocument) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(folder?.name ?? 'Folder');
  const [partIds, setPartIds] = useState<string[]>(
    selectedPartId && !document.folders?.some(folder => folder.partIds.includes(selectedPartId)) ? [selectedPartId] : []
  );
  const [planeIds, setPlaneIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const result = folder
      ? renameCadFolder(document, folder.id, name)
      : createCadFolder(document, {
          name,
          partIds,
          planeIds: (document.planes ?? []).filter(plane => planeIds.includes(plane.id)).map(plane => plane.id),
        });
    if ('error' in result) return setError(result.error);
    onChange(result.document);
    onClose();
  };
  const available = document.parts.filter(part => !document.folders?.some(candidate => candidate.partIds.includes(part.id)));
  const availablePlanes = (document.planes ?? []).filter(
    plane => !document.folders?.some(candidate => candidate.planeIds?.includes(plane.id))
  );
  return (
    <FeatureDialog title={folder ? 'Rename folder' : 'New folder'} onOk={save} onCancel={onClose}>
      <label className="cad-number-field" htmlFor={`${id}-name`}>
        Name
        <input id={`${id}-name`} value={name} autoFocus onChange={event => setName(event.target.value)} />
      </label>
      {!folder && (
        <fieldset className="cad-folder-members">
          <legend>Neighbouring parts</legend>
          {available.map(part => (
            <label key={part.id}>
              <input
                type="checkbox"
                checked={partIds.includes(part.id)}
                onChange={event =>
                  setPartIds(previous => (event.target.checked ? [...previous, part.id] : previous.filter(id => id !== part.id)))
                }
              />
              {part.name}
            </label>
          ))}
        </fieldset>
      )}
      {!folder && availablePlanes.length > 0 && (
        <fieldset className="cad-folder-members">
          <legend>Neighbouring planes</legend>
          {availablePlanes.map(plane => (
            <label key={plane.id}>
              <input
                type="checkbox"
                checked={planeIds.includes(plane.id)}
                onChange={event =>
                  setPlaneIds(previous => (event.target.checked ? [...previous, plane.id] : previous.filter(id => id !== plane.id)))
                }
              />
              {plane.name}
            </label>
          ))}
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
    </FeatureDialog>
  );
}
