import { dividedTrayWorkflow } from './dividedTray';
import { loadWoodworkingSource, sourceVariable } from './woodworkingChecks';
import type { CadWorkflow } from './workflow';

/** Preserve the whole tray and exact missing tool reference; do not substitute a sibling or infer a golden shape. */
export function missingDividerToolWorkflow(): CadWorkflow {
  const workflow = dividedTrayWorkflow();
  return {
    ...workflow,
    id: 'divided-tray-missing-tool',
    name: 'Selected divider disappears after pattern shrink',
    checkpoints: [
      ...workflow.checkpoints.slice(0, 4),
      {
        id: 'missing-selected-tool',
        edit: d => sourceVariable(d, 'dividers', '2'),
        unsupported:
          'The selected third physical tool no longer exists. Restore its source slot or explicitly select another tool; no replacement geometry is inferred.',
        checks: [],
      },
    ],
  };
}

/** The original saved face-sketch case remains an incomplete diagnostic, rather than an incidental solved golden. */
export function underconstrainedJointWorkflow(): CadWorkflow {
  return {
    id: 'fitted-joint-unconstrained-source',
    name: 'Original face-sketch joint with unresolved strip height',
    create: () => loadWoodworkingSource('finger-joint-face-sketch'),
    checkpoints: [
      {
        id: 'unresolved-strip-height',
        unsupported:
          'The original source leaves one strip-height degree of freedom. Freeze an explicit authored dimension before claiming expected geometry.',
        checks: [],
      },
    ],
  };
}
