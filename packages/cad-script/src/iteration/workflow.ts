import { createHash } from 'node:crypto';
import {
  activeDesign,
  cadCopyName,
  consumedTools,
  isCadBody,
  parseCadDocument,
  type CadDocument,
  type CadPlacement,
  type EvaluatedCadPart,
} from '@wbcnc/cad';
import { inspectCadDocument, type CadReport } from '../inspect';

export type WorkflowLayer = 'source' | 'solver' | 'geometry' | 'assembly' | 'cam' | 'persistence';
export type WorkflowValue = null | boolean | number | string | WorkflowValue[] | { [key: string]: WorkflowValue };
export interface WorkflowContext {
  /** The preceding completed state, used for identity/lifecycle contracts across an edit. */
  previousDocument: CadDocument;
  sourceDocument: CadDocument;
  document: CadDocument;
  report: CadReport;
  parts: EvaluatedCadPart[];
}
export interface WorkflowCheck {
  layer: WorkflowLayer;
  description: string;
  expected: WorkflowValue;
  actual(context: WorkflowContext): WorkflowValue;
  tolerance?: number;
}
export interface WorkflowCheckpoint {
  id: string;
  edit?(document: CadDocument): CadDocument | Promise<CadDocument>;
  /** The error state is part of the contract when an edit intentionally leaves dependent parts colliding. */
  expectedErrors?: string[];
  reload?: boolean;
  unsupported?: string;
  checks: WorkflowCheck[];
}
export interface CadWorkflow {
  id: string;
  name: string;
  create(): CadDocument | Promise<CadDocument>;
  checkpoints: WorkflowCheckpoint[];
}
export interface WorkflowFailure {
  checkpoint: string;
  layer: WorkflowLayer;
  message: string;
  expected?: WorkflowValue;
  actual?: WorkflowValue;
}
export interface WorkflowBody {
  id: string;
  sourcePartId: string;
  copyId?: string;
  name: string;
  frame: 'part-local';
  /** Candidate placement only: independent backends must resolve source expressions themselves. */
  placement: CadPlacement | null;
  placementCoordinates: 'candidate-derived';
  mirrored: boolean;
}
export interface WorkflowCheckpointResult {
  id: string;
  status: 'passed' | 'failed' | 'unsupported';
  /** This snapshot is captured after the edit and before the candidate solver runs. */
  sourceDocument: CadDocument;
  sourceSha256: string;
  /** Exact bytes whose digest is sourceSha256. Artifact writers must not reformat these bytes. */
  sourceText: string;
  solvedDocument?: CadDocument;
  solvedCoordinates: 'candidate-derived';
  bodies: WorkflowBody[];
  checks: { layer: WorkflowLayer; description: string; expected: WorkflowValue; actual: WorkflowValue; passed: boolean }[];
  timings: { editMs: number; inspectMs: number; checksMs: number; totalMs: number };
}
export interface WorkflowResult {
  id: string;
  name: string;
  status: 'passed' | 'failed' | 'unsupported';
  scope: 'complete' | 'prefix';
  checkpoints: WorkflowCheckpointResult[];
  firstFailure?: WorkflowFailure;
  totalMs: number;
}

/** Source IDs remain present in every checkpoint, so a reference can compare the same bodies across edits. */
function bodies(document: CadDocument): WorkflowBody[] {
  const active = activeDesign(document),
    consumed = consumedTools(active);
  return active.parts.flatMap(part => {
    // Match the domain's physical-piece seam: absorbed tools cut the target but are no longer output bodies.
    if (!isCadBody(active, part) || consumed.has(part.id)) return [];
    return [
      {
        id: part.id,
        sourcePartId: part.id,
        name: part.name,
        frame: 'part-local' as const,
        placement: part.placement ?? null,
        placementCoordinates: 'candidate-derived' as const,
        mirrored: false,
      },
      ...(part.copies ?? []).map((copy, index) => ({
        id: `${part.id}:${copy.id}`,
        sourcePartId: part.id,
        copyId: copy.id,
        name: cadCopyName(part, index),
        frame: 'part-local' as const,
        placement: copy.placement ?? null,
        placementCoordinates: 'candidate-derived' as const,
        mirrored: !!copy.mirrored,
      })),
    ];
  });
}

function equal(actual: WorkflowValue, expected: WorkflowValue, tolerance = 0): boolean {
  if (typeof actual === 'number' && typeof expected === 'number')
    return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
  if (Array.isArray(actual) || Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      Array.isArray(expected) &&
      actual.length === expected.length &&
      actual.every((value, index) => equal(value, expected[index]!, tolerance))
    );
  if (actual !== null && expected !== null && typeof actual === 'object' && typeof expected === 'object') {
    const keys = Object.keys(expected).sort();
    return keys.join('\n') === Object.keys(actual).sort().join('\n') && keys.every(key => equal(actual[key]!, expected[key]!, tolerance));
  }
  return actual === expected;
}

/** Run the real edit/solve/report path, stopping where the first observable contract diverges. */
export async function runCadWorkflow(workflow: CadWorkflow, options: { through?: string } = {}): Promise<WorkflowResult> {
  if (!workflow.checkpoints.length) throw new Error('A workflow needs at least one checkpoint.');
  if (new Set(workflow.checkpoints.map(checkpoint => checkpoint.id)).size !== workflow.checkpoints.length)
    throw new Error('Checkpoint IDs must be unique.');
  if (options.through && !workflow.checkpoints.some(checkpoint => checkpoint.id === options.through))
    throw new Error(`Unknown checkpoint ${options.through}.`);
  const started = performance.now();
  const scope = options.through && options.through !== workflow.checkpoints.at(-1)!.id ? 'prefix' : 'complete';
  const result: WorkflowResult = { id: workflow.id, name: workflow.name, status: 'passed', scope, checkpoints: [], totalMs: 0 };
  let document: CadDocument;
  try {
    document = await workflow.create();
  } catch (error) {
    result.status = 'failed';
    result.firstFailure = { checkpoint: 'create', layer: 'source', message: error instanceof Error ? error.message : String(error) };
    result.totalMs = performance.now() - started;
    return result;
  }
  for (const checkpoint of workflow.checkpoints) {
    const checkpointStart = performance.now();
    const previousDocument = structuredClone(document);
    let sourceDocument = structuredClone(previousDocument);
    const failure = (layer: WorkflowLayer, message: string, expected?: WorkflowValue, actual?: WorkflowValue) => {
      result.status = 'failed';
      result.firstFailure = {
        checkpoint: checkpoint.id,
        layer,
        message,
        ...(expected !== undefined && { expected }),
        ...(actual !== undefined && { actual }),
      };
    };
    try {
      if (checkpoint.edit) sourceDocument = await checkpoint.edit(sourceDocument);
    } catch (error) {
      failure('source', error instanceof Error ? error.message : String(error));
    }
    const editMs = performance.now() - checkpointStart;
    const sourceText = `${JSON.stringify(sourceDocument, null, 1)}\n`;
    const row: WorkflowCheckpointResult = {
      id: checkpoint.id,
      status: result.status,
      sourceDocument: structuredClone(sourceDocument),
      sourceText,
      sourceSha256: createHash('sha256').update(sourceText).digest('hex'),
      solvedCoordinates: 'candidate-derived',
      bodies: [],
      checks: [],
      timings: { editMs, inspectMs: 0, checksMs: 0, totalMs: 0 },
    };
    result.checkpoints.push(row);
    if (checkpoint.unsupported) {
      row.status = result.status = 'unsupported';
      result.firstFailure = { checkpoint: checkpoint.id, layer: 'source', message: checkpoint.unsupported };
    } else if (!result.firstFailure) {
      if (!checkpoint.checks.length) failure('source', 'A supported checkpoint needs at least one observable expectation.');
      else {
        const inspectStarted = performance.now();
        let phase: WorkflowLayer = 'solver';
        try {
          const inspected = await inspectCadDocument(sourceDocument, new Map(), { toolpaths: false });
          row.timings.inspectMs = performance.now() - inspectStarted;
          row.solvedDocument = inspected.document;
          row.bodies = bodies(inspected.document);
          document = inspected.document;
          if (inspected.report.status !== 'solved')
            failure('solver', 'The sketch solver did not solve the checkpoint.', 'solved', inspected.report.status);
          else {
            const codes = [...new Set(inspected.report.errors.map(error => error.code))].sort();
            const expectedCodes = [...new Set(checkpoint.expectedErrors ?? [])].sort();
            if (!equal(codes, expectedCodes))
              failure(codes.includes('parts-collide') ? 'assembly' : 'geometry', 'Checkpoint errors differ.', expectedCodes, codes);
            else {
              const checksStarted = performance.now();
              const context: WorkflowContext = { ...inspected, previousDocument, sourceDocument: row.sourceDocument };
              for (const check of checkpoint.checks) {
                phase = check.layer;
                const actual = check.actual(context),
                  passed = equal(actual, check.expected, check.tolerance);
                row.checks.push({ layer: check.layer, description: check.description, expected: check.expected, actual, passed });
                if (!passed) {
                  failure(check.layer, check.description, check.expected, actual);
                  break;
                }
              }
              if (!result.firstFailure && checkpoint.reload) {
                phase = 'persistence';
                // Reload must exercise the document parser, not just clone an object in memory.
                const serialized = JSON.stringify(inspected.document);
                const reloaded = parseCadDocument(JSON.parse(serialized));
                const again = await inspectCadDocument(reloaded, new Map(), { toolpaths: false });
                const persisted = JSON.stringify(again.document) === serialized;
                row.checks.push({
                  layer: 'persistence',
                  description: 'Reload preserves the solved document and IDs.',
                  expected: true,
                  actual: persisted,
                  passed: persisted,
                });
                if (!persisted) failure('persistence', 'Reload changed the solved document or IDs.', true, false);
                else if (!equal(again.report as unknown as WorkflowValue, inspected.report as unknown as WorkflowValue))
                  failure('persistence', 'Reload changed the observable design report.');
              }
              row.timings.checksMs = performance.now() - checksStarted;
            }
          }
        } catch (error) {
          failure(phase, error instanceof Error ? error.message : String(error));
        }
      }
    }
    row.status = result.status;
    row.timings.totalMs = performance.now() - checkpointStart;
    if (result.firstFailure || checkpoint.id === options.through) break;
  }
  result.totalMs = performance.now() - started;
  return result;
}
