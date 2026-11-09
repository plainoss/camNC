import path from 'node:path';
import { cupboardWorkflow } from './cupboard';
import { runCadWorkflow } from './workflow';
import { writeWorkflowArtifacts } from './artifacts';

const usage = 'iterate [--workflow cupboard] [--through checkpoint] [--out directory] [--list]';
const args = process.argv.slice(2);
let workflowId = 'cupboard',
  through: string | undefined,
  list = false;
let output = path.resolve(process.env.INIT_CWD ?? process.cwd(), 'test-results/cad-iteration/core');
try {
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--') continue;
    if (flag === '--list') list = true;
    else if (['--workflow', '--through', '--out'].includes(flag)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value.`);
      if (flag === '--workflow') workflowId = value;
      else if (flag === '--through') through = value;
      else output = path.resolve(process.env.INIT_CWD ?? process.cwd(), value);
    } else throw new Error(`Unknown option ${flag}. ${usage}`);
  }
  if (workflowId !== 'cupboard') throw new Error(`Unknown workflow ${workflowId}. Available: cupboard.`);
  const workflow = cupboardWorkflow();
  if (list)
    process.stdout.write(
      `${JSON.stringify({ workflows: [{ id: workflow.id, name: workflow.name, checkpoints: workflow.checkpoints.map(row => row.id) }] })}\n`
    );
  else {
    // Solver diagnostics belong in stderr; stdout remains a machine-readable result for the agent loop.
    console.log = console.error.bind(console);
    const result = await runCadWorkflow(workflow, { through });
    const { report } = await writeWorkflowArtifacts(result, output);
    process.stdout.write(
      `${JSON.stringify({ ...report, artifacts: output, checkpointManifest: path.join(output, 'checkpoints.json') })}\n`
    );
    process.exitCode = result.status === 'passed' ? 0 : result.status === 'unsupported' ? 2 : 1;
  }
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ status: 'failed', scope: 'incomplete', firstFailure: { layer: 'source', message: error instanceof Error ? error.message : String(error) } })}\n`
  );
  process.exitCode = 1;
}
