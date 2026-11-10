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
    const workspaceHeading = page.getByText('PART STUDIO', { exact: true });
    const workspaceLabel = await workspaceHeading.count() === 1 ? await workspaceHeading.locator('..').innerText() : '';
    const workspacePartCount = !workspaceLabel ? null : /\bone part\b/.test(workspaceLabel) ? 1 : Number(/\b(\d+) parts\b/.exec(workspaceLabel)?.[1]);
    const dialogSelections = {};
    for (const name of ['Tools', 'Targets']) {
      const group = dialog.getByRole('group', { name, exact: true });
      if (await group.count()) dialogSelections[name] = await group.getByRole('listitem').evaluateAll(items => items.map(item =>
        [...item.childNodes].filter(node => node.nodeName !== 'BUTTON').map(node => node.textContent).join('').trim()));
    }
    const measurements = await page.locator('.cad-studio-measure-results button').evaluateAll(buttons => Object.fromEntries(buttons.map(button => {
      const text = button.getAttribute('aria-label') ?? button.innerText, at = text.indexOf(': ');
      return [text.slice(0, at), text.slice(at + 2)];
    })));
    const dialogName = await dialog.count() ? await dialog.evaluate(element => element.getAttribute('aria-label') ?? document.getElementById(element.getAttribute('aria-labelledby'))?.textContent ?? null) : null;
    const sectionDialog = page.getByRole('dialog', { name: 'Section view', exact: true });
    const editingSection = await sectionDialog.count() > 0;
    const section = {
      active: await page.getByRole('button', { name: 'Edit section view', exact: true }).count() > 0,
      editing: editingSection,
      ...(editingSection ? {
        plane: await sectionDialog.getByRole('combobox', { name: 'Section plane', exact: true }).inputValue(),
        offset: await sectionDialog.getByRole('textbox', { name: 'Offset', exact: true }).inputValue(),
        flipped: await sectionDialog.getByRole('button', { name: 'Flip plane', exact: true }).getAttribute('aria-pressed') === 'true',
      } : {}),
    };
    return { ...studioState(document), content: studioContent(document), listedParts, partIssues, workspacePartCount, dialogSelections, measurements, section, dialog: dialogName };
  };
  const step = async text => {
    const [verb] = text.split(' '), rest = text.slice(verb.length).trim();
    if (!['feature', 'dialogfill', 'dialogconfirm', 'dialogcancel', 'checkpoint', 'studiotool', 'selectpart', 'dialogselect', 'dialogcheck', 'featureaction', 'dialogfocus', 'dialogremove', 'pickviewcenter'].includes(verb)) return base.step(text);
    if (!(await base.inDemo())) throw new Error('Studio workflow input requires demo mode');
    const since = await settledSnapshot(page);
    if (verb === 'pickviewcenter') {
      // A single stock board is centered by the named camera view. This is a real canvas click, never a model edit.
      const canvas = page.getByTestId('workspace-3d').locator('canvas').first();
      await canvas.waitFor();
      const box = await canvas.boundingBox();
      if (!box) throw new Error('The workspace canvas has no visible bounds');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else if (verb === 'studiotool') {
      await page.getByRole('toolbar', { name: 'Part Studio toolbar', exact: true }).getByRole('button', { name: rest, exact: true }).click();
    } else if (verb === 'selectpart') {
      const rows = page.getByRole('list', { name: 'Parts', exact: true }).getByRole('listitem').filter({ has: page.getByText(rest, { exact: true }) });
      if (await rows.count() !== 1) throw new Error(`Part name must identify one rendered row: ${rest}`);
      await rows.getByRole('button').first().click();
    } else if (verb === 'dialogfocus') {
      await page.getByRole('dialog').getByRole('group', { name: rest, exact: true }).click();
    } else if (verb === 'dialogremove') {
      const at = rest.indexOf(' = ');
      if (at < 0) throw new Error('dialogremove takes Box = Part name');
      const name = rest.slice(0, at), part = rest.slice(at + 3);
      await page.getByRole('dialog').getByRole('group', { name, exact: true })
        .getByRole('button', { name: `Take ${part} out of ${name.toLowerCase()}`, exact: true }).click();
    } else if (verb === 'dialogselect' || verb === 'dialogcheck') {
      const at = rest.indexOf(' = ');
      if (at < 0) throw new Error(`${verb} takes Label = value`);
      const label = rest.slice(0, at);
      const field = verb === 'dialogselect'
        ? page.getByRole('dialog').getByRole('combobox', { name: label, exact: true })
        : page.getByRole('dialog').getByLabel(label, { exact: true });
      if (verb === 'dialogselect') await field.selectOption(rest.slice(at + 3));
      else {
        const value = rest.slice(at + 3);
        if (!['true', 'false'].includes(value)) throw new Error('dialogcheck requires true or false');
        await field.setChecked(value === 'true');
      }
    } else if (verb === 'featureaction') {
      const at = rest.indexOf(' = ');
      if (at < 0) throw new Error('featureaction takes Feature name = Action');
      const name = rest.slice(0, at), action = rest.slice(at + 3);
      const row = page.getByRole('region', { name: 'Features', exact: true }).getByRole('button', { name: new RegExp(`^${escapePattern(name)}(?:\\s|$)`) });
      if (await row.count() !== 1) throw new Error(`Feature name must identify one row: ${name}`);
      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: action, exact: true }).click();
    } else if (verb === 'feature') {
      const feature = page.getByRole('region', { name: 'Features', exact: true }).getByRole('button', { name: new RegExp(`^${escapePattern(rest)}(?:\\s|$)`) });
      // An ambiguous feature name must fail rather than silently editing the wrong part.
      if (await feature.count() !== 1) throw new Error(`Feature name must identify one row: ${rest}`);
      await feature.dblclick();
      await page.getByRole('dialog').waitFor();
    } else if (verb === 'dialogfill') {
      const at = rest.indexOf(' = ');
      if (at < 0) throw new Error('dialogfill takes Label = value');
      const label = rest.slice(0, at);
      const field = page.getByRole('dialog').getByRole('textbox', { name: new RegExp(`^${escapePattern(label)}(?:\\s+(?:mm|deg|°))?$`) });
      if (await field.count() !== 1) throw new Error(`Dialog field must identify one visible textbox: ${label}`);
      await field.fill(rest.slice(at + 3));
    } else if (verb === 'dialogconfirm' || verb === 'dialogcancel') {
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: verb === 'dialogconfirm' ? /^(OK|Save)$/ : 'Cancel', exact: true }).click();
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
