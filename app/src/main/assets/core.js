import {normalizeExercise,normalizePlan} from './training.js';

export const templates = {
 Push: ['Dumbbell_Bench_Press','Cable_Crossover','Side_Lateral_Raise','Triceps_Pushdown'],
 Pull: ['Seated_Cable_Rows','Wide-Grip_Lat_Pulldown','Face_Pull','Dumbbell_Bicep_Curl'],
 Legs: ['Bodyweight_Squat','Dumbbell_Lunges','Standing_Calf_Raises']
};
export function makePlan(day='Push') {
 return normalizePlan({name:day,exercises:templates[day].map(id=>({id,sets:3,reps:12,rest:90,weight:0,done:0}))});
}
export function validPlan(p, ids) {
 return !!p && typeof p.name==='string' && p.name.length>0 && p.name.length<=80 &&
 Array.isArray(p.exercises) && p.exercises.length>0 && p.exercises.length<=12 &&
 new Set(p.exercises.map(e=>e?.id)).size===p.exercises.length &&
 p.exercises.every(e=>{
  if(!e||typeof e!=='object'||!ids.includes(e.id)||!Number.isInteger(e.sets)||e.sets<1||e.sets>10||
   !Number.isInteger(e.reps)||e.reps<1||e.reps>50||!Number.isInteger(e.rest)||e.rest<15||e.rest>600||
   !Number.isFinite(e.weight)||e.weight<0||e.weight>1000)return false;
  if(e.setReps!==undefined&&(!Array.isArray(e.setReps)||e.setReps.length!==e.sets||e.setReps.some(v=>!Number.isInteger(v)||v<1||v>50)))return false;
  if(e.setWeights!==undefined&&(!Array.isArray(e.setWeights)||e.setWeights.length!==e.sets||e.setWeights.some(v=>!Number.isFinite(v)||v<0||v>1000)))return false;
  return true;
 });
}
export function mergePlan(old, next) {
 const before=normalizePlan(old),after=normalizePlan(next);
 return {...after,exercises:after.exercises.map(e=>{
  const previous=before.exercises.find(x=>x.id===e.id);
  if(!previous)return e;
  const merged=normalizeExercise(e),done=Math.min(merged.sets,previous.done||0);
  for(let i=0;i<done;i++){merged.setReps[i]=previous.setReps[i];merged.setWeights[i]=previous.setWeights[i];}
  merged.done=done;merged.reps=merged.setReps[0];merged.weight=merged.setWeights[0];
  return merged;
 })};
}
// Persisted state is untrusted: a malformed timer must never stop app startup.
export function normalizeTimer(timer){
 if(!timer||typeof timer!=='object')return {};
 const context={};
 if(['mon','tue','wed','thu','fri','sat','sun'].includes(timer.day))context.day=timer.day;
 if(typeof timer.exerciseId==='string')context.exerciseId=timer.exerciseId;
 if(Number.isFinite(timer.paused)&&timer.paused>=0)return {...context,paused:Math.ceil(timer.paused)};
 if(Number.isFinite(timer.end)&&timer.end>0)return {...context,end:timer.end};
 return {};
}
export function secondsLeft(timer,now=Date.now()) {const t=normalizeTimer(timer);return t.paused!=null?t.paused:t.end?Math.max(0,Math.ceil((t.end-now)/1000)):0;}
