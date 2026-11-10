import { updatePartCut } from '@wbcnc/cad';
import {
  authoringCheck,
  authoringSignature,
  check,
  identityChecks,
  loadWoodworkingSource,
  materialChecks,
  sourceOwners,
  sourceVariable,
} from './woodworkingChecks';
import { jointExpected, type JointIntent } from './woodworkingExpected';
import type { CadWorkflow, WorkflowCheckpoint } from './workflow';

/** Default split phase is anchored to the positive world end, as specified before this workflow in857690a/#295. */
export function fittedJointsWorkflow(): CadWorkflow {
  let owners: Record<string, string> = {},
    lapId = '',
    fingerId = '',
    authoring = '';
  const states: {
    id: string;
    intent: JointIntent;
    variables: Record<string, string>;
    edit?: WorkflowCheckpoint['edit'];
    reload?: boolean;
  }[] = [];
  let p: JointIntent = {
    board: 18,
    legWidth: 300,
    legHeight: 400,
    frameLength: 300,
    frameHeight: 100,
    sideDepth: 200,
    station: 500,
    fingers: 5,
    fit: 0,
    target: 'Side',
    suppressed: false,
  };
  let vars = {
    board: '18mm',
    legWidth: '300mm',
    legHeight: '400mm',
    frameLength: '300mm',
    frameHeight: '100mm',
    sideDepth: '200mm',
    station: '500mm',
    fingers: '5',
    fit: '0mm',
  };
  const state = (id: string, edit?: WorkflowCheckpoint['edit'], reload?: boolean) =>
    states.push({ id, intent: { ...p }, variables: { ...vars }, edit, reload });
  state('assembled');
  p = { ...p, board: 21 };
  vars = { ...vars, board: '21mm' };
  state('resize-stock', d => sourceVariable(d, 'board', '21mm'));
  p = { ...p, legHeight: 480, frameHeight: 120 };
  vars = { ...vars, legHeight: '480mm', frameHeight: '120mm' };
  state('resize-joint-heights', d => sourceVariable(sourceVariable(d, 'legHeight', '480mm'), 'frameHeight', '120mm'));
  p = { ...p, fingers: 8 };
  vars = { ...vars, fingers: '8' };
  state('grow-finger-count', d => sourceVariable(d, 'fingers', '8'));
  p = { ...p, target: 'Front' };
  state('swap-finger-phase', d => updatePartCut(d, fingerId, { tools: [owners.Side!], targets: [owners.Front!] }));
  p = { ...p, fit: 0.2 };
  vars = { ...vars, fit: '0.2mm' };
  state('clearance', d => sourceVariable(d, 'fit', '0.2mm'));
  p = { ...p, suppressed: true };
  state('suppress-joints', d => updatePartCut(updatePartCut(d, lapId, { suppressed: true }), fingerId, { suppressed: true }));
  p = { ...p, suppressed: false };
  state(
    'restore-and-reload',
    d => updatePartCut(updatePartCut(d, lapId, { suppressed: undefined }), fingerId, { suppressed: undefined }),
    true
  );
  return {
    id: 'fitted-joints-regeneration',
    name: 'Crossed half-laps and corner fingers with count, phase and clearance edits',
    async create() {
      const d = await loadWoodworkingSource('fitted-joints');
      owners = sourceOwners(d);
      lapId = d.partCuts![0]!.id;
      fingerId = d.partCuts![1]!.id;
      authoring = authoringSignature(d);
      return d;
    },
    checkpoints: states.map(s => ({
      id: s.id,
      edit: s.edit,
      reload: s.reload,
      expectedErrors: s.intent.suppressed ? ['parts-collide'] : [],
      checks: [
        ...identityChecks(() => owners),
        authoringCheck(() => authoring),
        check('source', 'Every source variable retains the authored recipe expression.', s.variables, ({ sourceDocument }) =>
          Object.fromEntries((sourceDocument.variables ?? []).map(v => [v.name, v.expression]))
        ),
        check(
          'source',
          'The same two joint operations preserve their source owners, target/tool phase and count expression.',
          true,
          ({ document }) => {
            const lap = document.partCuts?.find(c => c.id === lapId),
              finger = document.partCuts?.find(c => c.id === fingerId),
              target = s.intent.target,
              tool = target === 'Side' ? 'Front' : 'Side';
            return (
              document.partCuts?.length === 2 &&
              lap?.split === 'half' &&
              JSON.stringify(lap.tools) === JSON.stringify([owners['Leg B']]) &&
              JSON.stringify(lap.targets) === JSON.stringify([owners['Leg A']]) &&
              !!finger &&
              typeof finger.split === 'object' &&
              finger.split.fingers === s.intent.fingers &&
              finger.split.fingersExpression === 'fingers' &&
              JSON.stringify(finger.tools) === JSON.stringify([owners[tool]]) &&
              JSON.stringify(finger.targets) === JSON.stringify([owners[target]]) &&
              [lap, finger].every(
                c =>
                  c.clearanceExpression === 'fit' && Math.abs(c.clearance - s.intent.fit) < 1e-8 && !!c.suppressed === s.intent.suppressed
              )
            );
          }
        ),
        ...materialChecks(jointExpected(s.intent)),
      ],
    })),
  };
}
