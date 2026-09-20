export const templates = {
 Push: ['Dumbbell_Bench_Press','Cable_Crossover','Side_Lateral_Raise','Triceps_Pushdown'],
 Pull: ['Seated_Cable_Rows','Wide-Grip_Lat_Pulldown','Face_Pull','Dumbbell_Bicep_Curl'],
 Legs: ['Bodyweight_Squat','Dumbbell_Lunges','Standing_Calf_Raises']
};
export function makePlan(day='Push') { return {name:day, exercises:templates[day].map(id=>({id,sets:3,reps:12,rest:90,weight:0,done:0}))}; }
export function validPlan(p, ids) {
 return !!p && typeof p.name==='string' && p.name.length>0 && p.name.length<=80 && Array.isArray(p.exercises) && p.exercises.length>0 && p.exercises.length<=12 && new Set(p.exercises.map(e=>e?.id)).size===p.exercises.length && p.exercises.every(e=>e && typeof e==='object' && ids.includes(e.id) && Number.isInteger(e.sets)&&e.sets>=1&&e.sets<=10 && Number.isInteger(e.reps)&&e.reps>=1&&e.reps<=50 && Number.isInteger(e.rest)&&e.rest>=15&&e.rest<=600 && Number.isFinite(e.weight)&&e.weight>=0&&e.weight<=1000);
}
export function mergePlan(old, next) {
 return {...next,exercises:next.exercises.map(e=>({...e,done:Math.min(e.sets,old.exercises.find(x=>x.id===e.id)?.done||0)}))};
}
export function secondsLeft(timer,now=Date.now()) {return timer.paused!=null?timer.paused:timer.end?Math.max(0,Math.ceil((timer.end-now)/1000)):0;}
