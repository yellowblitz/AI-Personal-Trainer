const int=(v,min,max,fallback)=>Number.isInteger(v)&&v>=min&&v<=max?v:fallback;
const num=(v,min,max,fallback)=>Number.isFinite(v)&&v>=min&&v<=max?v:fallback;
const cleanText=(v,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';

export function normalizeExercise(ex){
 if(!ex||typeof ex!=='object')return ex;
 const sets=int(ex.sets,1,10,3),baseReps=int(ex.reps,1,50,12),baseWeight=num(ex.weight,0,1000,0);
 const sourceReps=Array.isArray(ex.setReps)?ex.setReps:[];
 const sourceWeights=Array.isArray(ex.setWeights)?ex.setWeights:[];
 const setReps=Array.from({length:sets},(_,i)=>int(sourceReps[i],1,50,baseReps));
 const setWeights=Array.from({length:sets},(_,i)=>num(sourceWeights[i],0,1000,baseWeight));
 // Newer sessions preserve the original prescription separately from what was actually performed.
 // Old saved sessions migrate by treating their logged values as both planned and actual.
 const sourcePlannedReps=Array.isArray(ex.plannedReps)?ex.plannedReps:(Array.isArray(ex.targetReps)?ex.targetReps:setReps);
 const sourcePlannedWeights=Array.isArray(ex.plannedWeights)?ex.plannedWeights:(Array.isArray(ex.targetWeights)?ex.targetWeights:setWeights);
 const plannedReps=Array.from({length:sets},(_,i)=>int(sourcePlannedReps[i],1,50,setReps[i]));
 const plannedWeights=Array.from({length:sets},(_,i)=>num(sourcePlannedWeights[i],0,1000,setWeights[i]));
 const done=Math.max(0,Math.min(sets,Number.isInteger(ex.done)?ex.done:0));
 const rir=Number.isInteger(ex.rir)&&ex.rir>=0&&ex.rir<=4?ex.rir:null;
 const effort=['too_easy','right','too_hard'].includes(ex.effort)?ex.effort:'';
 const form=['good','breaking','poor'].includes(ex.form)?ex.form:'';
 const discomfort=['none','mild','pain'].includes(ex.discomfort)?ex.discomfort:'';
 return {...ex,sets,reps:setReps[0],weight:setWeights[0],setReps,setWeights,plannedReps,plannedWeights,done,rir,note:cleanText(ex.note),effort,form,discomfort};
}
export function normalizePlan(plan){
 if(!plan||!Array.isArray(plan.exercises))return plan;
 return {...plan,exercises:plan.exercises.map(normalizeExercise)};
}
export function resizeSets(ex,count){
 const next=normalizeExercise(ex),sets=int(count,1,10,next.sets);
 const lastRep=next.setReps.at(-1)??next.reps,lastWeight=next.setWeights.at(-1)??next.weight;
 const lastPlannedRep=next.plannedReps.at(-1)??lastRep,lastPlannedWeight=next.plannedWeights.at(-1)??lastWeight;
 next.sets=sets;
 next.setReps=Array.from({length:sets},(_,i)=>i<next.setReps.length?next.setReps[i]:lastRep);
 next.setWeights=Array.from({length:sets},(_,i)=>i<next.setWeights.length?next.setWeights[i]:lastWeight);
 next.plannedReps=Array.from({length:sets},(_,i)=>i<next.plannedReps.length?next.plannedReps[i]:lastPlannedRep);
 next.plannedWeights=Array.from({length:sets},(_,i)=>i<next.plannedWeights.length?next.plannedWeights[i]:lastPlannedWeight);
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
export function setExerciseFeedback(ex,rir,note='',feedback={}){
 const next=normalizeExercise(ex);
 next.rir=Number.isInteger(rir)&&rir>=0&&rir<=4?rir:null;
 next.note=cleanText(note);
 next.effort=['too_easy','right','too_hard'].includes(feedback?.effort)?feedback.effort:next.effort;
 next.form=['good','breaking','poor'].includes(feedback?.form)?feedback.form:next.form;
 next.discomfort=['none','mild','pain'].includes(feedback?.discomfort)?feedback.discomfort:next.discomfort;
 return next;
}
export function completedSets(ex){return normalizeExercise(ex)?.done||0;}
export function totalSets(plan){return (plan?.exercises||[]).reduce((n,e)=>n+normalizeExercise(e).sets,0);}
export function completedSetTotal(plan){return (plan?.exercises||[]).reduce((n,e)=>n+completedSets(e),0);}
export function estimatePlanMinutes(plan){
 const p=normalizePlan(plan);if(!p?.exercises?.length)return 0;
 let seconds=0;
 for(const ex of p.exercises){
  seconds+=60;
  for(let i=0;i<ex.sets;i++)seconds+=ex.plannedReps[i]*3.5;
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
export function comparePlanPerformance(plan){
 const p=normalizePlan(plan),sets=[];
 for(const ex of p?.exercises||[])for(let i=0;i<ex.done;i++){
  const plannedReps=ex.plannedReps[i],actualReps=ex.setReps[i],plannedWeight=ex.plannedWeights[i],actualWeight=ex.setWeights[i];
  sets.push({exerciseId:ex.id,set:i+1,plannedReps,actualReps,plannedWeight,actualWeight,
   plannedVolume:plannedReps*plannedWeight,actualVolume:actualReps*actualWeight,
   metReps:actualReps>=plannedReps,metLoad:actualWeight>=plannedWeight});
 }
 const plannedReps=sets.reduce((n,s)=>n+s.plannedReps,0),actualReps=sets.reduce((n,s)=>n+s.actualReps,0);
 const plannedVolume=sets.reduce((n,s)=>n+s.plannedVolume,0),actualVolume=sets.reduce((n,s)=>n+s.actualVolume,0);
 return {sets,completedSets:sets.length,metRepSets:sets.filter(s=>s.metReps).length,belowRepSets:sets.filter(s=>!s.metReps).length,plannedReps,actualReps,plannedVolume,actualVolume};
}
export function summarizeHistory(history,catalog,limit=20){
 const names=new Map(catalog.map(c=>[c.id,c.name]));
 return (Array.isArray(history)?history:[]).slice(0,limit).map(h=>({
  date:h.date,day:h.day,name:h.plan?.name||'Workout',
  exercises:(h.plan?.exercises||[]).map(raw=>{const e=normalizeExercise(raw);return {
   id:e.id,name:names.get(e.id)||e.id,completedSets:e.done,rir:e.rir,note:e.note,effort:e.effort,form:e.form,discomfort:e.discomfort,
   sets:Array.from({length:e.done},(_,i)=>({set:i+1,plannedReps:e.plannedReps[i],plannedWeight:e.plannedWeights[i],actualReps:e.setReps[i],actualWeight:e.setWeights[i],
    reps:e.setReps[i],weight:e.setWeights[i]}))
  };})
 }));
}
export function lastExercisePerformance(history,id){
 for(const session of Array.isArray(history)?history:[]){
  if(!session||!Number.isFinite(Date.parse(session.date)))continue;
  const raw=session.plan?.exercises?.find(e=>e?.id===id);
  const ex=normalizeExercise(raw);
  if(!ex?.done)continue;
  return {date:session.date,rir:ex.rir,note:ex.note,effort:ex.effort,form:ex.form,discomfort:ex.discomfort,sets:Array.from({length:ex.done},(_,i)=>({
   reps:ex.setReps[i],weight:ex.setWeights[i],plannedReps:ex.plannedReps[i],plannedWeight:ex.plannedWeights[i]
  }))};
 }
 return null;
}
export function exerciseProgress(history,id){
 return (Array.isArray(history)?history:[]).slice().reverse().flatMap(session=>{
  if(!session||!Number.isFinite(Date.parse(session.date)))return [];
  const raw=session.plan?.exercises?.find(e=>e?.id===id),ex=normalizeExercise(raw);
  if(!ex?.done)return [];
  const actualReps=ex.setReps.slice(0,ex.done).reduce((a,b)=>a+b,0),plannedReps=ex.plannedReps.slice(0,ex.done).reduce((a,b)=>a+b,0);
  const actualVolume=ex.setReps.slice(0,ex.done).reduce((n,r,i)=>n+r*ex.setWeights[i],0);
  const plannedVolume=ex.plannedReps.slice(0,ex.done).reduce((n,r,i)=>n+r*ex.plannedWeights[i],0);
  const estimated1RM=Math.max(...ex.setReps.slice(0,ex.done).map((r,i)=>ex.setWeights[i]>0?ex.setWeights[i]*(1+r/30):0),0);
  return [{date:session.date,actualReps,plannedReps,actualVolume,plannedVolume,estimated1RM,rir:ex.rir}];
 });
}


const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
const MUSCLE_ALIASES={
 shoulders:'deltoids',shoulder:'deltoids',deltoid:'deltoids',
 glutes:'gluteal',glute:'gluteal',hamstrings:'hamstring',
 abdominals:'abs',abdominal:'abs',lats:'upper-back',latissimus:'upper-back',
 traps:'trapezius',forearms:'forearm',quadricep:'quadriceps'
};
const canonicalMuscle=value=>{
 const raw=String(value||'').trim().toLowerCase().replace(/_/g,'-');
 return MUSCLE_ALIASES[raw]||raw;
};
const exerciseMuscles=c=>{
 const primary=[...(Array.isArray(c?.anatomePrimarySlugs)?c.anatomePrimarySlugs:[]),c?.muscleSlug||c?.muscle].map(canonicalMuscle).filter(Boolean);
 const secondary=(Array.isArray(c?.secondaryMuscleSlugs)?c.secondaryMuscleSlugs:[]).map(canonicalMuscle).filter(Boolean);
 return {primary:[...new Set(primary)],secondary:[...new Set(secondary.filter(x=>!primary.includes(x)))]};
};
const completedExerciseMetrics=raw=>{
 const ex=normalizeExercise(raw);if(!ex?.done)return null;
 const reps=ex.setReps.slice(0,ex.done),weights=ex.setWeights.slice(0,ex.done);
 const weighted=weights.some(w=>w>0);
 const performance=weighted?Math.max(...reps.map((r,i)=>weights[i]>0?weights[i]*(1+r/30):0),0):Math.max(...reps,0);
 const volume=weighted?reps.reduce((n,r,i)=>n+r*weights[i],0):reps.reduce((a,b)=>a+b,0);
 let met=0;for(let i=0;i<ex.done;i++)if(reps[i]>=ex.plannedReps[i]&&weights[i]>=ex.plannedWeights[i])met++;
 return {ex,performance,volume,adherence:ex.done?met/ex.done:0};
};

export function exerciseProgressionSignal(history,id){
 const recent=(Array.isArray(history)?history:[]).flatMap(session=>{
  if(!session||!Number.isFinite(Date.parse(session.date)))return [];
  const raw=session.plan?.exercises?.find(e=>e?.id===id),m=completedExerciseMetrics(raw);
  return m?[{...m,date:session.date}]:[];
 }).slice(0,3);
 if(!recent.length)return {action:'collect',label:'Build history',reason:'Complete this exercise to build a progression signal.',sessions:0};
 const latest=recent[0],ex=latest.ex;
 if(ex.discomfort==='pain'||ex.discomfort==='mild')return {action:'replace',label:'Review exercise',reason:'Discomfort was reported last time, so automatic progression is paused.',sessions:recent.length};
 if(ex.form==='poor')return {action:'hold',label:'Hold',reason:'Form was rated poor last time; improve execution before increasing the prescription.',sessions:recent.length};
 const repeatedHard=recent.length>=2&&recent.slice(0,2).every(x=>x.adherence<.75&&(x.ex.rir==null||x.ex.rir<=1||x.ex.effort==='too_hard'));
 if(repeatedHard)return {action:'reduce',label:'Consider reducing',reason:'Targets were missed in two recent sessions while effort was high.',sessions:recent.length};
 if(latest.adherence>=.999&&(ex.effort==='too_easy'||(ex.rir!=null&&ex.rir>=2))&&ex.form!=='breaking')return {action:'progress',label:'Ready to progress',reason:'The latest prescription was completed with useful reps still in reserve.',sessions:recent.length};
 if(latest.adherence<.75&&(ex.rir==null||ex.rir<=1||ex.effort==='too_hard'))return {action:'hold',label:'Hold',reason:'The latest session missed several targets at high effort; avoid increasing yet.',sessions:recent.length};
 return {action:'hold',label:'Hold & observe',reason:'Keep the prescription stable until the recent trend is clearer.',sessions:recent.length};
}

export function exerciseRecords(history,id){
 const sessions=(Array.isArray(history)?history:[]).flatMap(session=>{
  if(!session||!Number.isFinite(Date.parse(session.date)))return [];
  const raw=session.plan?.exercises?.find(e=>e?.id===id),m=completedExerciseMetrics(raw);
  if(!m)return [];
  const maxWeight=Math.max(...m.ex.setWeights.slice(0,m.ex.done),0);
  const maxReps=Math.max(...m.ex.setReps.slice(0,m.ex.done),0);
  return [{date:session.date,estimated1RM:m.performance,maxWeight,maxReps,volume:m.volume,rir:m.ex.rir}];
 });
 if(!sessions.length)return null;
 return {
  sessions:sessions.length,
  bestEstimated1RM:Math.max(...sessions.map(x=>x.estimated1RM),0),
  bestWeight:Math.max(...sessions.map(x=>x.maxWeight),0),
  bestReps:Math.max(...sessions.map(x=>x.maxReps),0),
  bestVolume:Math.max(...sessions.map(x=>x.volume),0)
 };
}

export function muscleTrainingLoad(history,catalog,days=7,now=Date.now()){
 const since=Number(now)-Math.max(1,Number(days)||7)*86400000,byId=new Map((catalog||[]).map(c=>[c.id,c])),scores=new Map();
 for(const session of Array.isArray(history)?history:[]){
  const when=Date.parse(session?.date);if(!Number.isFinite(when)||when<since||when>Number(now)+86400000)continue;
  for(const raw of session.plan?.exercises||[]){
   const m=completedExerciseMetrics(raw);if(!m)return;
   const muscles=exerciseMuscles(byId.get(m.ex.id));
   for(const slug of muscles.primary)scores.set(slug,(scores.get(slug)||0)+m.ex.done);
   for(const slug of muscles.secondary)scores.set(slug,(scores.get(slug)||0)+m.ex.done*.5);
  }
 }
 return [...scores.entries()].map(([slug,sets])=>({slug,sets:Math.round(sets*10)/10})).sort((a,b)=>b.sets-a.sets);
}

export function muscleProgress(history,catalog,{days=56,now=Date.now()}={}){
 const since=Number(now)-Math.max(14,Number(days)||56)*86400000,byId=new Map((catalog||[]).map(c=>[c.id,c])),perExercise=new Map();
 const chronological=(Array.isArray(history)?history:[]).filter(s=>Number.isFinite(Date.parse(s?.date))).slice().sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 for(const session of chronological){
  const when=Date.parse(session.date);if(when<since||when>Number(now)+86400000)continue;
  for(const raw of session.plan?.exercises||[]){
   const m=completedExerciseMetrics(raw);if(!m)continue;
   const list=perExercise.get(m.ex.id)||[];list.push({...m,date:session.date});perExercise.set(m.ex.id,list);
  }
 }
 const muscle=new Map();
 for(const [id,points] of perExercise){
  const c=byId.get(id);if(!c)continue;
  const muscles=exerciseMuscles(c),take=Math.min(2,points.length);
  const first=points.slice(0,take),last=points.slice(-take);
  const perfBase=mean(first.map(x=>x.performance)),perfRecent=mean(last.map(x=>x.performance));
  const volBase=mean(first.map(x=>x.volume)),volRecent=mean(last.map(x=>x.volume));
  const strengthPct=points.length>=2&&perfBase>0?clamp((perfRecent-perfBase)/perfBase*100,-100,100):null;
  const volumePct=points.length>=2&&volBase>0?clamp((volRecent-volBase)/volBase*100,-100,100):null;
  const add=(slug,roleWeight)=>{
   const key=canonicalMuscle(slug);if(!key)return;
   const a=muscle.get(key)||{slug:key,strengthSum:0,strengthWeight:0,volumeSum:0,volumeWeight:0,met:0,sets:0,rir:[],dates:new Set(),exerciseIds:new Set()};
   if(strengthPct!=null){a.strengthSum+=strengthPct*roleWeight;a.strengthWeight+=roleWeight;}
   if(volumePct!=null){a.volumeSum+=volumePct*roleWeight;a.volumeWeight+=roleWeight;}
   for(const p of points){
    a.met+=p.adherence*p.ex.done*roleWeight;a.sets+=p.ex.done*roleWeight;
    if(p.ex.rir!=null)a.rir.push(p.ex.rir);
    a.dates.add(p.date.slice(0,10));
   }
   a.exerciseIds.add(id);muscle.set(key,a);
  };
  for(const slug of muscles.primary)add(slug,1);
  for(const slug of muscles.secondary)add(slug,.5);
 }
 return [...muscle.values()].map(a=>{
  const strengthPct=a.strengthWeight?Math.round(a.strengthSum/a.strengthWeight*10)/10:null;
  const volumePct=a.volumeWeight?Math.round(a.volumeSum/a.volumeWeight*10)/10:null;
  const trendParts=[];if(strengthPct!=null)trendParts.push([strengthPct,.7]);if(volumePct!=null)trendParts.push([volumePct,.3]);
  const denom=trendParts.reduce((n,x)=>n+x[1],0),trendPct=denom?Math.round(trendParts.reduce((n,x)=>n+x[0]*x[1],0)/denom*10)/10:null;
  const sessions=a.dates.size,confidence=sessions>=6?'high':sessions>=3?'medium':'low';
  return {slug:a.slug,trendPct,strengthPct,volumePct,adherencePct:a.sets?Math.round(a.met/a.sets*100):0,avgRir:a.rir.length?Math.round(mean(a.rir)*10)/10:null,effectiveSets:Math.round(a.sets*10)/10,sessions,exerciseCount:a.exerciseIds.size,confidence};
 }).sort((a,b)=>(b.sessions-a.sessions)||((b.trendPct??-999)-(a.trendPct??-999)));
}

export function weeklyTrainingReview(history,catalog,{days=7,now=Date.now()}={}){
 const since=Number(now)-Math.max(1,Number(days)||7)*86400000,sessions=(Array.isArray(history)?history:[]).filter(s=>{const t=Date.parse(s?.date);return Number.isFinite(t)&&t>=since&&t<=Number(now)+86400000;});
 let sets=0,met=0,rir=[],discomfortReports=0,formWarnings=0;
 for(const session of sessions)for(const raw of session.plan?.exercises||[]){
  const m=completedExerciseMetrics(raw);if(!m)continue;sets+=m.ex.done;met+=m.adherence*m.ex.done;
  if(m.ex.rir!=null)rir.push(m.ex.rir);if(m.ex.discomfort&&m.ex.discomfort!=='none')discomfortReports++;if(m.ex.form==='breaking'||m.ex.form==='poor')formWarnings++;
 }
 return {sessions:sessions.length,sets,adherencePct:sets?Math.round(met/sets*100):0,avgRir:rir.length?Math.round(mean(rir)*10)/10:null,discomfortReports,formWarnings,muscles:muscleTrainingLoad(history,catalog,days,now)};
}
