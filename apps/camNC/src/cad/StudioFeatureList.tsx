import { designSteps, type CadDocument } from '@wbcnc/cad';
import { useState, type ComponentProps, type RefObject } from 'react';
import { FeatureList } from './FeatureList';
import { reorderedSteps } from './reorderSteps';
import { ExportDialog, type ExportTarget } from './export/ExportDialog';
import { sketchExportTarget } from './export/sketchExportTarget';

/** Session wiring for the source list stays out of the sketch editor. */
export function StudioFeatureList({
  currentDocument,
  commit,
  onRefusal,
  workspace,
  ...props
}: Omit<ComponentProps<typeof FeatureList>, 'onChange' | 'onRename' | 'onReorder'> & {
  currentDocument: RefObject<CadDocument>;
  commit: (document: CadDocument) => void;
  onRefusal: (message: string | null) => void;
  workspace: boolean;
}) {
  const [exporting, setExporting] = useState<ExportTarget | null>(null);
  return (
    <>
      <FeatureList
        {...props}
        onAction={(entry, action) => {
          if (action !== 'export') return props.onAction(entry, action);
          const target = entry.kind === 'step' ? sketchExportTarget(currentDocument.current, entry.step) : null;
          if (target) setExporting(target);
        }}
        onChange={commit}
        onReorder={
          workspace
            ? (stepId, beforeId) => {
                const document = currentDocument.current;
                const steps = designSteps(document);
                const dragged = steps.find(step => step.id === stepId),
                  target = steps.find(step => step.id === beforeId);
                if (!dragged || !target) return;
                const result = reorderedSteps(document, dragged, target);
                if ('error' in result) return onRefusal(result.error);
                onRefusal(null);
                commit(result.document);
              }
            : undefined
        }
        onRename={(step, name) => {
          const document = currentDocument.current;
          commit({
            ...document,
            revision: document.revision + 1,
            parts: document.parts.map(part =>
              part.id !== step.partId ? part : step.kind === 'extrude' ? { ...part, extrudeName: name } : { ...part, sketchName: name }
            ),
          });
        }}
      />
      <ExportDialog target={exporting} unit={currentDocument.current.lengthUnit ?? 'mm'} onClose={() => setExporting(null)} />
    </>
  );
}
