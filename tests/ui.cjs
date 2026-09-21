const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');

(async()=>{
 const server=spawn('python3',['-m','http.server','8000','--directory','app/src/main/assets'],{stdio:'ignore'});
 let browser;
 try{
  for(let i=0;i<30;i++){try{await fetch('http://localhost:8000');break;}catch{await new Promise(r=>setTimeout(r,100));}}
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:412,height:915}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));

  let captured=null;
  await page.route('https://api.deepseek.com/chat/completions',async route=>{
   const request=route.request(),body=request.postDataJSON();
   assert.equal(request.headers().authorization,'Bearer test-deepseek-key');
   assert.equal(body.model,'deepseek-v4-pro');
   assert.equal(body.response_format.type,'json_object');
   assert.equal(body.thinking.type,'enabled');
   assert.equal(body.reasoning_effort,'high');
   assert.equal(body.messages[0].role,'system');
   captured=JSON.parse(body.messages[1].content);

   const lower=String(captured.request||'').toLowerCase();
   let data;
   if(lower.includes('30 minute')){
    const week=structuredClone(captured.currentWeek);
    week.days[0].enabled=true;
    week.days[0].minutes=30;
    week.days[0].plan={name:'DeepSeek Test',exercises:[
     {id:'Pushups',sets:4,reps:12,setReps:[12,12,12,12],weight:0,setWeights:[0,0,0,0],rest:75},
     {id:'Cable_Crossover',sets:4,reps:12,setReps:[12,12,12,12],weight:20,setWeights:[20,20,20,20],rest:90},
     {id:'Triceps_Pushdown_-_Rope_Attachment',sets:4,reps:12,setReps:[12,12,12,12],weight:30,setWeights:[30,30,30,30],rest:90}
    ]};
    data={reply:'I drafted a 30 minute Monday workout for review.',action:'proposal',week,profile:null,memory:'Prefers exact workout prescriptions and reviewed AI changes.'};
   }else{
    data={reply:'Your logged performance should guide progression.',action:'advice',week:null,profile:null,memory:'Use actual logged performance when progressing future sessions.'};
   }
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(data)}}]
   })});
  });

  await page.goto('http://localhost:8000');
  await page.waitForSelector('[data-select-day="mon"]');
  assert.match(await page.locator('.dashboard-coach-card').textContent(),/DeepSeek/i);

  // Android system-bar layout still stays above the 3-button navigation area.
  await page.evaluate(()=>{document.documentElement.style.setProperty('--system-bottom-inset','48px');document.documentElement.style.setProperty('--system-top-inset','28px');});
  const navBottom=await page.evaluate(()=>Math.round(innerHeight-document.querySelector('nav').getBoundingClientRect().bottom));
  assert.equal(navBottom,48);

  // Experimental settings expose DeepSeek model choice, API key, and Google sign-in.
  await page.locator('#settings').click();
  assert.match(await page.locator('#modalBody').textContent(),/Experimental DeepSeek unified build/);
  assert.deepEqual(await page.locator('#aiModel option').evaluateAll(opts=>opts.map(o=>o.value)),['deepseek-flash','deepseek-v4-pro']);
  assert.equal(await page.locator('#googleSignIn').isVisible(),true);
  await page.locator('#aiModel').selectOption('deepseek-v4-pro');
  await page.locator('#apiKey').fill('test-deepseek-key');
  await page.locator('#googleClientId').fill('123456789012-example.apps.googleusercontent.com');

  // Browser smoke test simulates the native Credential Manager callback.
  await page.evaluate(()=>window.onTrainerGoogleSignIn({uniqueId:'local-test',email:'trainer@example.com',name:'Trainer Test',picture:'',localProfileOnly:true}));
  assert.match(await page.locator('#googleAccountStatus').textContent(),/trainer@example.com/);
  await page.locator('#saveSettings').click();

  await page.locator('[data-tab="coach"]').click();
  assert.match(await page.locator('#coach').textContent(),/DeepSeek Coach/);
  assert.equal(await page.locator('#inlineChatSlot').isHidden(),true);
  assert.equal(await page.locator('#handoffPanel').isHidden(),true);

  // A normal coaching reply uses the same DeepSeek endpoint without changing planner data.
  await page.locator('#chatInput').fill('How should I progress from my logged workouts?');
  await page.locator('#send').click();
  await page.waitForFunction(()=>!document.querySelector('#send').disabled);
  assert.match(await page.locator('#messages').textContent(),/logged performance should guide progression/i);
  assert.ok(captured.currentWeek);
  assert.ok(Array.isArray(captured.recentTraining));
  assert.equal(captured.userProfile.goal,'General fitness');

  // The same DeepSeek response contract can produce executable app changes.
  await page.locator('#chatInput').fill('Make Monday a 30 minute workout');
  await page.locator('#send').click();
  await page.waitForFunction(()=>!document.querySelector('#send').disabled);
  await page.waitForSelector('#proposal:not([hidden])');
  assert.match(await page.locator('#proposalDetails').textContent(),/Monday/);
  assert.match(await page.locator('#proposalDetails').textContent(),/DeepSeek Test/);
  await page.locator('#applyProposal').click();
  assert.equal(await page.locator('#workout').isVisible(),true);
  assert.equal(await page.locator('#planName').textContent(),'DeepSeek Test');

  // Settings persist the selected model and local Google profile, but never the API key in localStorage.
  await page.locator('#settings').click();
  assert.equal(await page.locator('#aiModel').inputValue(),'deepseek-v4-pro');
  assert.match(await page.locator('#googleAccountStatus').textContent(),/trainer@example.com/);
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage}).includes('test-deepseek-key')),false);
  await page.locator('#closeModal').click();

  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'trainer-preview.png',fullPage:true});
  console.log('DeepSeek unified coach, executable workout draft, model selection, Google profile sign-in callback, and Android inset smoke tests passed.');
 }finally{
  await browser?.close();
  server.kill();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
