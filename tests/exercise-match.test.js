import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveExerciseRef,rankExerciseCatalog,compactCatalog} from '../app/src/main/assets/exercise-match.js';

const baseCatalog=JSON.parse(readFileSync(new URL('../app/src/main/assets/catalog.json',import.meta.url)));
const customCatalog=JSON.parse(readFileSync(new URL('../app/src/main/assets/custom-exercises.json',import.meta.url)));
const catalog=[...baseCatalog,...customCatalog];

test('full exercise library includes broad equipment variety',()=>{
 assert.ok(catalog.length>=877);
 assert.ok(catalog.filter(x=>x.equipment==='cable').length>=70);
 assert.ok(catalog.filter(x=>x.equipment==='dumbbell').length>=100);
 assert.ok(catalog.filter(x=>x.equipment==='body only').length>=100);
});

test('base exercises have exact anatomy/demo pairing and supplemental exercises have local anatomy metadata',()=>{
 const allowed=new Set(['abs','adductors','biceps','calves','chest','deltoids','forearm','gluteal','hamstring','lower-back','neck','quadriceps','trapezius','triceps','upper-back']);
 assert.equal(baseCatalog.length,873);
 assert.ok(baseCatalog.every(x=>allowed.has(x.muscleSlug)));
 assert.ok(baseCatalog.every(x=>x.demoGif===`https://api.anatome.dev/exerciseGif?id=${encodeURIComponent(x.id)}`));
 assert.ok(baseCatalog.every(x=>x.exerciseInfoUrl.includes('api.anatome.dev/getExercise?name=')));
 assert.equal(customCatalog.length,4);
 assert.ok(customCatalog.every(x=>allowed.has(x.muscleSlug)));
 assert.ok(customCatalog.every(x=>Array.isArray(x.secondaryMuscleSlugs)));
 assert.deepEqual(customCatalog.map(x=>x.id).sort(),['Bulgarian_Split_Squat','Cable_Leg_Curl','Cable_Romanian_Deadlift','Cable_Squat'].sort());
});

test('exact names and common coaching aliases resolve deterministically',()=>{
 assert.equal(resolveExerciseRef('Dumbbell Bench Press',catalog),'Dumbbell_Bench_Press');
 assert.equal(resolveExerciseRef('cable fly',catalog),'Cable_Crossover');
 assert.equal(resolveExerciseRef('rope tricep pushdown',catalog),'Triceps_Pushdown_-_Rope_Attachment');
 assert.equal(resolveExerciseRef('Cable Chest Press',catalog),'Cable_Chest_Press');
 assert.equal(resolveExerciseRef('Incline DB Press',catalog),'Incline_Dumbbell_Press');
 assert.equal(resolveExerciseRef('DB Lateral Raise',catalog),'Side_Lateral_Raise');
 assert.equal(resolveExerciseRef('Rear-Delt Fly',catalog),'Cable_Rear_Delt_Fly');
 assert.equal(resolveExerciseRef('Seated Row',catalog),'Seated_Cable_Rows');
 assert.equal(resolveExerciseRef('DB Curl',catalog),'Dumbbell_Bicep_Curl');
 assert.equal(resolveExerciseRef('Cable Squat',catalog),'Cable_Squat');
 assert.equal(resolveExerciseRef('Cable RDL',catalog),'Cable_Romanian_Deadlift');
 assert.equal(resolveExerciseRef('Bulgarian Split Squat',catalog),'Bulgarian_Split_Squat');
 assert.equal(resolveExerciseRef('Cable Leg Curl',catalog),'Cable_Leg_Curl');
 assert.equal(resolveExerciseRef('DB Calf Raise',catalog),'Standing_Dumbbell_Calf_Raise');
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
