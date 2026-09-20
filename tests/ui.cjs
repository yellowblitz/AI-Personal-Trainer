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
  await page.locator('#settings').click();await page.locator('#url').fill('https://trainer.example');await page.locator('#token').fill('test-token');await page.locator('#saveSettings').click();
  await page.route('https://trainer.example/api/coach',async route=>{
   const body=route.request().postDataJSON();body.plan.exercises[0].reps=10;
   await route.fulfill({json:{reply:'Changed to 10 reps.',plan:body.plan},headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.locator('[data-tab="coach"]').click();await page.locator('#chatInput').fill('Change reps to 10');await page.locator('#send').click();
  await page.waitForFunction(()=>document.querySelector('#messages').textContent.includes('Changed to 10 reps.'));
  await page.locator('[data-tab="workout"]').click();assert.equal(await page.locator('[data-index="0"][data-field="reps"]').inputValue(),'10');
  await page.locator('#undo').click();assert.equal(await page.locator('[data-index="0"][data-field="reps"]').inputValue(),'12');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);await page.screenshot({path:'trainer-preview.png',fullPage:true});console.log('UI smoke test passed.');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
