import { describe, expect, it } from 'vitest';
import { createCadDocument } from '@wbcnc/cad';
import { editCad } from './edit';
import type { CadScript } from './editTypes';

describe('runtime script arguments', () => {
  it.each([
    ["d=>{d.newPart('P').profile.circle({at:[20,20],radius:5});}", /circle has no option radius.*d/],
    ["d=>{d.newPart('P').profile.circle({at:[20,20]});}", /requires d/],
    ["d=>{d.variable('width',42);}", /Variable expression must be/],
    ["d=>{d.newPart('P').profile.rect({at:[0,0],w:NaN,h:10});}", /rect.w must be a finite/],
    ["d=>{d.newPart('P').profile.circel({at:[20,20],d:5});}", /no method or property circel.*circle/],
    ["d=>{d.newPart('P').copy({at:[0,0]});}", /copy.at must contain 3/],
    ["d=>{d.newPart('P').expect({pocket:2});}", /expect has no option pocket.*pockets/],
    ["d=>{d.folder('Piece',f=>{f.newPart('P').profile.circle({at:[20,20],radius:5});});}", /circle has no option radius/],
    [
      "d=>{const p=d.newPart('P');p.profile.rect({at:[0,0],w:100,h:80});p.place({at:[0,0,0]});p.pattern({axis:'z',count:2,spacing:50})[0].sketchOn('top').circle({at:[20,20],radius:5});}",
      /circle has no option radius/,
    ],
  ])('gives a useful refusal for %s', async (source, message) => {
    const start = createCadDocument();
    const script = new Function(`return (${source});`)() as CadScript;
    const result = await editCad(start, script);
    expect(result.scriptError).toMatch(message);
    expect(result.document).toEqual(start);
  });
});
