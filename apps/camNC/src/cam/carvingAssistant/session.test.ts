import { describe, expect, it } from 'vitest';
import { createCarvingJob } from '../jobDb';
import { clampTarget, initialTarget, preparationKey, variantBrief } from './session';

describe('carving assistant session', () => {
  it('keeps the box on the board and at a size preparation accepts', () => {
    expect(clampTarget({ x: 5, y: 500, w: 2, h: 900 }, { w: 300, h: 140 })).toEqual({ x: 5, y: 70, w: 10, h: 140 });
  });

  it('starts a new box clear of existing items, and reworks generated artwork where it is', async () => {
    const job = await createCarvingJob(undefined, { lettering: 'Welcome' });
    const { target, replace } = initialTarget(job);
    expect(replace).toBe(false);
    const text = job.carving!.items[0];
    // Clear of the lettering on either axis: where depends on the font's measured outline.
    const xs = text.outline.flat().map(p => p.x + text.x),
      ys = text.outline.flat().map(p => p.y + text.y);
    const clearX = target.x - target.w / 2 >= Math.max(...xs) || target.x + target.w / 2 <= Math.min(...xs);
    const clearY = target.y - target.h / 2 >= Math.max(...ys) || target.y + target.h / 2 <= Math.min(...ys);
    expect(clearX || clearY).toBe(true);
    text.generated = {
      assetId: 'a',
      sourceSvg: '<svg/>',
      prompt: 'p',
      summary: 's',
      detail: 'simple',
      width: 40,
      height: 30,
      checkedFor: '',
    };
    const saved = initialTarget(job, text.id);
    expect(saved.replace).toBe(true);
    expect(saved.target).toMatchObject({ w: 40, h: 30 });
  });

  it('asks each variant for a different composition while keeping the user brief first', () => {
    const brief = variantBrief('An owl reading', 'bold', 1, 4);
    expect(brief.startsWith('An owl reading\n')).toBe(true);
    expect(brief).toContain('bold, broad filled shapes');
    expect(brief).toContain('Variant 2 of 4');
    expect(variantBrief('An owl', 'line', 0, 1)).not.toContain('Variant');
  });

  it('prepares again for any box, detail, placement or job change', async () => {
    const job = await createCarvingJob(undefined, { lettering: 'Welcome' });
    const box = { x: 50, y: 50, w: 40, h: 30 };
    const key = preparationKey(job, box, 'balanced', 'add');
    expect(preparationKey(job, { ...box, x: 50.01 }, 'balanced', 'add')).toBe(key);
    expect(preparationKey(job, { ...box, w: 41 }, 'balanced', 'add')).not.toBe(key);
    expect(preparationKey(job, box, 'simple', 'add')).not.toBe(key);
    expect(preparationKey({ ...job, carving: { ...job.carving!, maxDepth: 1 } }, box, 'balanced', 'add')).not.toBe(key);
  });
});
