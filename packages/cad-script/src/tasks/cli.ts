import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { editCad, type CadScript } from '../edit';
import { cadSavedTask, cadSavedTasks } from './catalogue';
import { loadCadTaskStart, recordedCadTaskModel } from './files';
import { compareCadTaskRuns, runCadTask } from './run';
import type { CadTaskModel, CadTaskRun } from './types';

const usage = 'tasks --list | --replay [--task A1] [--max-checks 8] [--out directory] | --compare report.json [report.json ...]';
const args = process.argv.slice(2).filter(argument => argument !== '--');
const cwd = process.env.INIT_CWD ?? process.cwd();
let taskId: string | undefined,
  output: string | undefined,
  maxChecks = 8,
  replay = false,
  list = false;
const comparisons: string[] = [];
try {
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--list') list = true;
    else if (argument === '--replay') replay = true;
    else if (argument === '--compare') {
      comparisons.push(...args.slice(index + 1));
      break;
    } else if (['--task', '--max-checks', '--out'].includes(argument)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${argument} needs a value.`);
      if (argument === '--task') taskId = value;
      else if (argument === '--max-checks') maxChecks = Number(value);
      else output = path.resolve(cwd, value);
    } else throw new Error(`Unknown option ${argument}. ${usage}`);
  }
  if (list) process.stdout.write(`${JSON.stringify(cadSavedTasks, null, 2)}\n`);
  else if (comparisons.length) {
    const reports = await Promise.all(
      comparisons.map(async file => JSON.parse(await readFile(path.resolve(cwd, file), 'utf8')) as { runs: CadTaskRun[] })
    );
    process.stdout.write(`${JSON.stringify(compareCadTaskRuns(reports.flatMap(report => report.runs)), null, 2)}\n`);
  } else if (replay) {
    const tasks = taskId ? [cadSavedTask(taskId)] : cadSavedTasks.filter(task => task.recording);
    const runs: CadTaskRun[] = [];
    // The solver writes diagnostics; stdout stays machine-readable for comparisons.
    console.log = console.error.bind(console);
    for (const task of tasks) {
      const model: CadTaskModel = await recordedCadTaskModel(task);
      runs.push(
        await runCadTask(task, await loadCadTaskStart(task), model, {
          maxChecks,
          async check(file, start) {
            // Only the committed recordings are imported here. Provider adapters supply an isolated checker to runCadTask.
            const script = (await import(/* @vite-ignore */ pathToFileURL(file).href)).default as CadScript;
            return editCad(start, script);
          },
        })
      );
    }
    const report = { schema: 1, kind: 'recorded-replay', runs, comparison: compareCadTaskRuns(runs) };
    if (output) {
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, 'tasks.json'), `${JSON.stringify(report, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    // Replays deliberately preserve unsuccessful attempts; a known unmet outcome is benchmark data, not a CLI crash.
    process.exitCode = runs.some(run => run.status === 'error') ? 1 : 0;
  } else throw new Error(usage);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
}
