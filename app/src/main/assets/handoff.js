import {DAYS,cleanWeek,validWeek} from './week.js';
import {normalizeExercise,normalizePlan} from './training.js';
import {mergePlan,validPlan} from './core.js';
import {MODELS,DEFAULT_MODEL,geminiUrl,cleanProfile,validProfile} from './gemini.js';
import {compactCatalog,resolveExerciseRef} from './exercise-match.js';

const text=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
const dayName=id=>({mon:'Monday',tue:'Tuesday',wed:'Wednesday',thu:'Thursday',fri:'Friday',sat:'Saturday',sun:'Sunday'})[id]||id;
const int=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max?v:null;
const finite=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max?v:null;
const GOALS=['General fitness','Build muscle','Strength','Endurance','Fat loss','Mobility / athleticism'];
const LEVELS=['Beginner','Intermediate','Advanced'];

const DAY_WORDS={monday:'mon',tuesday:'tue',wednesday:'wed',thursday:'thu',friday:'fri',saturday:'sat',sunday:'sun'};
const DAY_HEADER_RE=/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b\s*(?:[-–—]\s*)?([^:\n*]{0,40}?)(?:\*{0,2}\s*:|\*{0,2}\s*(?=\n|$))/gim;
function exerciseHintFromSegment(value){
 let s=String(value||'').trim().replace(/^[•*\-–—]+\s*/,'');
 if(!s||/\b(optional|warm[- ]?up|cool[- ]?down)\b/i.test(s)&&/\b(bike|cardio|walk|treadmill|elliptical)\b/i.test(s))return '';
 const hasPrescription=/\b\d+\s*[x×]\s*\d+\b/i.test(s)||/\b\d+\s*sets?\b/i.test(s)||/\bsets?\s*[:=]?\s*\d+\b/i.test(s);
 if(!hasPrescription)return '';
 let cut=s.length;
 for(const re of [/\b\d+(?:\.\d+)?\s*(?:lb|lbs|kg)(?:\s*\/\s*(?:side|leg))?\b/i,/\b\d+\s*[x×]\s*\d+\b/i,/\b\d+\s*sets?\b/i]){
  const m=re.exec(s);if(m&&m.index<cut)cut=m.index;
 }
 return s.slice(0,cut).replace(/[,:;\-–—]+\s*$/,'').trim().slice(0,120);
}
export function extractExplicitPlanHints(sourceText){
 const source=text(sourceText,24000);if(!source)return [];
 const matches=[...source.matchAll(DAY_HEADER_RE)],out=[];
 for(let i=0;i<matches.length;i++){
  const m=matches[i],day=DAY_WORDS[m[1].toLowerCase()],start=(m.index||0)+m[0].length,end=i+1<matches.length?(matches[i+1].index||source.length):source.length;
  const body=source.slice(start,end),segments=body.split(/[;|\n]+/),exercises=segments.map(exerciseHintFromSegment).filter(Boolean);
  if(exercises.length)out.push({day,label:dayName(day),planLabel:text(m[2],40).replace(/^[\s\-–—:]+|[\s\-–—:*]+$/g,''),exercises});
 }
 return out;
}

function timeToSeconds(minutes,seconds='0'){
 const m=Number(minutes),sec=Number(seconds||0);return Number.isFinite(m)&&Number.isFinite(sec)?Math.round(m*60+sec):null;
}
function restFromSegment(value){
 const s=String(value||'');
 const clock=/\brest\b[^\d]{0,10}(\d{1,2}):(\d{2})/i.exec(s);if(clock)return int(timeToSeconds(clock[1],clock[2]),15,600);
 const seconds=/\brest\b[^\d]{0,10}(\d{2,3})\s*(?:s|sec|secs|second|seconds)\b/i.exec(s);if(seconds)return int(Number(seconds[1]),15,600);
 const minutes=/\brest\b[^\d]{0,10}(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes)\b/i.exec(s);if(minutes)return int(Math.round(Number(minutes[1])*60),15,600);
 return 90;
}
function localExerciseFromSegment(segment,catalog){
 const name=exerciseHintFromSegment(segment);if(!name)return null;
 const id=resolveExerciseRef(name,catalog);if(!id)return {error:'unresolved',name};
 const prescription=/\b(\d+)\s*[x×]\s*(\d+)(?:\s*\/\s*(?:leg|side))?/i.exec(segment)
  ||/\b(\d+)\s*sets?\s*(?:of\s*)?(\d+)\s*reps?\b/i.exec(segment);
 if(!prescription)return {error:'prescription',name};
 const sets=int(Number(prescription[1]),1,10),reps=int(Number(prescription[2]),1,50);if(sets===null||reps===null)return {error:'prescription',name};
 const load=/\b(\d+(?:\.\d+)?)\s*(lb|lbs|kg)(?:\s*\/\s*(?:side|leg))?\b/i.exec(segment);
 let weight=load?Number(load[1]):0;if(load&&/^kg$/i.test(load[2]))weight=Math.round(weight*2.2046226218*2)/2;
 if(finite(weight,0,1000)===null)return {error:'load',name};
 const rest=restFromSegment(segment);if(rest===null)return {error:'rest',name};
 return normalizeExercise({id,sets,reps,weight,setReps:Array(sets).fill(reps),setWeights:Array(sets).fill(weight),rest,done:0});
}
export function tryLocalExplicitPlanTranslation(sourceText,catalog){
 const source=text(sourceText,24000);if(!source)return null;
 const matches=[...source.matchAll(DAY_HEADER_RE)];if(!matches.length)return null;
 const commands=[],unresolved=[];
 for(let i=0;i<matches.length;i++){
  const m=matches[i],day=DAY_WORDS[m[1].toLowerCase()],start=(m.index||0)+m[0].length,end=i+1<matches.length?(matches[i+1].index||source.length):source.length;
  const body=source.slice(start,end),segments=body.split(/[;|\n]+/).map(v=>v.trim()).filter(Boolean);
  const prescribed=segments.filter(v=>exerciseHintFromSegment(v));
  if(prescribed.length<2)continue;
  const exercises=[];
  for(const segment of prescribed){
   const parsed=localExerciseFromSegment(segment,catalog);
   if(!parsed||parsed.error){unresolved.push({day,name:parsed?.name||exerciseHintFromSegment(segment),reason:parsed?.error||'unknown'});continue;}
   exercises.push(parsed);
  }
  if(exercises.length!==prescribed.length)continue;
  const label=text(m[2],40).replace(/^[\s\-–—:]+|[\s\-–—:*]+$/g,'')||dayName(day);
  commands.push({type:'replace_plan',day,name:label,exercises});
 }
 if(!commands.length)return null;
 if(unresolved.length)return {complete:false,unresolved,commands};
 const restRangeUsed=/\brest\b[^\n;]{0,24}\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2}/i.test(source);
 const batch=validateCommandBatch({summary:'Translated explicit workout plan locally.',warnings:restRangeUsed?['Rest ranges use the first listed rest time because the planner stores one rest value per exercise.']:[],commands},catalog);
 const gaps=coverageProblems(source,batch.commands,catalog);
 return gaps.length?{complete:false,unresolved:gaps,commands:batch.commands}:{complete:true,batch};
}

function coverageProblems(sourceText,commands,catalog){
 const requirements=extractExplicitPlanHints(sourceText).filter(x=>x.exercises.length>=2),problems=[];
 for(const req of requirements){
  const cmd=commands.find(x=>x.type==='replace_plan'&&x.day===req.day);
  const expectedIds=req.exercises.map(name=>resolveExerciseRef(name,catalog));
  const actualIds=cmd?.exercises?.map(x=>x.id)||[];
  if(!cmd||actualIds.length!==req.exercises.length){
   problems.push({day:req.day,expected:req.exercises.length,actual:actualIds.length,exerciseNames:req.exercises,expectedIds,actualIds});continue;
  }
  if(expectedIds.every(Boolean)&&expectedIds.some((id,i)=>id!==actualIds[i])){
   problems.push({day:req.day,expected:req.exercises.length,actual:actualIds.length,exerciseNames:req.exercises,expectedIds,actualIds,reason:'exercise_order_or_identity_mismatch'});
  }
 }
 return problems;
}
export function validateSourceCoverage(sourceText,commands,catalog){return coverageProblems(sourceText,commands,catalog);}


export function buildChatGPTContext({week,profile,memory='',recentTraining=[]},catalog){
 const p=cleanProfile(profile||{}),w=cleanWeek(week);
 const currentIds=w.days.flatMap(d=>d.enabled&&d.plan?d.plan.exercises.map(e=>e.id):[]);
 const catalogNames=compactCatalog([p.equipment,...currentIds].join(' '),catalog,{limit:90,includeIds:currentIds})
  .map(c=>c.name+' ['+c.id+'] · '+c.equipment+' · '+c.muscle).join('\n');
 const schedule=w.days.map(d=>d.enabled
  ? dayName(d.id)+' · target '+d.minutes+' training min (warm-up excluded) · '+d.plan.name+'\n  '+d.plan.exercises.map(e=>catalog.find(c=>c.id===e.id)?.name+' '+e.sets+' sets · reps '+e.setReps.join('/')+' · rest '+e.rest+'s'+(e.setWeights.some(x=>x>0)?' · loads '+e.setWeights.join('/')+' lb':'')).join('\n  ')
  : dayName(d.id)+' · Rest').join('\n');
 const recent=(Array.isArray(recentTraining)?recentTraining:[]).slice(0,8).map(h=>h.date+' '+dayName(h.day)+' '+h.name+': '+(h.exercises||[]).map(e=>{
  const sets=(e.sets||[]).map(s=>'S'+s.set+' target '+(s.plannedReps??s.reps)+' reps'+((s.plannedWeight??s.weight)?' @ '+(s.plannedWeight??s.weight)+' lb':' BW')+' -> actual '+(s.actualReps??s.reps)+' reps'+((s.actualWeight??s.weight)?' @ '+(s.actualWeight??s.weight)+' lb':' BW')).join(', ');
  return e.name+' '+sets+(e.rir!=null?' · RIR '+(e.rir===4?'4+':e.rir):'')+(e.note?' · note: '+text(e.note,300):'');
 }).join(' | ')).join('\n');
 return [
  'You are my personal training coach in regular ChatGPT. Talk to me naturally and make the coaching decisions; do not output JSON or app commands.',
  'When I ask for workout changes, give clear day-by-day exercise names, sets, reps, load guidance and rest so my trainer app can interpret your response.',
  'My app has a broad exercise library and will later pass your reply to a separate Gemini parser. Use normal, specific exercise names; you do not need to know internal IDs. If a movement has important variants, name the equipment, grip, angle, or stance so the parser can choose the correct one.',
  'Training-minute targets below exclude warm-up and are approximate unless I explicitly give a strict limit. Exercise count is flexible.',
  'For recent training, distinguish the planned target from actual logged performance. RIR is reps in reserve: 0 means no more good reps, 4+ means at least four. Use target misses, RIR and notes when discussing progression instead of assuming prescribed reps were completed.',
  '',
  'PROFILE',
  'Goal: '+(p.goal||'not set'),
  'Experience: '+(p.experience||'not set'),
  'Equipment: '+(p.equipment||'not set'),
  'Height: '+(p.heightIn??'not set')+' in',
  'Weight: '+(p.weightLb??'not set')+' lb',
  memory?'Coach memory: '+text(memory,4000):'Coach memory: none',
  '',
  'CURRENT WEEK',
  schedule,
  '',
  'RECENT TRAINING',
  recent||'No logged sessions yet.',
  '',
  'RELEVANT EXERCISE LIBRARY SAMPLE ('+catalog.length+' total exercises available)',
  catalogNames
 ].join('\n').slice(0,30000);
}

function normalizeCommandExercise(e,catalog){
 if(!e||typeof e!=='object')return null;
 const resolvedId=resolveExerciseRef(e.id??e.name??e.exercise,catalog);
 if(!resolvedId)return null;
 const sets=int(Number(e.sets),1,10);if(sets===null)return null;
 const repsBase=int(Number(e.reps),1,50);
 const weightBase=finite(Number(e.weight??0),0,1000);
 const setReps=Array.isArray(e.setReps)&&e.setReps.length===sets?e.setReps.map(v=>int(Number(v),1,50)):null;
 const setWeights=Array.isArray(e.setWeights)&&e.setWeights.length===sets?e.setWeights.map(v=>finite(Number(v),0,1000)):null;
 if((setReps&&setReps.some(v=>v===null))||(setWeights&&setWeights.some(v=>v===null)))return null;
 const reps=setReps||Array(sets).fill(repsBase??12),weights=setWeights||Array(sets).fill(weightBase??0);
 const rest=int(Number(e.rest??90),15,600);if(rest===null)return null;
 return normalizeExercise({id:resolvedId,sets,reps:reps[0],weight:weights[0],setReps:reps,setWeights:weights,rest,done:0});
}

export function validateCommandBatch(data,catalog){
 if(!data||typeof data!=='object'||!Array.isArray(data.commands))throw new Error('Gemini returned an invalid command batch.');
 const ids=catalog.map(c=>c.id),commands=[];
 if(data.commands.length>40)throw new Error('Gemini returned too many commands.');
 for(const raw of data.commands){
  if(!raw||typeof raw!=='object'||typeof raw.type!=='string')throw new Error('A command is malformed.');
  if(raw.type==='set_day'){
   if(!DAYS.includes(raw.day)||typeof raw.enabled!=='boolean')throw new Error('A set_day command is invalid.');
   const minutes=raw.minutes==null?null:int(Number(raw.minutes),5,180);if(raw.minutes!=null&&minutes===null)throw new Error('A set_day minute target is invalid.');
   commands.push({type:'set_day',day:raw.day,enabled:raw.enabled,minutes});
  }else if(raw.type==='replace_plan'){
   if(!DAYS.includes(raw.day)||typeof raw.name!=='string'||!raw.name.trim()||!Array.isArray(raw.exercises)||raw.exercises.length<1||raw.exercises.length>12)throw new Error('A replace_plan command is invalid.');
   const exercises=raw.exercises.map(e=>normalizeCommandExercise(e,catalog));if(exercises.some(e=>!e))throw new Error('A replace_plan exercise is invalid, unsupported, or ambiguous.');
   if(new Set(exercises.map(e=>e.id)).size!==exercises.length)throw new Error('A replace_plan command contains duplicate exercises.');
   const plan={name:text(raw.name,80),exercises};if(!validPlan(plan,ids))throw new Error('A replacement workout failed validation.');
   commands.push({type:'replace_plan',day:raw.day,name:plan.name,exercises:plan.exercises});
  }else if(raw.type==='update_profile'){
   const fields={};for(const k of ['goal','experience','equipment','heightIn','weightLb'])if(Object.prototype.hasOwnProperty.call(raw.fields||{},k))fields[k]=raw.fields[k];
   if(!Object.keys(fields).length)throw new Error('An update_profile command has no supported fields.');
   if(fields.goal!==undefined&&!GOALS.includes(fields.goal))throw new Error('An update_profile goal is unsupported.');
   if(fields.experience!==undefined&&!LEVELS.includes(fields.experience))throw new Error('An update_profile experience level is unsupported.');
   if(fields.equipment!==undefined&&(typeof fields.equipment!=='string'||fields.equipment.length>500))throw new Error('An update_profile equipment value is invalid.');
   if(fields.heightIn!==undefined&&finite(Number(fields.heightIn),36,96)===null)throw new Error('An update_profile height is invalid.');
   if(fields.weightLb!==undefined&&finite(Number(fields.weightLb),50,1000)===null)throw new Error('An update_profile weight is invalid.');
   commands.push({type:'update_profile',fields});
  }else if(raw.type==='set_memory'){
   const value=text(raw.text,4000);if(!value)throw new Error('A set_memory command is empty.');commands.push({type:'set_memory',text:value});
  }else throw new Error('Unsupported command type: '+raw.type);
 }
 return {summary:text(data.summary,2000)||'ChatGPT changes interpreted.',warnings:Array.isArray(data.warnings)?data.warnings.map(x=>text(x,500)).filter(Boolean).slice(0,12):[],commands};
}

export function applyCommandBatch(batch,{week,profile,memory=''},catalog){
 const parsed=validateCommandBatch(batch,catalog),ids=catalog.map(c=>c.id),nextWeek=structuredClone(cleanWeek(week)),nextProfile=cleanProfile(profile||{});let nextMemory=text(memory,4000);
 const descriptions=[];
 for(const cmd of parsed.commands){
  if(cmd.type==='set_day'){
   const d=nextWeek.days[DAYS.indexOf(cmd.day)];d.enabled=cmd.enabled;if(cmd.minutes!=null)d.minutes=cmd.minutes;if(!cmd.enabled)d.plan=null;
   descriptions.push(dayName(cmd.day)+': '+(cmd.enabled?'training day'+(cmd.minutes?' · ~'+cmd.minutes+' min':''):'rest day'));
  }else if(cmd.type==='replace_plan'){
   const d=nextWeek.days[DAYS.indexOf(cmd.day)],incoming=normalizePlan({name:cmd.name,exercises:cmd.exercises});
   d.enabled=true;d.plan=d.plan?mergePlan(d.plan,incoming):incoming;
   const detail=incoming.exercises.map(e=>(catalog.find(c=>c.id===e.id)?.name||e.id)+' '+e.sets+' sets · reps '+e.setReps.join('/')+' · '+e.rest+'s rest').join(' | ');descriptions.push(dayName(cmd.day)+': '+cmd.name+' — '+detail);
  }else if(cmd.type==='update_profile'){
   const merged={...nextProfile,...cmd.fields},cleaned=cleanProfile(merged);if(!validProfile(cleaned))throw new Error('The interpreted profile update is invalid.');
   Object.assign(nextProfile,cleaned);descriptions.push('Update profile: '+Object.keys(cmd.fields).join(', '));
  }else if(cmd.type==='set_memory'){
   nextMemory=cmd.text;descriptions.push('Update long-term coach memory');
  }
 }
 if(!validWeek(nextWeek,ids))throw new Error('The interpreted commands would create an invalid weekly plan.');
 return {summary:parsed.summary,warnings:parsed.warnings,commands:parsed.commands,week:nextWeek,profile:nextProfile,memory:nextMemory,descriptions};
}

export function buildInterpreterRequest({sourceText,week,profile,memory='',selectedDay,coverageRepair=[]},catalog){
 if(!text(sourceText,24000))throw new Error('Paste or share a ChatGPT response first.');
 const cleanedWeek=cleanWeek(week),cleanedProfile=cleanProfile(profile||{}),explicitDayExerciseHints=extractExplicitPlanHints(sourceText);
 const includeIds=cleanedWeek.days.flatMap(d=>d.enabled&&d.plan?d.plan.exercises.map(e=>e.id):[]);
 const candidateMap=new Map();
 const addCandidates=items=>items.forEach(item=>{if(item?.id&&!candidateMap.has(item.id))candidateMap.set(item.id,item);});
 for(const block of explicitDayExerciseHints)for(const name of block.exercises)addCandidates(compactCatalog(name+' '+cleanedProfile.equipment,catalog,{limit:8}));
 addCandidates(compactCatalog([sourceText,cleanedProfile.equipment].join('\n'),catalog,{limit:90,includeIds}));
 const catalogSummary=[...candidateMap.values()].slice(0,180);
 const system=[
  'You are a deterministic command translator for an Android workout planner. You are NOT the coach and must not redesign the workout.',
  'Interpret only concrete changes explicitly stated in the supplied ChatGPT response. Preserve everything not mentioned.',
  'Return only JSON with keys: summary (string), warnings (array of strings), commands (array).',
  'Allowed commands:',
  '1) {"type":"set_day","day":"mon|tue|wed|thu|fri|sat|sun","enabled":true|false,"minutes":optional integer 5-180}.',
  '2) {"type":"replace_plan","day":"...","name":"...","exercises":[{"id":"catalog id","sets":1-10,"setReps":[...],"setWeights":[...],"rest":15-600,"reps":first set reps,"weight":first set load}]}.',
  '3) {"type":"update_profile","fields":{only goal,experience,equipment,heightIn,weightLb fields explicitly changed by ChatGPT}}.',
  '4) {"type":"set_memory","text":"durable coaching context explicitly requested to remember"}.',
  'The candidate catalog below is relevance-ranked from the full local exercise library. Prefer its exact IDs. The local app also resolves exact exercise names and common aliases, but you must never guess between materially different variants.',
  'If ChatGPT mentions an unsupported or genuinely ambiguous exercise, add a warning and do not silently substitute it.',
  'When ChatGPT provides a complete explicit day plan, that day is atomic: replace_plan MUST include every listed strength exercise in the same order. Never apply a partial day. If even one listed exercise cannot be resolved, warn and omit the replace_plan for that entire day.',
  'The user payload includes explicitDayExerciseHints mechanically extracted from clearly prescribed day blocks. Use those names and counts as coverage constraints, not as coaching suggestions. DB means dumbbell; RDL means Romanian deadlift.',
  'If a complete explicit day plan is present, emit replace_plan for that day even when some exercises are unchanged from the current week. This prevents a full plan from being mistaken for a small patch.',
  'For a complete workout/day redesign, use replace_plan. For a rest/training-day or target-time change, use set_day. The minute target excludes warm-up and is approximate unless ChatGPT explicitly says strict.',
  'If ChatGPT gives a PPL split as Day 1/Day 2/Day 3 without weekdays, map those in order onto the currently enabled training days. If there are not enough enabled days, warn instead of inventing extra days.',
  'Do not create progress records from advice text. Actual set completion is recorded by the app itself.',
  'For prose that does not contain a complete explicit day plan, emit only commands for data that should change.',
  'Candidate catalog ('+catalogSummary.length+' of '+catalog.length+' local exercises): '+JSON.stringify(catalogSummary)
 ].join('\n');
 return {systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:JSON.stringify({chatgptResponse:text(sourceText,24000),selectedDay,currentWeek:cleanedWeek,profile:cleanedProfile,memory:text(memory,1200),explicitDayExerciseHints,coverageRepair:Array.isArray(coverageRepair)?coverageRepair.slice(0,8):[]})}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:7000,thinkingConfig:{thinkingLevel:'low'}}};
}

export async function interpretChatGPTResponse(input,catalog,apiKey,fetcher=fetch){
 const local=tryLocalExplicitPlanTranslation(input.sourceText,catalog);
 if(local?.complete)return {...local.batch,modelUsed:'local-parser',fallbackFrom:null,translationPath:'local',attempts:[]};
 if(typeof apiKey!=='string'||!apiKey.trim())throw new Error('This response needs Gemini fallback. Add your Gemini API key in Settings first.');
 const selected=MODELS.some(m=>m.id===input.model)?input.model:DEFAULT_MODEL;
 const models=[selected,...MODELS.map(m=>m.id).filter(id=>id!==selected)],attempts=[];
 const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
 const timeoutFor=model=>{
  const avg=Number(input?.timing?.[model]?.avgMs);
  return Number.isFinite(avg)&&avg>0?clamp(Math.round(avg*2.5+8000),25000,60000):35000;
 };
 const requestModel=async(model,body)=>{
  const timeoutMs=timeoutFor(model),started=Date.now();let response;
  try{response=await fetcher(geminiUrl(model),{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey.trim()},body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs),credentials:'omit',redirect:'error'});}
  catch(e){
   const timedOut=e.name==='TimeoutError'||e.name==='AbortError',durationMs=Date.now()-started;
   attempts.push({model,outcome:timedOut?'timeout':'network',durationMs,timeoutMs});
   const err=new Error(timedOut?'Gemini interpreter timed out on '+model+'. Trying another model when available.':'Could not connect to the Gemini interpreter.');
   err.diagnostic={category:timedOut?'handoff_timeout':'handoff_network',model,durationMs,timeoutMs,attempts:[...attempts]};err.retryable=true;throw err;
  }
  if(!response.ok){
   let provider={};try{provider=await response.json();}catch{}
   const durationMs=Date.now()-started,detail={model,httpStatus:response.status,providerStatus:text(provider?.error?.status,80),providerMessage:text(provider?.error?.message,800),durationMs,timeoutMs,outcome:'http_'+response.status};attempts.push(detail);
   const err=new Error([429,500,502,503,504].includes(response.status)?'Gemini interpreter is temporarily unavailable. Trying another model when available.':'Gemini could not interpret the ChatGPT response.');
   err.diagnostic={category:'handoff_http_error',...detail,attempts:[...attempts]};err.retryable=[429,500,502,503,504].includes(response.status);throw err;
  }
  let data;try{data=await response.json();}catch{
   const durationMs=Date.now()-started;attempts.push({model,outcome:'invalid_http_json',durationMs,timeoutMs});
   const err=new Error('Gemini returned an unreadable command response.');err.diagnostic={category:'handoff_invalid_http_json',model,durationMs,timeoutMs,attempts:[...attempts]};err.retryable=true;throw err;
  }
  const candidate=data?.candidates?.[0];
  if(candidate?.finishReason!=='STOP'){
   const durationMs=Date.now()-started;attempts.push({model,outcome:'incomplete',durationMs,timeoutMs,finishReason:candidate?.finishReason||'missing'});
   const err=new Error('Gemini returned an incomplete command response.');err.diagnostic={category:'handoff_incomplete',model,finishReason:candidate?.finishReason||'missing',durationMs,timeoutMs,attempts:[...attempts]};err.retryable=true;throw err;
  }
  try{
   const json=JSON.parse((candidate.content?.parts||[]).filter(p=>!p.thought&&typeof p.text==='string').map(p=>p.text).join(''));
   attempts.push({model,outcome:'success',durationMs:Date.now()-started,timeoutMs});return json;
  }catch{
   const durationMs=Date.now()-started;attempts.push({model,outcome:'invalid_json',durationMs,timeoutMs});
   const err=new Error('Gemini returned invalid command JSON.');err.diagnostic={category:'handoff_invalid_json',model,durationMs,timeoutMs,attempts:[...attempts]};err.retryable=true;throw err;
  }
 };
 let lastError=null;
 for(let i=0;i<models.length;i++){
  const model=models[i];let json,parsed;
  try{json=await requestModel(model,buildInterpreterRequest(input,catalog));}
  catch(err){lastError=err;if(err.retryable&&i<models.length-1)continue;throw err;}
  let firstValidationError=null;
  try{parsed=validateCommandBatch(json,catalog);}catch(err){firstValidationError=err;}
  let gaps=parsed?coverageProblems(input.sourceText,parsed.commands,catalog):[{reason:'validation',message:firstValidationError?.message||'invalid command batch'}];
  if(gaps.length){
   const repair=gaps.map(g=>({...g,instruction:'Re-translate the original ChatGPT response. Complete every explicit day atomically and include every listed exercise in order.'}));
   try{
    const repairedJson=await requestModel(model,buildInterpreterRequest({...input,coverageRepair:repair},catalog));
    parsed=validateCommandBatch(repairedJson,catalog);gaps=coverageProblems(input.sourceText,parsed.commands,catalog);
   }catch(err){
    lastError=err;
    if(err.retryable&&i<models.length-1)continue;
    if(!err.diagnostic)err.diagnostic={category:'handoff_validation',model,firstError:firstValidationError?.message||null,coverageRepair:repair,attempts:[...attempts]};
    throw err;
   }
  }
  if(gaps.length){
   const err=new Error('Gemini left exercises out of the ChatGPT plan, so no incomplete workout was applied. Please retry the response.');
   err.diagnostic={category:'handoff_incomplete_day',model,gaps,attempts:[...attempts]};lastError=err;if(i<models.length-1)continue;throw err;
  }
  return {...parsed,modelUsed:model,fallbackFrom:model!==selected?selected:null,translationPath:'gemini',attempts:[...attempts]};
 }
 if(lastError)throw lastError;
 throw new Error('Gemini could not interpret the ChatGPT response.');
}
