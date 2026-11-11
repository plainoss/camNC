import {
  addPartCut, addPhysicalTransform, addRectangle, cadPartReference, cadPartsToCut, copyOperationPrefix, createCadPart,
  evaluateCadDocument, evaluatedPartCopy, parseCadDocument, physicalCadView, solveCadDocument,
  type CadDocument, type CadEvaluation, type CadPart, type EvaluatedCadPart,
} from '@wbcnc/cad';
import { profileFeatures } from '@wbcnc/cam';
import { expect, it } from 'vitest';
import { axisMaterial } from './axisMaterial';
import { loadWoodworkingSource, sourcePart, sourceVariable } from './woodworkingChecks';

type Recipe='cabinet'|'tray';
const setups={
  cabinet:{fixture:'task-start-cupboard-three-shelves',family:'Shelf',count:'shelves',original:{width:800,board:18},edited:{width:860,board:21},others:['Side','Right side','Bottom','Top','Back']},
  tray:{fixture:'divided-tray-copy-tools',family:'Divider',count:'dividers',original:{width:420,board:15},edited:{width:480,board:18},others:['Base','Left wall','Right wall','Front wall','Back wall']},
} as const;
const shift=400;
const reload=(document:CadDocument)=>parseCadDocument(JSON.parse(JSON.stringify(document)));
const materialData=({thickness,outline,holes,cuts=[]}:EvaluatedCadPart)=>({thickness,outline,holes,cuts});
const ids=(source:CadDocument)=>source.parts.map(part=>({id:part.id,sketch:part.sketch.id,entities:part.sketch.entities.map(entity=>entity.id),features:part.features?.map(feature=>feature.id),pattern:part.pattern?.id}));

async function solve(source:CadDocument) {
  const bytes=JSON.stringify(source),result=await solveCadDocument(source);
  expect(result.status,JSON.stringify(result.diagnostics)).toBe('solved');
  expect(result.diagnostics).toEqual([]);
  expect(JSON.stringify(source)).toBe(bytes);
  return result;
}

function knife(recipe:Recipe,later:boolean) {
  const cabinet=recipe==='cabinet',part=createCadPart(later?'Later knife':'Earlier knife',cabinet ?18:20);
  if (cabinet) part.thicknessExpression='board';
  part.sketch=addRectangle(part.sketch,{x:cabinet ? later ?150:100:104,y:later ?390:-10,width:cabinet ?20:17,height:cabinet ?40:30,dimensioned:true,positioned:true});
  const set=(kind:'positionX'|'positionY'|'distanceX',label:string|undefined,expression:string)=>{
    const constraint=part.sketch.constraints.find(constraint=>constraint.type===kind && (label===undefined || ('label' in constraint && constraint.label===label)));
    if (!constraint || !('value' in constraint)) throw Error(`Missing ${kind} ${label}`);
    constraint.expression=expression;
  };
  if (!cabinet) {
    set('positionX',undefined,'board/2 + (width - 2*board)/(dividers + 1) - 1mm');
    set('positionY',undefined,later ?'board + 390mm':'board - 10mm');
    set('distanceX','Width','board + 2mm');
  }
  part.drawnOn={on:{plane:'top'},offset:cabinet ?220.5:later ?30:60,...(cabinet && {offsetExpression:'(height - board)/(shelves + 1)'})};
  return part;
}

function child(recipe:Recipe,parent:CadPart) {
  const part=createCadPart('Joined block',6);part.addTo=parent.id;
  part.drawnOn={on:{partId:parent.id,face:'top'},offset:0};
  part.sketch=addRectangle(part.sketch,{x:recipe==='cabinet' ?200:80,y:recipe==='cabinet' ?80:30,width:20,height:10,dimensioned:true,positioned:true});
  return part;
}

/** Authored dimensions and the Top/Right plane coordinate contract, independent of evaluated bounds. */
function expected(recipe:Recipe,width:number,board:number,count:number,slot:number,moved:boolean) {
  const cabinet=recipe==='cabinet',left=cabinet ?board+1:board/2+slot*(width-2*board)/(count+1);
  const z=cabinet ?slot*(900-board)/(count+1):board-4,y=(cabinet ?0:board)+(moved ?shift:0);
  return {
    origin:cabinet ?[0,moved ?shift:0,z]:[left,moved ?shift:0,0],
    min:[left,y,z],max:cabinet ?[width-board-1,y+284,z+board]:[left+board,y+240-2*board,80],
    volume:cabinet ?(width-2*board-2)*284*board:(240-2*board)*(80-board+4)*board,
    notch:cabinet ?20*30*board:20*20*board,
    first:[cabinet ?110:left+board/2,y+(cabinet ?15:10),cabinet ?z+board/2:70],
    second:[cabinet ?160:left+board/2,y+(cabinet ?15:10),cabinet ?z+board/2:40],
    retained:[cabinet ?210:left+board/2,y+50,cabinet ?z+board/2:40],
    childProbe:cabinet ?[210,(moved ?shift:0)+85,z+board+3]:[left+board+3,(moved ?shift:0)+90,35],
  };
}

function check(source:CadDocument,result:CadEvaluation,recipe:Recipe,width:number,board:number,count:number,stage:'first'|'move'|'second',childId:string) {
  const view=physicalCadView(source,result),family=sourcePart(view.document,setups[recipe].family),shape=view.parts.find(part=>part.partId===family.id)!;
  const component=view.document.parts.find(part=>part.id===childId)!,block=view.parts.find(part=>part.partId===childId)!;
  const cam=cadPartsToCut(view.document,view.parts);
  const names=Array.from({length:count},(_,index)=>index ?`${family.name} ${index+1}`:family.name);
  expect(cam.flatMap(group=>group.names).sort()).toEqual([
    ...setups[recipe].others,...names,'Joined block',...names.slice(1).map(name=>`Joined block · ${name}`),'Earlier knife','Later knife',
  ].sort());
  for (let slot=1;slot<=count;slot++) {
    const seed=slot===1,moved=seed && stage!=='first',intent=expected(recipe,width,board,count,slot,moved);
    const copy=seed ?undefined:family.copies![slot-2]!,material=axisMaterial(copy ?evaluatedPartCopy(shape,copy):shape,(copy??family).placement!);
    expect(material.volume,`${recipe} ${names[slot-1]} ${stage}`).toBeCloseTo(intent.volume-(seed ?(stage==='second' ?2:1)*intent.notch:0),5);
    expect(material.components).toBe(1);
    intent.min.forEach((value,axis)=>expect(material.bounds.min[axis]).toBeCloseTo(value,6));
    intent.max.forEach((value,axis)=>expect(material.bounds.max[axis]).toBeCloseTo(value,6));
    expect(material.containsWorld(intent.first)).toBe(!seed);
    expect(material.containsWorld(intent.second)).toBe(!(seed && stage==='second'));
    expect(material.containsWorld(intent.retained)).toBe(true);
    const piece=cam.find(group=>group.names.includes(names[slot-1]!))!,profile=profileFeatures(piece.part);
    expect(profile.problem).toBeUndefined();
    expect(profile.features.levels.reduce((sum,level)=>sum+level.z*level.area,0)).toBeCloseTo(intent.volume-(seed ?(stage==='second' ?2:1)*intent.notch:0),5);
    const inherited=seed ?undefined:component.copies!.find(copy=>copy.id===family.copies![slot-2]!.id)!;
    const childMaterial=axisMaterial(inherited ?evaluatedPartCopy(block,inherited):block,(inherited??component).placement!);
    expect(childMaterial.volume).toBeCloseTo(20*10*6,5);
    expect(childMaterial.containsWorld(intent.childProbe)).toBe(true);
  }
}

it.each(['cabinet','tray'] as const)('moves only the original %s piece through ordered cuts, regenerated slots and CAM',async recipe=>{
  const setup=setups[recipe];
  let source=sourceVariable(await loadWoodworkingSource(setup.fixture),setup.count,'3');
  const family=sourcePart(source,setup.family),joined=child(recipe,family),earlier=knife(recipe,false),later=knife(recipe,true);
  source={...source,parts:[...source.parts,joined,earlier,later]};
  const baseline=await solve(source),identity=ids(baseline.document),legacy=baseline.document.partCuts!.map(cut=>cut.id);
  const first=addPartCut(baseline.document,[earlier.id],[family.id],{value:0});
  const move=addPhysicalTransform(first.document,{kind:'seed',partId:family.id},{by:[0,shift,0]});
  source=move.document;
  const second=addPartCut(source,[later.id],[family.id],{value:0});source=second.document;
  const settings=JSON.stringify(source.copyTransforms),order=[...source.operationOrder!];
  const camIds=new Map<string,string>();
  for (const state of [{...setup.original,count:3},{...setup.edited,count:3},{...setup.edited,count:2},{...setup.edited,count:3}]) {
    source=sourceVariable(sourceVariable(sourceVariable(source,'width',`${state.width}mm`),'board',`${state.board}mm`),setup.count,String(state.count));
    const regenerated=await solve(source),result=await solve(reload(regenerated.document));source=result.document;
    expect(ids(source)).toEqual(identity);
    expect(source.operationOrder).toEqual(order);
    expect(source.legacyPartCutIds).toEqual([...legacy,first.id]);
    expect(JSON.stringify(source.copyTransforms)).toBe(settings);
    expect(source.partCuts!.find(cut=>cut.id===first.id)!.targets).toEqual([family.id]);
    expect(source.partCuts!.find(cut=>cut.id===second.id)!.targets).toEqual([family.id]);
    const raw=sourcePart(source,setup.family),creation=expected(recipe,state.width,state.board,state.count,1,false).origin;
    creation.forEach((value,axis)=>expect(raw.placement!.position[axis]).toBeCloseTo(value,6));
    expect(raw.copies!.map(copy=>copy.id)).toEqual(Array.from({length:state.count-1},(_,index)=>`${family.pattern!.id}:${index+1}`));
    const afterFirst=evaluateCadDocument(source,{through:first.id}),afterMove=evaluateCadDocument(source,{through:move.id});
    check(source,afterFirst,recipe,state.width,state.board,state.count,'first',joined.id);
    check(source,afterMove,recipe,state.width,state.board,state.count,'move',joined.id);
    check(source,result,recipe,state.width,state.board,state.count,'second',joined.id);
    expect(evaluateCadDocument(reload(copyOperationPrefix(source,move.id)))).toEqual(afterMove);
    const original=evaluateCadDocument(copyOperationPrefix(source,legacy.at(-1)!)),oldView=physicalCadView(source,original),newView=physicalCadView(source,result);
    const before=cadPartsToCut(oldView.document,oldView.parts),after=cadPartsToCut(newView.document,newView.parts);
    for (const name of setup.others)
      expect(materialData(after.find(group=>group.names.includes(name))!.part),`${name} keeps its material`).toEqual(materialData(before.find(group=>group.names.includes(name))!.part));
    for (const name of [setup.family,'Joined block']) {
      const id=after.find(group=>group.names.includes(name))!.part.partId;
      if (!camIds.has(name)) camIds.set(name,id);
      expect(id).toBe(camIds.get(name));
    }
    expect(source.parts.find(part=>part.id===joined.id)!.copies).toBeUndefined();
    expect(result.available).toContain(family.id);
    for (const copy of raw.copies!) expect(result.available).toContain(cadPartReference(family.id,copy.id));
  }
});
