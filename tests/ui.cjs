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
  await page.goto('http://localhost:8000');await page.waitForSelector('[data-select-day="mon"]');
  // Simulate a phone using Android 3-button navigation plus a status bar.
  await page.evaluate(()=>{document.documentElement.style.setProperty('--system-bottom-inset','48px');document.documentElement.style.setProperty('--system-top-inset','28px');});
  const insetLayout=await page.evaluate(()=>{const nav=document.querySelector('nav'),header=document.querySelector('header'),main=document.querySelector('main'),n=nav.getBoundingClientRect(),csNav=getComputedStyle(nav),csHeader=getComputedStyle(header),csMain=getComputedStyle(main);return {navBottom:Math.round(innerHeight-n.bottom),navCssBottom:csNav.bottom,headerPaddingTop:Math.round(parseFloat(csHeader.paddingTop)),mainPaddingBottom:Math.round(parseFloat(csMain.paddingBottom))};});
  assert.equal(insetLayout.navBottom,48);assert.equal(insetLayout.navCssBottom,'48px');assert.equal(insetLayout.headerPaddingTop,50);assert.ok(insetLayout.mainPaddingBottom>=258);
  await page.locator('[data-select-day="mon"]').click();
  assert.ok(await page.locator('.muscle-picture').first().isVisible());assert.match(await page.locator('.muscle-picture img').first().getAttribute('src'),/api\.anatome\.dev\/generateImage/);
  await page.route('https://api.anatome.dev/**',route=>{
   const url=route.request().url();
   if(url.includes('/getExercise'))return route.fulfill({json:{name:'Dumbbell Bench Press',anatome_primary_slugs:['chest'],anatome_secondary_slugs:['triceps','deltoids'],primaryMuscles:['chest'],secondaryMuscles:['triceps','shoulders']}});
   if(url.includes('/generateImage'))return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#eee"/><rect x="35" y="45" width="50" height="25" fill="#dc2626"/></svg>'});
   return route.abort();
  });
  await page.route('https://wger.de/api/v2/exerciseinfo/**',route=>route.fulfill({json:{results:[{translations:[{name:'Dumbbell Bench Press',aliases:[]}],videos:[{video:'https://wger.de/media/demo.mp4',is_main:true,license_author:'Open demo author',license_title:'CC BY-SA'}]}]}}));
  await page.route('https://wger.de/media/**',route=>route.abort());
  await page.locator('[data-demo="Dumbbell_Bench_Press"]').first().click();await page.waitForSelector('#demoVideo');assert.equal(await page.locator('.muscle-picture.large').isVisible(),true);assert.match(await page.locator('#anatomyDetail').textContent(),/Primary: Chest/);assert.match(await page.locator('#anatomyDetail').textContent(),/Secondary: Triceps, Shoulders/);assert.match(await page.evaluate(()=>localStorage.getItem('demoMetaCache')||''),/anatome_secondary_slugs/);await page.locator('#closeModalTop').click();

  // Each exercise card can collapse from its dropdown button and keeps that state across rerenders/reload.
  let collapseButton=page.locator('[data-collapse="0"]');
  assert.equal(await collapseButton.getAttribute('aria-expanded'),'true');
  await collapseButton.click();
  assert.equal(await collapseButton.getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('.exercise-card-body').first().isHidden(),true);
  await page.reload();await page.locator('[data-select-day="mon"]').click();
  collapseButton=page.locator('[data-collapse="0"]');
  assert.equal(await collapseButton.getAttribute('aria-expanded'),'false');
  await collapseButton.click();
  assert.equal(await collapseButton.getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('.exercise-card-body').first().isVisible(),true);

  // Persistent per-exercise setup notes survive rerenders and are shown on the card.
  await page.locator('[data-setup-note="0"]').click();await page.locator('#setupNoteText').fill('Bench notch 3 · pulley at shoulder height');await page.locator('#saveSetupNote').click();assert.match(await page.locator('.exercise-setup-note').first().textContent(),/Bench notch 3/);
  await page.reload();await page.locator('[data-select-day="mon"]').click();assert.match(await page.locator('.exercise-setup-note').first().textContent(),/Bench notch 3/);

  // Per-set logging: later sets can differ and survive reload.
  const setRep=n=>page.locator('[data-index="0"][data-set-index="'+n+'"][data-set-field="reps"]');
  assert.equal(await setRep(0).inputValue(),'12');await setRep(1).fill('9');await setRep(1).press('Tab');assert.equal(await setRep(0).inputValue(),'12');assert.equal(await setRep(1).inputValue(),'9');
  await page.locator('[data-set="0"][data-n="0"]').click();await page.locator('[data-set="0"][data-n="1"]').click();await page.waitForSelector('#timer:not([hidden])');
  await page.reload();await page.waitForSelector('[data-set="0"][data-n="1"].done');await page.locator('[data-select-day="mon"]').click();assert.equal(await setRep(1).inputValue(),'9');
  await page.locator('[data-select-day="wed"]').click();assert.match(await page.locator('#timerLabel').textContent(),/Monday/);await page.locator('#pause').click();await page.reload();await page.waitForSelector('#pause');assert.equal(await page.locator('#pause').textContent(),'Resume');assert.match(await page.locator('#timerLabel').textContent(),/Monday/);await page.locator('[data-select-day="mon"]').click();
  await page.locator('[data-set="0"][data-n="2"]').click();await page.waitForSelector('[data-rir="0"]');await page.locator('#exerciseNote').fill('Last reps were hard');await page.locator('[data-rir="0"]').click();await page.locator('[data-effort="too_hard"]').click();await page.locator('[data-form="breaking"]').click();await page.locator('#saveFeedback').click();
  assert.match(await page.locator('[data-feedback="0"]').textContent(),/RIR 0/);
  assert.match(await page.locator('[data-feedback="0"]').textContent(),/too hard/);
  await page.locator('#finish').click();assert.match(await page.locator('#modalBody').textContent(),/Session complete/);assert.match(await page.locator('#modalBody').textContent(),/2\/3/);await page.locator('#closeModalTop').click();
  assert.match(await page.locator('.last-performance').first().textContent(),/S2 9 BW/);assert.match(await page.locator('.last-performance').first().textContent(),/RIR 0/);
  await page.locator('[data-tab="history"]').click();assert.match(await page.locator('#historyList').textContent(),/S1 12→12 BW/);assert.match(await page.locator('#historyList').textContent(),/S2 12→9 BW/);assert.match(await page.locator('#historyList').textContent(),/Last reps were hard/);assert.match(await page.locator('#historyList').textContent(),/form breaking/);assert.match(await page.locator('#progressCharts').textContent(),/Reps · target vs actual/);
  assert.equal(await page.locator('#calendarGrid .logged').count(),1);assert.equal(await page.locator('#weeklyReview').isVisible(),true);assert.equal(await page.locator('#muscleProgressCard').isVisible(),true);assert.ok((await page.locator('#muscleProgressList').textContent()).length>0);

  // Set a 60-minute Monday and body/profile context.
  await page.locator('[data-tab="workout"]').click();await page.locator('#editWeek').click();assert.equal(await page.locator('[data-count]').count(),0);assert.match(await page.locator('#modalBody').textContent(),/Choose training days and approximate minutes/);await page.locator('[data-minutes="mon"]').fill('60');await page.locator('#saveWeek').click();assert.match(await page.locator('#sessionLabel').textContent(),/60 MIN/);
  await page.locator('[data-tab="profilePage"]').click();await page.locator('#profileGoal').selectOption('Strength');await page.locator('#profileExperience').selectOption('Intermediate');await page.locator('#profileEquipment').fill('Bodyweight, functional trainer, adjustable dumbbells');await page.locator('#heightFeet').fill('5');await page.locator('#heightInches').fill('10');await page.locator('#weightLb').fill('180');await page.locator('#saveProfilePage').click();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');await page.locator('#settings').click();assert.equal(await page.locator('#appTheme').inputValue(),'dark');await page.locator('#appTheme').selectOption('light');assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');await page.locator('#appTheme').selectOption('dark');assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');await page.locator('#geminiModel').selectOption('gemini-3.7-flash');await page.locator('#apiKey').fill('test-gemini-key');await page.locator('#saveSettings').click();

  let captured=null,capturedHandoff=null;
  await page.route('https://generativelanguage.googleapis.com/**',async route=>{
   const body=route.request().postDataJSON(),system=body.systemInstruction.parts[0].text;assert.equal(route.request().headers()['x-goog-api-key'],'test-gemini-key');assert.match(route.request().url(),/gemini-3\.7-flash:generateContent/);if(system.includes('deterministic command translator'))assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'low');
   if(system.includes('deterministic command translator')){
    capturedHandoff=JSON.parse(body.contents[0].parts[0].text);
    const full=/Friday Legs/i.test(capturedHandoff.chatgptResponse);
    const data=full?{summary:'Apply complete ChatGPT PPL plan.',warnings:[],commands:[
     {type:'replace_plan',day:'mon',name:'Push',exercises:[
      {name:'Cable Chest Press',sets:4,reps:10,weight:60,rest:120},{name:'Incline DB Press',sets:3,reps:10,weight:25,rest:90},
      {name:'Cable Fly',sets:3,reps:12,weight:30,rest:75},{name:'DB Lateral Raise',sets:3,reps:12,weight:10,rest:60},{name:'Triceps Pushdown',sets:3,reps:12,weight:50,rest:75}
     ]},
     {type:'replace_plan',day:'wed',name:'Pull',exercises:[
      {name:'Lat Pulldown',sets:4,reps:10,weight:70,rest:120},{name:'Seated Row',sets:3,reps:10,weight:70,rest:90},
      {name:'Rear-Delt Fly',sets:3,reps:12,weight:20,rest:75},{name:'Face Pull',sets:3,reps:12,weight:40,rest:75},{name:'DB Curl',sets:3,reps:10,weight:20,rest:75}
     ]},
     {type:'replace_plan',day:'fri',name:'Legs',exercises:[
      {name:'Cable Squat',sets:4,reps:10,weight:80,rest:120},{name:'Cable RDL',sets:3,reps:10,weight:70,rest:120},
      {name:'Bulgarian Split Squat',sets:3,reps:10,weight:20,rest:90},{name:'Cable Leg Curl',sets:3,reps:12,weight:40,rest:75},{name:'DB Calf Raise',sets:3,reps:15,weight:30,rest:60}
     ]}
    ]}:{summary:'Apply ChatGPT push-day changes.',warnings:[],commands:[
     {type:'set_day',day:'mon',enabled:true,minutes:60},
     {type:'replace_plan',day:'mon',name:'ChatGPT Push',exercises:[
      {id:'Dumbbell_Bench_Press',sets:3,reps:10,setReps:[10,9,8],weight:0,setWeights:[0,0,0],rest:120},
      {id:'Cable_Crossover',sets:3,reps:12,setReps:[12,12,10],weight:0,setWeights:[0,0,0],rest:90}
     ]}
    ]};
    await route.fulfill({json:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(data)}]}}]}});return;
   }
   captured=JSON.parse(body.contents[0].parts[0].text);
   const request=captured.request.toLowerCase();let data;
   if(request.includes('next week')){const week=structuredClone(captured.currentWeek);week.days[0].plan={name:'Next Week Progression',exercises:[
     {id:'Dumbbell_Bench_Press',sets:6,reps:10,setReps:[10,10,10,10,10,10],weight:0,setWeights:[0,0,0,0,0,0],rest:120},
     {id:'Cable_Crossover',sets:6,reps:12,setReps:[12,12,12,12,12,12],weight:0,setWeights:[0,0,0,0,0,0],rest:90},
     {id:'Triceps_Pushdown_-_Rope_Attachment',sets:6,reps:12,setReps:[12,12,12,12,12,12],weight:0,setWeights:[0,0,0,0,0,0],rest:90},
     {id:'Pushups',sets:6,reps:12,setReps:[12,12,12,12,12,12],weight:0,setWeights:[0,0,0,0,0,0],rest:75},
     {id:'Bodyweight_Squat',sets:6,reps:15,setReps:[15,15,15,15,15,15],weight:0,setWeights:[0,0,0,0,0,0],rest:75}
    ]};data={reply:'Next week is based on your logged set performance.',action:'proposal',week,profile:null,memory:'Use logged set performance for conservative weekly progression.'};}
   else if(request.includes('invalid plan')){const week=structuredClone(captured.currentWeek);week.days[0].plan.exercises[0].id='invented-exercise';data={reply:'I drafted it.',action:'proposal',week,profile:null,memory:captured.coachMemory||''};}
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
  // ChatGPT handoff: Android share/paste text -> Gemini command translation -> local review/apply.
  await page.locator('[data-tab="coach"]').click();assert.match(await page.locator('#coach').textContent(),/ChatGPT Coach/);assert.equal(await page.locator('#openChatGPT').count(),0);assert.equal(await page.locator('#inlineChatSlot').isVisible(),true);
  await page.evaluate(()=>window.receiveTrainerShare('ChatGPT recommends a revised Monday Push workout for about one hour, warm-up excluded.'));
  assert.match(await page.locator('#handoffText').inputValue(),/revised Monday Push/);assert.equal(await page.locator('#handoffPanel').evaluate(el=>el.open),true);
  await page.locator('#interpretHandoff').click();await page.waitForSelector('#handoffPreview:not([hidden])');assert.match(await page.locator('#handoffCommands').textContent(),/ChatGPT Push/);assert.match(await page.locator('#handoffCommands').textContent(),/Dumbbell Bench Press 3 sets · reps 10\/9\/8/);assert.match(capturedHandoff.chatgptResponse,/revised Monday Push/);
  await page.locator('#applyHandoff').click();assert.equal(await page.locator('#workout').isVisible(),true);assert.equal(await page.locator('#planName').textContent(),'ChatGPT Push');assert.equal(await page.locator('#exercises .card').count(),2);
  await page.locator('[data-tab="coach"]').click();assert.equal(await page.locator('#restoreLastHandoff').isVisible(),true);assert.match(await page.locator('#lastHandoffStatus').textContent(),/Last translation/);
  await page.locator('#restoreLastHandoff').click();assert.equal(await page.locator('#handoffPreview').isVisible(),true);assert.match(await page.locator('#handoffCommands').textContent(),/ChatGPT Push/);
  await page.locator('#discardHandoff').click();assert.equal(await page.locator('#restoreLastHandoff').isVisible(),true);
  await page.locator('[data-tab="workout"]').click();
  await page.locator('#refreshNextWeek').click();await page.waitForFunction(()=>document.querySelector('#nextWeekStatus').textContent.includes('Ready'));assert.match(await page.locator('#nextWeekDays').textContent(),/Next Week Progression/);assert.equal(await page.locator('#viewNextWeek').isVisible(),true);
  await page.locator('#viewNextWeek').click();assert.equal(await page.locator('#closeModalTop').isVisible(),true);assert.match(await page.locator('#modalBody').textContent(),/Next Week Progression/);await page.locator('#closeModalTop').click();

  // Regression for a real compact ChatGPT PPL response: all 15 strength exercises must survive translation.
  const fullPpl='Monday Push: Cable Chest Press 60 lb/side 4x10; Incline DB Press 25 lb 3x10; Cable Fly 30 lb/side 3x12; DB Lateral Raise 10 lb 3x12; Triceps Pushdown 50 lb 3x12. Wednesday Pull: Lat Pulldown 70 lb/side 4x10; Seated Row 70 lb/side 3x10; Rear-Delt Fly 20 lb/side 3x12; Face Pull 40 lb 3x12; DB Curl 20 lb 3x10. Friday Legs: Cable Squat 80 lb/side 4x10; Cable RDL 70 lb/side 3x10; Bulgarian Split Squat 20 lb 3x10/leg; Cable Leg Curl 40 lb 3x12/leg; DB Calf Raise 30 lb 3x15; optional 20-min easy bike.';
  await page.locator('[data-tab="coach"]').click();await page.evaluate(text=>window.receiveTrainerShare(text),fullPpl);await page.locator('#interpretHandoff').click();await page.waitForSelector('#handoffPreview:not([hidden])');
  assert.match(await page.locator('#handoffCommands').textContent(),/Cable Squat/);assert.match(await page.locator('#handoffCommands').textContent(),/Cable Romanian Deadlift/);assert.match(await page.locator('#handoffCommands').textContent(),/Cable Leg Curl/);
  await page.locator('#applyHandoff').click();assert.match(await page.locator('[data-select-day="mon"] small').textContent(),/^5 exercises/);assert.match(await page.locator('[data-select-day="wed"] small').textContent(),/^5 exercises/);assert.match(await page.locator('[data-select-day="fri"] small').textContent(),/^5 exercises/);
  await page.locator('[data-select-day="fri"]').click();assert.equal(await page.locator('#exercises .card').count(),5);assert.match(await page.locator('#exercises').textContent(),/Cable Romanian Deadlift/);assert.match(await page.locator('#exercises').textContent(),/Cable Leg Curl/);

  const chat=async text=>{await page.locator('[data-tab="coach"]').click();await page.locator('#geminiCoach').evaluate(el=>el.open=true);await page.locator('#chatInput').fill(text);await page.locator('#send').click();await page.waitForFunction(()=>!document.querySelector('#send').disabled);};

  await chat('What did you learn from my last workout?');assert.ok(captured.recentTraining.length>0);assert.equal(captured.recentTraining[0].exercises[0].sets[1].reps,9);assert.equal(captured.recentTraining[0].exercises[0].sets[1].plannedReps,12);assert.equal(captured.recentTraining[0].exercises[0].sets[1].actualReps,9);assert.equal(captured.recentTraining[0].exercises[0].rir,0);assert.match(captured.recentTraining[0].exercises[0].note,/hard/);assert.ok(Array.isArray(captured.exercisePreferences));assert.equal(captured.userProfile.heightIn,70);
  await chat('Make Monday a 60 minute bodyweight-only workout');await page.waitForSelector('#proposal:not([hidden])');const proposalText=await page.locator('#proposalDetails').textContent(),proposalMinutes=Number(proposalText.match(/Estimated session: ~(\d+) min/)?.[1]);assert.ok(proposalMinutes>=60);assert.match(await page.locator('[data-tab="coach"]').textContent(),/draft/i);
  await page.locator('#applyProposal').click();assert.equal(await page.locator('#workout').isVisible(),true);const exerciseCount=await page.locator('#exercises .card').count();assert.ok(exerciseCount>=2&&exerciseCount<=12);const summaryText=await page.locator('#summary').textContent(),summaryMinutes=Number(summaryText.match(/~(\d+) min/)?.[1]);assert.ok(summaryMinutes>=60);const tags=await page.locator('#exercises .tag').allTextContents();assert.ok(tags.every(t=>/body only/i.test(t)));

  await chat('Update my saved body weight to 175 lb');await page.waitForSelector('#proposal:not([hidden])');assert.match(await page.locator('#proposalDetails').textContent(),/180 → 175 lb/);await page.locator('#applyProposal').click();assert.equal(await page.locator('#profilePage').isVisible(),true);assert.equal(await page.locator('#weightLb').inputValue(),'175');
  await chat('Make an invalid plan for testing test-gemini-key');assert.equal(await page.evaluate(()=>localStorage.getItem('errorReports').includes('test-gemini-key')),false);assert.match(await page.locator('#messages').textContent(),/error report was saved/i);
  await page.locator('#settings').click();assert.equal(await page.locator('#geminiModel').inputValue(),'gemini-3.7-flash');assert.match(await page.locator('#clearDemoCache').textContent(),/Clear demo cache/);assert.match(await page.locator('#viewErrorReports').textContent(),/Error reports \(1\)/);await page.locator('#viewErrorReports').click();const report=await page.locator('#errorReportText').inputValue();assert.match(report,/proposal_validation/);assert.match(report,/unsupported exercise id invented-exercise/);assert.match(report,/gemini-3.7-flash/);assert.equal(report.includes('test-gemini-key'),false);await page.locator('#closeModal').click();

  // Starting a new visible conversation keeps long-term coach memory.
  await page.locator('[data-tab="coach"]').click();await page.locator('#clearChat').click();await page.locator('#confirmClearChat').click();await page.locator('[data-tab="profilePage"]').click();assert.match(await page.locator('#coachMemory').inputValue(),/175 lb/);
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,chat:''}).includes('test-gemini-key')),false);

  await page.locator('[data-tab="workout"]').click();await page.locator('[data-select-day="sun"]').click();assert.equal(await page.locator('#trainingDetails').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // Exercise search and the 12-exercise limit must keep the saved week loadable.
  await page.locator('[data-select-day="mon"]').click();
  await page.locator('#add').click();assert.ok(await page.locator('[data-muscle-group]:visible').count()>=6);await page.locator('#exerciseSearch').fill('zzzz-no-match');assert.equal(await page.locator('#exerciseEmpty').isVisible(),true);
  await page.locator('#exerciseSearch').fill('');assert.ok(await page.locator('[data-muscle-group]:visible').count()>0);await page.locator('[data-muscle-group]').first().click();assert.ok(await page.locator('[data-add]:visible').count()>0);await page.locator('#closeModalTop').click();
  while(await page.locator('#exercises .card').count()<12){await page.locator('#add').click();await page.locator('[data-muscle-group]').first().click();await page.locator('[data-add]').first().click();}
  assert.equal(await page.locator('#add').isDisabled(),true);await page.reload();await page.waitForSelector('#exercises .card');assert.equal(await page.locator('#exercises .card').count(),12);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // Simulate the Android bounds bridge: the chat is a slot on the existing tab.
  await page.evaluate(()=>{window.chatBounds=[];window.TrainerShare={positionChat:(...rect)=>window.chatBounds.push(rect),hideChat:()=>window.chatBounds.push('hidden')};});
  await page.locator('[data-tab="coach"]').click();
  await page.waitForFunction(()=>Array.isArray(window.chatBounds.at(-1)));
  let bounds=await page.evaluate(()=>({rect:window.chatBounds.at(-1),nav:document.querySelector('nav').getBoundingClientRect().top}));
  assert.ok(bounds.rect[3]>=80);assert.ok(bounds.rect[1]+bounds.rect[3]<=bounds.nav);
  await page.locator('#settings').click();await page.waitForFunction(()=>window.chatBounds.at(-1)==='hidden');
  await page.locator('#closeModal').click();await page.waitForFunction(()=>Array.isArray(window.chatBounds.at(-1)));
  await page.setViewportSize({width:360,height:440});await page.waitForTimeout(100);
  bounds=await page.evaluate(()=>({rect:window.chatBounds.at(-1),nav:document.querySelector('nav').getBoundingClientRect().top}));
  assert.ok(Array.isArray(bounds.rect));assert.ok(bounds.rect[3]>=80);assert.ok(bounds.rect[1]+bounds.rect[3]<=bounds.nav);
  await page.locator('[data-tab="workout"]').click();await page.waitForFunction(()=>window.chatBounds.at(-1)==='hidden');
  await page.setViewportSize({width:412,height:915});
  assert.deepEqual(errors,[]);await page.screenshot({path:'trainer-preview.png',fullPage:true});
  console.log('Android insets, anatomical muscle illustrations, exact demo pairing, on-demand video matching, actual-vs-planned logging, RIR, progression graphs, grouped picker, ChatGPT handoff, Gemini next-week recommendations and diagnostics tests passed.');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
