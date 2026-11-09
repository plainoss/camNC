/**
 * While a step before the last is edited, the view shows the design only that far; Final shows it all, with the change.
 * The editor says whether it's offered, and the dialog shows its button. Null when there's nothing after the step.
 */
type FinalPreview = { shown: boolean; toggle: () => void } | null;
let finalPreview: FinalPreview = null;
const listeners = new Set<() => void>();
export function offerFinalPreview(next: FinalPreview) {
  finalPreview = next;
  listeners.forEach(listener => listener());
}
export const subscribeFinalPreview = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const finalPreviewNow = () => finalPreview;
