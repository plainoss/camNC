/**
 * Runs sketch scenarios against the editor's own drawing code in Node, with no page. It models only the tools in
 * `@wbcnc/cad-editor/headlessSketch`, so `supports` picks the scenarios whose every step and expectation it can answer,
 * and the browser adapter remains the reference for all of them.
 */

import { createCadDocument, createCadPart, sketchRegions, solveCadDocument } from '@wbcnc/cad';
import { createHeadlessSketch, HEADLESS_SKETCH_TOOLS } from '@wbcnc/cad-editor/headlessSketch';
import { SKETCH_KEYS, canonical, checkSketch, point } from './sketchModel.mjs';

const named = label => HEADLESS_SKETCH_TOOLS.some(tool => tool.label.toLowerCase() === label.toLowerCase());
const STEPS = {
  key: rest => rest === 'Escape' || HEADLESS_SKETCH_TOOLS.some(tool => tool.key === rest),
  tool: named,
  click: () => true,
  hover: () => true,
  drag: () => true,
  down: () => true,
  move: () => true,
  up: () => true,
  rect: () => true,
};
const EXPECTATIONS = new Set([...SKETCH_KEYS, 'part', 'regions', 'tool']);

/** Why a scenario can't run here, or null when every step and expectation is modelled. */
export function unsupported(scenario) {
  for (const step of scenario.steps) {
    if (typeof step === 'object') {
      const key = Object.keys(step.expect).find(key => !EXPECTATIONS.has(key));
      if (key) return `expectation ${key}`;
      if ((step.expect.part ?? 0) !== 0) return 'a second part';
      continue;
    }
    const space = step.indexOf(' ');
    const verb = space < 0 ? step : step.slice(0, space);
    if (!STEPS[verb]?.(step.slice(space + 1))) return `step ${step}`;
  }
  return null;
}

export function createAdapter() {
  const editor = createHeadlessSketch();
  let at = { x: 0, y: 0 };
  const to = text => {
    const [x, y] = point(text);
    at = { x, y };
    return at;
  };
  /** The sketch as the editor shows it once solved, as the browser adapter reads the saved design. */
  const solvedPart = async () => {
    const part = { ...createCadPart(), sketch: editor.state().sketch };
    const result = await solveCadDocument({ ...createCadDocument(), parts: [part] });
    return result.status === 'solved' ? result.document.parts[0] : part;
  };

  const step = async text => {
    const [verb, ...args] = text.split(' ');
    switch (verb) {
      case 'key':
        return editor.key(args.join(' '));
      case 'tool':
        return editor.tool(args.join(' '));
      case 'click':
        return editor.click(to(args[0]));
      case 'hover':
        return editor.hover(to(args[0]));
      case 'down':
        return editor.press(to(args[0]));
      case 'move':
        return editor.move(to(args[0]));
      case 'up':
        return editor.release(at);
      case 'drag':
        return editor.drag(to(args[0]), to(args[1]));
      case 'rect':
        // As the browser adapter: draw with the normal tool, then leave it.
        editor.key('g');
        editor.click(to(args[0]));
        editor.click(to(args[1]));
        editor.key('Escape');
        return editor.key('Escape');
      default:
        throw new Error(`Unknown step: ${text}`);
    }
  };

  const check = async expect => {
    const failures = [];
    const fail = (name, want, got) => failures.push(`${name}: wanted ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    const part = await solvedPart();
    if (SKETCH_KEYS.some(key => key in expect)) checkSketch(expect, canonical(part), fail);
    // The editor shades each closed region with a shape of its own.
    const regions = sketchRegions(part.sketch).length;
    if ('regions' in expect && regions !== expect.regions) fail('regions', expect.regions, regions);
    const tool = editor.state().tool;
    if ('tool' in expect && !tool.toLowerCase().startsWith(expect.tool.toLowerCase())) fail('tool', expect.tool, [tool]);
    return failures;
  };

  const state = async () => ({ tool: editor.state().tool, status: editor.state().status, parts: [canonical(await solvedPart())] });

  return { step, check, settle: async () => {}, state };
}
