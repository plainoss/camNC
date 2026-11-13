import { describe, expect, it } from 'vitest';
import { angleBetween, namedView, parseModelPoint, parseSketchPick, regionCount } from './adapters/studioPick.mjs';
import { checkStudio } from './adapters/studioModel.mjs';

describe('Part Studio picks and region reads', () => {
  it('reads a viewport pick as a model point in millimetres', () => {
    expect(parseModelPoint('30, 20,-5.5')).toEqual([30, 20, -5.5]);
    for (const bad of ['30,20', '30,20,x', '1,2,3,4', '']) expect(() => parseModelPoint(bad)).toThrow(/x,y,z/);
  });
  it('reads a pick in an open sketch as a point on its plane', () => {
    expect(parseSketchPick('30,20')).toEqual([30, 20]);
    expect(parseSketchPick('30, 20, 0')).toEqual([30, 20]);
    expect(() => parseSketchPick('30,20,5')).toThrow(/z must be 0/);
    expect(() => parseSketchPick('30')).toThrow(/x,y/);
  });
  it('names the view a camera direction matches, within a degree', () => {
    expect(namedView([0, 0, -1])).toBe('top');
    expect(namedView([0, 1, 0])).toBe('front');
    expect(namedView([-0.2, 0.75, -1].map(value => value / Math.hypot(0.2, 0.75, 1)))).toBe('iso');
    expect(namedView([0.01, 0, -1])).toBe('top');
    expect(namedView([0.1, 0, -1])).toBeNull();
    expect(angleBetween([1, 0, 0], [0, 2, 0])).toBeCloseTo(90);
  });
  it('checks plane visibility and the camera only where a scenario names them', () => {
    const actual = {
      planes: { Origin: { view: true, list: 'shown' }, Top: { view: false, list: 'hidden' } },
      camera: { direction: [0, 0, -1], view: 'top' },
    };
    expect(checkStudio({ planes: { Top: { view: false } }, camera: { view: 'top' } }, actual)).toEqual([]);
    expect(checkStudio({ planes: { Top: { list: 'shown' } } }, actual)).toEqual(['studio/planes/Top/list: wanted "shown", got "hidden"']);
    expect(checkStudio({ camera: { direction: [0.01, 0, -1] } }, actual)).toEqual([]);
    expect(checkStudio({ camera: { direction: [0, 1, 0] } }, actual)).toHaveLength(1);
    expect(checkStudio({ camera: { view: 'iso' } }, { camera: null })).toHaveLength(1);
  });
  it('counts the regions an Extrude dialog lists', () => {
    expect(regionCount('No region picked yet')).toBe(0);
    expect(regionCount('A region of Sketch 1')).toBe(1);
    expect(regionCount('3 regions of Sketch 1')).toBe(3);
    expect(regionCount('Sketch 1')).toBeNull();
    expect(regionCount(null)).toBeNull();
  });
  it('checks only the region fields a scenario names', () => {
    const actual = { extrudeRegions: { box: 'Regions to add', selection: '2 regions of Sketch 1', regions: 2, picking: true } };
    expect(checkStudio({ extrudeRegions: { regions: 2, picking: true } }, actual)).toEqual([]);
    expect(checkStudio({ extrudeRegions: { regions: 1 } }, actual)).toEqual(['studio/extrudeRegions/regions: wanted 1, got 2']);
    expect(checkStudio({ extrudeRegions: null }, { extrudeRegions: null })).toEqual([]);
    expect(checkStudio({ extrudeRegions: { regions: 1 } }, { extrudeRegions: null })).toHaveLength(1);
  });
});
