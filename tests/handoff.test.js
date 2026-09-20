import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeWeek,weekKey} from '../app/src/main/assets/week.js';
import {summarizeHistory} from '../app/src/main/assets/training.js';
import {buildChatGPTContext,buildInterpreterRequest,validateCommandBatch,applyCommandBatch,interpretChatGPTResponse} from '../app/src/main/assets/handoff.js';

const catalog=JSON.parse(readFileSync(new URL('../app/src/main/assets/catalog.json',import.meta.url)));
const profile={goal:'Strength',experience:'Intermediate',equipment:'Functional trainer',heightIn:70,weightLb:180};
const week=makeWeek();
const response=value=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});

test('ChatGPT context contains current plan and logged set performance without app commands',()=>{
 const p=structuredClone(week.days[0].plan);p.exercises[0].done=2;p.exercises[0].setReps=[12,9,8];
 const recent=summarizeHistory([{date:'2026-09-20T10:00:00Z',day:'mon',plan:p}],catalog,20);
 const text=buildChatGPTContext({week,profile,memory:'Prefer controlled reps.',recentTraining:recent},catalog);
 assert.match(text,/regular ChatGPT/);assert.match(text,/CURRENT WEEK/);assert.match(text,/S2 9 reps/);assert.match(text,/APP EXERCISE CATALOG/);assert.doesNotMatch(text,/Return only JSON/);
});

test('interpreter request makes Gemini a translator rather than a coach',()=>{
 const body=buildInterpreterRequest({sourceText:'ChatGPT says make Monday push for about an hour.',week,profile,memory:'',selectedDay:'mon'},catalog);
 const system=body.systemInstruction.parts[0].text;
 assert.match(system,/deterministic command translator/);assert.match(system,/NOT the coach/);assert.match(system,/Do not repeat the entire week/);
 const payload=JSON.parse(body.contents[0].parts[0].text);assert.match(payload.chatgptResponse,/Monday push/);
});

test('validated handoff commands change only requested trainer data',()=>{
 const before=weekKey(week),tuesday=JSON.stringify(week.days[1]);
 const batch=validateCommandBatch({summary:'Use a revised push day.',warnings:[],commands:[
  {type:'set_day',day:'mon',enabled:true,minutes:60},
  {type:'replace_plan',day:'mon',name:'ChatGPT Push',exercises:[
   {id:'Dumbbell_Bench_Press',sets:3,reps:10,setReps:[10,9,8],weight:0,setWeights:[0,0,0],rest:120},
   {id:'Cable_Crossover',sets:3,reps:12,setReps:[12,12,10],weight:0,setWeights:[0,0,0],rest:90}
  ]},
  {type:'set_memory',text:'ChatGPT prefers controlled progression.'}
 ]},catalog);
 const applied=applyCommandBatch(batch,{week,profile,memory:''},catalog);
 assert.notEqual(weekKey(applied.week),before);assert.equal(JSON.stringify(applied.week.days[1]),tuesday);assert.equal(applied.week.days[0].minutes,60);assert.equal(applied.week.days[0].plan.name,'ChatGPT Push');assert.equal(applied.week.days[0].plan.exercises.length,2);assert.match(applied.memory,/controlled progression/);
});

test('unsupported exercise IDs and malformed commands never execute',()=>{
 assert.throws(()=>validateCommandBatch({summary:'bad',commands:[{type:'replace_plan',day:'mon',name:'Bad',exercises:[{id:'invented',sets:3,reps:10,rest:90,weight:0}]}]},catalog),/invalid or unsupported/);
 assert.throws(()=>validateCommandBatch({summary:'bad',commands:[{type:'delete_everything'}]},catalog),/Unsupported command/);
});

test('interpreter falls back on 503 and returns a validated command batch',async()=>{
 const seen=[];
 const batch=await interpretChatGPTResponse({sourceText:'Make Monday about 60 minutes.',week,profile,memory:'',selectedDay:'mon',model:'gemini-3.8-flash'},catalog,'key',async url=>{
  seen.push(url);
  if(url.includes('gemini-3.8-flash'))return {ok:false,status:503,json:async()=>({error:{status:'UNAVAILABLE',message:'busy'}})};
  return {ok:true,json:async()=>response({summary:'Change Monday time.',warnings:[],commands:[{type:'set_day',day:'mon',enabled:true,minutes:60}]})};
 });
 assert.equal(seen.length,2);assert.equal(batch.commands[0].minutes,60);assert.equal(batch.fallbackFrom,'gemini-3.8-flash');assert.equal(batch.modelUsed,'gemini-3.7-flash');
});
