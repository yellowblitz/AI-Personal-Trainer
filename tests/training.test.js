import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeExercise,setSetValue,setExerciseFeedback,comparePlanPerformance,summarizeHistory,exerciseProgress} from '../app/src/main/assets/training.js';

test('actual reps can differ from the preserved prescription',()=>{
 const ex=normalizeExercise({id:'Demo',sets:3,reps:7,weight:20,rest:90,done:0});
 const changed=setSetValue(ex,1,'reps',5);
 assert.deepEqual(changed.plannedReps,[7,7,7]);
 assert.deepEqual(changed.setReps,[7,5,7]);
 assert.deepEqual(changed.plannedWeights,[20,20,20]);
});

test('RIR and notes are stored as exercise feedback',()=>{
 const ex=setExerciseFeedback(normalizeExercise({id:'Demo',sets:2,reps:8,weight:0,rest:60}),0,'Second set was a grind');
 assert.equal(ex.rir,0);
 assert.equal(ex.note,'Second set was a grind');
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
