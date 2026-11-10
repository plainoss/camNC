import { updatePartCut } from '@wbcnc/cad';
import {
  authoringCheck,
  authoringSignature,
  check,
  identityChecks,
  loadWoodworkingSource,
  materialChecks,
  sourceOwners,
  sourcePart,
  sourceVariable,
} from './woodworkingChecks';
import { trayExpected, type TrayIntent } from './woodworkingExpected';
import type { CadWorkflow, WorkflowCheckpoint } from './workflow';

/** Six source panels remain a complete tray while individual edit failures can be reduced separately. */
export function dividedTrayWorkflow(): CadWorkflow {
  let owners: Record<string, string> = {},
    patternId = '',
    cutId = '',
    authoring = '';
  const states: {
    id: string;
    intent: TrayIntent;
    variables: Record<string, string>;
    edit?: WorkflowCheckpoint['edit'];
    reload?: boolean;
  }[] = [];
  let p: TrayIntent = {
    width: 360,
    depth: 240,
    height: 80,
    board: 12,
    rebate: 4,
    dividers: 3,
    shift: 0,
    fit: 0,
    tools: 'family',
    suppressed: false,
  };
  let vars = {
    width: '360mm',
    depth: '240mm',
    height: '80mm',
    board: '12mm',
    rebate: '4mm',
    dividers: '3',
    shift: '0mm',
    fit: '0mm',
    pitch: '(width - 2*board)/(dividers + 1)',
  };
  const state = (id: string, edit?: WorkflowCheckpoint['edit'], reload?: boolean) =>
    states.push({ id, intent: { ...p }, variables: { ...vars }, edit, reload });
  state('assembled');
  p = { ...p, board: 15, width: 420 };
  vars = { ...vars, board: '15mm', width: '420mm' };
  state('resize-stock-and-width', d => sourceVariable(sourceVariable(d, 'board', '15mm'), 'width', '420mm'));
  p = { ...p, dividers: 4 };
  vars = { ...vars, dividers: '4' };
  state('grow-divider-count', d => sourceVariable(d, 'dividers', '4'));
  p = { ...p, tools: 'third' };
  state('selected-third-divider', d => updatePartCut(d, cutId, { tools: [`${sourcePart(d, 'Divider').id}:${patternId}:2`] }));
  p = { ...p, tools: 'family', shift: 10 };
  vars = { ...vars, shift: '10mm' };
  state('restore-family-and-move', d => sourceVariable(updatePartCut(d, cutId, { tools: [sourcePart(d, 'Divider').id] }), 'shift', '10mm'));
  p = { ...p, fit: 0.2 };
  vars = { ...vars, fit: '0.2mm' };
  state('clearance', d => sourceVariable(d, 'fit', '0.2mm'));
  p = { ...p, suppressed: true };
  state('suppress-housings', d => updatePartCut(d, cutId, { suppressed: true }));
  p = { ...p, suppressed: false };
  state('restore-and-reload', d => updatePartCut(d, cutId, { suppressed: undefined }), true);
  return {
    id: 'divided-tray-regeneration',
    name: 'Divided tray with repeated dividers, floor housings and a selected physical tool',
    async create() {
      const d = await loadWoodworkingSource('divided-tray');
      owners = sourceOwners(d);
      patternId = sourcePart(d, 'Divider').pattern!.id;
      cutId = d.partCuts![0]!.id;
      authoring = authoringSignature(d);
      return d;
    },
    checkpoints: states.map(s => ({
      id: s.id,
      edit: s.edit,
      reload: s.reload,
      expectedErrors: s.intent.suppressed || s.intent.tools === 'third' ? ['parts-collide'] : [],
      checks: [
        ...identityChecks(() => owners, { part: 'Divider', id: () => patternId, count: s.intent.dividers }),
        authoringCheck(() => authoring),
        check('source', 'Every source variable retains the authored recipe expression.', s.variables, ({ sourceDocument }) =>
          Object.fromEntries((sourceDocument.variables ?? []).map(v => [v.name, v.expression]))
        ),
        check('source', 'The same floor-housing feature retains its explicit family or exact-copy tool.', true, ({ document }) => {
          const cut = document.partCuts?.[0],
            divider = owners.Divider!,
            tools = s.intent.tools === 'third' ? [`${divider}:${patternId}:2`] : [divider];
          return (
            document.partCuts?.length === 1 &&
            cut?.id === cutId &&
            JSON.stringify(cut.tools) === JSON.stringify(tools) &&
            JSON.stringify(cut.targets) === JSON.stringify([owners.Base]) &&
            cut.clearanceExpression === 'fit' &&
            Math.abs(cut.clearance - s.intent.fit) < 1e-8 &&
            !cut.consumeTools &&
            !!cut.suppressed === s.intent.suppressed
          );
        }),
        ...materialChecks(trayExpected(s.intent)),
      ],
    })),
  };
}
