import { describe, expect, it } from 'vitest';
import { createHeadlessSketch, UnsupportedSketchInput } from './headlessSketch';

const curves = (editor: ReturnType<typeof createHeadlessSketch>) => editor.state().sketch.entities.filter(e => e.type === 'line');
const types = (editor: ReturnType<typeof createHeadlessSketch>) => editor.state().sketch.constraints.map(c => c.type);

describe('headless sketch', () => {
  it('draws a rectangle with two clicks, then keeps the tool for the next one', () => {
    const editor = createHeadlessSketch();
    editor.key('g');
    expect(editor.state()).toMatchObject({ tool: 'Corner rectangle', status: expect.stringMatching(/first corner/) });
    editor.click({ x: 20, y: 20 });
    expect(curves(editor)).toHaveLength(0);
    editor.click({ x: 80, y: 60 });
    expect(curves(editor)).toHaveLength(4);
    expect(editor.state().selected).toHaveLength(4);
    expect(editor.state().tool).toBe('Corner rectangle');
  });

  it('draws a rectangle with one drag', () => {
    const editor = createHeadlessSketch();
    editor.key('g');
    editor.drag({ x: 20, y: 20 }, { x: 80, y: 60 });
    expect(curves(editor)).toHaveLength(4);
  });

  it('joins a corner clicked on an existing corner', () => {
    const editor = createHeadlessSketch();
    editor.key('g');
    editor.click({ x: 20, y: 20 });
    editor.click({ x: 80, y: 60 });
    const before = types(editor).filter(type => type === 'coincident').length;
    editor.click({ x: 80, y: 60 });
    editor.click({ x: 120, y: 100 });
    expect(types(editor).filter(type => type === 'coincident').length).toBe(before + 4 + 1);
  });

  it('leaves a click on the same spot pending, with the reason', () => {
    const editor = createHeadlessSketch();
    editor.key('g');
    editor.click({ x: 40, y: 40 });
    editor.click({ x: 40, y: 40 });
    expect(curves(editor)).toHaveLength(0);
    expect(editor.state().status).toMatch(/greater than zero/);
  });

  it('cancels the pending corner, then the tool, with Escape', () => {
    const editor = createHeadlessSketch();
    editor.tool('Center rectangle');
    editor.click({ x: 40, y: 40 });
    editor.key('Escape');
    editor.click({ x: 50, y: 50 });
    editor.click({ x: 60, y: 60 });
    expect(curves(editor).filter(line => !line.construction)).toHaveLength(4);
    editor.key('Escape');
    expect(editor.state().tool).toBe('Select');
    expect(() => editor.click({ x: 10, y: 10 })).toThrow(UnsupportedSketchInput);
  });

  it('says which input it does not model', () => {
    const editor = createHeadlessSketch();
    expect(() => editor.key('l')).toThrow(UnsupportedSketchInput);
    expect(() => editor.tool('Spline')).toThrow(UnsupportedSketchInput);
  });
});
