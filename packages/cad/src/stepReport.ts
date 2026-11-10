import { cadFaceFrame, cadFaceName, type CadFaceFrame } from './drawnOn';
import { cadCopyName } from './partPatterns';
import type { CadCircularPartPattern, CadDocument, CadPartPattern, CadPlacement, EvaluatedCadPart } from './types';

/** What one step of a design refers to, and what that came to, in words and numbers rather than pictures. */
export type CadStepReportEntry =
  | {
      kind: 'drawnOn';
      partId: string;
      part: string;
      /** The plane or face it's drawn on, named by the way it looks: "Side's +x face". */
      on: string;
      offset: number;
      inward: boolean;
      /** Where that face is, or why it can't be found. */
      frame: CadFaceFrame | { error: string };
      placement?: CadPlacement;
    }
  | ({
      kind: 'pattern';
      partId: string;
      part: string;
      count: number;
      copies: { name: string; position?: [number, number, number] }[];
    } & (
      | { axis: CadPartPattern['axis']; spacing: number; circular?: never }
      | {
          axis?: never;
          spacing?: never;
          countExpression?: string;
          circular: Pick<CadCircularPartPattern, 'origin' | 'axis' | 'angle' | 'angleExpression'> & {
            equalSpacing: boolean;
            opposite: boolean;
          };
        }
    ))
  | {
      kind: 'partCut';
      stepId: string;
      tools: string[];
      targets: string[];
      clearance: number;
      /** Each opening a tool, or a copy of one, cuts in a target, measured in the target's sketch coordinates. */
      cuts: {
        target: string;
        tool: string;
        side: 'top' | 'underside';
        /** Along the target's sketch x and y, before corner bones. */
        width: number;
        length: number;
        depth: number;
        through: boolean;
        at: { x: number; y: number };
      }[];
    };

const round = (value: number) => {
  const rounded = Math.round(value * 1e3) / 1e3;
  return rounded === 0 ? 0 : rounded;
};
const roundVector = <T extends number[]>(values: T): T => values.map(round) as T;

const roundedFrame = (frame: CadFaceFrame | { error: string }): CadFaceFrame | { error: string } =>
  'error' in frame
    ? frame
    : {
        origin: roundVector(frame.origin),
        x: roundVector(frame.x),
        y: roundVector(frame.y),
        normal: roundVector(frame.normal),
        ...(frame.length !== undefined && { length: round(frame.length) }),
      };

/**
 * Every step that relates parts to each other, in the order the design lists them: what each part is drawn on, each
 * part pattern, and each "cut parts" step with the openings it made. `parts` are the evaluated parts of the solved
 * `document`.
 */
export function cadStepReport(document: CadDocument, parts: readonly EvaluatedCadPart[]): CadStepReportEntry[] {
  const report: CadStepReportEntry[] = [];
  const byId = new Map(document.parts.map(part => [part.id, part]));
  for (const part of document.parts) {
    if (part.drawnOn)
      report.push({
        kind: 'drawnOn',
        partId: part.id,
        part: part.name,
        on: cadFaceName(document, part.drawnOn.on),
        offset: round(part.drawnOn.offset),
        inward: !!part.drawnOn.inward,
        frame: roundedFrame(cadFaceFrame(document, part.drawnOn.on)),
        ...(part.placement && {
          placement: {
            ...part.placement,
            position: roundVector(part.placement.position),
          },
        }),
      });
    if (part.pattern)
      report.push({
        kind: 'pattern',
        partId: part.id,
        part: part.name,
        count: round(part.pattern.count),
        ...(part.pattern.circular
          ? {
              ...(part.pattern.countExpression && { countExpression: part.pattern.countExpression }),
              circular: {
                origin: roundVector(part.pattern.circular.origin),
                axis: roundVector(part.pattern.circular.axis),
                angle: round(part.pattern.circular.angle),
                ...(part.pattern.circular.angleExpression && { angleExpression: part.pattern.circular.angleExpression }),
                equalSpacing: part.pattern.circular.equalSpacing !== false,
                opposite: !!part.pattern.circular.opposite,
              },
            }
          : { axis: part.pattern.axis, spacing: round(part.pattern.spacing) }),
        copies: (part.copies ?? []).flatMap((copy, index) =>
          copy.pattern === part.pattern!.id
            ? [{ name: cadCopyName(part, index), ...(copy.placement && { position: roundVector(copy.placement.position) }) }]
            : []
        ),
      });
  }
  /** A tool's name from a step's tool entry or a cut it made, either the whole part or one copy (`<partId>:<copyId>`). */
  const toolName = (cutId: string) => {
    // A tool that fills several rectangles makes a cut for each, numbered after the first.
    const id = cutId.replace(/#\d+$/, '').replace(/:lap(?=:|$)/, '');
    const [partId, copyId] = id.split(':');
    const tool = byId.get(partId!);
    if (!tool) return 'a part that is gone';
    const index = copyId ? (tool.copies ?? []).findIndex(copy => copy.id === id.slice(partId!.length + 1)) : -1;
    if (copyId && index < 0) return `a copy of ${tool.name} that is gone`;
    return index >= 0 ? cadCopyName(tool, index) : tool.name;
  };
  for (const step of document.partCuts ?? []) {
    const prefix = `cut-parts:${step.id}:`;
    report.push({
      kind: 'partCut',
      stepId: step.id,
      tools: step.tools.map(toolName),
      targets: step.targets.map(id => byId.get(id)?.name ?? 'a part that is gone'),
      clearance: round(step.clearance),
      cuts: parts.flatMap(part =>
        (part.cuts ?? []).flatMap(cut => {
          if (!cut.id.startsWith(prefix) || !cut.opening) return [];
          const { x0, y0, x1, y1 } = cut.opening;
          return [
            {
              target: part.name,
              tool: toolName(cut.id.slice(prefix.length)),
              side: cut.side,
              width: round(x1 - x0),
              length: round(y1 - y0),
              depth: round(cut.to - cut.from),
              through: cut.through,
              at: { x: round(x0), y: round(y0) },
            },
          ];
        })
      ),
    });
  }
  return report;
}
