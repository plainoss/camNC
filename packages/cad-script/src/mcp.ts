import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerCupboardTool } from './cupboardTool';

const packageDir = fileURLToPath(new URL('../', import.meta.url));
const examplesDir = path.join(packageDir, 'examples');

/**
 * Runs the check CLI in a process of its own, so every check imports the script afresh and a crash can't take the server.
 * Its report, and whether the design checked out and was written.
 */
function runCheck(file: string, out: string, svg: string, viewArgs: string[] = []): Promise<{ report: string; ok: boolean }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['node_modules/vite-node/vite-node.mjs', '--config', 'vite.config.ts', 'src/cli.ts', file, '--out', out, '--svg', svg, ...viewArgs],
      { cwd: packageDir, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // The solver logs to stderr too, so the error is the last line that names one.
        const lines = stderr.trim().split('\n');
        const failure =
          lines
            .filter(line => /Error\b/.test(line))
            .at(-1)
            ?.trim() ??
          (lines.at(-1) || error?.message || 'nothing printed');
        let report: { ok?: unknown };
        try {
          report = JSON.parse(stdout) as { ok?: unknown };
        } catch {
          return reject(new Error(`The check stopped without a report: ${failure}`));
        }
        // The CLI exits 1 for a design that doesn't check out, with its report. After a passing report, it failed writing.
        if (report.ok === true && error) return reject(new Error(`The design checked out, but writing it failed: ${failure}`));
        resolve({ report: stdout, ok: report.ok === true && !error });
      }
    );
  });
}

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });
const nameSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Letters, digits, - and _ only, such as "bookshelf".')
  .describe('The design\'s file name without extension, such as "bookshelf".');

export function createCadScriptServer(dir: string) {
  const server = new McpServer({ name: 'camnc-cad-script', version: '0.0.1' });
  registerCupboardTool(server, dir);
  const files = (name: string) => ({
    script: path.join(dir, `${name}.cad.ts`),
    document: path.join(dir, `${name}.json`),
    drawing: path.join(dir, `${name}.svg`),
  });

  server.registerTool(
    'cad_script_guide',
    {
      description:
        'How to write a camNC design script: the API, what the check reports, and the names of worked examples. Read it before writing the first design.',
      inputSchema: {},
    },
    async () => {
      const readme = await readFile(path.join(packageDir, 'README.md'), 'utf8');
      const examples = (await readdir(examplesDir)).filter(file => file.endsWith('.cad.ts')).map(file => file.replace(/\.cad\.ts$/, ''));
      return text(`${readme}\n\nExamples, readable with cad_script_example: ${examples.join(', ')}.`);
    }
  );

  server.registerTool(
    'cad_script_example',
    { description: 'The source of one worked example design.', inputSchema: { name: z.string() } },
    async ({ name }) => {
      const examples = (await readdir(examplesDir)).filter(file => file.endsWith('.cad.ts'));
      const file = examples.find(candidate => candidate === `${name}.cad.ts`);
      if (!file) return { ...text(`No example ${name}. There are: ${examples.join(', ')}.`), isError: true };
      return text(await readFile(path.join(examplesDir, file), 'utf8'));
    }
  );

  server.registerTool(
    'check_design',
    {
      description:
        "Saves a design script, type-checks and runs it, and returns the JSON report: errors, warnings, sizes, cuts, sketches' free movement, what CAM receives and a toolpath summary. " +
        'Leave out `source` to check the script already saved under that name. A design that checks out is written as <name>.json, ready to import into camNC; one that fails removes it. ' +
        'A drawing of every part is written as <name>.svg.',
      inputSchema: {
        name: nameSchema,
        source: z
          .string()
          .optional()
          .describe("The whole script: import { design } from '@wbcnc/cad-script'; export default design(d => { ... });"),
        views: z.boolean().optional().describe('Also draw top, front and right views of evaluated outlines and cuts, as placed.'),
        section: z
          .object({ part: z.string(), cut: z.string(), axis: z.enum(['x', 'y']).optional(), at: z.number().finite().optional() })
          .optional()
          .describe('Draw a local section through this physical part and evaluated cut ID or unambiguous handle.'),
      },
    },
    async ({ name, source, views, section }) => {
      const { script, document, drawing } = files(name);
      await mkdir(dir, { recursive: true });
      if (source !== undefined) await writeFile(script, source);
      // Whatever happens to this check, the last revision's files can't be mistaken for this one's.
      await Promise.all([document, drawing].map(file => rm(file, { force: true }).catch(() => undefined)));
      const viewDirectory = path.join(dir, `${name}.views`);
      const viewArgs = views || section ? ['--views', viewDirectory] : [];
      if (section) {
        viewArgs.push('--section-part', section.part, '--section-cut', section.cut, '--section-axis', section.axis ?? 'x');
        if (section.at !== undefined) viewArgs.push('--section-at', String(section.at));
      }
      // Clear the preceding drawing set even when this revision no longer asks for views.
      await Promise.all(['top', 'front', 'right', 'section'].map(view => rm(path.join(viewDirectory, `${view}.svg`), { force: true })));
      const { report, ok } = await runCheck(script, document, drawing, viewArgs);
      const written = ok ? `Wrote ${document} and ${drawing}.` : `${document} was not written.`;
      const drawings =
        ok && (views || section)
          ? await Promise.all(
              ['top', 'front', 'right', ...(section ? ['section'] : [])].map(async name => {
                const file = path.join(viewDirectory, `${name}.svg`);
                return {
                  type: 'resource' as const,
                  resource: { uri: pathToFileURL(file).href, mimeType: 'image/svg+xml', text: await readFile(file, 'utf8') },
                };
              })
            )
          : [];
      return {
        content: [{ type: 'text', text: report }, { type: 'text', text: `${script}\n${written}` }, ...drawings],
        isError: !ok,
      };
    }
  );

  server.registerTool(
    'read_design',
    { description: 'The script saved under a name, to edit it.', inputSchema: { name: nameSchema } },
    async ({ name }) => {
      const { script } = files(name);
      return text(await readFile(script, 'utf8').catch(() => `No design ${name} in ${dir}.`));
    }
  );

  return server;
}
