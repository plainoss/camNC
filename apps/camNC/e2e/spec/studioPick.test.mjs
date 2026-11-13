import { describe, expect, it } from 'vitest';
import { parseModelPoint, parseSketchPick, regionCount } from './adapters/studioPick.mjs';
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
