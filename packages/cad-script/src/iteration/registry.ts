import { cupboardWorkflow } from './cupboard';
import { dividedTrayWorkflow } from './dividedTray';
import { fittedJointsWorkflow } from './fittedJoints';
import { radialStoolWorkflow } from './radialStool';
import { missingDividerToolWorkflow, underconstrainedJointWorkflow } from './woodworkingDiagnostics';
import type { CadWorkflow } from './workflow';

const factories: Record<string, () => CadWorkflow> = {
  cupboard: cupboardWorkflow,
  'divided-tray': dividedTrayWorkflow,
  'fitted-joints': fittedJointsWorkflow,
  'radial-stool': radialStoolWorkflow,
  'tray-missing-tool': missingDividerToolWorkflow,
  'joint-unconstrained': underconstrainedJointWorkflow,
};
export const workflowKeys = Object.keys(factories);
export function selectWorkflow(key = 'cupboard'): CadWorkflow {
  if (!Object.hasOwn(factories, key)) throw new Error(`Unknown workflow ${key}. Available: ${workflowKeys.join(', ')}.`);
  return factories[key]!();
}
export function listWorkflows(key?: string) {
  return (key ? [key] : workflowKeys).map(key => {
    const workflow = selectWorkflow(key);
    return {
      key,
      id: workflow.id,
      name: workflow.name,
      checkpoints: workflow.checkpoints.map(c => c.id),
      unsupportedCheckpoints: workflow.checkpoints.filter(c => c.unsupported).map(c => ({ id: c.id, reason: c.unsupported! })),
    };
  });
}
