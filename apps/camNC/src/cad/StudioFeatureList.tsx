import { designSteps, type CadDocument } from '@wbcnc/cad';
import type { ComponentProps, RefObject } from 'react';
import { FeatureList } from './FeatureList';
import { reorderDrop, reorderedSteps } from './reorderSteps';

/** Session wiring for the source list stays out of the sketch editor. */
export function StudioFeatureList({
  currentDocument,
  commit,
  onRefusal,
  workspace,
  ...props
}: Omit<ComponentProps<typeof FeatureList>, 'onChange' | 'onRename' | 'onReorder' | 'reorderDrop'> & {
  currentDocument: RefObject<CadDocument>;
  commit: (document: CadDocument) => void;
  onRefusal: (message: string | null) => void;
  workspace: boolean;
}) {
  return (
    <FeatureList
      {...props}
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
      reorderDrop={workspace ? (stepId, ontoId) => reorderDrop(currentDocument.current, stepId, ontoId) : undefined}
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
  );
}
