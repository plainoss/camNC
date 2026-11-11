import { expect, it } from 'vitest';
import {
  addCopyTransform, addPartCopy, addPartCut, addPhysicalTransform, cadPartReference, copyOperationPrefix,
  createPlateDocument, evaluateCadDocument, evaluatedPartCopy, orderedCadDocument, parseCadDocument,
  physicalCadView, polygonArea, type CadDocument, type EvaluatedCadPart,
} from './index';
import { physicalJoinedCopies } from './physicalJoinedCopies';
import { notchedSeedSource } from './physicalSeedTransforms.testFixtures';

const volume=(shape:EvaluatedCadPart)=>{
  const area=(loop:typeof shape.outline)=>Math.abs(polygonArea(loop));
  return (area(shape.outline)-shape.holes.reduce((sum,hole)=>sum+area(hole),0))*shape.thickness-
    (shape.cuts??[]).reduce((sum,cut)=>sum+(area(cut.outline)-cut.islands.reduce((sum,island)=>sum+area(island),0))*(cut.to-cut.from),0);
};
const view=(source:CadDocument)=>physicalCadView(source,evaluateCadDocument(source));
const tool=(name:string,x:number,y:number)=>{
  const part=createPlateDocument({name,width:2,height:3,thickness:6}).parts[0]!;part.name=name;
  part.placement={position:[x,y,18],rotation:[0,0,0,1]};return part;
};

it.each([
  ['seed-first',false],['copy-first',false],['seed-first',true],['copy-first',true],
] as const)('rebuilds joined instance frames between ordered moves and cuts (%s, mirrored=%s)',(order,mirrored)=>{
  const f=notchedSeedSource();let source=copyOperationPrefix(f.source);
  source={...source,parts:source.parts.map(part=>part.id===f.partId ?{...part,pattern:undefined,copies:part.copies!.map((copy,index)=>({
    ...copy,pattern:undefined,...(index===0 && {mirrored}),
  }))}:part)};
  const copyId=source.parts[0]!.copies![0]!.id,reference=cadPartReference(f.childId,copyId);
  const a=tool('Earlier component knife',mirrored ?178:220,30),b=tool('Later component knife',mirrored ?172:226,85);
  source=orderedCadDocument({...source,parts:[...source.parts,a,b]});
  const seed=()=>{source=addPhysicalTransform(source,{kind:'seed',partId:f.partId},{by:[0,25,0],turn:{about:[0,0,0],axis:[0,0,1],degrees:90}}).document;};
  if (order==='seed-first') seed();
  const first=addPartCut(source,[a.id],[reference],{value:0});source=first.document;
  source=addCopyTransform(source,f.partId,copyId,{by:[0,50,0]}).document;
  if (order==='copy-first') seed();
  const last=addPartCut(source,[b.id],[reference],{value:0});source=last.document;
  const bytes=JSON.stringify(source),result=evaluateCadDocument(source);
  expect(result.diagnostics).toEqual([]);
  const prefix=view(copyOperationPrefix(source,first.id)),final=physicalCadView(source,result);
  const child=final.document.parts.find(part=>part.id===f.childId)!,shape=final.parts.find(part=>part.partId===f.childId)!;
  const selected=child.copies!.find(copy=>copy.id===copyId)!;
  expect(selected.placement!.position).toEqual([mirrored ?180:220,80,18]);
  expect(!!selected.mirrored).toBe(mirrored);
  expect(volume(evaluatedPartCopy(shape,selected))).toBe(10*8*6-2*2*3*6);
  expect(volume(shape)).toBe(10*8*6);
  const sibling=child.copies!.find(copy=>copy.id!==copyId)!;
  expect(sibling.placement!.position).toEqual([420,30,18]);
  expect(volume(evaluatedPartCopy(shape,sibling))).toBe(10*8*6);
  expect(child.placement!.position).toEqual([-30,45,18]);
  expect(final.document.parts.find(part=>part.id===f.dependentId)!.placement!.position).toEqual([0,0,18]);
  const oldChild=prefix.document.parts.find(part=>part.id===f.childId)!,oldShape=prefix.parts.find(part=>part.partId===f.childId)!;
  const oldCopy=oldChild.copies!.find(copy=>copy.id===copyId)!;
  expect(oldCopy.placement!.position).toEqual([mirrored ?180:220,30,18]);
  expect(volume(evaluatedPartCopy(oldShape,oldCopy))).toBe(10*8*6-2*3*6);
  expect(physicalJoinedCopies(final.document)).toBe(final.document);
  expect(view(parseCadDocument(JSON.parse(bytes)))).toEqual(final);
  expect(source.parts.find(part=>part.id===f.childId)!.copies).toBeUndefined();
  expect(JSON.stringify(source)).toBe(bytes);
});

it('preserves the established exact-copy move of an authored Add-owned copy without rebasing any seed or inherited slot',()=>{
  const f=notchedSeedSource(),generation=copyOperationPrefix(f.source);
  const own=addPartCopy(generation,f.childId,{offset:{position:[1000,0,0],rotation:[0,0,0,1]}});
  const knife=tool('Own-copy knife',1020,55),base={...own.document,parts:[...own.document.parts,knife]};
  const moved=addCopyTransform(base,f.childId,own.id,{by:[0,25,0]});
  const cut=addPartCut(moved.document,[knife.id],[cadPartReference(f.childId,own.id)],{value:0});
  const bytes=JSON.stringify(cut.document),result=evaluateCadDocument(cut.document),final=physicalCadView(cut.document,result);
  expect(result.diagnostics).toEqual([]);
  expect(result.placements![f.partId]!.position).toEqual([0,0,0]);
  expect(result.placements![f.childId]!.position).toEqual([20,30,18]);
  const child=final.document.parts.find(part=>part.id===f.childId)!,shape=final.parts.find(part=>part.partId===f.childId)!;
  const selected=child.copies!.find(copy=>copy.id===own.id)!;
  expect(selected.placement!.position).toEqual([1020,55,18]);
  expect(volume(evaluatedPartCopy(shape,selected))).toBe(10*8*6-2*3*6);
  expect(volume(shape)).toBe(10*8*6);
  for (const [index,copy] of child.copies!.filter(copy=>copy.id!==own.id).entries()) {
    expect(copy.placement!.position).toEqual([(index+1)*200+20,30,18]);
    expect(volume(evaluatedPartCopy(shape,copy))).toBe(10*8*6);
  }
  expect(cut.document.parts.find(part=>part.id===f.childId)!.copies![0]!.placement!.position).toEqual([1020,30,18]);
  expect(view(parseCadDocument(JSON.parse(bytes)))).toEqual(final);
  expect(JSON.stringify(cut.document)).toBe(bytes);
});

it('keeps unknown generation frames unknown and explicit same-stage copy descriptors authoritative',()=>{
  const f=notchedSeedSource(),generation=copyOperationPrefix(f.source);
  const stage={...generation,parts:generation.parts.map(part=>part.id===f.partId ?{...part,placement:{position:[0,25,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number]}}
    :part.id===f.childId ?{...part,placement:{position:[20,55,18] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number]}}:part)};
  const missing={...generation,parts:generation.parts.filter(part=>part.id!==f.childId)};
  const expanded=physicalJoinedCopies(stage,missing).parts.find(part=>part.id===f.childId)!;
  expect(expanded.copies).toHaveLength(2);
  expect(expanded.copies!.every(copy=>copy.placement===undefined)).toBe(true);
  const copyId=generation.parts[0]!.copies![0]!.id,pose={position:[999,888,777] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number]};
  const authoritative={...stage,parts:stage.parts.map(part=>part.id===f.childId ?{...part,copies:[{id:copyId,placement:pose}]}:part)};
  expect(physicalJoinedCopies(authoritative,generation).parts.find(part=>part.id===f.childId)!.copies![0]!.placement).toBe(pose);
});
