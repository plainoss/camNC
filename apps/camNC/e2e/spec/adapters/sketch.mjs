/**
 * The only app-specific code for sketch specs: it drives real pointer and keyboard input and reads
 * the saved design. Scenarios never see these hooks, so replacing the app means replacing this file.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { settledSnapshot, waitSettled } from '../settle.mjs';
import { SKETCH_KEYS, canonical, checkSketch, point, samePoint } from './sketchModel.mjs';

/** Design files named by `open` are relative to the spec folder, so `designs/x.json` is `e2e/spec/designs/x.json`. */
const SPEC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The Part Studio's named views, in the order of their Shift+1 to Shift+7 shortcuts. */
export const NAMED_VIEWS = ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso'];

/* Runs in the page. Reads what is on screen, in screen pixels. */
function readScene(cursor) {
  const svg = document.querySelector('[data-testid="cad-canvas"]');
  if (!svg) return { stage: location.pathname.split('/').pop(), noCanvas: true, pressed: [], labels: [], colors: {}, previewWidths: [], committedWidths: [], status: '', footer: '' };
  const visible = el => {
    const s = getComputedStyle(el);
    const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(s.stroke)?.[1];
    return s.stroke !== 'none' && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0 && Number(s.strokeOpacity) > 0 && (alpha === undefined || Number(alpha) > 0);
  };
  const width = el => {
    const s = getComputedStyle(el);
    const px = parseFloat(s.strokeWidth);
    if (s.vectorEffect === 'non-scaling-stroke') return px;
    const m = el.getScreenCTM();
    return px * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  };
  const shapes = 'line,path,polyline,polygon,circle,ellipse,rect';
  const preview = [...svg.querySelectorAll('.cad-preview')].flatMap(g => [...g.querySelectorAll(shapes)]).filter(visible);
  const committed = [...svg.querySelectorAll('[data-entity-id]')].flatMap(g => (g.matches(shapes) ? [g] : [...g.querySelectorAll(shapes)])).filter(visible);
  const rgb = el => (getComputedStyle(el).stroke.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const colors = { dark: 0, blue: 0, other: 0 };
  const seen = new Set();
  for (const el of committed) {
    const owner = el.closest('[data-entity-id]').getAttribute('data-entity-id');
    if (seen.has(owner)) continue;
    seen.add(owner);
    const [r, g, b] = rgb(el);
    if (r < 90 && g < 90 && b < 90) colors.dark++;
    else if (b > r + 60 && b > g + 40) colors.blue++;
    else colors.other++;
  }
  const texts = [...svg.querySelectorAll('text')].map(t => ({ text: t.textContent.trim(), rect: t.getBoundingClientRect() })).filter(t => /\d/.test(t.text));
  const segments = [...svg.querySelectorAll('[data-dimension-line]')].filter(visible).map(el => {
    const m = el.getScreenCTM();
    const map = (x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
    if (el.tagName === 'line') return [map(+el.getAttribute('x1'), +el.getAttribute('y1')), map(+el.getAttribute('x2'), +el.getAttribute('y2'))];
    const r = el.getBoundingClientRect();
    return [[r.left, r.top], [r.right, r.bottom]];
  });
  const toSegment = ([x, y], [[ax, ay], [bx, by]]) => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  };
  const annotation = texts.length
    ? texts
        .map(t => {
          const c = [t.rect.left + t.rect.width / 2, t.rect.top + t.rect.height / 2];
          return {
            label: t.text,
            toCursor: cursor ? Math.hypot(c[0] - cursor[0], c[1] - cursor[1]) : null,
            toLine: segments.length ? Math.min(...segments.map(segment => toSegment(c, segment))) : null,
          };
        })
        .sort((a, b) => (a.toCursor ?? 0) - (b.toCursor ?? 0))[0]
    : null;
  const pressed = [...document.querySelectorAll('[aria-pressed="true"]')].map(el => el.getAttribute('aria-label') ?? '').filter(Boolean);
  const active = document.activeElement;
  return {
    previewCount: preview.length,
    previewWidths: preview.map(width),
    committedWidths: committed.map(width),
    colors,
    annotation,
    labels: texts.map(t => t.text),
    labelCentres: texts.map(t => ({ text: t.text, x: t.rect.left + t.rect.width / 2, y: t.rect.top + t.rect.height / 2 })),
    regions: svg.querySelectorAll('[data-sketch-region]').length,
    cutDepths: [...svg.querySelectorAll('[data-cut-depth]')].map(el => el.getAttribute('data-cut-depth')).sort(),
    pressed,
    focusInput: !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'),
    status: document.querySelector('.cad-status')?.textContent ?? '',
    footer: document.querySelector('.cad-canvas-footer')?.textContent ?? '',
    stage: location.pathname.split('/').pop(),
    gridLines: svg.querySelectorAll('pattern, [data-grid], .cad-grid, .cad-grid line').length,
  };
}

/* Runs in the page. A reviewable drawing: real shapes in screen pixels, effective strokes, no names or IDs. */
function readFrame() {
  const svg = document.querySelector('[data-testid="cad-canvas"]');
  if (!svg) return null;
  const box = svg.getBoundingClientRect();
  const n = value => Math.round(value * 100) / 100;
  const lines = [];
  for (const el of svg.querySelectorAll('line,path,polyline,polygon,circle,ellipse,rect')) {
    if (el.closest('pattern,defs,clipPath')) continue;
    const s = getComputedStyle(el);
    const hasStroke = s.stroke !== 'none' && !/,\s*0\)$/.test(s.stroke);
    const hasFill = s.fill !== 'none' && !/,\s*0\)$/.test(s.fill);
    if ((!hasStroke && !hasFill) || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
    if (el.getAttribute('fill')?.startsWith('url(')) continue;
    const m = el.getScreenCTM();
    const px = parseFloat(s.strokeWidth);
    const width = s.vectorEffect === 'non-scaling-stroke' ? px : px * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    const shape = {};
    for (const attr of ['d', 'points', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height']) {
      const value = el.getAttribute(attr);
      if (value !== null) shape[attr] = value.replace(/-?\d+\.\d+(?:e-?\d+)?/g, match => String(Math.round(Number(match) * 100) / 100));
    }
    const attrs = Object.entries(shape).map(([key, value]) => `${key}="${value}"`).join(' ');
    const matrix = [m.a, m.b, m.c, m.d, m.e - box.left, m.f - box.top].map(n).join(' ');
    lines.push(`<${el.tagName} ${attrs} transform="matrix(${matrix})" vector-effect="non-scaling-stroke" stroke="${hasStroke ? s.stroke : 'none'}" stroke-width="${n(width)}" stroke-dasharray="${s.strokeDasharray}" fill="${hasFill ? s.fill : 'none'}" fill-rule="${s.fillRule}" opacity="${s.opacity}"/>`);
  }
  for (const t of svg.querySelectorAll('text')) {
    const b = t.getBoundingClientRect();
    if (!b.width) continue;
    const s = getComputedStyle(t);
    // Centre, not corner: glyph widths differ between platforms' fonts, and a golden must not depend on them.
    lines.push(`<text x="${n(b.left + b.width / 2 - box.left)}" y="${n(b.top + b.height / 2 - box.top)}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="11" fill="${s.fill}">${t.textContent.trim().replace(/[<&]/g, '')}</text>`);
  }
  // Document order, because later shapes draw over earlier ones.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(box.width)} ${Math.round(box.height)}">\n${lines.join('\n')}\n</svg>\n`;
}

export async function createAdapter(page, url) {
  // The dev server's type-check overlay would swallow every click; type errors have their own check.
  await page.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'vite-plugin-checker-error-overlay{display:none!important}';
      document.head.append(style);
    });
  });
  page.setDefaultNavigationTimeout(45000);
  await page.goto(new URL('/demo?camera=off', url).href, { waitUntil: 'domcontentloaded' });
  await page.getByRole('region', { name: 'Demo mode', exact: true }).waitFor();
  await page.goto(new URL('/cam', url).href, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^New design/ }).click();
  await page.getByTestId('model-origin').waitFor();
  await waitSettled(page);
  // This coordinate corpus is authored in mm, matching the headless adapter. Keep its fixture unit explicit when
  // the app's new-design default changes, so the existing geometry and label assertions retain their meaning.
  await page.getByRole('button', { name: 'Design settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Design settings', exact: true });
  await settings.getByRole('combobox', { name: 'Length unit' }).selectOption('mm');
  await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
  await settings.waitFor({ state: 'hidden' });
  await waitSettled(page);
  const canvas = page.getByTestId('cad-canvas');
  const studioToolbar = page.getByRole('toolbar', { name: 'Part Studio toolbar' });
  // A new design opens in the Part Studio with no parts: scenarios start a sketch on the top plane.
  await studioToolbar.getByRole('button', { name: /Sketch/ }).click();
  await page.getByRole('list', { name: 'Default geometry' }).getByRole('button', { name: 'Top', exact: true }).click();
  await canvas.waitFor();
  // These coordinate specs ask for a normal drawing view explicitly; opening a sketch preserves the studio camera.
  await canvas.press('n');
  await waitSettled(page);
  const pan = await canvas.evaluate(svg => {
    const view = svg.viewBox.baseVal, matrix = svg.getScreenCTM();
    const center = new DOMPoint(view.x + view.width / 2, view.y + view.height / 2).matrixTransform(matrix);
    const wanted = new DOMPoint(115, -70).matrixTransform(matrix);
    return { x: center.x, y: center.y, dx: center.x - wanted.x, dy: center.y - wanted.y };
  });
  await page.mouse.move(pan.x, pan.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(pan.x + pan.dx, pan.y + pan.dy, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await waitSettled(page);
  // Existing designs open in the Part Studio, and most steps work on the first part's sketch.
  const flatView = async () => {
    await page.getByRole('toolbar', { name: /^(Part Studio|Sketch) toolbar$/ }).first().waitFor();
    if (await studioToolbar.isVisible())
      await page.getByRole('region', { name: 'Features' }).getByRole('button', { name: /^Sketch( · | \d)/ }).first().dblclick();
    // A part shown in 3D, as after a face sketch, goes back to its drawing.
    const drawing = page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Drawing', exact: true });
    if ((await drawing.isVisible()) && (await drawing.getAttribute('aria-pressed')) !== 'true') await drawing.click();
    await canvas.waitFor();
    if ((await canvas.getAttribute('data-sketch-turned')) !== null) {
      await canvas.press('n');
      await waitSettled(page);
    }
  };
  /** Closes the open sketch back to the studio with its dialog's tick. */
  const closeSketch = async () => {
    await page.getByRole('dialog', { name: /^Sketch( ·| \d)/ }).getByRole('button', { name: /Finish sketch/ }).click();
    await studioToolbar.waitFor();
  };
  /** Back to the Part Studio from an open sketch; anywhere else, such as the Plan stage, says what needed it. */
  const toStudio = async what => {
    if (await studioToolbar.isVisible()) return;
    if (!(await page.getByRole('dialog', { name: /^Sketch( ·| \d)/ }).isVisible()))
      throw new Error(`${what} needs the Part Studio, and this page is not in it. A render can use --view page here.`);
    await closeSketch();
  };
  /**
   * A finished sketch is a sketch until it's extruded: its row selected, Shift+E extrudes all of it. A part already
   * extruded is left as it is, since Extrude would start another extrude of it.
   */
  const extrudeSketch = async () => {
    const extrude = page.getByRole('dialog', { name: /^Extrude( ·| \d)/ });
    // The sketch rows are listed in part order, one for each part with a sketch of its own.
    const design = await readDesign();
    const sketched = (design?.parts ?? []).filter(part => !part.sketchOf && !part.faceProfile);
    const index = sketched.findIndex(part => part.extrude === false);
    if (!(await extrude.isVisible()) && index >= 0) {
      // With nothing selected a confirmed sketch's Extrude starts with no region picked.
      const rows = page.getByRole('region', { name: 'Features' }).getByRole('button', { name: /^Sketch( · | \d)/ });
      await rows.nth(index).click();
      await page.keyboard.press('Shift+E');
      await extrude.waitFor({ timeout: 3000 }).catch(() => {});
    }
    if (await extrude.isVisible()) await extrude.getByRole('button', { name: 'OK', exact: true }).click();
  };
  // `open` moves the session to the project it makes.
  let jobId = new URL(page.url()).pathname.split('/')[2];
  let cursor = null;

  // The canvas can be re-rendered between steps, and a loaded runner can take longer than the 8 s default to bring it back.
  const screen = async ([x, y]) => {
    await canvas.waitFor({ state: 'attached', timeout: 30_000 });
    return canvas.evaluate((svg, p) => {
      const q = new DOMPoint(p[0], -p[1]).matrixTransform((svg.querySelector('[data-testid="cad-drawing"]') ?? svg).getScreenCTM());
      return [q.x, q.y];
    }, [x, y]);
  };
  const moveTo = async at => {
    const [x, y] = await screen(at);
    await page.mouse.move(x, y, { steps: 4 });
    cursor = [x, y];
    return [x, y];
  };
  const settle = (since = null) => waitSettled(page, since);
  // After a reload the design editor is back once its canvas is drawn and it has finished checking the design. A fixed
  // pause was too short on a busy runner, so the first check could look before the labels were drawn.
  const reopened = async () => {
    if (/\/design$/.test(new URL(page.url()).pathname)) {
      // It may come back showing the 3D view, with the sketch canvas there but hidden.
      await page.getByTestId('cad-canvas').waitFor({ state: 'attached', timeout: 30_000 });
      await settle();
    } else if (/\/boards$/.test(new URL(page.url()).pathname)) {
      // An accepted design reopens on Boards. Its stage links are present even while the board is still loading.
      await page.getByRole('region', { name: /^Board .+ drawing$/ }).first().waitFor({ timeout: 30_000 });
    } else await page.waitForTimeout(1500);
  };
  const leaveTool = async () => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  };
  // Each click of a drawing tool can start a solve and change what the next click snaps to, so it settles first.
  const click = async (at, options) => {
    await moveTo(at);
    await page.mouse.down(options);
    await page.mouse.up(options);
    await settle();
  };
  const drag = async (from, to) => {
    await moveTo(from);
    await page.mouse.down();
    const [x, y] = await screen(to);
    await page.mouse.move(x, y, { steps: 12 });
    cursor = [x, y];
    await page.mouse.up();
  };
  const chooseTool = async name => {
    const family = /arc|conic/i.test(name) ? 'Arc tools' : /rectangle/i.test(name) ? 'Rectangle tools' : 'Spline tools';
    await page.getByRole('button', { name: family, exact: true }).click();
    await page.locator('[role=menu][data-state=open]').getByRole('menuitem', { name, exact: true }).click();
  };
  /**
   * A draw step chooses its tool by key, unless that tool is already on: a step before it may have chosen it, as a
   * person does, and pressing the key again would turn it off.
   */
  const chooseByKey = async (key, name) => {
    const button = page.getByRole('toolbar', { name: 'Sketch toolbar' }).getByRole('button', { name });
    if ((await button.count()) === 1 && (await button.getAttribute('aria-pressed')) === 'true') return;
    await page.keyboard.press(key);
  };
  const readDesign = (which = 'draft') =>
    page.evaluate(async ([id, key]) => {
      const url = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => name.includes('/src/cam/jobDb.ts')).at(-1);
      if (!url) throw new Error('Specs need the Vite development server');
      const { getJob } = await import(url);
      return (await getJob(id))?.design?.[key] ?? null;
    }, [jobId, which]);

  /**
   * Runs a machine step and, when it fails, adds the controller's state and its last console lines to the error, which
   * the runner writes to results.json. Only its first lines are kept there, so all of this goes on two lines after the
   * first. The module is imported by its path: the resource timing list stops at 250 entries.
   */
  const withMachineState = async fn => {
    try {
      return await fn();
    } catch (error) {
      const summary = await page
        .evaluate(async () => {
          const { getCncApi } = await import('/src/lib/fluidnc/machine.ts');
          const api = getCncApi();
          const lines = api.consoleLines.value.slice(-40).map(line => `${line.kind} ${line.text}`);
          const state = { connected: api.isConnected.value, state: api.state.value, homed: api.homed.value, zZeroedAt: api.zZeroedAt.value };
          return `machine: ${JSON.stringify(state)}\nconsole (last ${lines.length}): ${lines.join(' ⏎ ')}`;
        })
        .catch(err => `machine: unavailable (${String(err?.message ?? err).split('\n')[0]})`);
      if (error instanceof Error) {
        const [first, ...rest] = String(error.message).split('\n');
        error.message = [first, summary, ...rest].join('\n');
      }
      throw error;
    }
  };

  // Machine-only binding: the footer now homes, explicitly confirms the probe, then runs.
  const prepareMachineSteps = async () => {
    // A CAM job's board program has to be in the machine view before homing and probing. Loading a program for another
    // bit than the one loaded clears Z zero, so a load that lands after the probe would put the footer back on Probe Z
    // and Run job never shows. Its Load button is disabled until the program is made and hides once it's loaded: wait
    // for both rather than skipping a disabled button.
    const load = page.getByRole('button', { name: /^Load (program|tab removal|parts freeing)$/ }).first();
    if (await load.waitFor({ timeout: 8000 }).then(() => true, () => false)) {
      await page.waitForFunction(element => !element.disabled, await load.elementHandle(), { timeout: 30_000 });
      await load.click();
    }
    await load.waitFor({ state: 'hidden', timeout: 15_000 });
    const home = page.getByRole('button', { name: 'Home machine', exact: true });
    const probe = page.getByRole('button', { name: 'Probe Z', exact: true });
    const run = page.getByRole('button', { name: 'Run job', exact: true });
    if (await home.isVisible().catch(() => false)) {
      await home.click();
      await probe.or(run).waitFor({ timeout: 15000 });
    }
    if (await probe.isVisible().catch(() => false)) {
      await probe.click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Probe', exact: true }).click();
    }
    await run.waitFor({ timeout: 15000 });
    await page.waitForTimeout(900);
  };
  const prepareMachine = () => withMachineState(prepareMachineSteps);

  const act = async text => {
    const space = text.indexOf(' ');
    const verb = space < 0 ? text : text.slice(0, space);
    const rest = space < 0 ? '' : text.slice(space + 1);
    const args = rest.split(' ');
    switch (verb) {
      // The step before has settled, so a value field it opened (after the solver checked a dimension) has focus.
      case 'key':
        await page.keyboard.press(rest);
        return;
      case 'type':
        await page.keyboard.type(rest);
        return;
      case 'click':
        return click(point(rest));
      case 'rclick':
        return click(point(rest), { button: 'right' });
      case 'dblclick': {
        const [x, y] = await moveTo(point(rest));
        await page.mouse.dblclick(x, y);
        return;
      }
      case 'shiftclick':
        await page.keyboard.down('Shift');
        await click(point(rest));
        await page.keyboard.up('Shift');
        return;
      case 'hover':
        await moveTo(point(rest));
        return;
      case 'down':
        await moveTo(point(rest));
        await page.mouse.down();
        return;
      case 'move': {
        const [x, y] = await screen(point(rest));
        await page.mouse.move(x, y, { steps: 8 });
        cursor = [x, y];
        return;
      }
      case 'up':
        await page.mouse.up();
        return;
      case 'drag':
        return drag(point(args[0]), point(args[1]));
      case 'wheel':
        await moveTo(point(args[0]));
        await page.mouse.wheel(0, Number(args[1]));
        return;
      case 'tool':
        return chooseTool(rest);
      case 'flat':
        return flatView();
      case 'click3d': {
        // The camera frames the part, so the middle of the view is the middle of the part. A busy machine can take a
        // moment to have the view ready to pick, so click again until the region's depth field opens.
        const view = page.getByTestId('part-3d'),
          field = page.getByRole('group', { name: 'Cut depth' });
        for (let attempt = 0; attempt < 6; attempt++) {
          const box = await view.boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
          await page.waitForTimeout(150);
          await page.mouse.down();
          await page.mouse.up();
          if (await field.waitFor({ timeout: 1000 }).then(() => true, () => false)) break;
        }
        return;
      }
      case 'button':
        // A button can wait on work in progress, as "Take the job to the machine" waits for every board's plan. On a busy
        // runner that takes longer than the default 8 s a click waits for it to enable.
        await page.getByRole('button', { name: new RegExp(rest, 'i') }).first().click({ timeout: 30_000 });
        return;
      case 'handle': {
        // handle <start|end> <point|segment>, optionally with Shift to add to the selection.
        const [end, part, add] = args;
        const target = page.locator(`[data-spline-handle-${part}="${end}"]`).first();
        const box = await target.boundingBox();
        if (add) await page.keyboard.down('Shift');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
        await page.mouse.down();
        await page.mouse.up();
        if (add) await page.keyboard.up('Shift');
        return;
      }
      case 'check':
        await page.getByLabel(rest, { exact: true }).check();
        return;
      case 'uncheck':
        await page.getByLabel(rest, { exact: true }).uncheck();
        return;
      case 'hold':
        await page.keyboard.down(rest);
        return;
      case 'release':
        await page.keyboard.up(rest);
        return;
      case 'selectdim':
      case 'editdim': {
        const label = page.locator('[data-dimension]').first();
        const box = await label.boundingBox();
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y, { steps: 3 });
        if (verb === 'editdim') await page.mouse.dblclick(x, y);
        else await page.mouse.click(x, y);
        return;
      }
      case 'hideplanes': {
        // The origin and base planes off with their eyes in the feature list, so a fitted view frames the parts alone.
        await toStudio('Hiding the planes');
        const geometry = page.getByRole('list', { name: 'Default geometry' });
        const shown = geometry.getByRole('button', { name: 'Hide', exact: true });
        for (let left = await shown.count(); left > 0; left--) {
          await shown.first().click();
          await page.waitForFunction(([list, want]) => list.querySelectorAll('button[aria-label="Hide"]').length === want, [await geometry.elementHandle(), left - 1]);
        }
        // Off the list, so a hovered row's eye doesn't show in a picture.
        await page.mouse.move(0, 0);
        return;
      }
      case 'view': {
        // A named view of the Part Studio's 3D view, by its keyboard shortcut (the studio toolbar's Views help).
        const digit = NAMED_VIEWS.indexOf(rest) + 1;
        if (!digit) throw new Error(`Unknown view: ${rest}. Use one of ${NAMED_VIEWS.join(', ')}`);
        await toStudio(`The ${rest} view`);
        const workspace = page.getByTestId('workspace-3d');
        const scene = workspace.locator('canvas').first();
        await scene.waitFor({ timeout: 30_000 });
        await workspace.focus();
        await page.keyboard.press(`Shift+Digit${digit}`);
        await settle();
        // The camera moves in an effect and is drawn on a later frame: done once two frames in a row look the same.
        let last = null;
        for (let attempt = 0; ; attempt++) {
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const picture = await scene.screenshot({ animations: 'disabled' });
          if (last?.equals(picture)) return;
          if (attempt >= 30) throw new Error(`The 3D view kept changing after choosing the ${rest} view`);
          last = picture;
        }
      }
      case 'addpart': {
        // In the Part Studio a new part is sketched from the studio: close the open sketch, then Sketch on the top plane.
        if (!(await studioToolbar.isVisible())) {
          await closeSketch();
          await extrudeSketch();
        }
        await studioToolbar.getByRole('button', { name: /Sketch/ }).click();
        await page.getByRole('list', { name: 'Default geometry' }).getByRole('button', { name: 'Top', exact: true }).click();
        await canvas.waitFor();
        return;
      }
      case 'line':
        await chooseByKey('l', /^Line \(L\)$/);
        await click(point(args[0]));
        await click(point(args[1]));
        return leaveTool();
      case 'rect':
        await chooseByKey('g', /^Corner rectangle \(G\)$/);
        await click(point(args[0]));
        await click(point(args[1]));
        return leaveTool();
      case 'circle': {
        const [x, y] = point(args[0]);
        await chooseByKey('c', /^Circle \(C\)$/);
        await click([x, y]);
        await click([x + Number(args[1]), y]);
        return leaveTool();
      }
      case 'arc':
        await chooseByKey('a', /^Arc \(A\)$/);
        for (const at of args) await click(point(at));
        return leaveTool();
      case 'field': {
        const value = args.pop();
        const field = page.getByLabel(new RegExp(`^${args.join(' ')}`));
        await field.fill(value);
        await page.keyboard.press('Enter');
        return;
      }
      case 'fieldkeep': {
        const value = args.pop();
        await page.getByLabel(new RegExp(`^${args.join(' ')}`)).fill(value);
        await page.keyboard.press('Enter');
        return;
      }
      case 'reload':
        await page.reload({ waitUntil: 'domcontentloaded' });
        await reopened();
        return;
      case 'reloadnow':
        await page.reload({ waitUntil: 'domcontentloaded' });
        await reopened();
        return;
      case 'goto': {
        // Leaving the design takes the sketch along as a part, as Extrude makes one of it.
        // A sketch that can't be finished stays open, for leaving to say why.
        const finishSketch = page.getByRole('dialog', { name: /^Sketch( ·| \d)/ }).getByRole('button', { name: /Finish sketch/ });
        if (/Boards|Plan|Machine/.test(rest) && (await finishSketch.isVisible()) && (await finishSketch.isEnabled())) {
          await closeSketch();
          await extrudeSketch();
        }
        // A stage link is marked pending (aria-disabled) while the step before it still works, as Plan does while the
        // boards are being laid out. On a busy runner that takes longer than the default 8 s a click waits for it.
        await page
          .getByRole('link', { name: new RegExp(rest) })
          .or(page.getByRole('button', { name: new RegExp(`^${rest}$`) }))
          .first()
          .click({ timeout: 30_000 });
        return;
      }
      case 'start': {
        await prepareMachine();
        await page.getByRole('button', { name: /^Run job/ }).click();
        await page.getByRole('alertdialog').getByRole('button', { name: /^Run( anyway)?$/ }).click({ timeout: 8000 });
        await page.getByText('Job started').first().waitFor({ timeout: 20000 });
        return;
      }
      case 'wait':
        await page.getByRole('button', { name: /Done, next/ }).waitFor({ timeout: 240000 });
        await page.waitForTimeout(800);
        return;
      case 'run':
        // Only ever the demo's simulated controller: the adapter always enters demo mode above.
        return withMachineState(async () => {
          await prepareMachineSteps();
          await page.getByRole('button', { name: '16×', exact: true }).click();
          await page.getByRole('button', { name: /^Run job/ }).click();
          await page.getByRole('alertdialog').getByRole('button', { name: /^Run( anyway)?$/ }).click({ timeout: 8000 });
          await page.getByText('Job started').first().waitFor({ timeout: 20000 });
          await page.getByRole('button', { name: /Done, next/ }).waitFor({ timeout: 180000 });
          await page.waitForTimeout(500);
        });
      case 'edit':
        await page.getByText('Edit design', { exact: true }).first().click();
        await flatView();
        return;
      case 'closesketch':
        await closeSketch();
        return;
      case 'finish': {
        // A sketch closes back to the studio, and Done there accepts the design.
        if (!(await studioToolbar.isVisible())) await closeSketch();
        await extrudeSketch();
        const done = studioToolbar.getByRole('button', { name: /Done/ });
        await page.waitForFunction(element => !element.disabled, await done.elementHandle(), { timeout: 8000 });
        await done.click();
        // Accepting checks and saves the design before it leaves, which can take longer than a click's timeout on a
        // loaded runner: once that has settled, the stage has changed.
        await settle();
        await page.waitForURL(u => !u.pathname.endsWith('/design'), { timeout: 8000 });
        return;
      }
      case 'cancel':
        // Cancelling the sketch returns to the studio, and cancelling there leaves the design.
        if (!(await studioToolbar.isVisible())) {
          await page.getByRole('dialog', { name: /^Sketch( ·| \d)/ }).getByRole('button', { name: 'Cancel', exact: true }).click();
          await studioToolbar.waitFor();
        }
        await studioToolbar.getByRole('button', { name: 'Cancel', exact: true }).click();
        return;
      case 'open': {
        // A saved design file (Save to file in the design's top bar), opened as a new project the way a person opens it.
        await page.goto(new URL('/cam', page.url()).href, { waitUntil: 'domcontentloaded' });
        const openButton = page.getByRole('button', { name: /Open model/ });
        await openButton.waitFor({ timeout: 30000 });
        const chooser = page.waitForEvent('filechooser', { timeout: 15000 });
        await openButton.click();
        await (await chooser).setFiles(path.resolve(SPEC_DIR, rest));
        await page.waitForURL(u => u.pathname.endsWith('/design'), { timeout: 15000 });
        jobId = new URL(page.url()).pathname.split('/')[2];
        await reopened();
        await flatView();
        return;
      }
      case 'design':
        await page.getByRole('link', { name: /Design/ }).first().click();
        await flatView();
        return;
      default:
        throw new Error(`Unknown step: ${text}`);
    }
  };

  /** Every step settles before it returns, so whatever reads or checks next sees what the step finally did. */
  const step = async text => {
    const since = await settledSnapshot(page);
    await act(text);
    await settle(since);
  };

  await settle();

  const check = async expect => {
    const failures = [];
    const scene = await page.evaluate(readScene, cursor);
    const fail = (name, want, got) => failures.push(`${name}: wanted ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    if (SKETCH_KEYS.some(key => key in expect)) {
      const design = await readDesign();
      checkSketch(expect, canonical(design?.parts?.[expect.part ?? 0]), fail);
    }
    if ('acceptedEntityCount' in expect) {
      const accepted = await readDesign('accepted');
      const got = canonical(accepted?.parts?.[expect.part ?? 0]).entities.length;
      if (got !== expect.acceptedEntityCount) fail('acceptedEntityCount', expect.acceptedEntityCount, got);
    }
    if (expect.savedBoards) {
      const boards = await page.evaluate(async id => {
        const url = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => name.includes('/src/cam/jobDb.ts')).at(-1);
        const { getJob } = await import(url);
        return (await getJob(id))?.boards ?? [];
      }, jobId);
      const got = { count: boards.length, cut: boards.filter(b => b.cut).length, layout: boards.filter(b => b.layout).length };
      for (const key of Object.keys(expect.savedBoards)) if (got[key] !== expect.savedBoards[key]) fail(`savedBoards.${key}`, expect.savedBoards[key], got);
    }
    if ('regions' in expect && scene.regions !== expect.regions) fail('regions', expect.regions, scene.regions);
    if ('fieldTextNot' in expect) {
      const text = await page.evaluate(() => {
        const input = document.activeElement;
        if (input?.tagName !== 'INPUT') return null;
        const unit = [...(input.parentElement?.children ?? [])].filter(el => el !== input && getComputedStyle(el).display !== 'none').map(el => el.textContent).join(' ');
        return `${input.value} ${unit}`.trim();
      });
      if (text === null || new RegExp(expect.fieldTextNot, 'i').test(text)) fail('fieldTextNot', expect.fieldTextNot, text);
    }
    if (expect.labelAt) {
      const { text, at, tolPx = 25 } = expect.labelAt;
      const [x, y] = await screen(at);
      const found = scene.labelCentres?.find(label => new RegExp(text).test(label.text));
      if (!found || Math.hypot(found.x - x, found.y - y) > tolPx) fail('labelAt', { text, at, px: [x, y] }, found ?? scene.labels);
    }
    if ('labelText' in expect && !scene.labels.some(label => new RegExp(expect.labelText).test(label))) fail('labelText', expect.labelText, scene.labels);
    if ('tool' in expect) {
      const name = expect.tool.toLowerCase();
      if (!scene.pressed.some(label => label.toLowerCase().startsWith(name))) fail('tool', expect.tool, scene.pressed);
    }
    if ('status' in expect && !new RegExp(expect.status, 'i').test(scene.status)) fail('status', expect.status, scene.status.slice(0, 160));
    if ('readout' in expect && !new RegExp(expect.readout, 'i').test(scene.footer)) fail('readout', expect.readout, scene.footer);
    if ('focus' in expect && (expect.focus === 'input') !== scene.focusInput) fail('focus', expect.focus, scene.focusInput ? 'input' : 'canvas');
    if ('stage' in expect && scene.stage !== expect.stage) fail('stage', expect.stage, scene.stage);
    for (const [key, name] of [['canUndo', 'Undo (Ctrl or Command Z)'], ['canRedo', 'Redo (Ctrl or Command Shift Z)']]) {
      if (key in expect && (await page.getByRole('button', { name, exact: true }).isEnabled()) !== expect[key]) fail(key, expect[key], !expect[key]);
    }
    if ('canFinish' in expect && (await page.getByRole('button', { name: /Finish sketch/ }).isEnabled()) !== expect.canFinish) fail('canFinish', expect.canFinish, !expect.canFinish);
    if ('cursor' in expect) {
      const match = /(-?[\d.]+),\s*(-?[\d.]+)\s*mm/.exec(scene.footer);
      const got = match ? [Number(match[1]), Number(match[2])] : null;
      if (!got || !samePoint(expect.cursor, got, 1.5)) fail('cursor', expect.cursor, got);
    }
    if (expect.noFalseGrid && /\bgrid\b/i.test(scene.footer) && !scene.gridLines) fail('grid label', 'no label without a drawn grid', scene.footer);
    if ('pageText' in expect) {
      const text = await page.locator('body').innerText();
      if (!new RegExp(expect.pageText, 'i').test(text)) fail('pageText', expect.pageText, text.slice(0, 800));
    }
    if ('pageTextOnce' in expect) {
      const banner = await page.locator('[role=alert]').allInnerTexts();
      for (const text of banner) if (text.split(expect.pageTextOnce).length > 2) fail('pageTextOnce', expect.pageTextOnce, text);
    }
    if ('previewCount' in expect && scene.previewCount !== expect.previewCount) fail('previewCount', expect.previewCount, scene.previewCount);
    if (expect.strokePx) {
      const [low, high] = expect.strokePx;
      const widths = [...scene.previewWidths, ...scene.committedWidths];
      if (!widths.length) fail('strokePx', 'some strokes', 'none');
      if (widths.some(w => w < low || w > high)) fail('strokePx', expect.strokePx, widths.map(w => Math.round(w * 10) / 10));
    }
    if (expect.colors) {
      for (const [name, count] of Object.entries(expect.colors)) if (scene.colors[name] !== count) fail(`colors.${name}`, count, scene.colors);
    }
    if (expect.annotation) {
      const a = scene.annotation;
      if (!a) fail('annotation', expect.annotation, null);
      else {
        if (expect.annotation.nearCursorPx !== undefined && !(a.toCursor <= expect.annotation.nearCursorPx)) fail('annotation near cursor', expect.annotation.nearCursorPx, a);
        if (expect.annotation.onLinePx !== undefined && !(a.toLine !== null && a.toLine <= expect.annotation.onLinePx)) fail('annotation on its line', expect.annotation.onLinePx, a);
      }
    }
    return failures;
  };

  /** What an agent exploring through spec:session reads after each step: the same facts `check` compares, ID-free. */
  const state = async () => {
    const scene = await page.evaluate(readScene, cursor);
    const enabled = async name => {
      const button = page.getByRole('button', { name }).first();
      return (await button.isVisible()) ? button.isEnabled() : null;
    };
    const design = await readDesign();
    const rounded = (_, value) => (typeof value === 'number' ? Math.round(value * 1000) / 1000 : value);
    return {
      stage: scene.stage,
      canvas: !scene.noCanvas,
      pressed: scene.pressed,
      status: scene.status.slice(0, 240),
      readout: scene.footer.slice(0, 240),
      focus: scene.focusInput ? 'input' : 'canvas',
      labels: scene.labels,
      regions: scene.regions ?? 0,
      previewCount: scene.previewCount ?? 0,
      canFinish: await enabled(/Finish sketch/),
      canUndo: await enabled(/^Undo/),
      canRedo: await enabled(/^Redo/),
      parts: JSON.parse(JSON.stringify((design?.parts ?? []).map(part => ({ name: part.name, ...canonical(part) })), rounded)),
    };
  };
  /** Only the simulated controller may ever be driven, so tools that keep a page open check before each input. */
  const inDemo = () => page.evaluate(() => sessionStorage.getItem('camnc-demo') === '1');

  return { step, check, settle, state, inDemo, frame: () => page.evaluate(readFrame) };
}
