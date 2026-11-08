import { assemblyReport, evaluateCadDocument, type CadDocument } from '@wbcnc/cad';
import { useMemo, useRef, useState } from 'react';
import { ModelViewport, type ModelView } from '@/cam/model/ModelViewport';
import { assemblyModel } from './assemblyModel';

const kViews: { view: ModelView; label: string }[] = [
  { view: 'assembled', label: 'Assembled' },
  { view: 'exploded', label: 'Exploded' },
  { view: 'flat', label: 'Laid flat' },
];
const always = () => true;
/** Two clicks this close together open a part, rather than selecting it twice. */
const kDoubleClickMs = 400;

/** Every part of the design where it sits. Click a part to select it, and double-click it to work on it. */
export default function WorkspaceView({
  document,
  selectedId,
  onSelect,
  onOpen,
}: {
  document: CadDocument;
  selectedId: string | null;
  onSelect: (partId: string) => void;
  onOpen: (partId: string) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const lastClick = useRef<{ partId: string; at: number } | null>(null);
  const model = useMemo(() => assemblyModel(document), [document]);
  const clashes = useMemo(() => assemblyReport(document, evaluateCadDocument(document).parts)?.collisions ?? [], [document]);
  const [view, setView] = useState<ModelView>('assembled');
  const selectedIndexes = model.instances.flatMap((instance, index) => (instance.partId === selectedId ? [index] : []));
  const status = clashes.length
    ? `${clashes.map(clash => `${clash.parts[0]} and ${clash.parts[1]}`).join(', ')} take up the same space.`
    : model.problems.length
      ? `Not shown: ${model.problems.map(problem => `${problem.name} (${problem.message})`).join(', ')}`
      : view === 'flat'
        ? 'Each part turned so its machined side faces up, the way it lies on the board.'
        : model.meshes.length
          ? 'Click a part to select it, double-click to work on it. Drag to orbit.'
          : 'Draw a part to start.';
  return (
    <div ref={frame} className="cad-part-view cad-assembly-view" data-testid="workspace-3d" tabIndex={-1}>
      <div className="cad-part-view-tools cad-assembly-tools">
        <div role="group" aria-label="Workspace view">
          {kViews.map(option => (
            <button key={option.view} type="button" aria-pressed={view === option.view} onClick={() => setView(option.view)}>
              {option.label}
            </button>
          ))}
        </div>
        {selectedId && (
          <button type="button" onClick={() => onOpen(selectedId)}>
            Open {document.parts.find(part => part.id === selectedId)?.name ?? 'part'}
          </button>
        )}
      </div>
      <ModelViewport
        meshes={model.meshes}
        parts={model.parts}
        view={view}
        selectedId={selectedId}
        selectedIndexes={selectedIndexes}
        warnIds={clashes.flatMap(clash => clash.partIds)}
        milled={always}
        onSelect={(_, index) => {
          const partId = model.instances[index]!.partId;
          const now = Date.now();
          if (lastClick.current?.partId === partId && now - lastClick.current.at < kDoubleClickMs) {
            lastClick.current = null;
            return onOpen(partId);
          }
          lastClick.current = { partId, at: now };
          onSelect(partId);
          frame.current?.focus();
        }}
      />
      <p role="status">{status}</p>
    </div>
  );
}
