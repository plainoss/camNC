import { createAdapter as sketchAdapter } from './sketch.mjs';
import { settledSnapshot } from '../settle.mjs';
import { checkStudio, studioContent, studioState } from './studioModel.mjs';

const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Part Studio steps use visible feature names and labelled controls; source reads never perform edits. */
export async function createAdapter(page, url) {
  const base = await sketchAdapter(page, url), checkpoints = new Map();
  const readDocument = () => page.evaluate(async () => {
    const jobId = location.pathname.split('/')[2];
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => name.includes('/src/cam/jobDb.ts')).at(-1);
    if (!moduleUrl) throw new Error('Studio specs require the development server');
    const { getJob } = await import(moduleUrl);
    return (await getJob(jobId))?.design?.draft ?? null;
  });
  const read = async () => {
    const document = await readDocument();
    const dialog = page.getByRole('dialog');
    const parts = page.getByRole('list', { name: 'Parts', exact: true });
    const listedParts = await parts.getByRole('listitem').evaluateAll(rows => rows.map(row => ({
      name: row.querySelector('button > span:not([aria-hidden])')?.textContent,
      thickness: Number(row.querySelector('button small')?.textContent.replace(/mm$/, '').trim()),
    })));
    const partIssues = await parts.getByRole('img').evaluateAll(items => items.map(item => item.getAttribute('aria-label')));
    return { ...studioState(document), content: studioContent(document), listedParts, partIssues, dialog: await dialog.count() ? await dialog.getAttribute('aria-label') : null };
  };
  const step = async text => {
    const [verb] = text.split(' '), rest = text.slice(verb.length).trim();
    if (!['feature', 'dialogfill', 'dialogconfirm', 'dialogcancel', 'checkpoint'].includes(verb)) return base.step(text);
    if (!(await base.inDemo())) throw new Error('Studio workflow input requires demo mode');
    const since = await settledSnapshot(page);
    if (verb === 'feature') {
      const feature = page.getByRole('region', { name: 'Features', exact: true }).getByRole('button', { name: new RegExp(`^${escapePattern(rest)}(?:\\s|$)`) });
      // An ambiguous feature name must fail rather than silently editing the wrong part.
      if (await feature.count() !== 1) throw new Error(`Feature name must identify one row: ${rest}`);
      await feature.dblclick();
      await page.getByRole('dialog').waitFor();
    } else if (verb === 'dialogfill') {
      const at = rest.indexOf(' = ');
      if (at < 0) throw new Error('dialogfill takes Label = value');
      await page.getByRole('dialog').getByLabel(rest.slice(0, at), { exact: true }).fill(rest.slice(at + 3));
    } else if (verb === 'dialogconfirm' || verb === 'dialogcancel') {
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: verb === 'dialogconfirm' ? 'OK' : 'Cancel', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
    } else {
      if (!rest || checkpoints.has(rest)) throw new Error(`Checkpoint must have a unique name: ${rest}`);
      checkpoints.set(rest, await read());
    }
    await base.settle(since);
  };
  return {
    ...base, step,
    state: async () => ({ ...await base.state(), studio: await read() }),
    check: async expected => {
      const { studio, ...sketch } = expected;
      return [...await base.check(sketch), ...(studio ? checkStudio(studio, await read(), checkpoints) : [])];
    },
  };
}
