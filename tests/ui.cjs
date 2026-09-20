const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
(async()=>{
 const server=spawn('python3',['-m','http.server','8000','--directory','app/src/main/assets'],{stdio:'ignore'});
 let browser;
 try {
  for(let i=0;i<30;i++){try{await fetch('http://localhost:8000');break;}catch{await new Promise(r=>setTimeout(r,100));}}
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:412,height:915}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:8000');await page.waitForSelector('.card');
  await page.locator('[data-set="0"][data-n="0"]').click();await page.waitForSelector('#timer:not([hidden])');
  await page.reload();await page.waitForSelector('.set-button.done');
  await page.locator('#pause').click();assert.equal(await page.locator('#pause').textContent(),'Resume');
  await page.locator('#finish').click();await page.locator('[data-tab="history"]').click();
  assert.match(await page.locator('#historyList').textContent(),/1 sets completed/);
  await page.locator('[data-tab="workout"]').click();await page.locator('[data-demo]').first().click();await page.waitForSelector('#demoImage');
  assert.equal(await page.locator('#demoImage').evaluate(i=>i.complete&&i.naturalWidth>0),true);
  await page.locator('#closeModal').click();
  await page.locator('#settings').click();await page.locator('#apiKey').fill('test-gemini-key');await page.locator('#showKey').click();assert.equal(await page.locator('#apiKey').getAttribute('type'),'text');await page.locator('#saveSettings').click();
  await page.route('https://generativelanguage.googleapis.com/**',async route=>{
   const body=route.request().postDataJSON();const input=JSON.parse(body.contents[0].parts[0].text);input.currentPlan.exercises[0].reps=10;
   assert.equal(route.request().headers()['x-goog-api-key'],'test-gemini-key');
   await route.fulfill({json:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({reply:'Changed to 10 reps.',plan:input.currentPlan})}]}}]},headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.locator('[data-tab="coach"]').click();await page.locator('#chatInput').fill('Change reps to 10');await page.locator('#send').click();
  await page.waitForFunction(()=>document.querySelector('#messages').textContent.includes('Changed to 10 reps.'));
  await page.locator('[data-tab="workout"]').click();assert.equal(await page.locator('[data-index="0"][data-field="reps"]').inputValue(),'10');
  await page.locator('#undo').click();assert.equal(await page.locator('[data-index="0"][data-field="reps"]').inputValue(),'12');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.unroute('https://generativelanguage.googleapis.com/**');
  await page.route('https://generativelanguage.googleapis.com/**',r=>r.fulfill({status:429,json:{error:{message:'private-provider-details'}}}));
  await page.locator('[data-tab="coach"]').click();await page.locator('#chatInput').fill('Make it easier');await page.locator('#send').click();
  await page.waitForFunction(()=>document.querySelector('#messages').textContent.includes('usage limit reached'));
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('test-gemini-key')),false);
  await page.locator('[data-tab="workout"]').click();assert.equal(await page.locator('[data-index="0"][data-field="reps"]').inputValue(),'12');
  await page.locator('#settings').click();await page.locator('#clearKey').click();
  await page.locator('[data-tab="coach"]').click();assert.match(await page.locator('#connection').textContent(),/Add your Gemini API key/);
  await page.locator('#settings').click();assert.equal(await page.locator('#apiKey').inputValue(),'');await page.locator('#closeModal').click();
  await page.locator('[data-tab="workout"]').click();
  assert.deepEqual(errors,[]);await page.screenshot({path:'trainer-preview.png',fullPage:true});console.log('UI smoke test passed.');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
