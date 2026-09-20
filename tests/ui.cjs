const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
(async()=>{
 const server=spawn('python3',['-m','http.server','8000','--directory','app/src/main/assets'],{stdio:'ignore'});
 let browser;
 try{
  for(let i=0;i<30;i++){try{await fetch('http://localhost:8000');break;}catch{await new Promise(r=>setTimeout(r,100));}}
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:412,height:915}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:8000');await page.waitForSelector('[data-select-day="mon"]');await page.locator('[data-select-day="mon"]').click();

  // Per-set logging: later sets can differ and survive reload.
  const setRep=n=>page.locator('[data-index="0"][data-set-index="'+n+'"][data-set-field="reps"]');
  assert.equal(await setRep(0).inputValue(),'12');await setRep(1).fill('9');await setRep(1).press('Tab');assert.equal(await setRep(0).inputValue(),'12');assert.equal(await setRep(1).inputValue(),'9');
  await page.locator('[data-set="0"][data-n="0"]').click();await page.locator('[data-set="0"][data-n="1"]').click();await page.waitForSelector('#timer:not([hidden])');
  await page.reload();await page.waitForSelector('[data-set="0"][data-n="1"].done');await page.locator('[data-select-day="mon"]').click();assert.equal(await setRep(1).inputValue(),'9');
  await page.locator('#finish').click();await page.locator('[data-tab="history"]').click();assert.match(await page.locator('#historyList').textContent(),/S1: 12 reps/);assert.match(await page.locator('#historyList').textContent(),/S2: 9 reps/);

  // Set a 60-minute Monday and body/profile context.
  await page.locator('[data-tab="workout"]').click();await page.locator('#editWeek').click();assert.equal(await page.locator('[data-count]').count(),0);assert.match(await page.locator('#modalBody').textContent(),/Exercise count is intentionally flexible/);await page.locator('[data-minutes="mon"]').fill('60');await page.locator('#saveWeek').click();assert.match(await page.locator('#sessionLabel').textContent(),/60 MIN/);
  await page.locator('[data-tab="profilePage"]').click();await page.locator('#profileGoal').selectOption('Strength');await page.locator('#profileExperience').selectOption('Intermediate');await page.locator('#profileEquipment').fill('Bodyweight, functional trainer, adjustable dumbbells');await page.locator('#heightFeet').fill('5');await page.locator('#heightInches').fill('10');await page.locator('#weightLb').fill('180');await page.locator('#saveProfilePage').click();
  await page.locator('#settings').click();await page.locator('#geminiModel').selectOption('gemini-3.7-flash');await page.locator('#apiKey').fill('test-gemini-key');await page.locator('#saveSettings').click();

  let captured=null;
  await page.route('https://generativelanguage.googleapis.com/**',async route=>{
   const body=route.request().postDataJSON();captured=JSON.parse(body.contents[0].parts[0].text);assert.equal(route.request().headers()['x-goog-api-key'],'test-gemini-key');assert.match(route.request().url(),/gemini-3\.7-flash:generateContent/);assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'high');
   const request=captured.request.toLowerCase();let data;
   if(request.includes('invalid plan')){const week=structuredClone(captured.currentWeek);week.days[0].plan.exercises[0].id='invented-exercise';data={reply:'I drafted it.',action:'proposal',week,profile:null,memory:captured.coachMemory||''};}
   else if(request.includes('bodyweight')){
    const week=structuredClone(captured.currentWeek);week.days[0].minutes=60;week.days[0].plan={name:'Bodyweight 60',exercises:[
     {id:'Pushups',sets:3,reps:12,rest:75,weight:0,setReps:[12,10,8],setWeights:[0,0,0]},
     {id:'Bodyweight_Squat',sets:3,reps:15,rest:75,weight:0,setReps:[15,12,10],setWeights:[0,0,0]}
    ]};
    data={reply:'I drafted a bodyweight-only 60 minute session.',action:'proposal',week,profile:null,memory:'Prefers workouts that actually fill the requested time and may reduce reps in later sets.'};
   }else if(request.includes('175')){
    data={reply:'I drafted your updated body weight.',action:'proposal',week:null,profile:{...captured.userProfile,weightLb:175},memory:'Current reported body weight is 175 lb. Prefers accurate time-filled workouts.'};
   }else{
    data={reply:'Your later-set drop is useful progression context.',action:'advice',week:null,profile:null,memory:'Often reduces reps in later sets; use logged set performance when progressing future sessions.'};
   }
   await route.fulfill({json:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(data)}]}}]}});
  });
  const chat=async text=>{await page.locator('[data-tab="coach"]').click();await page.locator('#chatInput').fill(text);await page.locator('#send').click();await page.waitForFunction(()=>!document.querySelector('#send').disabled);};

  await chat('What did you learn from my last workout?');assert.ok(captured.recentTraining.length>0);assert.equal(captured.recentTraining[0].exercises[0].sets[1].reps,9);assert.equal(captured.userProfile.heightIn,70);
  await chat('Make Monday a 60 minute bodyweight-only workout');await page.waitForSelector('#proposal:not([hidden])');const proposalText=await page.locator('#proposalDetails').textContent(),proposalMinutes=Number(proposalText.match(/Estimated session: ~(\d+) min/)?.[1]);assert.ok(proposalMinutes>=60);assert.match(await page.locator('[data-tab="coach"]').textContent(),/Draft/);
  await page.locator('#applyProposal').click();assert.equal(await page.locator('#workout').isVisible(),true);const exerciseCount=await page.locator('#exercises .card').count();assert.ok(exerciseCount>=2&&exerciseCount<=12);const summaryText=await page.locator('#summary').textContent(),summaryMinutes=Number(summaryText.match(/~(\d+) min estimated/)?.[1]);assert.ok(summaryMinutes>=60);const tags=await page.locator('#exercises .tag').allTextContents();assert.ok(tags.every(t=>/body only/i.test(t)));

  await chat('Update my saved body weight to 175 lb');await page.waitForSelector('#proposal:not([hidden])');assert.match(await page.locator('#proposalDetails').textContent(),/180 → 175 lb/);await page.locator('#applyProposal').click();assert.equal(await page.locator('#profilePage').isVisible(),true);assert.equal(await page.locator('#weightLb').inputValue(),'175');
  await chat('Make an invalid plan for testing');assert.match(await page.locator('#messages').textContent(),/error report was saved/i);
  await page.locator('#settings').click();assert.equal(await page.locator('#geminiModel').inputValue(),'gemini-3.7-flash');assert.match(await page.locator('#viewErrorReports').textContent(),/Error reports \(1\)/);await page.locator('#viewErrorReports').click();const report=await page.locator('#errorReportText').inputValue();assert.match(report,/proposal_validation/);assert.match(report,/unsupported exercise id invented-exercise/);assert.match(report,/gemini-3.7-flash/);assert.equal(report.includes('test-gemini-key'),false);await page.locator('#closeModal').click();

  // Starting a new visible conversation keeps long-term coach memory.
  await page.locator('[data-tab="coach"]').click();await page.locator('#clearChat').click();await page.locator('#confirmClearChat').click();await page.locator('[data-tab="profilePage"]').click();assert.match(await page.locator('#coachMemory').inputValue(),/175 lb/);
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('test-gemini-key')),false);

  await page.locator('[data-tab="workout"]').click();await page.locator('[data-select-day="sun"]').click();assert.equal(await page.locator('#trainingDetails').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);await page.screenshot({path:'trainer-preview.png',fullPage:true});
  console.log('Per-set logging, flexible exercise counts, model selection, error diagnostics, adaptive history, flexible time planning, body profile and coach memory tests passed.');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
