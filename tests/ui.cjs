const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
(async()=>{
 const server=spawn('python3',['-m','http.server','8000','--directory','app/src/main/assets'],{stdio:'ignore'});
 let browser;
 try {
  for(let i=0;i<30;i++){try{await fetch('http://localhost:8000');break;}catch{await new Promise(r=>setTimeout(r,100));}}
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:412,height:915}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:8000');await page.waitForSelector('[data-select-day="mon"]');await page.locator('[data-select-day="mon"]').click();
  await page.locator('[data-set="0"][data-n="0"]').click();await page.waitForSelector('#timer:not([hidden])');
  await page.reload();await page.waitForSelector('.set-button.done');await page.locator('#pause').click();assert.equal(await page.locator('#pause').textContent(),'Resume');
  await page.locator('#finish').click();await page.locator('[data-tab="history"]').click();assert.match(await page.locator('#historyList').textContent(),/1 sets completed/);await page.locator('[data-tab="workout"]').click();
  await page.locator('#editWeek').click();await page.locator('#dayCount').selectOption('4');await page.locator('[data-minutes="mon"]').fill('30');await page.locator('[data-count="mon"]').fill('3');await page.locator('#saveWeek').click();
  assert.match(await page.locator('#weekSummary').textContent(),/4 training days/);assert.match(await page.locator('#summary').textContent(),/3 exercises/);assert.match(await page.locator('#sessionLabel').textContent(),/30 MIN/);
  await page.reload();await page.waitForSelector('[data-select-day="mon"]');assert.match(await page.locator('#weekSummary').textContent(),/4 training days/);
  const setKey=async()=>{await page.locator('#settings').click();await page.locator('#apiKey').fill('test-gemini-key');await page.locator('#saveSettings').click();};await setKey();
  let responseMode='advice';let captured;
  await page.route('https://generativelanguage.googleapis.com/**',async route=>{
   const body=route.request().postDataJSON();captured=JSON.parse(body.contents[0].parts[0].text);assert.equal(route.request().headers()['x-goog-api-key'],'test-gemini-key');
   let data={reply:'You can progress gradually and allow recovery between hard sessions.',action:'advice',week:null};
   if(responseMode==='draft'){const week=structuredClone(captured.currentWeek);week.days[0].plan.exercises[0].reps=10;week.days[2].minutes=25;data={reply:'Here is a proposed week. Please review it.',action:'proposal',week};}
   if(responseMode==='refine'){assert.equal(captured.draftWeek.days[0].plan.exercises[0].reps,10);const week=structuredClone(captured.draftWeek);week.days[0].plan.exercises[0].reps=8;data={reply:'Here is a refined draft with 8 reps.',action:'proposal',week};}
   if(responseMode==='unchanged')data={reply:'The schedule already matches.',action:'proposal',week:captured.currentWeek};
   if(responseMode==='quota'){await route.fulfill({status:429,json:{error:{message:'private'}}});return;}
   await route.fulfill({json:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(data)}]}}]}});
  });
  const chat=async(text)=>{await page.locator('[data-tab="coach"]').click();await page.locator('#chatInput').fill(text);await page.locator('#send').click();await page.waitForFunction(()=>!document.querySelector('#send').disabled);};
  const reps=()=>page.locator('[data-index="0"][data-field="reps"]').inputValue();
  await chat('How should I progress?');assert.equal(await page.locator('#proposal').isVisible(),false);
  await page.locator('[data-tab="workout"]').click();assert.equal(await reps(),'12');
  responseMode='draft';await chat('Change Monday reps to 10 and Wednesday time to 25 minutes');await page.waitForSelector('#proposal:not([hidden])');assert.match(await page.locator('#proposalDetails').textContent(),/12 → 10 reps/);
  await page.locator('[data-tab="workout"]').click();assert.equal(await reps(),'12');
  responseMode='refine';await chat('Make the draft 8 reps instead');assert.match(await page.locator('#proposalDetails').textContent(),/12 → 8 reps/);assert.ok(captured.recentConversation.some(m=>m.content==='How should I progress?'));
  await page.reload();await page.waitForSelector('[data-select-day]');await page.locator('[data-tab="coach"]').click();assert.match(await page.locator('#messages').textContent(),/refined draft/);assert.equal(await page.locator('#proposal').isVisible(),true);
  await page.locator('#applyProposal').click();assert.equal(await page.locator('#workout').isVisible(),true);assert.equal(await reps(),'8');assert.match(await page.locator('#updateNotice').textContent(),/Monday, Wednesday/);
  await page.locator('[data-select-day="wed"]').click();assert.match(await page.locator('#sessionLabel').textContent(),/25 MIN/);
  await page.reload();await page.waitForSelector('[data-select-day]');await page.locator('[data-select-day="mon"]').click();assert.equal(await reps(),'8');await setKey();
  responseMode='draft';await chat('Try 10 again');await page.locator('#applyProposal').click();assert.equal(await reps(),'10');await page.locator('#undo').click();assert.equal(await reps(),'8');
  responseMode='unchanged';await chat('Keep the current schedule');assert.match(await page.locator('#messages').textContent(),/No actual schedule changes/);assert.equal(await page.locator('#proposal').isVisible(),false);
  responseMode='draft';await chat('Try another draft');await page.locator('[data-tab="workout"]').click();await page.locator('[data-index="0"][data-field="reps"]').fill('7');await page.locator('[data-index="0"][data-field="reps"]').press('Tab');await page.locator('[data-tab="coach"]').click();assert.equal(await page.locator('#applyProposal').isDisabled(),true);
  responseMode='quota';await chat('Refine it');assert.match(await page.locator('#messages').textContent(),/usage limit reached/);assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('test-gemini-key')),false);
  await page.locator('#clearChat').click();await page.locator('#confirmClearChat').click();assert.equal(await page.locator('#proposal').isVisible(),false);
  await page.locator('#settings').click();await page.locator('#clearKey').click();assert.match(await page.locator('#connection').textContent(),/Add your Gemini API key/);
  await page.locator('[data-tab="workout"]').click();await page.locator('[data-select-day="sun"]').click();assert.equal(await page.locator('#trainingDetails').isVisible(),false);
  await page.locator('[data-select-day="mon"]').click();assert.equal(await reps(),'7');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);await page.screenshot({path:'trainer-preview.png',fullPage:true});console.log('Weekly planner, conversational coach, refinement, apply/undo, no-op, stale draft and persistence tests passed.');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
