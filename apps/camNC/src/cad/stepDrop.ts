import { useRef, useState, type DragEvent } from 'react';

/** What dropping the dragged step on a row would do: the step it then goes before (null at the end), or why it can't. */
export type StepDropCheck = (stepId: string, ontoId: string) => { before: string | null } | { error: string } | null;
/** The row a step is dragged over, and what dropping it there would do. */
export type StepDrop = { stepId: string; onto: string; before?: string | null; error?: string };

/**
 * Follows a step dragged in the feature list, so the list can draw a line where it would land, or mark the row it
 * can't go to with the reason, before it's dropped. A drop the check refuses isn't taken, so the pointer says so too.
 */
export function useStepDrop(check?: StepDropCheck) {
  // The drag's data can't be read until the drop, so the dragged step is kept from its start.
  const dragging = useRef<string | null>(null);
  const [drop, setDrop] = useState<StepDrop | null>(null);
  const shown = useRef<StepDrop | null>(null);
  const show = (next: StepDrop | null) => {
    shown.current = next;
    setDrop(next);
  };
  return {
    drop,
    start(stepId: string) {
      dragging.current = stepId;
      // A drag whose end was missed (its row went away) mustn't leave a check made against an older design.
      shown.current = null;
    },
    end() {
      dragging.current = null;
      if (shown.current) show(null);
    },
    /** Over a row a step can't be dropped on at all, or out of the list. */
    leave() {
      if (shown.current) show(null);
    },
    /** A step dragged over another's row: takes the drop when it would move it there, and shows where or why not. */
    over(event: DragEvent, ontoId: string) {
      const stepId = dragging.current;
      if (!stepId) {
        event.preventDefault();
        return;
      }
      // Dragover repeats while the pointer rests on a row, so a row is only checked once.
      let next = shown.current?.onto === ontoId && shown.current.stepId === stepId ? shown.current : null;
      if (!next) {
        // Unchecked, a step goes just before the one it's dropped on.
        const result = check ? check(stepId, ontoId) : stepId === ontoId ? null : { before: ontoId };
        next = { stepId, onto: ontoId, ...(result && ('error' in result ? { error: result.error } : { before: result.before })) };
        show(next);
      }
      if (next.before !== undefined) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      } else event.dataTransfer.dropEffect = 'none';
    },
  };
}
