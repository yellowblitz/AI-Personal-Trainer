import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const assets=new URL('../app/src/main/assets/',import.meta.url);
const readJson=async name=>JSON.parse(await readFile(new URL(name,assets),'utf8'));

test('YouTube demo fallback index is conservative and valid',async()=>{
 const [catalog,custom,index]=await Promise.all([
  readJson('catalog.json'),
  readJson('custom-exercises.json'),
  readJson('youtube-demos.json')
 ]);
 const ids=new Set([...catalog,...custom].map(x=>x.id));
 const entries=Object.entries(index.demos||{});
 assert.ok(entries.length>=350,'expected broad curated YouTube coverage');
 assert.equal(index.source?.repository,'rthepen/workout-database');
 assert.match(index.source?.commit||'',/^[a-f0-9]{40}$/);
 for(const [exerciseId,demos] of entries){
  assert.ok(ids.has(exerciseId),'unknown exercise in YouTube index: '+exerciseId);
  assert.ok(Array.isArray(demos)&&demos.length>0&&demos.length<=3,'invalid demo list: '+exerciseId);
  for(const demo of demos){
   assert.match(demo.youtubeId,/^[A-Za-z0-9_-]{6,20}$/,'invalid YouTube id for '+exerciseId);
   assert.ok(demo.type==='short'||demo.type==='standard','invalid video type for '+exerciseId);
   assert.ok(Number.isFinite(Number(demo.priority)),'missing priority for '+exerciseId);
   if(demo.clipSeconds!=null)assert.ok(demo.clipSeconds>=6&&demo.clipSeconds<=15,'clip must stay short for '+exerciseId);
  }
 }
 for(const id of ['Cable_Squat','Cable_Romanian_Deadlift','Bulgarian_Split_Squat','Cable_Leg_Curl']){
  assert.ok(index.demos[id]?.length,'missing custom exercise fallback: '+id);
 }
});

test('trainer uses privacy-enhanced YouTube embeds only on demand',async()=>{
 const app=await readFile(new URL('app.js',assets),'utf8');
 assert.match(app,/youtube-demos\.json/);
 assert.match(app,/youtube-nocookie\.com\/embed/);
 assert.match(app,/lookupDemoVideos\(c\)[\s\S]*lookupYoutubeDemos\(c\)/);
 assert.match(app,/Math\.min\(15/);
});
