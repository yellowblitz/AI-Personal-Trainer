import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeExercise,setSetValue,setExerciseFeedback,comparePlanPerformance,summarizeHistory,exerciseProgress,exerciseProgressionSignal,exerciseRecords,muscleTrainingLoad,muscleProgress,weeklyTrainingReview} from '../app/src/main/assets/training.js';

test('actual reps can differ from the preserved prescription',()=>{
 const ex=normalizeExercise({id:'Demo',sets:3,reps:7,weight:20,rest:90,done:0});
 const changed=setSetValue(ex,1,'reps',5);
 assert.deepEqual(changed.plannedReps,[7,7,7]);
 assert.deepEqual(changed.setReps,[7,5,7]);
 assert.deepEqual(changed.plannedWeights,[20,20,20]);
});

test('RIR, effort, form, discomfort and notes are stored as exercise feedback',()=>{
 const ex=setExerciseFeedback(normalizeExercise({id:'Demo',sets:2,reps:8,weight:0,rest:60}),0,'Second set was a grind',{effort:'too_hard',form:'breaking',discomfort:'none'});
 assert.equal(ex.rir,0);
 assert.equal(ex.note,'Second set was a grind');
 assert.equal(ex.effort,'too_hard');
 assert.equal(ex.form,'breaking');
 assert.equal(ex.discomfort,'none');
});

test('session comparison reports planned versus actual performance',()=>{
 const plan={name:'Test',exercises:[normalizeExercise({id:'Demo',sets:3,reps:7,weight:20,rest:90,done:3,setReps:[7,6,5],setWeights:[20,20,20],plannedReps:[7,7,7],plannedWeights:[20,20,20]})]};
 const comparison=comparePlanPerformance(plan);
 assert.equal(comparison.plannedReps,21);
 assert.equal(comparison.actualReps,18);
 assert.equal(comparison.metRepSets,1);
 assert.equal(comparison.belowRepSets,2);
 assert.equal(comparison.plannedVolume,420);
 assert.equal(comparison.actualVolume,360);
});

test('AI history contains target, actual, RIR and notes',()=>{
 const plan={name:'Test',exercises:[normalizeExercise({id:'Demo',sets:2,reps:7,weight:20,rest:90,done:2,setReps:[7,5],setWeights:[20,20],plannedReps:[7,7],plannedWeights:[20,20],rir:0,note:'Hard finish'})]};
 const summary=summarizeHistory([{date:'2026-09-20T12:00:00Z',day:'mon',plan}],[{id:'Demo',name:'Demo Press'}],20);
 const ex=summary[0].exercises[0];
 assert.equal(ex.rir,0);
 assert.equal(ex.note,'Hard finish');
 assert.deepEqual(ex.sets[1],{set:2,plannedReps:7,plannedWeight:20,actualReps:5,actualWeight:20,reps:5,weight:20});
});

test('exercise progression is chronological and calculates volume',()=>{
 const make=(date,reps)=>({date,day:'mon',plan:{name:'Test',exercises:[normalizeExercise({id:'Demo',sets:1,reps:7,weight:20,rest:90,done:1,setReps:[reps],setWeights:[20],plannedReps:[7],plannedWeights:[20],rir:1})]}});
 const points=exerciseProgress([make('2026-09-20T12:00:00Z',7),make('2026-09-13T12:00:00Z',5)],'Demo');
 assert.deepEqual(points.map(p=>p.actualReps),[5,7]);
 assert.deepEqual(points.map(p=>p.plannedReps),[7,7]);
 assert.deepEqual(points.map(p=>p.actualVolume),[100,140]);
 assert.ok(points.every(p=>p.estimated1RM>20));
});


test('progression signal is transparent and conservative',()=>{
 const make=(date,reps,rir,extra={})=>({date,day:'mon',plan:{name:'Test',exercises:[normalizeExercise({id:'Demo',sets:2,reps:8,weight:20,rest:90,done:2,setReps:[reps,reps],setWeights:[20,20],plannedReps:[8,8],plannedWeights:[20,20],rir,...extra})]}});
 const ready=exerciseProgressionSignal([make('2026-09-20T12:00:00Z',8,3,{effort:'right',form:'good',discomfort:'none'})],'Demo');
 assert.equal(ready.action,'progress');
 const hard=exerciseProgressionSignal([
  make('2026-09-20T12:00:00Z',5,0,{effort:'too_hard',form:'breaking',discomfort:'none'}),
  make('2026-09-13T12:00:00Z',5,1,{effort:'too_hard',form:'breaking',discomfort:'none'})
 ],'Demo');
 assert.equal(hard.action,'reduce');
 const sore=exerciseProgressionSignal([make('2026-09-20T12:00:00Z',8,2,{effort:'right',form:'good',discomfort:'mild'})],'Demo');
 assert.equal(sore.action,'replace');
});

test('exercise records summarize best logged performance',()=>{
 const make=(date,reps,weight)=>({date,day:'mon',plan:{name:'Test',exercises:[normalizeExercise({id:'Demo',sets:1,reps,weight,rest:90,done:1,setReps:[reps],setWeights:[weight],plannedReps:[reps],plannedWeights:[weight]})]}});
 const records=exerciseRecords([make('2026-09-20T12:00:00Z',8,25),make('2026-09-13T12:00:00Z',10,20)],'Demo');
 assert.equal(records.sessions,2);
 assert.equal(records.bestWeight,25);
 assert.equal(records.bestReps,10);
 assert.ok(records.bestEstimated1RM>30);
});

test('muscle progress and weekly load use primary and secondary exposure transparently',()=>{
 const catalog=[{id:'Press',muscle:'chest',muscleSlug:'chest',anatomePrimarySlugs:['chest'],secondaryMuscleSlugs:['triceps']}];
 const make=(date,reps,weight,rir=2)=>({date,day:'mon',plan:{name:'Push',exercises:[normalizeExercise({id:'Press',sets:2,reps,weight,rest:90,done:2,setReps:[reps,reps],setWeights:[weight,weight],plannedReps:[reps,reps],plannedWeights:[weight,weight],rir,effort:'right',form:'good',discomfort:'none'})]}});
 const history=[make('2026-09-20T12:00:00Z',10,25),make('2026-09-06T12:00:00Z',8,20)];
 const now=Date.parse('2026-09-21T00:00:00Z');
 const load=muscleTrainingLoad(history,catalog,21,now);
 assert.equal(load.find(x=>x.slug==='chest').sets,4);
 assert.equal(load.find(x=>x.slug==='triceps').sets,2);
 const progress=muscleProgress(history,catalog,{days:56,now});
 const chest=progress.find(x=>x.slug==='chest');
 assert.ok(chest.trendPct>0);
 assert.equal(chest.sessions,2);
 assert.equal(chest.confidence,'low');
});

test('weekly review summarizes logged sessions and feedback',()=>{
 const catalog=[{id:'Press',muscle:'chest',muscleSlug:'chest',anatomePrimarySlugs:['chest'],secondaryMuscleSlugs:['triceps']}];
 const plan={name:'Push',exercises:[normalizeExercise({id:'Press',sets:2,reps:8,weight:20,rest:90,done:2,setReps:[8,7],setWeights:[20,20],plannedReps:[8,8],plannedWeights:[20,20],rir:1,effort:'too_hard',form:'breaking',discomfort:'none'})]};
 const review=weeklyTrainingReview([{date:'2026-09-20T12:00:00Z',day:'mon',plan}],catalog,{days:7,now:Date.parse('2026-09-21T00:00:00Z')});
 assert.equal(review.sessions,1);
 assert.equal(review.sets,2);
 assert.equal(review.adherencePct,50);
 assert.equal(review.avgRir,1);
 assert.equal(review.formWarnings,1);
});
