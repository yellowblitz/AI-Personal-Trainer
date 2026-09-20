import test from 'node:test';import assert from 'node:assert/strict';
import {makePlan,validPlan,mergePlan,secondsLeft} from '../app/src/main/assets/core.js';
import {readFileSync} from 'node:fs';
const catalog=JSON.parse(readFileSync(new URL('../app/src/main/assets/catalog.json',import.meta.url)));
const ids=catalog.map(e=>e.id);
test('all starter plans use real catalog entries',()=>{for(const day of ['Push','Pull','Legs'])assert.ok(validPlan(makePlan(day),ids));});
test('reject unsafe and malformed plans',()=>{for(const [key,value] of [['sets',0],['sets',11],['reps',51],['rest',-1],['weight',Infinity],['id','invented']]){const p=makePlan();p.exercises[0][key]=value;assert.equal(validPlan(p,ids),false);}const p=makePlan();p.exercises.push(p.exercises[0]);assert.equal(validPlan(p,ids),false);assert.equal(validPlan({name:'empty',exercises:[]},ids),false);});
test('AI updates preserve completed sets and clamp reduced set count',()=>{const old=makePlan();old.exercises[0].done=3;const next=makePlan();next.exercises[0].sets=2;assert.equal(mergePlan(old,next).exercises[0].done,2);assert.equal(old.exercises[0].done,3);});
test('rest timer uses wall clock, survives background delay and pause',()=>{assert.equal(secondsLeft({end:10000},1000),9);assert.equal(secondsLeft({end:10000},15000),0);assert.equal(secondsLeft({paused:12},999999),12);});
