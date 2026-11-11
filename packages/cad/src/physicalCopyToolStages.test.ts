import { expect, it } from 'vitest';
import {
  addCopyTransform, addPartCut, addPhysicalTransform, cadPartReference, cadPartsToCut, copyOperationPrefix,
  createPlateDocument, evaluateCadDocument, evaluatedPartCopy, orderedCadDocument, parseCadDocument,
  physicalCadView, pointInPolygon, polygonArea, setPartPattern, type CadDocument, type EvaluatedCadPart,
} from './index';
import { notchedSeedSource } from './physicalSeedTransforms.testFixtures';

const volume=(shape:EvaluatedCadPart)=>{
  const area=(loop:typeof shape.outline)=>Math.abs(polygonArea(loop));
  return (area(shape.outline)-shape.holes.reduce((sum,hole)=>sum+area(hole),0))*shape.thickness-
    (shape.cuts??[]).reduce((sum,cut)=>sum+(area(cut.outline)-cut.islands.reduce((sum,island)=>sum+area(island),0))*(cut.to-cut.from),0);
};
const contains=(shape:EvaluatedCadPart,x:number,y:number)=>pointInPolygon({x,y},shape.outline) &&
  !shape.holes.some(hole=>pointInPolygon({x,y},hole)) && !(shape.cuts??[]).some(cut=>cut.through && pointInPolygon({x,y},cut.outline) && !cut.islands.some(island=>pointInPolygon({x,y},island)));

function fixture() {
  const f=notchedSeedSource();let source=copyOperationPrefix(f.source);
  const copyId=source.parts[0]!.copies![1]!.id,reference=cadPartReference(f.childId,copyId);
  const knife=createPlateDocument({name:'Component notch knife',width:2,height:3,thickness:6}).parts[0]!;
  knife.name='Component notch knife';knife.placement={position:[420,30,18],rotation:[0,0,0,1]};
  const receiver=createPlateDocument({name:'Receiver',width:12,height:10,thickness:6}).parts[0]!;
  receiver.name='Receiver';receiver.placement={position:[419,79,18],rotation:[0,0,0,1]};
  source=orderedCadDocument({...source,parts:[...source.parts,knife,receiver]});
  const earlier=addPartCut(source,[knife.id],[reference],{value:0});
  const seed=addPhysicalTransform(earlier.document,{kind:'seed',partId:f.partId},{by:[0,25,0],turn:{about:[0,0,0],axis:[0,0,1],degrees:90}});
  const copy=addCopyTransform(seed.document,f.partId,copyId,{by:[0,50,0]});
  const later=addPartCut(copy.document,[reference],[receiver.id],{value:0});
  return {...f,source:later.document,copyId,reference,receiverId:receiver.id,earlierId:earlier.id,seedId:seed.id,copyMoveId:copy.id,laterId:later.id};
}

it('uses inherited tool material after an earlier cut, an original move and a later host-copy move',()=>{
  const f=fixture(),bytes=JSON.stringify(f.source),result=evaluateCadDocument(f.source);
  const receiver=result.parts.find(part=>part.partId===f.receiverId)!;
  // The10×8×6 component tool lost a2×3×6 corner. Its444mm³ material cuts into720mm³ stock.
  expect(volume(receiver)).toBe(12*10*6-(10*8*6-2*3*6));
  expect(result.diagnostics).toEqual([]);
  expect(contains(receiver,2,2)).toBe(true); // Original tool void, never bounding-stock fill.
  expect(contains(receiver,6,5)).toBe(false);
  expect(contains(receiver,0.5,0.5)).toBe(true);
  const final=physicalCadView(f.source,result),child=final.document.parts.find(part=>part.id===f.childId)!;
  const tool=child.copies!.find(copy=>copy.id===f.copyId)!,shape=result.parts.find(part=>part.partId===f.childId)!;
  expect(tool.placement!.position).toEqual([420,80,18]);
  expect(volume(evaluatedPartCopy(shape,tool))).toBe(10*8*6-2*3*6);
  expect(result.available).not.toContain(f.reference); // Material eligibility does not create an authored transform target.
  expect(()=>addCopyTransform(copyOperationPrefix(f.source,f.copyMoveId),f.childId,f.copyId,{by:[0,10,0]})).toThrow(/not available/);
  const raw=cadPartsToCut(f.source,result.parts,result),projected=cadPartsToCut(final.document,final.parts);
  expect(raw).toEqual(projected);
  expect(raw.flatMap(group=>group.names).sort()).toEqual([
    'Panel','Panel 2','Panel 3','Boss','Boss · Panel 2','Boss · Panel 3','Earlier face body','Later knife','Component notch knife','Receiver',
  ].sort());
  expect(evaluateCadDocument(parseCadDocument(JSON.parse(bytes)))).toEqual(result);
  expect(JSON.stringify(f.source)).toBe(bytes);
});

it('omits an unavailable inherited tool without falling back, then restores the same source reference and machining identity',()=>{
  const f=fixture(),saved=JSON.stringify(f.source.copyTransforms);
  const inspect=(source:CadDocument)=>{
    const result=evaluateCadDocument(source),view=physicalCadView(source,result);
    return {result,view,receiver:result.parts.find(part=>part.partId===f.receiverId)!};
  };
  const missing=setPartPattern(f.source,f.partId,{count:2,axis:'x',spacing:200}),absent=inspect(missing);
  expect(volume(absent.receiver)).toBe(12*10*6);
  expect(absent.result.diagnostics).toContainEqual(expect.objectContaining({code:'part-cut-tool-unavailable',severity:'warning'}));
  expect(absent.result.diagnostics).toContainEqual(expect.objectContaining({code:'copy-transform-target-missing',severity:'warning'}));
  expect(absent.view.document.parts.find(part=>part.id===f.childId)!.copies!.some(copy=>copy.id===f.copyId)).toBe(false);
  expect(missing.partCuts!.find(cut=>cut.id===f.laterId)!.tools).toEqual([f.reference]);
  const restored=parseCadDocument(JSON.parse(JSON.stringify(setPartPattern(missing,f.partId,{count:3,axis:'x',spacing:200})))),again=inspect(restored);
  expect(volume(again.receiver)).toBe(276);
  expect(again.result.diagnostics).toEqual([]);
  expect(JSON.stringify(restored.copyTransforms)).toBe(saved);
  expect(restored.partCuts!.find(cut=>cut.id===f.laterId)!.tools).toEqual([f.reference]);
  const baseline=inspect(f.source);
  expect(cadPartsToCut(again.view.document,again.view.parts)).toEqual(cadPartsToCut(baseline.view.document,baseline.view.parts));
});
