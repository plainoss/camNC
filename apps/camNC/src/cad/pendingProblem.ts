/**
 * Why the feature an open dialog is making isn't made yet, as a missing pick, for its row in the feature list to show
 * red while it waits. The dialog says so; the list reads it. Null when it's fine or no dialog says.
 */
let problem: string | null = null;
const listeners = new Set<() => void>();
export function setPendingProblem(next: string | null) {
  if (next === problem) return;
  problem = next;
  listeners.forEach(listener => listener());
}
export const subscribePendingProblem = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const pendingProblemNow = () => problem;
