import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makePlan,validPlan} from '../app/src/main/assets/core.js';
import {makeWeek,validWeek,weekKey,weekChanges,applyProposal} from '../app/src/main/assets/week.js';
const catalog=JSON.parse(readFileSync(new URL('../app/src/main/assets/catalog.json',import.meta.url))),ids=catalog.map(e=>e.id);
test('legacy workout migrates to Monday with its progress intact',()=>{
 const p=makePlan('Pull');p.exercises[0].done=2;const w=makeWeek(p);assert.ok(validWeek(w,ids));assert.equal(w.days[0].plan.exercises[0].done,2);assert.equal(w.days.filter(d=>d.enabled).length,3);
});
test('reject malformed weeks, duplicate days and invalid exercise payloads without throwing',()=>{
 assert.equal(validWeek({days:[null]},ids),false);
 const w=makeWeek();w.days[1].id='mon';assert.equal(validWeek(w,ids),false);
 const p=makePlan();p.exercises[0]=null;assert.equal(validPlan(p,ids),false);
});
test('same plan with object key reorder or progress changes is not an update',()=>{
 const w=makeWeek(),next=structuredClone(w);next.days[0].plan.exercises[0].done=3;
 assert.equal(weekKey(w),weekKey(next));assert.deepEqual(weekChanges(w,next,catalog),[]);
 assert.throws(()=>applyProposal(w,{base:weekKey(w),week:next},ids),/No workout changes/);
});
test('apply produces actual per-day changes, preserves completion and leaves original immutable',()=>{
 const w=makeWeek();w.days[0].plan.exercises[0].done=2;
 const next=structuredClone(w);next.days[0].plan.exercises[0].reps=10;next.days[2].minutes=30;
 const changes=weekChanges(w,next,catalog);assert.deepEqual(changes.map(d=>d.id),['mon','wed']);assert.match(changes[0].changes.join(' '),/12 → 10 reps/);
 const applied=applyProposal(w,{base:weekKey(w),week:next},ids);assert.equal(applied.days[0].plan.exercises[0].reps,10);assert.equal(applied.days[0].plan.exercises[0].done,2);assert.equal(w.days[0].plan.exercises[0].reps,12);
});
test('stale drafts cannot overwrite newer manual edits',()=>{
 const w=makeWeek(),draft=structuredClone(w),base=weekKey(w);draft.days[0].plan.exercises[0].sets=2;w.days[0].minutes=25;
 assert.throws(()=>applyProposal(w,{base,week:draft},ids),/schedule changed/);
});
test('all rest week valid, training-to-rest and added days are visible changes',()=>{
 const w=makeWeek(),next=structuredClone(w);next.days.forEach(d=>{d.enabled=false;d.plan=null;});assert.ok(validWeek(next,ids));assert.equal(weekChanges(w,next,catalog).length,3);
});
