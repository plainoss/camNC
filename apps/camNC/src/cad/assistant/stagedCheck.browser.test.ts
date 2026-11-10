import { expect, it } from 'vitest';
import { createCadDocument } from '@wbcnc/cad';
import { checkScriptInBrowser } from './scriptCheck';
import { finalizeBrowserCandidate } from './finalizeCandidate';

const source = `d => { const p=d.newPart('Panel',{thickness:18});p.profile.rect({at:[0,0],w:100,h:80});p.expect({size:[100,80],freedom:0}); }`;
it('checks geometry without planning, then fully checks the exact candidate without re-executing its script', async () => {
  const start = createCadDocument();
  const geometry = await checkScriptInBrowser(start, source, { toolpaths: false });
  expect(geometry.ok, JSON.stringify(geometry.report)).toBe(true);
  expect(geometry.report.parts[0]!.toolpaths).toBeUndefined();
  const before = JSON.stringify(geometry.document);
  const final = await finalizeBrowserCandidate(geometry, new AbortController().signal);
  expect(final.ok, JSON.stringify(final.report)).toBe(true);
  expect(final.report.parts[0]!.toolpaths).toBeDefined();
  expect(final.document).toEqual(geometry.document);
  expect(JSON.stringify(geometry.document)).toBe(before);
  expect(final.document.id).toBe(start.id);
  expect(final.document.parts[0]!.sketch.entities.map(e => e.id)).toEqual(geometry.document.parts[0]!.sketch.entities.map(e => e.id));
});
it('keeps full planning enabled by default for existing callers', async () => {
  const checked = await checkScriptInBrowser(createCadDocument(), source);
  expect(checked.ok, JSON.stringify(checked.report)).toBe(true);
  expect(checked.report.parts[0]!.toolpaths).toBeDefined();
});
it('preserves expectation failures and path closure warnings across the stages', async () => {
  const mismatch = await checkScriptInBrowser(createCadDocument(), source.replace('size:[100,80]', 'size:[120,80]'), { toolpaths: false });
  expect(mismatch.ok).toBe(false);
  expect(mismatch.report.errors.some(e => e.code === 'expect-failed')).toBe(true);
  const refused = await finalizeBrowserCandidate(mismatch, new AbortController().signal);
  expect(refused.ok).toBe(false);
  expect(refused.report.errors).toEqual(mismatch.report.errors);
  const path = await checkScriptInBrowser(
    createCadDocument(),
    `d => { d.newPart('Panel').profile.path([0,0]).lineTo([100,0]).lineTo([100,80]).lineTo([0,80]).close(); }`,
    { toolpaths: false }
  );
  expect(path.ok, JSON.stringify(path.report)).toBe(true);
  expect(path.report.warnings.some(w => w.code === 'close-straight')).toBe(true);
  const final = await finalizeBrowserCandidate(path, new AbortController().signal);
  expect(final.ok, JSON.stringify(final.report)).toBe(true);
  expect(final.report.warnings.filter(w => w.code === 'close-straight')).toEqual(
    path.report.warnings.filter(w => w.code === 'close-straight')
  );
});
it('does not publish a full result after cancellation', async () => {
  const checked = await checkScriptInBrowser(createCadDocument(), source, { toolpaths: false });
  const controller = new AbortController();
  controller.abort();
  const final = await finalizeBrowserCandidate(checked, controller.signal);
  expect(final.ok).toBe(false);
  expect(final.scriptError).toContain('stopped');
  expect(final.report.parts).toEqual([]);
});

it('adds planning warnings only at full acceptance instead of losing them during geometry repairs', async () => {
  const checked = await checkScriptInBrowser(
    createCadDocument(),
    `d => { const p=d.newPart('Panel');p.profile.rect({at:[0,0],w:100,h:80});const s=p.sketchOn('top');s.circle({at:[50,40],d:2});p.cut(s.regionAt(50,40),{depth:3}); }`,
    { toolpaths: false }
  );
  expect(checked.ok, JSON.stringify(checked.report)).toBe(true);
  expect(checked.report.warnings.some(w => w.code === 'toolpath-missing')).toBe(false);
  const final = await finalizeBrowserCandidate(checked, new AbortController().signal);
  expect(final.report.warnings.some(w => w.code === 'toolpath-missing')).toBe(true);
  expect(final.report.parts[0]!.toolpaths).toBeDefined();
});

it('rejects a result when cancelled during full acceptance', async () => {
  const checked = await checkScriptInBrowser(createCadDocument(), source, { toolpaths: false });
  const controller = new AbortController();
  const pending = finalizeBrowserCandidate(checked, controller.signal);
  controller.abort();
  const final = await pending;
  expect(final.ok).toBe(false);
  expect(final.scriptError).toContain('stopped');
});
