import { parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { cadSavedTask } from '../../../../../../packages/cad-script/src/tasks/catalogue';
import type { CadSavedTask, CadTaskAssessment, CadTaskCandidate } from '../../../../../../packages/cad-script/src/tasks/types';

const starts = import.meta.glob('../../../../../../packages/cad-script/fixtures/designs/task-start-*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export function liveStart(task: CadSavedTask): CadDocument | null {
  if (!task.start) return null;
  const name = task.start.split('/').at(-1)!;
  const raw = Object.entries(starts).find(([file]) => file.endsWith(`/${name}`))?.[1];
  if (!raw) throw new Error(`Missing start design ${name}`);
  return parseCadDocument(JSON.parse(raw));
}

/** Instability prompts: plausible requests whose literal result is a tipping or spindly piece. */
const tallNarrow: CadSavedTask = {
  id: 'tall-narrow',
  request:
    'A tall narrow bookshelf, 300 wide, 1800 tall, 250 deep, from 18 mm board. Five fixed shelves between the top and bottom, housed in the sides. No back.',
  start: null,
  source: 'whole-piece-requirement',
  outcomes: ['Overall 300 × 250 × 1800 mm.', 'Five shelves.', 'Named folder.'],
  review: ['Response warns that a 1800 tall, 250 deep case can tip and should be anchored.'],
};
const barStool: CadSavedTask = {
  id: 'bar-stool',
  request:
    'A bar stool 650 tall with a 300 × 300 mm seat of 18 mm board on top, four 20 × 20 mm square legs at the corners, and a rail between each pair of neighbouring legs 200 mm above the floor. Use joints I can cut on the CNC.',
  start: null,
  source: 'whole-piece-requirement',
  outcomes: ['Overall 300 × 300 × 650 mm.', 'Four legs and four rails.', 'Named folder.'],
  review: ['Response notes that 20 mm legs over 630 mm are slender.'],
};

declare const __ASSISTANT_LIVE__: Record<string, string | undefined> | undefined;
export const liveTaskIds = ((typeof __ASSISTANT_LIVE__ === 'undefined' ? undefined : __ASSISTANT_LIVE__.ASSISTANT_LIVE_TASKS) ?? 'A1,A2,A3,B1,C1,shelf-description,tall-narrow,bar-stool').split(',');
export const liveTask = (id: string): CadSavedTask => (id === 'tall-narrow' ? tallNarrow : id === 'bar-stool' ? barStool : cadSavedTask(id));

const close = (a: number, b: number) => Math.abs(a - b) < 0.5;
/** Saved tasks use the catalogue assessor; the two instability prompts get the same size/count/folder checks. */
export function assessLiveTask(task: CadSavedTask, candidate: CadTaskCandidate, base: CadTaskAssessment): CadTaskAssessment {
  if (task.id !== 'tall-narrow' && task.id !== 'bar-stool') return base;
  const bodies = candidate.report.assembly?.parts ?? [];
  const size = [0, 1, 2].map(axis =>
    bodies.length ? Math.max(...bodies.map(b => b.at[axis] + b.size[axis])) - Math.min(...bodies.map(b => b.at[axis])) : NaN
  );
  const wanted = task.id === 'tall-narrow' ? [300, 250, 1800] : [300, 300, 650];
  const count = (pattern: RegExp) => bodies.filter(body => pattern.test(body.name)).length;
  const checks = [...base.checks];
  checks.push({ description: 'Overall size', passed: size.every((n, i) => close(n, wanted[i]!)), expected: wanted, actual: size });
  if (task.id === 'tall-narrow') checks.push({ description: 'Five shelves', passed: count(/\bshelf\b/i) === 5, actual: count(/\bshelf\b/i) });
  else checks.push({ description: 'Four legs', passed: count(/\bleg\b/i) === 4, actual: count(/\bleg\b/i) });
  checks.push({ description: 'Named folder', passed: !!candidate.document.folders?.length });
  return { checks, automaticPass: checks.every(check => check.passed), review: base.review };
}
