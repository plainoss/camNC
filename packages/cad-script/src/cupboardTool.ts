import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { assemblyReport, evaluateCadDocument, parseCadDocument } from '@wbcnc/cad';
import { cupboard } from './cupboard';
import { editCad } from './edit';
import { compactCadReport } from './compactReport';
import { renderCadSvg } from './render';

const filename = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Use a saved design name: letters, digits, - and _ only.');
const dimension = z.number().positive().max(10_000);

/** Uses the same one-shot builder as Insert. It produces design files, never programs or editor applies. */
export function registerCupboardTool(server: McpServer, directory: string) {
  server.registerTool(
    'insert_cupboard',
    {
      description:
        'Build a cupboard as an ordinary folder of parts, joints, pin holes, a shelf pattern and variables. Optionally start from a saved design name in this tool directory. Writes a candidate JSON and SVG for the user to review; never applies to an open editor.',
      inputSchema: {
        name: filename.describe('Output design file name, without extension.'),
        from: filename.optional().describe('Existing saved JSON design name in this same directory; no paths.'),
        folderName: z.string().trim().min(1).optional(),
        width: dimension.optional(),
        height: dimension.optional(),
        depth: dimension.optional(),
        board: dimension.optional(),
        shelves: z.number().int().min(1).max(200).optional(),
        at: z
          .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
          .optional()
          .describe('Assembly origin in mm; defaults to beside the existing design.'),
      },
    },
    async ({ name, from, folderName, width, height, depth, board, shelves, at }) => {
      const start = from ? parseCadDocument(JSON.parse(await readFile(path.join(directory, `${from}.json`), 'utf8'))) : null;
      const placed = start ? (assemblyReport(start, evaluateCadDocument(start).parts)?.parts ?? []) : [];
      const right = Math.max(0, ...placed.map(part => part.at[0] + part.size[0]));
      const result = await editCad(
        start,
        cupboard({
          ...(folderName && { name: folderName }),
          ...(width !== undefined && { width: `${width}mm` }),
          ...(height !== undefined && { height: `${height}mm` }),
          ...(depth !== undefined && { depth: `${depth}mm` }),
          ...(board !== undefined && { board: `${board}mm` }),
          ...(shelves !== undefined && { shelves }),
          at: at ?? [start?.parts.length ? right + 100 : 0, 0, 0],
        }),
        { name }
      );
      const report = JSON.stringify({
        ...compactCadReport(result.document, result.report),
        ok: result.ok,
        ...(result.scriptError && { scriptError: result.scriptError }),
      });
      if (!result.ok)
        return {
          content: [
            { type: 'text' as const, text: report },
            { type: 'text' as const, text: 'No file was changed; the candidate needs repair.' },
          ],
          isError: true,
        };
      await mkdir(directory, { recursive: true });
      const document = path.join(directory, `${name}.json`),
        drawing = path.join(directory, `${name}.svg`);
      await writeFile(document, `${JSON.stringify(result.document, null, 1)}\n`);
      await writeFile(drawing, renderCadSvg(result.parts));
      return {
        content: [
          { type: 'text' as const, text: report },
          { type: 'text' as const, text: `Wrote candidate ${document} and ${drawing}. Apply only after reviewing it in the editor.` },
        ],
        isError: false,
      };
    }
  );
}
