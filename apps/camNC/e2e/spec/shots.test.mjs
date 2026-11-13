import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { shotPath } from './shots.mjs';

describe('scenario screenshots', () => {
  it('writes a file scenario’s shot next to it, and another beside the run’s results', () => {
    expect(shotPath({ id: 'studio/a', baseDir: '/specs/x/camnc' }, 'runs/latest/step-7', '/out')).toBe(path.resolve('/specs/x/camnc/runs/latest/step-7.png'));
    expect(shotPath({ id: 'studio/a', baseDir: '/specs/x' }, 'after.png', '/out')).toBe(path.resolve('/specs/x/after.png'));
    expect(shotPath({ id: 'studio/extrude/a' }, 'after', '/out')).toBe(path.join('/out', 'studio.extrude.a.after.png'));
    expect(shotPath({ id: 'studio/a' }, '', '/out')).toBe(path.join('/out', 'studio.a.shot.png'));
    expect(() => shotPath({ id: 'studio/a' }, '../escape', '/out')).toThrow(/letters, digits/);
  });
});
