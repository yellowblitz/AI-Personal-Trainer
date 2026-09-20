import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveExerciseRef,rankExerciseCatalog,compactCatalog} from '../app/src/main/assets/exercise-match.js';

const catalog=JSON.parse(readFileSync(new URL('../app/src/main/assets/catalog.json',import.meta.url)));

test('full exercise library includes broad equipment variety',()=>{
 assert.ok(catalog.length>=870);
 assert.ok(catalog.filter(x=>x.equipment==='cable').length>=70);
 assert.ok(catalog.filter(x=>x.equipment==='dumbbell').length>=100);
 assert.ok(catalog.filter(x=>x.equipment==='body only').length>=100);
});

test('exact names and common coaching aliases resolve deterministically',()=>{
 assert.equal(resolveExerciseRef('Dumbbell Bench Press',catalog),'Dumbbell_Bench_Press');
 assert.equal(resolveExerciseRef('cable fly',catalog),'Cable_Crossover');
 assert.equal(resolveExerciseRef('rope tricep pushdown',catalog),'Triceps_Pushdown_-_Rope_Attachment');
 assert.equal(resolveExerciseRef('definitely not a real exercise name',catalog),null);
});

test('functional trainer context ranks cable exercises into the candidate catalog',()=>{
 const ranked=rankExerciseCatalog('Rep Arcadia Max functional trainer chest workout',catalog,{limit:80});
 assert.ok(ranked.some(x=>x.equipment==='cable'));
 assert.ok(ranked.some(x=>x.id==='Cable_Crossover'));
 const compact=compactCatalog('functional trainer cable fly',catalog,{limit:40});
 assert.ok(compact.some(x=>x.id==='Cable_Crossover'));
 assert.ok(compact.length<=40);
});
