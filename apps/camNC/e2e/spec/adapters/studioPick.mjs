import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Where a model point (millimetres, Top plane = XY, Z up) is drawn in the Part Studio's 3D view, in page pixels. It
 * projects through the view's own camera, read from the running canvas, so it holds for any named view and zoom.
 * Null when the point is outside the view.
 */
export async function modelPointOnScreen(page, point) {
  const canvas = page.getByTestId('workspace-3d').locator('canvas').first();
  await canvas.waitFor({ timeout: 30_000 });
  return canvas.evaluate(async (element, [x, y, z]) => {
    // The page's own copy of the 3D library, so its root for this canvas is the one the view draws with.
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /@react-three_fiber\.js|@react-three\/fiber/.test(name)).at(-1);
    if (!moduleUrl) throw new Error('Viewport picks require the development server');
    const { _roots } = await import(moduleUrl);
    const root = _roots.get(element);
    if (!root) throw new Error('The 3D view has no camera yet');
    const { camera } = root.store.getState();
    camera.updateMatrixWorld();
    const projected = camera.position.clone().set(x, y, z).project(camera);
    if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) return null;
    const box = element.getBoundingClientRect();
    return { x: box.left + ((projected.x + 1) / 2) * box.width, y: box.top + ((1 - projected.y) / 2) * box.height };
  }, point);
}

/** `x,y,z` in model millimetres, as a scenario writes a viewport pick. */
export function parseModelPoint(text) {
  const values = text.split(',').map(value => (value.trim() ? Number(value) : NaN));
  if (values.length !== 3 || values.some(value => !Number.isFinite(value))) throw new Error(`viewpick takes a model point x,y,z in mm: ${text}`);
  return values;
}

/**
 * A pick in an open sketch, in the sketch plane's millimetres: `x,y`, or `x,y,0`. A point off the plane can't be
 * picked in the drawing, so a non-zero z is refused rather than dropped.
 */
export function parseSketchPick(text) {
  const values = text.split(',').map(value => (value.trim() ? Number(value) : NaN));
  if (![2, 3].includes(values.length) || values.some(value => !Number.isFinite(value)))
    throw new Error(`In a sketch, viewpick takes a point x,y in the sketch's mm: ${text}`);
  if (values[2]) throw new Error(`In a sketch, viewpick picks on the sketch plane, so z must be 0: ${text}`);
  return values.slice(0, 2);
}

/** One real click on the model point in the 3D view, as a person picks a face, region or plane there. */
export async function viewPick(page, text) {
  const point = parseModelPoint(text);
  const at = await modelPointOnScreen(page, point);
  if (!at) throw new Error(`The model point ${point.join(', ')} is not in the 3D view; choose a view that shows it`);
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.up();
}

/** A selection box's listing as a count: none, one region, several, or null for the whole sketch or a face. */
export function regionCount(selection) {
  if (/^No region picked/.test(selection ?? '')) return 0;
  if (/^A region of /.test(selection ?? '')) return 1;
  const count = /^(\d+) regions of /.exec(selection ?? '')?.[1];
  return count ? Number(count) : null;
}

/** What the open Extrude dialog will extrude: its selection box, what it lists, and whether region picking is on. */
export async function extrudeRegions(page) {
  const dialog = page.getByRole('dialog', { name: /^Extrude/ });
  if (!(await dialog.count())) return null;
  const select = dialog.getByRole('button', { name: 'Select profile', exact: true });
  if (!(await select.count())) return { box: null, selection: null, regions: null, picking: null };
  const row = select.locator('..');
  const box = (await row.locator('small').first().textContent())?.trim() ?? null;
  const selection = (await row.locator('span').first().textContent())?.trim() ?? null;
  return { box, selection, regions: regionCount(selection), picking: (await select.getAttribute('aria-pressed')) === 'true' };
}

/** Saves the download a visible button starts to `file`, making its folder. */
async function saveDownload(page, file, start) {
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await start();
  await mkdir(path.dirname(file), { recursive: true });
  await (await download).saveAs(file);
  return file;
}

/**
 * Exports the shown parts as STEP in millimetres through the design's visible Export dialog. A part left out of the
 * file fails the step with the dialog's reason, so a partial export can't pass as the whole result.
 */
export async function exportStep(page, file) {
  await page.getByRole('button', { name: 'Export…', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Export parts' });
  await dialog.waitFor();
  await dialog.getByRole('combobox', { name: 'Units' }).selectOption('mm');
  const submit = dialog.getByRole('button', { name: /^Download/ });
  if ((await submit.textContent())?.trim() !== 'Download') {
    const reason = await dialog.locator('p').allInnerTexts();
    throw new Error(`The export leaves parts out: ${reason.join(' ')}`);
  }
  await saveDownload(page, file, () => submit.click());
  // Its title changes as it closes, so wait for any export dialog to be gone.
  await page.getByRole('dialog', { name: /^Export/ }).waitFor({ state: 'hidden' });
  return file;
}

/** The whole design as Save to file writes it. */
export function saveDesign(page, file) {
  return saveDownload(page, file, () => page.getByRole('button', { name: 'Save to file', exact: true }).click());
}

/** Where each named view looks from, Z up, as the 3D view frames them; its view direction is the opposite. */
export const NAMED_VIEW_FROM = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  iso: [0.2, -0.75, 1],
};

/** The angle in degrees between two directions, of any length. */
export function angleBetween(a, b) {
  const cosine = a.reduce((sum, value, axis) => sum + value * b[axis], 0) / (Math.hypot(...a) * Math.hypot(...b));
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
}

/** The named view a view direction matches within `degrees`, or null. */
export function namedView(direction, degrees = 1) {
  const match = Object.entries(NAMED_VIEW_FROM).find(([, from]) => angleBetween(from.map(value => -value), direction) <= degrees);
  return match?.[0] ?? null;
}

/** The 3D view's camera: the unit direction it looks along, in model axes, and the named view that is. Null without one. */
export async function studioCamera(page) {
  const canvas = page.getByTestId('workspace-3d').locator('canvas').first();
  if (!(await canvas.isVisible())) return null;
  const direction = await canvas.evaluate(async element => {
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /@react-three_fiber\.js|@react-three\/fiber/.test(name)).at(-1);
    const root = moduleUrl && (await import(moduleUrl))._roots.get(element);
    if (!root) return null;
    const { camera } = root.store.getState();
    camera.updateMatrixWorld();
    return camera.getWorldDirection(camera.position.clone()).toArray();
  });
  if (!direction) return null;
  return { direction: direction.map(value => Math.round(value * 1e4) / 1e4 || 0), view: namedView(direction) };
}

/**
 * The origin and base planes: whether the 3D view draws each (its label, or the origin's dot) and whether its Feature
 * list row is shown or hidden by its eye. An eye is named for what it does, so "Show" means the row is hidden.
 */
export async function studioPlanes(page) {
  const view = page.getByTestId('workspace-3d');
  const drawn = (await view.isVisible())
    ? await view.evaluate(element => {
        const names = new Set();
        if (element.querySelector('[data-testid="model-origin"]')) names.add('Origin');
        for (const label of element.querySelectorAll('div')) {
          const text = label.textContent?.trim();
          if (label.children.length || !['Top', 'Front', 'Right'].includes(text)) continue;
          if (!label.closest('button, [role=toolbar], [role=group], [role=dialog]')) names.add(text);
        }
        return [...names];
      })
    : [];
  const rows = await page.getByRole('list', { name: 'Default geometry', exact: true }).getByRole('listitem').evaluateAll(items => items.map(item => ({
    // The name is the row's own span without children, not the icon beside it.
    name: [...item.querySelectorAll('span:not([aria-hidden])')].filter(span => !span.children.length).map(span => span.textContent?.trim()).find(Boolean) ?? null,
    eye: item.querySelector('button[aria-label="Show"], button[aria-label="Hide"]')?.getAttribute('aria-label') ?? null,
  })));
  return Object.fromEntries(['Origin', 'Top', 'Front', 'Right'].map(name => {
    const row = rows.find(candidate => candidate.name === name);
    return [name, { view: drawn.includes(name), list: !row ? null : row.eye === 'Show' ? 'hidden' : 'shown' }];
  }));
}
