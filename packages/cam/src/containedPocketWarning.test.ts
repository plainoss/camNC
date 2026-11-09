import { describe, expect, it } from 'vitest';
import { machiningPart, rectangle } from '../test/machining-fixtures';
import { camPart } from './toolpaths';

describe('a pocket kept inside its open edge', () => {
  it('names what the neighbour fallback leaves at the open edge, apart from the corners', () => {
    // A 12 mm rabbet along the part's edge, cut with a 6 mm bit, as in #147.
    const features = machiningPart([[rectangle(15, 0, 85, 12)]], 6);
    const settings = { cutThrough: false, tools: [{ number: 1, diameter: 6 }] };
    const open = camPart(features, settings);
    expect(open.warnings.filter(w => w.includes('open edge'))).toEqual([]);
    const { warnings } = camPart(features, settings, { containedPockets: new Set([0]) });
    const edge = warnings.find(w => w.includes('left along the open edge'));
    expect(edge).toMatch(/^Pocket 1: [0-9.]+mm² left along the open edge with D=6: the path stays inside the pocket/);
    expect(parseFloat(edge!.split(': ')[1])).toBeGreaterThan(1);
    // What the open path would leave too isn't put on the fallback.
    const corners = (list: string[]) => list.filter(w => w.includes('left in corners')).map(w => parseFloat(w.split(': ')[1]));
    expect(corners(warnings).every(area => area <= Math.max(0, ...corners(open.warnings)) + 0.1)).toBe(true);
  });
});
