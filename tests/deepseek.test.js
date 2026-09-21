import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {askDeepSeek,buildRequest,parseResponse,MODELS,DEFAULT_MODEL,DEEPSEEK_URL,diagnoseWeek} from '../app/src/main/assets/deepseek.js';
import {makeWeek} from '../app/src/main/assets/week.js';

const catalog=JSON.parse(readFileSync(new URL('../app/src/main/assets/catalog.json',import.meta.url)));
const profile={goal:'Strength',experience:'Intermediate',equipment:'Functional trainer and adjustable dumbbells',heightIn:70,weightLb:180};
const input={message:'Change Monday reps',week:makeWeek(),selectedDay:'mon',profile,memory:'Prefers controlled progression.',model:DEFAULT_MODEL,preferences:[],recentTraining:[]};

function proposalWeek(){
 const w=makeWeek();
 w.days[0].minutes=20;
 w.days[0].plan.exercises[0].setReps=[10,8,8];
 w.days[0].plan.exercises[0].reps=10;
 return w;
}
function provider(value,finish='stop'){
 return {choices:[{finish_reason:finish,message:{role:'assistant',content:JSON.stringify(value)}}]};
}

test('DeepSeek request uses current model, JSON output, thinking and app context',()=>{
 const body=buildRequest({...input,model:'deepseek-v4-pro'},catalog);
 assert.equal(body.model,'deepseek-v4-pro');
 assert.equal(body.response_format.type,'json_object');
 assert.equal(body.thinking.type,'enabled');
 assert.equal(body.reasoning_effort,'high');
 assert.equal(body.messages[0].role,'system');
 assert.match(body.messages[0].content,/single AI engine/);
 const context=JSON.parse(body.messages[1].content);
 assert.equal(context.userProfile.heightIn,70);
 assert.equal(context.currentWeek.days.length,7);
 assert.equal(context.selectedDay,'mon');
});

test('DeepSeek browser fallback uses Bearer auth and parses a proposal',async()=>{
 const value={reply:'Draft ready.',action:'proposal',week:proposalWeek(),profile:null,memory:'Keep exact logged performance.'};
 const data=await askDeepSeek(input,catalog,'private-key',async(url,opts)=>{
  assert.equal(url,DEEPSEEK_URL);
  assert.equal(opts.headers.Authorization,'Bearer private-key');
  assert.equal((url+opts.body).includes('private-key'),false);
  assert.equal(opts.redirect,'error');
  return {ok:true,status:200,json:async()=>provider(value)};
 });
 assert.equal(data.action,'proposal');
 assert.equal(data.week.days.length,7);
 assert.match(data.memory,/logged performance/);
});

test('Advice cannot mutate planner even if provider includes a week',()=>{
 const answer=parseResponse(provider({reply:'Advice only.',action:'advice',week:proposalWeek(),profile,memory:'Keep this.'}),catalog,input.week,profile);
 assert.equal(answer.week,null);
 assert.equal(answer.profile,null);
 assert.equal(answer.memory,'Keep this.');
});

test('Invalid exercise IDs are rejected as non-executable',()=>{
 const w=proposalWeek();
 w.days[0].plan.exercises[0].id='invented';
 const parsed=parseResponse(provider({reply:'Draft.',action:'proposal',week:w,profile:null,memory:''}),catalog,input.week,profile);
 assert.equal(parsed.action,'advice');
 assert.equal(parsed.week,null);
 assert.equal(parsed.diagnostic.category,'proposal_validation');
 assert.ok(diagnoseWeek(w,catalog).some(x=>/unsupported exercise id/.test(x)));
});

test('DeepSeek model list matches experimental Settings choices',()=>{
 assert.deepEqual(MODELS.map(m=>m.id),['deepseek-flash','deepseek-v4-pro']);
 assert.equal(DEFAULT_MODEL,'deepseek-flash');
});

test('API key is required before a network request',async()=>{
 await assert.rejects(askDeepSeek(input,catalog,'',()=>assert.fail('Must not fetch')),/API key/);
});

test('DeepSeek HTTP errors have useful messages',async()=>{
 for(const [status,pattern] of [[401,/API key/],[403,/API key/],[429,/usage limit/],[404,/model is unavailable/],[500,/temporarily unavailable/]]){
  await assert.rejects(
   askDeepSeek(input,catalog,'key',async()=>({ok:false,status,json:async()=>({error:{message:'provider detail'}})})),
   pattern
  );
 }
});

test('Incomplete provider response is rejected without executable changes',()=>{
 assert.throws(()=>parseResponse(provider({reply:'Draft.',action:'proposal',week:proposalWeek(),profile:null,memory:''},'length'),catalog,input.week,profile),/incomplete/);
});
