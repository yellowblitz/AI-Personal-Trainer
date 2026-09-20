const int=(v,min,max,fallback)=>Number.isInteger(v)&&v>=min&&v<=max?v:fallback;
const num=(v,min,max,fallback)=>Number.isFinite(v)&&v>=min&&v<=max?v:fallback;

export function normalizeExercise(ex){
 if(!ex||typeof ex!=='object')return ex;
 const sets=int(ex.sets,1,10,3),baseReps=int(ex.reps,1,50,12),baseWeight=num(ex.weight,0,1000,0);
 const sourceReps=Array.isArray(ex.setReps)?ex.setReps:[];
 const sourceWeights=Array.isArray(ex.setWeights)?ex.setWeights:[];
 const setReps=Array.from({length:sets},(_,i)=>int(sourceReps[i],1,50,baseReps));
 const setWeights=Array.from({length:sets},(_,i)=>num(sourceWeights[i],0,1000,baseWeight));
 const done=Math.max(0,Math.min(sets,Number.isInteger(ex.done)?ex.done:0));
 return {...ex,sets,reps:setReps[0],weight:setWeights[0],setReps,setWeights,done};
}
export function normalizePlan(plan){
 if(!plan||!Array.isArray(plan.exercises))return plan;
 return {...plan,exercises:plan.exercises.map(normalizeExercise)};
}
export function resizeSets(ex,count){
 const next=normalizeExercise(ex),sets=int(count,1,10,next.sets);
 const lastRep=next.setReps.at(-1)??next.reps,lastWeight=next.setWeights.at(-1)??next.weight;
 next.sets=sets;
 next.setReps=Array.from({length:sets},(_,i)=>i<next.setReps.length?next.setReps[i]:lastRep);
 next.setWeights=Array.from({length:sets},(_,i)=>i<next.setWeights.length?next.setWeights[i]:lastWeight);
 next.reps=next.setReps[0];next.weight=next.setWeights[0];next.done=Math.min(next.done,sets);
 return next;
}
export function setSetValue(ex,setIndex,field,value){
 const next=normalizeExercise(ex);
 if(!Number.isInteger(setIndex)||setIndex<0||setIndex>=next.sets)return next;
 if(field==='reps'){
  if(!Number.isInteger(value)||value<1||value>50)return next;
  next.setReps[setIndex]=value;next.reps=next.setReps[0];
 }else if(field==='weight'){
  if(!Number.isFinite(value)||value<0||value>1000)return next;
  next.setWeights[setIndex]=value;next.weight=next.setWeights[0];
 }
 return next;
}
export function completedSets(ex){return normalizeExercise(ex)?.done||0;}
export function totalSets(plan){return (plan?.exercises||[]).reduce((n,e)=>n+normalizeExercise(e).sets,0);}
export function completedSetTotal(plan){return (plan?.exercises||[]).reduce((n,e)=>n+completedSets(e),0);}
export function estimatePlanMinutes(plan){
 const p=normalizePlan(plan);if(!p?.exercises?.length)return 0;
 let seconds=0; // workout estimate excludes warm-up; the user's minute target is training time
 for(const ex of p.exercises){
  seconds+=60; // exercise setup / transition
  for(let i=0;i<ex.sets;i++)seconds+=ex.setReps[i]*3.5;
  seconds+=Math.max(0,ex.sets-1)*ex.rest;
 }
 return Math.max(1,Math.round(seconds/60));
}
const eq=x=>(x||'body only').toLowerCase().replace(/\s+/g,' ').trim();
export function fitPlanDuration(plan,targetMinutes,catalog){
 let p=normalizePlan(structuredClone(plan)),adjusted=false;
 const target=int(targetMinutes,5,180,45);
 const signature=[...new Set(p.exercises.map(e=>eq(catalog.find(c=>c.id===e.id)?.equipment)))];
 const sameEquipment=signature.length===1?signature[0]:null;
 const candidatePool=sameEquipment?catalog.filter(c=>!p.exercises.some(e=>e.id===c.id)&&eq(c.equipment)===sameEquipment):[];
 // The minute value is a planning target, not a hard ceiling and not an exercise-count target.
 // Prefer adding useful exercise variety first when a draft is too short, then add sets if needed.
 while(estimatePlanMinutes(p)<target&&p.exercises.length<12&&candidatePool.length){
  const c=candidatePool.shift();
  p.exercises.push(normalizeExercise({id:c.id,sets:3,reps:12,rest:75,weight:0,done:0}));
  adjusted=true;
 }
 let guard=0;
 while(estimatePlanMinutes(p)<target&&guard++<80){
  let changed=false;
  for(let i=0;i<p.exercises.length&&estimatePlanMinutes(p)<target;i++){
   const e=p.exercises[i];
   if(e.sets<6){p.exercises[i]=resizeSets(e,e.sets+1);changed=adjusted=true;}
  }
  if(!changed)break;
 }
 return {plan:p,estimatedMinutes:estimatePlanMinutes(p),adjusted};
}
export function summarizeHistory(history,catalog,limit=20){
 const names=new Map(catalog.map(c=>[c.id,c.name]));
 return (Array.isArray(history)?history:[]).slice(0,limit).map(h=>({
  date:h.date,day:h.day,name:h.plan?.name||'Workout',
  exercises:(h.plan?.exercises||[]).map(raw=>{const e=normalizeExercise(raw);return {
   id:e.id,name:names.get(e.id)||e.id,completedSets:e.done,
   sets:Array.from({length:e.done},(_,i)=>({set:i+1,reps:e.setReps[i],weight:e.setWeights[i]}))
  };})
 }));
}

// Use only completed performance, never unperformed targets from a saved session.
export function lastExercisePerformance(history,id){
 for(const session of Array.isArray(history)?history:[]){
  if(!session||!Number.isFinite(Date.parse(session.date)))continue;
  const raw=session.plan?.exercises?.find(e=>e?.id===id);
  const ex=normalizeExercise(raw);
  if(!ex?.done)continue;
  return {date:session.date,sets:Array.from({length:ex.done},(_,i)=>({reps:ex.setReps[i],weight:ex.setWeights[i]}))};
 }
 return null;
}
