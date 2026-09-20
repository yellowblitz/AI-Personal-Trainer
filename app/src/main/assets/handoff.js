import {DAYS,cleanWeek,validWeek} from './week.js';
import {normalizeExercise,normalizePlan} from './training.js';
import {mergePlan,validPlan} from './core.js';
import {MODELS,DEFAULT_MODEL,geminiUrl,cleanProfile,validProfile} from './gemini.js';

const text=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
const dayName=id=>({mon:'Monday',tue:'Tuesday',wed:'Wednesday',thu:'Thursday',fri:'Friday',sat:'Saturday',sun:'Sunday'})[id]||id;
const int=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max?v:null;
const finite=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max?v:null;

export function buildChatGPTContext({week,profile,memory='',recentTraining=[]},catalog){
 const p=cleanProfile(profile||{}),w=cleanWeek(week);
 const catalogNames=catalog.map(c=>c.name+' ['+c.id+'] · '+c.equipment+' · '+c.muscle).join('\n');
 const schedule=w.days.map(d=>d.enabled
  ? dayName(d.id)+' · target '+d.minutes+' training min (warm-up excluded) · '+d.plan.name+'\n  '+d.plan.exercises.map(e=>catalog.find(c=>c.id===e.id)?.name+' '+e.sets+' sets · reps '+e.setReps.join('/')+' · rest '+e.rest+'s'+(e.setWeights.some(x=>x>0)?' · loads '+e.setWeights.join('/')+' lb':'')).join('\n  ')
  : dayName(d.id)+' · Rest').join('\n');
 const recent=(Array.isArray(recentTraining)?recentTraining:[]).slice(0,8).map(h=>h.date+' '+dayName(h.day)+' '+h.name+': '+(h.exercises||[]).map(e=>e.name+' '+(e.sets||[]).map(s=>'S'+s.set+' '+s.reps+' reps'+(s.weight?' @ '+s.weight+' lb':'')).join(', ')).join(' | ')).join('\n');
 return [
  'You are my personal training coach in regular ChatGPT. Talk to me naturally and make the coaching decisions; do not output JSON or app commands.',
  'When I ask for workout changes, give clear day-by-day exercise names, sets, reps, load guidance and rest so my trainer app can interpret your response.',
  'My app will later pass your reply to a separate Gemini parser that can only execute exercises from the catalog below. If you recommend an exercise outside the catalog, clearly label it as a suggestion that may need a substitute.',
  'Training-minute targets below exclude warm-up and are approximate unless I explicitly give a strict limit. Exercise count is flexible.',
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
  'APP EXERCISE CATALOG',
  catalogNames
 ].join('\n').slice(0,30000);
}

function normalizeCommandExercise(e,ids){
 if(!e||typeof e!=='object'||!ids.includes(e.id))return null;
 const sets=int(Number(e.sets),1,10);if(sets===null)return null;
 const repsBase=int(Number(e.reps),1,50);
 const weightBase=finite(Number(e.weight??0),0,1000);
 const setReps=Array.isArray(e.setReps)&&e.setReps.length===sets?e.setReps.map(v=>int(Number(v),1,50)):null;
 const setWeights=Array.isArray(e.setWeights)&&e.setWeights.length===sets?e.setWeights.map(v=>finite(Number(v),0,1000)):null;
 if((setReps&&setReps.some(v=>v===null))||(setWeights&&setWeights.some(v=>v===null)))return null;
 const reps=setReps||Array(sets).fill(repsBase??12),weights=setWeights||Array(sets).fill(weightBase??0);
 const rest=int(Number(e.rest??90),15,600);if(rest===null)return null;
 return normalizeExercise({id:e.id,sets,reps:reps[0],weight:weights[0],setReps:reps,setWeights:weights,rest,done:0});
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
   const exercises=raw.exercises.map(e=>normalizeCommandExercise(e,ids));if(exercises.some(e=>!e))throw new Error('A replace_plan exercise is invalid or unsupported.');
   if(new Set(exercises.map(e=>e.id)).size!==exercises.length)throw new Error('A replace_plan command contains duplicate exercises.');
   const plan={name:text(raw.name,80),exercises};if(!validPlan(plan,ids))throw new Error('A replacement workout failed validation.');
   commands.push({type:'replace_plan',day:raw.day,name:plan.name,exercises:plan.exercises});
  }else if(raw.type==='update_profile'){
   const fields={};for(const k of ['goal','experience','equipment','heightIn','weightLb'])if(Object.prototype.hasOwnProperty.call(raw.fields||{},k))fields[k]=raw.fields[k];
   if(!Object.keys(fields).length)throw new Error('An update_profile command has no supported fields.');
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
   descriptions.push(dayName(cmd.day)+': replace workout with '+cmd.name+' ('+incoming.exercises.length+' exercises)');
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

export function buildInterpreterRequest({sourceText,week,profile,memory='',selectedDay},catalog){
 if(!text(sourceText,24000))throw new Error('Paste or share a ChatGPT response first.');
 const catalogSummary=catalog.map(({id,name,equipment,muscle})=>({id,name,equipment,muscle}));
 const system=[
  'You are a deterministic command translator for an Android workout planner. You are NOT the coach and must not redesign the workout.',
  'Interpret only concrete changes explicitly stated in the supplied ChatGPT response. Preserve everything not mentioned.',
  'Return only JSON with keys: summary (string), warnings (array of strings), commands (array).',
  'Allowed commands:',
  '1) {"type":"set_day","day":"mon|tue|wed|thu|fri|sat|sun","enabled":true|false,"minutes":optional integer 5-180}.',
  '2) {"type":"replace_plan","day":"...","name":"...","exercises":[{"id":"catalog id","sets":1-10,"setReps":[...],"setWeights":[...],"rest":15-600,"reps":first set reps,"weight":first set load}]}.',
  '3) {"type":"update_profile","fields":{only goal,experience,equipment,heightIn,weightLb fields explicitly changed by ChatGPT}}.',
  '4) {"type":"set_memory","text":"durable coaching context explicitly requested to remember"}.',
  'Use only exact catalog IDs. Map a normal exercise name to an ID only when the match is unambiguous. Never invent an ID.',
  'If ChatGPT mentions an unsupported or ambiguous exercise, add a warning and do not silently substitute it.',
  'For a complete workout/day redesign, use replace_plan. For a rest/training-day or target-time change, use set_day. The minute target excludes warm-up and is approximate unless ChatGPT explicitly says strict.',
  'If ChatGPT gives a PPL split as Day 1/Day 2/Day 3 without weekdays, map those in order onto the currently enabled training days. If there are not enough enabled days, warn instead of inventing extra days.',
  'Do not create progress records from advice text. Actual set completion is recorded by the app itself.',
  'Do not repeat the entire week. Emit only commands for data that should change.',
  'Catalog: '+JSON.stringify(catalogSummary)
 ].join('\n');
 return {systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:JSON.stringify({chatgptResponse:text(sourceText,24000),selectedDay,currentWeek:cleanWeek(week),profile:cleanProfile(profile||{}),memory:text(memory,4000)})}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:10000,thinkingConfig:{thinkingLevel:'high'}}};
}

export async function interpretChatGPTResponse(input,catalog,apiKey,fetcher=fetch){
 if(typeof apiKey!=='string'||!apiKey.trim())throw new Error('Add your Gemini API key in Settings first.');
 const selected=MODELS.some(m=>m.id===input.model)?input.model:DEFAULT_MODEL,start=MODELS.findIndex(m=>m.id===selected),models=MODELS.slice(start).map(m=>m.id);
 const body=buildInterpreterRequest(input,catalog),attempts=[];
 for(let i=0;i<models.length;i++){
  const model=models[i];let response;
  try{response=await fetcher(geminiUrl(model),{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey.trim()},body:JSON.stringify(body),signal:AbortSignal.timeout(90000),credentials:'omit',redirect:'error'});}catch(e){const err=new Error(e.name==='TimeoutError'?'Gemini interpreter timed out.':'Could not connect to the Gemini interpreter.');err.diagnostic={category:e.name==='TimeoutError'?'handoff_timeout':'handoff_network',model,attempts};throw err;}
  if(!response.ok){
   let provider={};try{provider=await response.json();}catch{}
   const detail={model,httpStatus:response.status,providerStatus:text(provider?.error?.status,80),providerMessage:text(provider?.error?.message,800)};attempts.push(detail);
   if(response.status===503&&i<models.length-1)continue;
   const err=new Error(response.status===503?'Gemini interpreters are currently busy. Please try again shortly.':'Gemini could not interpret the ChatGPT response.');
   err.diagnostic={category:'handoff_http_error',...detail,attempts};throw err;
  }
  let data;try{data=await response.json();}catch{const err=new Error('Gemini returned an unreadable command response.');err.diagnostic={category:'handoff_invalid_http_json',model};throw err;}
  const candidate=data?.candidates?.[0];if(candidate?.finishReason!=='STOP'){const err=new Error('Gemini returned an incomplete command response.');err.diagnostic={category:'handoff_incomplete',model,finishReason:candidate?.finishReason||'missing'};throw err;}
  let json;try{json=JSON.parse((candidate.content?.parts||[]).filter(p=>!p.thought&&typeof p.text==='string').map(p=>p.text).join(''));}catch{const err=new Error('Gemini returned invalid command JSON.');err.diagnostic={category:'handoff_invalid_json',model};throw err;}
  const parsed=validateCommandBatch(json,catalog);return {...parsed,modelUsed:model,fallbackFrom:model!==selected?selected:null};
 }
 throw new Error('Gemini could not interpret the ChatGPT response.');
}
