import {makePlan,validPlan,mergePlan} from './core.js';
import {normalizePlan} from './training.js';
export const DAYS=['mon','tue','wed','thu','fri','sat','sun'];
export const DAY_NAMES=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
export const dayName=id=>DAY_NAMES[DAYS.indexOf(id)]||id;
export function makeWeek(legacy){return {days:DAYS.map((id,i)=>({id,enabled:[0,2,4].includes(i),minutes:45,plan:i===0?(legacy?normalizePlan(legacy):makePlan('Push')):i===2?makePlan('Pull'):i===4?makePlan('Legs'):null}))};}
export function normalizeWeek(week){return {days:week.days.map(d=>({...d,plan:d.plan?normalizePlan(d.plan):null}))};}
export function validWeek(week,ids){return !!week&&Array.isArray(week.days)&&week.days.length===7&&week.days.every((d,i)=>d&&d.id===DAYS[i]&&typeof d.enabled==='boolean'&&Number.isInteger(d.minutes)&&d.minutes>=5&&d.minutes<=180&&(d.enabled?validPlan(d.plan,ids):d.plan===null));}
export function cleanWeek(week){const normalized=normalizeWeek(week);return {days:normalized.days.map(d=>({id:d.id,enabled:d.enabled,minutes:d.minutes,plan:d.plan?{name:d.plan.name,exercises:d.plan.exercises.map(({id,sets,reps,rest,weight,setReps,setWeights})=>({id,sets,reps,rest,weight,setReps,setWeights}))}:null}))};}
export const weekKey=week=>JSON.stringify(cleanWeek(week));
export function mergeWeek(current,next){return {days:next.days.map((d,i)=>({...d,plan:d.plan?mergePlan(current.days[i].plan||{name:d.plan.name,exercises:[]},d.plan):null}))};}
const arrSame=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>v===b[i]);
export function weekChanges(old,next,catalog){
 const names=new Map(catalog.map(e=>[e.id,e.name]));
 const beforeWeek=normalizeWeek(old),afterWeek=normalizeWeek(next);
 return afterWeek.days.flatMap((d,i)=>{
  const prev=beforeWeek.days[i],changes=[],name=id=>names.get(id)||id;
  if(prev.enabled!==d.enabled)changes.push(d.enabled?'Rest → workout':'Workout → rest');
  if(d.enabled){
   if(prev.minutes!==d.minutes)changes.push(`Time: ${prev.minutes} → ${d.minutes} min`);
   if(prev.plan?.name!==d.plan.name)changes.push(`Session: ${prev.plan?.name||'Rest'} → ${d.plan.name}`);
   const before=prev.plan?.exercises||[];
   for(const e of d.plan.exercises){const p=before.find(x=>x.id===e.id);
    if(!p){changes.push(`Add ${name(e.id)}: ${e.sets} sets · ${e.setReps.join('/')} reps · ${e.rest}s rest`);continue;}
    const fields=[];
    if(p.sets!==e.sets)fields.push(`${p.sets} → ${e.sets} sets`);
    if(!arrSame(p.setReps,e.setReps))fields.push(`reps ${p.setReps.join('/')} → ${e.setReps.join('/')}`);
    if(!arrSame(p.setWeights,e.setWeights))fields.push(`load ${p.setWeights.join('/')} → ${e.setWeights.join('/')} lb`);
    if(p.rest!==e.rest)fields.push(`${p.rest} → ${e.rest}s rest`);
    if(fields.length)changes.push(`${name(e.id)}: ${fields.join(', ')}`);
   }
   for(const e of before)if(!d.plan.exercises.some(x=>x.id===e.id))changes.push(`Remove ${name(e.id)}`);
   if(before.length===d.plan.exercises.length&&before.every(e=>d.plan.exercises.some(x=>x.id===e.id))&&before.some((e,j)=>e.id!==d.plan.exercises[j].id))changes.push('Exercise order changed');
  }else if(prev.minutes!==d.minutes)changes.push(`Time budget: ${prev.minutes} → ${d.minutes} min`);
  return changes.length?[{id:d.id,changes}]:[];
 });
}
export function applyProposal(current,pending,ids){
 if(!pending||pending.base!==weekKey(current))throw new Error('Your schedule changed after this draft. Ask the coach to refine it again.');
 if(!validWeek(pending.week,ids))throw new Error('The proposed week is invalid.');
 if(weekKey(current)===weekKey(pending.week))throw new Error('No workout changes to apply.');
 return mergeWeek(normalizeWeek(current),normalizeWeek(pending.week));
}
