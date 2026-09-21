import {DAYS,dayName,makeWeek,normalizeWeek,validWeek,weekKey,weekChanges,applyProposal} from './week.js';
import {askGemini,MODELS,DEFAULT_MODEL} from './gemini.js';
import {templates,makePlan,validPlan,secondsLeft,normalizeTimer} from './core.js';
import {normalizeExercise,normalizePlan,resizeSets,setSetValue,setExerciseFeedback,completedSetTotal,totalSets,estimatePlanMinutes,summarizeHistory,lastExercisePerformance,comparePlanPerformance,exerciseProgress,exerciseProgressionSignal,exerciseRecords,muscleTrainingLoad,muscleProgress,weeklyTrainingReview} from './training.js';
import {buildChatGPTContext,interpretChatGPTResponse,applyCommandBatch} from './handoff.js';
const $=id=>document.getElementById(id);
const [baseCatalog,customCatalog]=await Promise.all([fetch('catalog.json').then(r=>r.json()),fetch('custom-exercises.json').then(r=>r.ok?r.json():[]).catch(()=>[])]),catalog=[...baseCatalog,...customCatalog],ids=catalog.map(e=>e.id);
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const THEMES=['dark','light','green'];
let theme=read('theme','dark');if(!THEMES.includes(theme))theme='dark';
function applyTheme(next,persist=true){
 theme=THEMES.includes(next)?next:'dark';
 document.documentElement.dataset.theme=theme;
 const scheme=document.querySelector('meta[name="color-scheme"]');if(scheme)scheme.content=theme==='light'?'light':'dark';
 if(persist)localStorage.setItem('theme',JSON.stringify(theme));
 try{window.TrainerShare?.setTheme?.(theme);}catch{}
 requestAnimationFrame(()=>window.syncInlineChat?.());
}
applyTheme(theme,false);
const legacy=read('plan',null);
let week=read('week',null);
if(!validWeek(week,ids))week=makeWeek(validPlan(legacy,ids)?legacy:undefined);
week=normalizeWeek(week);
let selected=read('selectedDay',validPlan(legacy,ids)?'mon':DAYS[(new Date().getDay()+6)%7]);
if(!DAYS.includes(selected))selected='mon';
let plan=week.days[DAYS.indexOf(selected)].plan||makePlan(),timer=read('timer',{}),history=read('history',[]),undo=null,busy=false,demoInterval;
let collapsedExercises=new Set((Array.isArray(read('collapsedExercises',[]))?read('collapsedExercises',[]):[]).filter(x=>typeof x==='string').slice(-200));
if(!Array.isArray(history))history=[];
history=history.filter(h=>h&&Number.isFinite(Date.parse(h.date))&&validPlan(h.plan,ids)).slice(0,200);
timer=normalizeTimer(timer);
const APP_VERSION='0.14.0';
let apiKey='',messages=read('chat',[]),pending=read('proposal',null),geminiModel=read('geminiModel',DEFAULT_MODEL),errorReports=read('errorReports',[]),handoffDraft=null,handoffTiming=read('handoffTiming',{}),lastHandoff=read('lastHandoff',null);
if(!MODELS.some(m=>m.id===geminiModel))geminiModel=DEFAULT_MODEL;
if(!Array.isArray(errorReports))errorReports=[];errorReports=errorReports.filter(r=>r&&typeof r==='object').slice(0,20);
if(!handoffTiming||typeof handoffTiming!=='object'||Array.isArray(handoffTiming))handoffTiming={};
if(!lastHandoff||typeof lastHandoff!=='object'||!lastHandoff.batch||!Array.isArray(lastHandoff.batch.commands))lastHandoff=null;
const GOALS=['General fitness','Build muscle','Strength','Endurance','Fat loss','Mobility / athleticism'];
const LEVELS=['Beginner','Intermediate','Advanced'];
const cleanNumber=(value,min,max)=>Number.isFinite(Number(value))&&Number(value)>=min&&Number(value)<=max?Number(value):null;
const normalizeProfile=value=>({goal:GOALS.includes(value?.goal)?value.goal:'General fitness',experience:LEVELS.includes(value?.experience)?value.experience:'Beginner',equipment:typeof value?.equipment==='string'?value.equipment.trim().slice(0,500):'',heightIn:cleanNumber(value?.heightIn,36,96),weightLb:cleanNumber(value?.weightLb,50,1000)});
const profileKey=value=>JSON.stringify(normalizeProfile(value));
const validProfile=value=>!!value&&GOALS.includes(value.goal)&&LEVELS.includes(value.experience)&&typeof value.equipment==='string'&&(value.heightIn===null||(Number.isFinite(value.heightIn)&&value.heightIn>=36&&value.heightIn<=96))&&(value.weightLb===null||(Number.isFinite(value.weightLb)&&value.weightLb>=50&&value.weightLb<=1000));
const profileChanges=(a,b)=>{const x=normalizeProfile(a),y=normalizeProfile(b),out=[];if(x.goal!==y.goal)out.push(`Goal: ${x.goal} → ${y.goal}`);if(x.experience!==y.experience)out.push(`Experience: ${x.experience} → ${y.experience}`);if(x.equipment!==y.equipment)out.push('Available equipment updated');if(x.heightIn!==y.heightIn)out.push(`Height: ${x.heightIn==null?'not set':Math.floor(x.heightIn/12)+"' "+(x.heightIn%12)+"\""} → ${y.heightIn==null?'not set':Math.floor(y.heightIn/12)+"' "+(y.heightIn%12)+"\""}`);if(x.weightLb!==y.weightLb)out.push(`Weight: ${x.weightLb??'not set'} → ${y.weightLb??'not set'} lb`);return out;};
let profile=normalizeProfile(read('profile',{})),coachMemory=typeof read('coachMemory','')==='string'?read('coachMemory','').slice(0,4000):'';
const saveProfile=()=>localStorage.setItem('profile',JSON.stringify(profile));
const saveMemory=()=>localStorage.setItem('coachMemory',JSON.stringify(coachMemory));
let nextWeekRecommendation=read('nextWeekRecommendation',null),recommendationBusy=false;
if(nextWeekRecommendation&&(!nextWeekRecommendation.week||!validWeek(nextWeekRecommendation.week,ids))){nextWeekRecommendation=null;localStorage.removeItem('nextWeekRecommendation');}
const saveNextWeekRecommendation=()=>{if(nextWeekRecommendation)localStorage.setItem('nextWeekRecommendation',JSON.stringify(nextWeekRecommendation));else localStorage.removeItem('nextWeekRecommendation');};
let exercisePreferences=read('exercisePreferences',{}),demoMetaCache=read('demoMetaCache',{}),demoProblems=read('demoProblems',{}),exerciseNotes=read('exerciseNotes',{});
if(!exercisePreferences||typeof exercisePreferences!=='object'||Array.isArray(exercisePreferences))exercisePreferences={};
if(!demoMetaCache||typeof demoMetaCache!=='object'||Array.isArray(demoMetaCache))demoMetaCache={};
if(!demoProblems||typeof demoProblems!=='object'||Array.isArray(demoProblems))demoProblems={};
if(!exerciseNotes||typeof exerciseNotes!=='object'||Array.isArray(exerciseNotes))exerciseNotes={};
const saveExercisePreferences=()=>localStorage.setItem('exercisePreferences',JSON.stringify(exercisePreferences));
const saveExerciseNotes=()=>localStorage.setItem('exerciseNotes',JSON.stringify(exerciseNotes));
const saveDemoProblems=()=>localStorage.setItem('demoProblems',JSON.stringify(demoProblems));
function recordExercisePreference(id,field){
 if(!id||!['added','removed','completed'].includes(field))return;
 const old=exercisePreferences[id]&&typeof exercisePreferences[id]==='object'?exercisePreferences[id]:{};
 exercisePreferences[id]={added:Number(old.added)||0,removed:Number(old.removed)||0,completed:Number(old.completed)||0,lastUsed:old.lastUsed||null};
 exercisePreferences[id][field]++;exercisePreferences[id].lastUsed=new Date().toISOString();saveExercisePreferences();
}
function compactPreferences(){
 const idsWithNotes=Object.keys(exerciseNotes).filter(id=>typeof exerciseNotes[id]==='string'&&exerciseNotes[id].trim());
 const allIds=[...new Set([...Object.keys(exercisePreferences),...idsWithNotes])];
 return allIds.map(id=>{const v=exercisePreferences[id]&&typeof exercisePreferences[id]==='object'?exercisePreferences[id]:{};return {id,added:Number(v.added)||0,removed:Number(v.removed)||0,completed:Number(v.completed)||0,lastUsed:v.lastUsed||null,note:String(exerciseNotes[id]||'').trim().slice(0,300)};})
  .filter(v=>v.added||v.removed||v.completed||v.note).sort((a,b)=>(b.completed+b.added-b.removed)-(a.completed+a.added-a.removed)).slice(0,80);
}
const saveDemoMetaCache=()=>{const entries=Object.entries(demoMetaCache).sort((a,b)=>(Date.parse(b[1]?.usedAt)||0)-(Date.parse(a[1]?.usedAt)||0)).slice(0,50);demoMetaCache=Object.fromEntries(entries);localStorage.setItem('demoMetaCache',JSON.stringify(demoMetaCache));};

if(!Array.isArray(messages))messages=[];
messages=messages.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').slice(-200);
if(pending){const hasWeek=pending.week&&validWeek(pending.week,ids)&&typeof pending.base==='string';const hasProfile=pending.profile&&validProfile(pending.profile)&&typeof pending.profileBase==='string';if(!hasWeek&&!hasProfile)pending=null;}
const currentDay=()=>week.days[DAYS.indexOf(selected)];
function selectDay(id){selected=id;plan=currentDay().plan?normalizePlan(currentDay().plan):makePlan();if(currentDay().enabled)currentDay().plan=plan;localStorage.setItem('selectedDay',JSON.stringify(selected));}
try { apiKey=window.TrainerKeys?.getKey()||''; } catch {}
localStorage.removeItem('endpoint');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function exerciseCollapseKey(id){return selected+':'+id;}
function saveCollapsedExercises(){localStorage.setItem('collapsedExercises',JSON.stringify([...collapsedExercises].slice(-200)));}
function save(){
 if(currentDay().enabled)currentDay().plan=plan;
 localStorage.setItem('week',JSON.stringify(week));localStorage.setItem('selectedDay',JSON.stringify(selected));
 localStorage.setItem('plan',JSON.stringify(plan));localStorage.setItem('timer',JSON.stringify(timer));
}
function saveChat(){messages=messages.slice(-200);localStorage.setItem('chat',JSON.stringify(messages));localStorage.setItem('proposal',JSON.stringify(pending));saveMemory();}
const redact=value=>{let out=typeof value==='string'?value:JSON.stringify(value,null,2);if(apiKey)out=out.split(apiKey).join('[REDACTED API KEY]');return out.replace(/AIza[A-Za-z0-9_-]{20,}/g,'[REDACTED API KEY]');};
// Also scrub reports written by older versions before persisting them again.
errorReports=JSON.parse(redact(errorReports));
localStorage.setItem('errorReports',JSON.stringify(errorReports));
function recordErrorReport(diagnostic,request='',visibleMessage=''){
 const report={id:'E'+Date.now().toString(36).toUpperCase(),time:new Date().toISOString(),appVersion:APP_VERSION,model:geminiModel,selectedDay:selected,category:diagnostic?.category||'unknown',visibleMessage:String(visibleMessage||'').slice(0,1000),request:String(request||'').slice(0,1200),diagnostic:diagnostic&&typeof diagnostic==='object'?diagnostic:{}};
 const safeReport=JSON.parse(redact(report));
 errorReports.unshift(safeReport);errorReports=errorReports.slice(0,20);localStorage.setItem('errorReports',JSON.stringify(errorReports));return safeReport;
}
function saveLastHandoff(){
 if(lastHandoff)localStorage.setItem('lastHandoff',JSON.stringify(lastHandoff));else localStorage.removeItem('lastHandoff');
}
function recordHandoffAttempts(attempts=[]){
 if(!Array.isArray(attempts)||!attempts.length)return;
 for(const a of attempts){
  if(!a||typeof a.model!=='string'||!Number.isFinite(Number(a.durationMs)))continue;
  const current=handoffTiming[a.model]&&typeof handoffTiming[a.model]==='object'?handoffTiming[a.model]:{};
  const duration=Math.max(0,Math.min(120000,Number(a.durationMs))),success=a.outcome==='success',samples=Math.max(0,Number(current.samples)||0);
  handoffTiming[a.model]={
   avgMs:success?(samples?Math.round((Number(current.avgMs)||duration)*.7+duration*.3):Math.round(duration)):Number(current.avgMs)||null,
   lastMs:Math.round(duration),
   samples:success?samples+1:samples,
   timeouts:(Number(current.timeouts)||0)+(a.outcome==='timeout'?1:0),
   lastOutcome:String(a.outcome||'unknown').slice(0,40),
   updatedAt:new Date().toISOString()
  };
 }
 localStorage.setItem('handoffTiming',JSON.stringify(handoffTiming));
}
function lastHandoffLabel(){
 if(!lastHandoff)return '';
 const when=Number.isFinite(Date.parse(lastHandoff.translatedAt))?new Date(lastHandoff.translatedAt).toLocaleString():'saved';
 const source=lastHandoff.batch?.translationPath==='local'?'on-device parser':(lastHandoff.batch?.modelUsed||'Gemini');
 const state=lastHandoff.status==='applied'?'applied':lastHandoff.status==='apply_failed'?'apply failed':'ready';
 return 'Last translation · '+when+' · '+source+' · '+state;
}
function errorReportText(){
 if(!errorReports.length)return 'No AI error reports saved.';
 return errorReports.map(r=>redact(['AI Personal Trainer error '+r.id,'Time: '+r.time,'App: v'+r.appVersion,'Model: '+r.model,'Category: '+r.category,'Selected day: '+r.selectedDay,'Message: '+r.visibleMessage,'Request: '+r.request,'Diagnostic: '+redact(r.diagnostic)].join('\n'))).join('\n\n--------------------\n\n');
}
function showErrorReports(){
 modal('<h2>AI error reports</h2><p class="small muted">Reports never include your saved Gemini API key. They contain the failed request text, selected model, error category, and validation/API details so a problem can be diagnosed.</p><textarea id="errorReportText" rows="16" readonly></textarea><div class="row"><button id="copyErrorReport" class="primary">Copy reports</button><button id="clearErrorReports" class="secondary">Clear reports</button></div>');
 $('errorReportText').value=errorReportText();
 $('copyErrorReport').onclick=async()=>{const text=$('errorReportText').value;try{await navigator.clipboard.writeText(text);toast('Error report copied.');}catch{$('errorReportText').focus();$('errorReportText').select();toast('Report selected. Use Copy.');}};
 $('clearErrorReports').onclick=()=>{errorReports=[];localStorage.removeItem('errorReports');$('errorReportText').value=errorReportText();toast('Error reports cleared.');};
}

function toast(s){$('toast').textContent=s;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,4500);}
function modal(html){clearInterval(demoInterval);$('modalBody').innerHTML=html;$('modal').showModal();}
$('closeModal').onclick=()=>$('modal').close();$('closeModalTop').onclick=()=>$('modal').close();$('modal').onclose=()=>{clearInterval(demoInterval);$('modalBody').innerHTML='';};

const MUSCLE_GROUPS=[
 {key:'chest',label:'Chest',muscles:['chest']},
 {key:'back',label:'Back',muscles:['lats','middle back','lower back','traps']},
 {key:'shoulders',label:'Shoulders',muscles:['shoulders','neck']},
 {key:'arms',label:'Arms',muscles:['biceps','triceps','forearms']},
 {key:'legs',label:'Legs',muscles:['quadriceps','hamstrings','calves']},
 {key:'hips',label:'Glutes & hips',muscles:['glutes','adductors','abductors']},
 {key:'core',label:'Core',muscles:['abdominals']},
 {key:'other',label:'Other',muscles:[]}
];
function muscleGroupFor(muscle){
 const m=String(muscle||'').toLowerCase();
 return MUSCLE_GROUPS.find(g=>g.key!=='other'&&g.muscles.some(x=>m===x||m.includes(x)))?.key||'other';
}
function markNextWeekStale(){
 if(!nextWeekRecommendation||nextWeekRecommendation.stale)return;
 nextWeekRecommendation={...nextWeekRecommendation,stale:true};saveNextWeekRecommendation();renderNextWeekRecommendation();
}
function renderNextWeekRecommendation(){
 if(!$('nextWeekStatus'))return;
 const rec=nextWeekRecommendation,refresh=$('refreshNextWeek'),view=$('viewNextWeek'),use=$('useNextWeek'),days=$('nextWeekDays');
 refresh.disabled=recommendationBusy||!apiKey;
 view.hidden=!rec;use.hidden=!rec;
 if(recommendationBusy)$('nextWeekStatus').textContent='Gemini is updating…';
 else if(rec){const when=Number.isFinite(Date.parse(rec.generatedAt))?new Date(rec.generatedAt).toLocaleDateString():'';$('nextWeekStatus').textContent=(rec.stale?'Refresh suggested':'Ready')+(when?' · '+when:'');}
 else if(!apiKey)$('nextWeekStatus').textContent='Add a Gemini key to enable recommendations.';
 else if(!history.length)$('nextWeekStatus').textContent='Save a workout to start recommendations.';
 else $('nextWeekStatus').textContent='Build a plan from your recent training.';
 days.innerHTML=rec?rec.week.days.filter(d=>d.enabled&&d.plan).map(d=>'<span class="next-week-day"><b>'+escape(dayName(d.id).slice(0,3))+'</b>'+escape(d.plan.name)+' · '+d.plan.exercises.length+'</span>').join(''):'';
}
async function refreshNextWeekRecommendation(trigger='manual'){
 if(recommendationBusy)return;
 if(!apiKey){if(trigger==='manual')toast('Add your Gemini API key in Settings first.');return;}
 recommendationBusy=true;renderNextWeekRecommendation();
 try{
  const message='Create a proposal for my recommended training week NEXT WEEK. Use my current week as the baseline and recentTraining as progression evidence. Compare plannedReps/plannedWeight with actualReps/actualWeight for every completed set, and use exercise-level RIR, effort, form, discomfort and notes. If actual reps missed target, especially with RIR 0-1, effort too_hard, form breaking/poor, or discomfort, do not blindly progress that prescription; hold, reduce, or substitute as appropriate. If targets were met with RIR 2-4+, good form, manageable effort and no discomfort, gradual progression may be appropriate. Treat one unusual session cautiously. Consider exercisePreferences: repeated removals are a signal to avoid an exercise, repeated completed/added exercises are a positive preference signal, and persistent exercise notes describe setup preferences that should be respected. Preserve enabled training days and time budgets unless evidence supports a change. Recommend exact exercises, set-by-set reps, rest, and loads. This is a next-week recommendation only; do not claim the current week was changed.';
  const data=await askGemini({message,week,selectedDay:selected,proposal:null,history:[],profile,memory:coachMemory,recentTraining:summarizeHistory(history,catalog,20),preferences:compactPreferences(),model:geminiModel},catalog,apiKey);
  if(data.action!=='proposal'||!data.week)throw new Error('Gemini did not return a next-week plan.');
  nextWeekRecommendation={week:normalizeWeek(data.week),generatedAt:new Date().toISOString(),historyCount:history.length,stale:false,note:String(data.reply||'').slice(0,1200)};
  saveNextWeekRecommendation();
  if(typeof data.memory==='string'&&data.memory.trim()){coachMemory=data.memory.trim().slice(0,4000);saveMemory();}
  if(trigger==='manual')toast('Next-week recommendation updated.');
 }catch(err){
  if(nextWeekRecommendation){nextWeekRecommendation={...nextWeekRecommendation,stale:true};saveNextWeekRecommendation();}
  recordErrorReport(err.diagnostic||{category:'next_week_recommendation'},'Generate next-week recommendation',err.message);
  if(trigger==='manual')toast('Could not update the next-week recommendation.');
 }finally{recommendationBusy=false;renderNextWeekRecommendation();}
}
function showNextWeekRecommendation(){
 if(!nextWeekRecommendation)return;
 const w=nextWeekRecommendation.week;
 const html=w.days.filter(d=>d.enabled&&d.plan).map(d=>{
  const items=d.plan.exercises.map(raw=>{const e=normalizeExercise(raw),name=catalog.find(x=>x.id===e.id)?.name||e.id;const reps=e.setReps.join('/'),load=e.setWeights.some(x=>x>0)?' · '+e.setWeights.join('/')+' lb':'';return '<li><b>'+escape(name)+'</b><small>'+e.sets+' sets · '+escape(reps)+' reps'+escape(load)+' · '+e.rest+'s rest</small></li>';}).join('');
  return '<section class="next-week-review-day"><h3>'+escape(dayName(d.id))+' · '+escape(d.plan.name)+'</h3><ol>'+items+'</ol></section>';
 }).join('');
 modal('<h2>Next week</h2>'+(nextWeekRecommendation.note?'<p class="small muted">'+escape(nextWeekRecommendation.note)+'</p>':'')+html);
}


const normName=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

const ANATOMICAL_NAMES={
 abs:'Abdominals',adductors:'Adductors',biceps:'Biceps',calves:'Calves',chest:'Chest',deltoids:'Deltoids',
 forearm:'Forearms',gluteal:'Glutes',hamstring:'Hamstrings','lower-back':'Lower back',neck:'Neck',obliques:'Obliques',
 quadriceps:'Quadriceps',tibialis:'Tibialis anterior',trapezius:'Trapezius',triceps:'Triceps','upper-back':'Back / lats'
};
const FRONT_ONLY=new Set(['abs','biceps','chest','obliques','quadriceps','tibialis']);
const BACK_ONLY=new Set(['gluteal','hamstring','lower-back','upper-back']);
const safeMuscleSlugs=value=>(Array.isArray(value)?value:[]).map(x=>String(x||'').trim().toLowerCase()).filter(x=>ANATOMICAL_NAMES[x]);
function anatomyView(primary,large=false){
 if(large)return 'dual';
 const p=primary[0];
 return BACK_ONLY.has(p)?'back':'front';
}
function anatomyImageUrl(primary,secondary=[],large=false){
 const p=[...new Set(safeMuscleSlugs(primary))],s=[...new Set(safeMuscleSlugs(secondary).filter(x=>!p.includes(x)))];
 if(!p.length)return '';
 const layers='DC2626:'+p.join(',')+(s.length?'|F59E0B:'+s.join(','):'');
 const view=anatomyView(p,large);
 return 'https://api.anatome.dev/generateImage?gender=male&view='+view+'&layers='+encodeURIComponent(layers)+'&background=transparent&body_color=575757&contour_color=e5e7eb&border_color=c8c8c8&output=raw';
}
function prettyMuscle(value){return String(value||'').replace(/[-_]+/g,' ').replace(/\b\w/g,m=>m.toUpperCase());}
function anatomyLabel(primary,secondary=[],info=null){
 const fallbackPrimary=safeMuscleSlugs(primary).map(x=>ANATOMICAL_NAMES[x]),fallbackSecondary=safeMuscleSlugs(secondary).filter(x=>!primary.includes(x)).map(x=>ANATOMICAL_NAMES[x]);
 const p=(Array.isArray(info?.primaryMuscles)&&info.primaryMuscles.length?info.primaryMuscles.map(prettyMuscle):fallbackPrimary);
 const sec=(Array.isArray(info?.secondaryMuscles)&&info.secondaryMuscles.length?info.secondaryMuscles.map(prettyMuscle):fallbackSecondary);
 const uniqueP=[...new Set(p)],uniqueS=[...new Set(sec.filter(x=>!uniqueP.includes(x)))];
 return '<div class="muscle-legend detailed"><span><i class="primary-dot"></i><b>Primary:</b> '+escape(uniqueP.join(', ')||'Unknown')+'</span>'+(uniqueS.length?'<span><i class="secondary-dot"></i><b>Secondary:</b> '+escape(uniqueS.join(', '))+'</span>':'')+'</div>';
}
function musclePicture(c,large=false,info=null){
 const primary=safeMuscleSlugs(info?.anatome_primary_slugs?.length?info.anatome_primary_slugs:(Array.isArray(c.anatomePrimarySlugs)&&c.anatomePrimarySlugs.length?c.anatomePrimarySlugs:[c.muscleSlug]));
 const secondary=safeMuscleSlugs(info?.anatome_secondary_slugs?.length?info.anatome_secondary_slugs:(c.secondaryMuscleSlugs||[]));
 const url=anatomyImageUrl(primary,secondary,large);
 if(!url)return '';
 return '<div class="muscle-picture '+(large?'large':'')+'"><img loading="lazy" src="'+escape(url)+'" alt="'+escape((primary.map(x=>ANATOMICAL_NAMES[x]).join(', ')||c.muscle)+' highlighted on an anatomical body diagram')+'">'+(large?anatomyLabel(primary,secondary,info):'<small>'+escape(ANATOMICAL_NAMES[primary[0]]||c.muscle)+(secondary.length?' <span class="muscle-secondary-mini">+ '+escape(secondary.map(x=>ANATOMICAL_NAMES[x]).join(', '))+'</span>':'')+'</small>')+'</div>';
}
async function lookupExerciseInfo(c){
 const localInfo={
  anatome_primary_slugs:safeMuscleSlugs(Array.isArray(c.anatomePrimarySlugs)&&c.anatomePrimarySlugs.length?c.anatomePrimarySlugs:[c.muscleSlug]),
  anatome_secondary_slugs:safeMuscleSlugs(c.secondaryMuscleSlugs||[]),
  primaryMuscles:Array.isArray(c.primaryMuscles)&&c.primaryMuscles.length?c.primaryMuscles.slice(0,8):[c.muscle],
  secondaryMuscles:Array.isArray(c.secondaryMuscles)?c.secondaryMuscles.slice(0,8):[]
 };
 const cached=demoMetaCache[c.id]?.exerciseInfo;
 if(cached){demoMetaCache[c.id].usedAt=new Date().toISOString();saveDemoMetaCache();return cached;}
 if(!c.exerciseInfoUrl)return localInfo;
 try{
  const response=await fetch(c.exerciseInfoUrl,{credentials:'omit',cache:'no-store'});
  if(!response.ok)throw new Error('exercise info unavailable');
  const raw=await response.json(),data=raw?.exercise||raw?.data||raw;
  const info={
   anatome_primary_slugs:safeMuscleSlugs(data?.anatome_primary_slugs?.length?data.anatome_primary_slugs:localInfo.anatome_primary_slugs),
   anatome_secondary_slugs:safeMuscleSlugs(data?.anatome_secondary_slugs?.length?data.anatome_secondary_slugs:localInfo.anatome_secondary_slugs),
   primaryMuscles:Array.isArray(data?.primaryMuscles)&&data.primaryMuscles.length?data.primaryMuscles.slice(0,8):localInfo.primaryMuscles,
   secondaryMuscles:Array.isArray(data?.secondaryMuscles)?data.secondaryMuscles.slice(0,8):localInfo.secondaryMuscles
  };
  demoMetaCache[c.id]={...(demoMetaCache[c.id]||{}),exerciseInfo:info,usedAt:new Date().toISOString(),source:'anatome'};
  saveDemoMetaCache();return info;
 }catch{return localInfo;}
}

let wgerExerciseIndexPromise=null;
let youtubeDemoIndexPromise=null;
function safeWgerVideoUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='wger.de'||u.hostname.endsWith('.wger.de'))?u.href:null;}catch{return null;}
}
function safeYoutubeId(value){const id=String(value||'').trim();return /^[A-Za-z0-9_-]{6,20}$/.test(id)?id:null;}
async function lookupDemoVideos(c){
 const cached=demoMetaCache[c.id];
 if(cached?.videos?.length){cached.usedAt=new Date().toISOString();saveDemoMetaCache();return cached.videos;}
 try{
  if(!wgerExerciseIndexPromise)wgerExerciseIndexPromise=fetch('https://wger.de/api/v2/exerciseinfo/?limit=1000',{credentials:'omit',cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('wger unavailable');return r.json();});
  const data=await wgerExerciseIndexPromise,items=Array.isArray(data?.results)?data.results:[];
  const wantedNames=[c.name,...(Array.isArray(c.demoLookupNames)?c.demoLookupNames:[]),...(Array.isArray(c.aliases)?c.aliases:[])].map(normName).filter(Boolean);
  const wantedTokenSets=wantedNames.map(n=>new Set(n.split(' ').filter(Boolean)));
  const candidates=items.map(item=>{
   const names=[];for(const t of item?.translations||[]){if(t?.name)names.push(t.name);for(const a of t?.aliases||[])if(a?.alias)names.push(a.alias);}
   const normalized=names.map(normName);
   if(normalized.some(n=>wantedNames.includes(n)))return {item,score:2};
   let best=0;
   for(const n of normalized){
    const ts=new Set(n.split(' ').filter(Boolean));if(!ts.size)continue;
    for(const wantedTokens of wantedTokenSets){
     if(!wantedTokens.size)continue;
     let hit=0;for(const t of wantedTokens)if(ts.has(t))hit++;
     const coverage=hit/wantedTokens.size,specificity=hit/ts.size,score=coverage*.7+specificity*.3;
     if(score>best)best=score;
    }
   }
   return {item,score:best};
  }).sort((x,y)=>y.score-x.score);
  const match=candidates[0]?.score===2||(
   candidates[0]?.score>=.88&&(!candidates[1]||candidates[0].score-candidates[1].score>=.12)
  )?candidates[0].item:null;
  const videos=(match?.videos||[]).map(v=>({url:safeWgerVideoUrl(v.video),author:String(v.license_author||'').slice(0,120),title:String(v.license_title||'').slice(0,160),isMain:!!v.is_main,duration:Number(v.duration)||0,source:'wger'})).filter(v=>v.url).sort((x,y)=>Number(y.isMain)-Number(x.isMain)).slice(0,4);
  if(videos.length){demoMetaCache[c.id]={...(demoMetaCache[c.id]||{}),videos,usedAt:new Date().toISOString(),videoSource:'wger'};saveDemoMetaCache();}
  return videos;
 }catch{return [];}
}
async function lookupYoutubeDemos(c){
 const cached=demoMetaCache[c.id];
 if(cached?.youtubeDemos?.length){cached.usedAt=new Date().toISOString();saveDemoMetaCache();return cached.youtubeDemos;}
 try{
  if(!youtubeDemoIndexPromise)youtubeDemoIndexPromise=fetch('youtube-demos.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('youtube demo index unavailable');return r.json();});
  const index=await youtubeDemoIndexPromise,raw=Array.isArray(index?.demos?.[c.id])?index.demos[c.id]:[];
  const demos=raw.map(v=>({
   youtubeId:safeYoutubeId(v.youtubeId),
   type:v.type==='short'?'short':'standard',
   priority:Number.isFinite(Number(v.priority))?Number(v.priority):99,
   startSeconds:Number.isFinite(Number(v.startSeconds))?Math.max(0,Math.floor(Number(v.startSeconds))):0,
   durationSeconds:Number.isFinite(Number(v.durationSeconds))?Math.max(0,Math.floor(Number(v.durationSeconds))):0,
   clipSeconds:Number.isFinite(Number(v.clipSeconds))?Math.max(6,Math.min(15,Math.floor(Number(v.clipSeconds)))):0,
   aspectRatio:String(v.aspectRatio||''),
   channel:String(v.channel||'').slice(0,120),
   title:String(v.title||'').slice(0,160),
   source:String(v.source||'youtube')
  })).filter(v=>v.youtubeId).sort((x,y)=>x.priority-y.priority||Number(x.type==='short')-Number(y.type==='short')).slice(0,3);
  if(demos.length){demoMetaCache[c.id]={...(demoMetaCache[c.id]||{}),youtubeDemos:demos,usedAt:new Date().toISOString(),youtubeSource:'curated'};saveDemoMetaCache();}
  return demos;
 }catch{return [];}
}
function youtubeEmbedUrl(v){
 const id=safeYoutubeId(v?.youtubeId);if(!id)return '';
 const start=Math.max(0,Math.floor(Number(v.startSeconds)||0));
 const requested=Number(v.clipSeconds)||(v.type==='short'?(Number(v.durationSeconds)||15):12);
 const clip=Math.max(6,Math.min(15,Math.floor(requested||12))),end=start+clip;
 return 'https://www.youtube-nocookie.com/embed/'+id+'?autoplay=1&mute=1&playsinline=1&controls=1&rel=0&modestbranding=1&start='+start+'&end='+end+'&loop=1&playlist='+id;
}
function startImageDemo(c){
 const media=$('demoMedia');if(!media)return;
 const images=[...new Set((c.images||[]).filter(Boolean))];
 if(images.length<2){
  media.innerHTML='<img id="demoImage" class="demo" src="'+escape(images[0]||anatomyImageUrl([c.muscleSlug],c.secondaryMuscleSlugs||[],true))+'" alt="Anatomy reference for '+escape(c.name)+'"><p class="small muted">No exact motion demo matched yet · anatomy reference shown</p>';
  return;
 }
 media.innerHTML='<img id="demoImage" class="demo" src="'+escape(images[0])+'" alt="Exercise demonstration"><button id="demoToggle" class="secondary">Pause</button>';
 let frame=0;const play=()=>setInterval(()=>{const img=$('demoImage');if(img)img.src=images[(++frame)%images.length];},1200);demoInterval=play();
 $('demoToggle').onclick=()=>{if(demoInterval){clearInterval(demoInterval);demoInterval=null;$('demoToggle').textContent='Play';}else{demoInterval=play();$('demoToggle').textContent='Pause';}};
}
function renderAnimatedDemo(c){
 const media=$('demoMedia');if(!media)return;
 if(!c.demoGif){startImageDemo(c);return;}
 media.innerHTML='<img id="demoGif" class="demo-gif" src="'+escape(c.demoGif)+'" alt="Animated demonstration for '+escape(c.name)+'"><p class="small muted">Animated demo · exact library match</p>';
 const img=$('demoGif');if(img)img.onerror=()=>startImageDemo(c);
}
async function openExerciseDemo(c){
 modal('<h2>'+escape(c.name)+'</h2><div id="anatomyDetail">'+musclePicture(c,true)+'</div><div id="demoMedia" class="demo-media"><div class="notice">Loading demo…</div></div><details class="compact-details"><summary><b>Instructions</b></summary><ol>'+c.instructions.map(s=>'<li>'+escape(s)+'</li>').join('')+'</ol></details><p class="small muted">Demo priority: verified wger video → curated YouTube clip → exact animated demo → start/end images or anatomy. If a clip is wrong or unavailable, tap Demo problem and the app will remember to skip it on this device.</p>');
 const infoPromise=lookupExerciseInfo(c);
 const problemKey=(kind,v)=>kind==='wger'?'wger:'+String(v?.url||''):'youtube:'+String(v?.youtubeId||'')+':'+String(v?.startSeconds||0);
 const blocked=key=>!!demoProblems[c.id]?.[key];
 const flag=key=>{if(!key)return;const current=demoProblems[c.id]&&typeof demoProblems[c.id]==='object'?demoProblems[c.id]:{};current[key]=new Date().toISOString();demoProblems[c.id]=current;saveDemoProblems();};
 let videos=(await lookupDemoVideos(c)).filter(v=>!blocked(problemKey('wger',v))),youtubeDemos=[];
 if(!videos.length)youtubeDemos=(await lookupYoutubeDemos(c)).filter(v=>!blocked(problemKey('youtube',v)));
 const info=await infoPromise;
 if(!$('modal').open||!$('demoMedia'))return;
 $('anatomyDetail').innerHTML=musclePicture(c,true,info);
 const animatedLabel=c.demoGif?'Animated demo':'Anatomy reference';
 let active=null;
 const actions=()=>'<div class="demo-health-actions"><button class="secondary" data-demo-next>Try another demo</button>'+(active?'<button class="secondary" data-demo-problem>Demo problem</button>':'')+'</div>';
 const renderAnimated=message=>{active=null;renderAnimatedDemo(c);if(message&&$('demoMedia'))$('demoMedia').insertAdjacentHTML('beforeend','<p class="small muted">'+escape(message)+'</p>');};
 const ensureYoutube=async()=>{if(!youtubeDemos.length)youtubeDemos=(await lookupYoutubeDemos(c)).filter(v=>!blocked(problemKey('youtube',v)));return youtubeDemos;};
 const renderVideo=index=>{
  const v=videos[index];if(!v){ensureYoutube().then(list=>list.length?renderYoutube(0):renderAnimated('No other verified motion demo is available yet.'));return;}
  active={kind:'wger',key:problemKey('wger',v),index};
  $('demoMedia').innerHTML='<video id="demoVideo" class="demo-video" controls muted loop playsinline preload="metadata" src="'+escape(v.url)+'"></video><div class="demo-switcher">'+videos.map((_,i)=>'<button class="'+(i===index?'primary':'secondary')+'" data-demo-view="'+i+'">Video '+(i+1)+'</button>').join('')+'<button class="secondary" data-demo-animated>'+animatedLabel+'</button></div>'+actions()+'<p class="small muted">'+escape(v.author?'Video by '+v.author:'Video via wger')+(v.title?' · '+escape(v.title):'')+'</p>';
  const player=$('demoVideo'),videoKey=active.key;player?.play?.().catch(()=>{});
  if(player)player.onerror=async()=>{flag(videoKey);videos=videos.filter(x=>problemKey('wger',x)!==videoKey);active=null;if(videos.length)renderVideo(0);else{const list=await ensureYoutube();if(list.length)renderYoutube(0);else renderAnimated('That video failed to load and was skipped.');}};
 };
 const renderYoutube=index=>{
  const v=youtubeDemos[index];if(!v){renderAnimated('No other verified motion demo is available yet.');return;}
  const src=youtubeEmbedUrl(v);if(!src){renderAnimated('This clip could not be opened.');return;}
  active={kind:'youtube',key:problemKey('youtube',v),index};
  const vertical=v.aspectRatio==='9:16',label=v.type==='short'?'Short '+(index+1):'Clip '+(index+1);
  $('demoMedia').innerHTML='<iframe id="demoYoutube" class="demo-youtube'+(vertical?' vertical':'')+'" src="'+escape(src)+'" title="Exercise demonstration for '+escape(c.name)+'" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe><div class="demo-switcher">'+youtubeDemos.map((x,i)=>'<button class="'+(i===index?'primary':'secondary')+'" data-youtube-view="'+i+'">'+(x.type==='short'?'Short ':'Clip ')+(i+1)+'</button>').join('')+'<button class="secondary" data-demo-animated>'+animatedLabel+'</button></div>'+actions()+'<p class="small muted">'+escape(label+' · YouTube'+(v.channel?' · '+v.channel:''))+' · streamed on demand</p>';
 };
 const nextDemo=async()=>{
  if(active?.kind==='wger'){
   if(videos[active.index+1])return renderVideo(active.index+1);
   const list=await ensureYoutube();if(list.length)return renderYoutube(0);
  }else if(active?.kind==='youtube'&&youtubeDemos[active.index+1])return renderYoutube(active.index+1);
  renderAnimated('Showing the local fallback.');
 };
 if(videos.length)renderVideo(0);else{youtubeDemos=await ensureYoutube();if(youtubeDemos.length)renderYoutube(0);else renderAnimated('No verified motion demo matched this exercise yet.');}
 $('demoMedia').onclick=async e=>{
  const b=e.target.closest('[data-demo-view]');if(b){renderVideo(Number(b.dataset.demoView)||0);return;}
  const y=e.target.closest('[data-youtube-view]');if(y){renderYoutube(Number(y.dataset.youtubeView)||0);return;}
  if(e.target.closest('[data-demo-animated]')){renderAnimated('Showing the local fallback.');return;}
  if(e.target.closest('[data-demo-next]')){await nextDemo();return;}
  if(e.target.closest('[data-demo-problem]')&&active){
   const bad={...active};flag(bad.key);active=null;
   if(bad.kind==='wger'){
    videos=videos.filter(v=>problemKey('wger',v)!==bad.key);
    toast('Demo skipped. The app will avoid it next time.');
    if(videos.length)renderVideo(Math.min(bad.index,videos.length-1));
    else{const list=await ensureYoutube();if(list.length)renderYoutube(0);else renderAnimated('Showing the local fallback.');}
   }else{
    youtubeDemos=youtubeDemos.filter(v=>problemKey('youtube',v)!==bad.key);
    toast('Demo skipped. The app will avoid it next time.');
    if(youtubeDemos.length)renderYoutube(Math.min(bad.index,youtubeDemos.length-1));else renderAnimated('Showing the local fallback.');
   }
  }
 };
}

function promptExerciseFeedback(index){
 let ex=normalizeExercise(plan.exercises[index]),c=catalog.find(x=>x.id===ex.id);if(!c)return;
 const optionButtons=(attr,values,current)=>values.map(([value,label])=>'<button data-'+attr+'="'+value+'" class="'+(current===value?'primary':'secondary')+'">'+label+'</button>').join('');
 modal('<h2>'+escape(c.name)+'</h2><p>How many more good reps could you have done?</p><div class="rir-grid">'+[0,1,2,3,4].map(v=>'<button data-rir="'+v+'" class="'+(ex.rir===v?'primary':'secondary')+'">'+(v===4?'4+':v)+'</button>').join('')+'</div><label class="feedback-label">Difficulty</label><div class="feedback-choice">'+optionButtons('effort',[['too_easy','Too easy'],['right','About right'],['too_hard','Too hard']],ex.effort)+'</div><label class="feedback-label">Form quality</label><div class="feedback-choice">'+optionButtons('form',[['good','Good'],['breaking','Breaking down'],['poor','Poor']],ex.form)+'</div><label class="feedback-label">Discomfort</label><div class="feedback-choice">'+optionButtons('discomfort',[['none','None'],['mild','Some'],['pain','Painful']],ex.discomfort||'none')+'</div><label>Session note <input id="exerciseNote" maxlength="500" placeholder="Optional: setup, fatigue, technique…" value="'+escape(ex.note||'')+'"></label><p class="small muted">These signals are saved with this workout and used to make future progression more conservative or aggressive. Pain is never used to diagnose an injury.</p><button id="saveFeedback" class="primary wide">Save feedback</button><button id="skipRir" class="secondary wide">Skip</button>');
 const state={rir:ex.rir,effort:ex.effort,form:ex.form,discomfort:ex.discomfort||'none'};
 const select=(attr,value)=>{state[attr]=value;$('modalBody').querySelectorAll('[data-'+attr+']').forEach(x=>x.className=x.dataset[attr]===String(value)?'primary':'secondary');};
 $('modalBody').onclick=e=>{
  const r=e.target.closest('[data-rir]');if(r){select('rir',Number(r.dataset.rir));return;}
  for(const attr of ['effort','form','discomfort']){const b=e.target.closest('[data-'+attr+']');if(b){select(attr,b.dataset[attr]);return;}}
  if(e.target.closest('#saveFeedback')){plan.exercises[index]=setExerciseFeedback(ex,state.rir,$('exerciseNote').value,{effort:state.effort,form:state.form,discomfort:state.discomfort});save();render();$('modal').close();return;}
  if(e.target.closest('#skipRir'))$('modal').close();
 };
}

function exerciseMuscleDetail(c){
 const primary=(Array.isArray(c.primaryMuscles)&&c.primaryMuscles.length?c.primaryMuscles:(Array.isArray(c.anatomePrimarySlugs)&&c.anatomePrimarySlugs.length?c.anatomePrimarySlugs:[c.muscleSlug||c.muscle])).map(prettyMuscle);
 const secondary=(Array.isArray(c.secondaryMuscles)&&c.secondaryMuscles.length?c.secondaryMuscles:(c.secondaryMuscleSlugs||[])).map(prettyMuscle);
 return '<div class="exercise-muscle-detail"><span><b>Primary</b> '+escape([...new Set(primary)].join(', ')||prettyMuscle(c.muscle))+'</span>'+(secondary.length?'<span><b>Secondary</b> '+escape([...new Set(secondary)].join(', '))+'</span>':'')+'</div>';
}
function renderExerciseCard(raw,i){
 const e=normalizeExercise(raw),c=catalog.find(x=>x.id===e.id);plan.exercises[i]=e;
 const collapsed=collapsedExercises.has(exerciseCollapseKey(e.id)),bodyId='exercise-body-'+i;
 const previous=lastExercisePerformance(history,e.id),signal=exerciseProgressionSignal(history,e.id);
 const last=previous?'<p class="small muted last-performance"><b>Last · '+escape(new Date(previous.date).toLocaleDateString())+'</b><br>'+escape(previous.sets.map((v,n)=>'S'+(n+1)+' '+v.reps+(v.weight?' @ '+v.weight+' lb':' BW')+(v.reps<v.plannedReps?' · target '+v.plannedReps:'')).join(' · '))+(previous.rir!=null?'<br>RIR '+(previous.rir===4?'4+':previous.rir):'')+(previous.effort? ' · '+escape(previous.effort.replaceAll('_',' ')):'')+(previous.form?' · form '+escape(previous.form):'')+(previous.discomfort&&previous.discomfort!=='none'?'<br>Discomfort: '+escape(previous.discomfort):'')+'</p>':'';
 const rows=e.setReps.map((reps,n)=>{
  const target=e.plannedReps[n]+' rep'+(e.plannedReps[n]===1?'':'s')+(e.plannedWeights[n]>0?' @ '+e.plannedWeights[n]+' lb':' · BW');
  return '<div class="set-row '+(n<e.done?'done':'')+'"><div class="set-target"><b>Set '+(n+1)+'</b><small>Target '+escape(target)+'</small></div><label>Actual<input aria-label="'+escape(c.name)+' set '+(n+1)+' actual reps" type="number" data-index="'+i+'" data-set-index="'+n+'" data-set-field="reps" min="1" max="50" value="'+reps+'" '+(busy?'disabled':'')+'></label><label>Load<input aria-label="'+escape(c.name)+' set '+(n+1)+' actual load" type="number" data-index="'+i+'" data-set-index="'+n+'" data-set-field="weight" min="0" max="1000" step="0.5" value="'+e.setWeights[n]+'" '+(busy?'disabled':'')+'></label><button class="set-button '+(n<e.done?'done':'')+'" data-set="'+i+'" data-n="'+n+'" '+(busy?'disabled':'')+'>'+(n<e.done?'✓':'Done')+'</button></div>';
 }).join('');
 const feedback=e.done===e.sets?'<button class="secondary" data-feedback="'+i+'">'+(e.rir==null?'Rate effort':'RIR '+(e.rir===4?'4+':e.rir)+(e.effort?' · '+e.effort.replaceAll('_',' '):''))+'</button>':'';
 const permanentNote=String(exerciseNotes[e.id]||'').trim();
 const signalHtml=signal.sessions?'<div class="progression-signal '+escape(signal.action)+'"><b>'+escape(signal.label)+'</b><span>'+escape(signal.reason)+'</span></div>':'';
 return '<article class="card exercise-card '+(collapsed?'collapsed':'')+'"><div class="card-top"><button data-demo="'+e.id+'" aria-label="Demonstration for '+escape(c.name)+'" class="thumb-button"><img class="thumb" src="'+c.images[0]+'" alt="'+escape(c.name)+' starting position"></button><div class="exercise-title"><h3>'+escape(c.name)+'</h3><span class="tag">'+escape(c.muscle)+' · '+escape(c.equipment)+'</span></div>'+musclePicture(c)+'<button class="exercise-collapse-button" data-collapse="'+i+'" aria-expanded="'+(!collapsed)+'" aria-controls="'+bodyId+'" aria-label="'+(collapsed?'Expand ':'Collapse ')+escape(c.name)+'"><span aria-hidden="true">⌄</span></button></div><div id="'+bodyId+'" class="exercise-card-body" '+(collapsed?'hidden':'')+'>'+exerciseMuscleDetail(c)+signalHtml+(permanentNote?'<div class="exercise-setup-note"><b>Your setup note</b><span>'+escape(permanentNote)+'</span></div>':'')+last+'<div class="fields two"><label>Sets<input type="number" data-index="'+i+'" data-field="sets" value="'+e.sets+'" min="1" max="10" '+(busy?'disabled':'')+'></label><label>Rest<input type="number" data-index="'+i+'" data-field="rest" value="'+e.rest+'" min="15" max="600" '+(busy?'disabled':'')+'></label></div><div class="set-list"><div class="set-head"><span>Set / target</span><span>Actual</span><span>Load</span><span></span></div>'+rows+'</div><div class="row exercise-actions"><button class="secondary" data-demo="'+e.id+'">Demo</button>'+feedback+'<button class="secondary" data-setup-note="'+i+'">'+(permanentNote?'Setup note ✓':'Setup note')+'</button><button class="secondary" data-replace="'+i+'" '+(busy?'disabled':'')+'>Replace</button><button class="secondary" data-remove="'+i+'" '+(busy?'disabled':'')+'>Remove</button></div></div></article>';
}

function openSetupNote(index){
 const e=normalizeExercise(plan.exercises[index]),c=catalog.find(x=>x.id===e.id);if(!c)return;
 modal('<h2>'+escape(c.name)+' setup note</h2><p class="small muted">This note stays attached to the exercise and is available to the trainer when planning.</p><textarea id="setupNoteText" rows="5" maxlength="300" placeholder="Bench setting, cable height, grip, cues…">'+escape(exerciseNotes[e.id]||'')+'</textarea><div class="row"><button id="saveSetupNote" class="primary">Save</button><button id="clearSetupNote" class="secondary">Clear</button></div>');
 $('saveSetupNote').onclick=()=>{const value=$('setupNoteText').value.trim().slice(0,300);if(value)exerciseNotes[e.id]=value;else delete exerciseNotes[e.id];saveExerciseNotes();render();$('modal').close();toast('Setup note saved.');};
 $('clearSetupNote').onclick=()=>{delete exerciseNotes[e.id];saveExerciseNotes();render();$('modal').close();toast('Setup note cleared.');};
}
function openReplacementPicker(index){
 const current=normalizeExercise(plan.exercises[index]),source=catalog.find(x=>x.id===current.id);if(!source)return;
 if(current.done&&!confirm('Replace this exercise and discard its unsaved completed sets?'))return;
 const sourceGroup=muscleGroupFor(source.muscle),sourceMuscle=normName(source.muscle),sourceEquipment=normName(source.equipment);
 const pool=catalog.filter(c=>c.id!==source.id&&!plan.exercises.some((e,i)=>i!==index&&e.id===c.id)).map(c=>{
  const sameMuscle=normName(c.muscle)===sourceMuscle,sameEquipment=normName(c.equipment)===sourceEquipment,sameGroup=muscleGroupFor(c.muscle)===sourceGroup;
  const pref=exercisePreferences[c.id]||{},preference=(Number(pref.completed)||0)+(Number(pref.added)||0)-(Number(pref.removed)||0)*1.5;
  return {c,score:(sameMuscle?12:0)+(sameEquipment?4:0)+(sameGroup?2:0)+Math.max(-4,Math.min(4,preference)),sameMuscle,sameEquipment,sameGroup};
 }).filter(x=>x.sameMuscle||x.sameGroup).sort((a,b)=>b.score-a.score||a.c.name.localeCompare(b.c.name)).slice(0,30);
 const button=x=>'<button class="exercise-pick replacement-pick" data-replacement="'+escape(x.c.id)+'"><span>'+escape(x.c.name)+'</span><small>'+escape(x.c.muscle)+' · '+escape(x.c.equipment)+(x.sameMuscle&&x.sameEquipment?' · same muscle & equipment':x.sameMuscle?' · same muscle':' · related muscle group')+'</small></button>';
 modal('<h2>Replace '+escape(source.name)+'</h2><p class="small muted">Alternatives are ranked by muscle match, equipment and your local exercise preferences. Reps, sets and rest are preserved; load resets because weights are not interchangeable between exercises.</p><div class="exercise-results">'+(pool.length?pool.map(button).join(''):'<div class="notice">No close substitutes found.</div>')+'</div>');
 $('modalBody').onclick=e=>{const b=e.target.closest('[data-replacement]');if(!b)return;const nextId=b.dataset.replacement;
  const old=normalizeExercise(plan.exercises[index]),reps=[...old.plannedReps],zero=Array(old.sets).fill(0);
  plan.exercises[index]=normalizeExercise({id:nextId,sets:old.sets,reps:reps[0],rest:old.rest,weight:0,done:0,setReps:reps,setWeights:zero,plannedReps:reps,plannedWeights:zero});
  recordExercisePreference(old.id,'removed');recordExercisePreference(nextId,'added');if(timer.day===selected&&timer.exerciseId===old.id)timer={};undo=null;save();markNextWeekStale();render();$('modal').close();toast('Exercise replaced. Set the new exercise load before training.');
 };
}

function renderDashboardSummary(){
 const review=weeklyTrainingReview(history,catalog,{days:7,now:Date.now()});
 if($('todayDateLabel'))$('todayDateLabel').textContent=new Date().toLocaleDateString(undefined,{month:'short',day:'numeric'});
 if($('dashWorkouts'))$('dashWorkouts').textContent=String(review.sessions||0);
 if($('dashSets'))$('dashSets').textContent=String(review.sets||0);
 if($('dashAdherence'))$('dashAdherence').textContent=review.sets?review.adherencePct+'%':'—';
 const enabled=week.days.filter(d=>d.enabled).length;
 const now=new Date(),day=(now.getDay()+6)%7,start=new Date(now.getFullYear(),now.getMonth(),now.getDate()-day),end=new Date(start.getTime()+7*86400000);
 const completedDays=new Set(history.filter(h=>{const t=new Date(h.date);return t>=start&&t<end;}).map(h=>h.day).filter(Boolean));
 const completedScheduled=week.days.filter(d=>d.enabled&&completedDays.has(d.id)).length;
 const consistency=enabled?Math.min(100,Math.round(completedScheduled/enabled*100)):0;
 if($('dashConsistency'))$('dashConsistency').textContent=consistency+'%';
}
function renderHeroMuscle(active){
 const target=$('heroMuscle');if(!target)return;
 if(!active||!plan.exercises.length){target.innerHTML='';return;}
 const c=catalog.find(x=>x.id===plan.exercises[0].id);
 target.innerHTML=c?musclePicture(c):'';
}
function render(){
 renderWeek();renderNextWeekRecommendation();renderDashboardSummary();
 const active=currentDay().enabled;
 $('sessionLabel').textContent=dayName(selected).toUpperCase()+' · '+(active?currentDay().minutes+' MIN BUDGET':'REST DAY');
 $('trainingDetails').hidden=!active;$('newWorkout').hidden=!active;$('progress').hidden=!active;
 $('planName').textContent=active?plan.name:'Rest & recover';const done=completedSetTotal(plan),total=totalSets(plan),estimate=estimatePlanMinutes(plan);
 $('summary').textContent=active?plan.exercises.length+' exercises · '+done+'/'+total+' sets · ~'+estimate+' min':'Rest day';$('progress').value=done;$('progress').max=total;$('undo').disabled=!undo||busy;renderHeroMuscle(active);
 $('exercises').innerHTML=plan.exercises.map(renderExerciseCard).join('');
 $('add').disabled=busy||plan.exercises.length>=12;$('newWorkout').disabled=busy;$('finish').disabled=busy;$('settings').disabled=busy;$('editWeek').disabled=busy;drawProposal();
 const modelName=MODELS.find(m=>m.id===geminiModel)?.name||geminiModel;$('connection').textContent=apiKey?(pending?modelName+' ready · Draft waiting':modelName+' ready'):'Add Gemini key in Settings.';
}
$('exercises').onchange=e=>{
 const i=Number(e.target.dataset.index);if(!Number.isInteger(i))return;const value=Number(e.target.value),next=normalizePlan(structuredClone(plan));
 if(e.target.dataset.setField){const n=Number(e.target.dataset.setIndex);next.exercises[i]=setSetValue(next.exercises[i],n,e.target.dataset.setField,value);}
 else if(e.target.dataset.field==='sets')next.exercises[i]=resizeSets(next.exercises[i],value);
 else if(e.target.dataset.field==='rest')next.exercises[i].rest=value;else return;
 if(e.target.value===''||!validPlan(next,ids)){toast('Please enter a value within the allowed range.');render();return;}
 plan=next;undo=null;save();markNextWeekStale();render();
};

$('exercises').onclick=e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.collapse!==undefined){
  const i=Number(b.dataset.collapse),ex=plan.exercises[i];if(!Number.isInteger(i)||!ex)return;
  const key=exerciseCollapseKey(ex.id);
  if(collapsedExercises.has(key))collapsedExercises.delete(key);else collapsedExercises.add(key);
  saveCollapsedExercises();render();return;
 }
 if(b.dataset.demo){const c=catalog.find(x=>x.id===b.dataset.demo);if(c)openExerciseDemo(c);return;}
 if(b.dataset.feedback!==undefined){promptExerciseFeedback(Number(b.dataset.feedback));return;}
 if(b.dataset.setupNote!==undefined){openSetupNote(Number(b.dataset.setupNote));return;}
 if(busy)return;
 if(b.dataset.replace!==undefined){openReplacementPicker(Number(b.dataset.replace));return;}
 let feedbackIndex=null;
 if(b.dataset.remove!==undefined){
  if(plan.exercises.length===1)return toast('Keep at least one exercise.');
  const removed=plan.exercises[+b.dataset.remove];
  if(removed.done&&!confirm('Remove this exercise and its unsaved completed sets?'))return;
  if(timer.day===selected&&timer.exerciseId===removed.id)timer={};
  recordExercisePreference(removed.id,'removed');plan.exercises.splice(+b.dataset.remove,1);markNextWeekStale();
 }
 if(b.dataset.set!==undefined){
  const i=+b.dataset.set,n=+b.dataset.n,ex=normalizeExercise(plan.exercises[i]);
  if(n<ex.done){ex.done=n;timer={};}
  else if(n===ex.done){
   ex.done++;
   timer={end:Date.now()+ex.rest*1000,day:selected,exerciseId:ex.id};
   if(ex.done===ex.sets){feedbackIndex=i;recordExercisePreference(ex.id,'completed');}
  }else return toast('Complete the next set in order.');
  plan.exercises[i]=ex;
 }
 undo=null;save();render();tick();if(feedbackIndex!==null)setTimeout(()=>promptExerciseFeedback(feedbackIndex),0);
};

function openExercisePicker(){
 if(plan.exercises.length>=12)return toast('A session supports up to 12 exercises.');
 const available=()=>catalog.filter(x=>!plan.exercises.some(e=>e.id===x.id));
 let selectedGroup=null;
 const exerciseButton=x=>'<button class="exercise-pick" data-add="'+escape(x.id)+'"><span>'+escape(x.name)+'</span><small>'+escape(x.muscle)+' · '+escape(x.equipment)+'</small></button>';
 const renderBrowse=()=>{
  const q=$('exerciseSearch').value.trim().toLowerCase(),pool=available(),browse=$('exerciseBrowse');
  if(q){
   const matches=pool.filter(x=>[x.name,x.muscle,x.equipment].join(' ').toLowerCase().includes(q));
   const shown=matches.slice(0,80);$('exerciseEmpty').hidden=matches.length>0;
   browse.innerHTML=matches.length?'<p class="small muted exercise-result-meta">Found '+matches.length+(matches.length>shown.length?' · showing first '+shown.length:'')+'</p><div class="exercise-results">'+shown.map(exerciseButton).join('')+'</div>':'';
   return;
  }
  $('exerciseEmpty').hidden=true;
  if(!selectedGroup){
   browse.innerHTML='<div class="exercise-group-grid">'+MUSCLE_GROUPS.map(g=>{const n=pool.filter(x=>muscleGroupFor(x.muscle)===g.key).length;return n?'<button class="exercise-group" data-muscle-group="'+g.key+'"><span>'+escape(g.label)+'</span><small>'+n+'</small></button>':'';}).join('')+'</div>';
   return;
  }
  const group=MUSCLE_GROUPS.find(g=>g.key===selectedGroup),matches=pool.filter(x=>muscleGroupFor(x.muscle)===selectedGroup),shown=matches.slice(0,80);
  browse.innerHTML='<div class="exercise-browser-head"><button class="secondary" data-group-back>← Groups</button><h3>'+escape(group?.label||'Exercises')+'</h3><small>'+matches.length+'</small></div>'+(matches.length>shown.length?'<p class="small muted">Showing first '+shown.length+'. Search to narrow.</p>':'')+'<div class="exercise-results">'+shown.map(exerciseButton).join('')+'</div>';
 };
 modal('<h2>Add exercise</h2><input id="exerciseSearch" type="search" placeholder="Search exercises" aria-label="Search exercises"><p id="exerciseEmpty" class="small muted" hidden>No matching exercises.</p><div id="exerciseBrowse"></div>');
 $('exerciseSearch').oninput=renderBrowse;
 $('modalBody').onclick=e=>{
  const group=e.target.closest('[data-muscle-group]');if(group){selectedGroup=group.dataset.muscleGroup;renderBrowse();return;}
  if(e.target.closest('[data-group-back]')){selectedGroup=null;renderBrowse();return;}
  const add=e.target.closest('[data-add]');const id=add?.dataset.add;
  if(!id||plan.exercises.length>=12||plan.exercises.some(x=>x.id===id))return;
  plan.exercises.push(normalizeExercise({id,sets:3,reps:12,rest:90,weight:0,done:0}));recordExercisePreference(id,'added');undo=null;save();markNextWeekStale();render();$('modal').close();
 };
 renderBrowse();
}
$('add').onclick=openExercisePicker;
$('newWorkout').onclick=()=>{modal('<h2>New session</h2>'+Object.keys(templates).map(day=>`<button class="wide" data-day="${day}">${day}</button>`).join(''));$('modalBody').onclick=e=>{if(!e.target.dataset.day)return;plan=makePlan(e.target.dataset.day);timer={};undo=null;save();markNextWeekStale();render();tick();$('modal').close();};};

function showSessionComparison(snapshot,comparison,previousById={}){
 const formatSets=(sets=[])=>sets.map((v,n)=>'S'+(n+1)+' '+v.reps+(v.weight?' @ '+v.weight+' lb':' BW')).join(' · ');
 const byExercise=(snapshot.exercises||[]).filter(x=>normalizeExercise(x).done>0).map(raw=>{
  const e=normalizeExercise(raw),name=catalog.find(x=>x.id===e.id)?.name||e.id,previous=previousById[e.id];
  const short=e.setReps.slice(0,e.done).filter((v,i)=>v<e.plannedReps[i]).length;
  const today=Array.from({length:e.done},(_,i)=>({reps:e.setReps[i],weight:e.setWeights[i]}));
  const prior=previous?.sets?.length?'<small class="comparison-previous"><b>Previous:</b> '+escape(formatSets(previous.sets))+'<br><b>Today:</b> '+escape(formatSets(today))+'</small>':'<small class="comparison-previous">First logged comparison for this exercise.</small>';
  return '<div class="comparison-row comparison-row-detailed"><div><b>'+escape(name)+'</b><small>'+e.done+' sets'+(e.rir!=null?' · RIR '+(e.rir===4?'4+':e.rir):'')+'</small>'+prior+'</div><span class="'+(short?'below':'met')+'">'+(short?short+' below target':'On target')+'</span></div>';
 }).join('');
 const repDelta=comparison.actualReps-comparison.plannedReps;
 const volDelta=Math.round(comparison.actualVolume-comparison.plannedVolume);
 modal('<h2>Session complete</h2><div class="comparison-stats"><div><strong>'+comparison.actualReps+'</strong><small>actual reps</small></div><div><strong>'+(repDelta>=0?'+':'')+repDelta+'</strong><small>vs target</small></div><div><strong>'+comparison.metRepSets+'/'+comparison.completedSets+'</strong><small>sets met reps</small></div></div>'+(comparison.plannedVolume>0?'<p class="small muted">Volume: '+Math.round(comparison.actualVolume).toLocaleString()+' lb-reps · '+(volDelta>=0?'+':'')+volDelta.toLocaleString()+' vs target</p>':'')+'<div class="comparison-list">'+byExercise+'</div><button id="viewProgressAfterSession" class="primary wide">View progress</button>');
 $('viewProgressAfterSession').onclick=()=>{$('modal').close();showTab('history');};
}
$('finish').onclick=()=>{
 const count=completedSetTotal(plan);if(!count)return toast('Complete a set before saving.');
 const snapshot=normalizePlan(structuredClone(plan)),comparison=comparePlanPerformance(snapshot),previousById={};
 for(const raw of snapshot.exercises){const e=normalizeExercise(raw);if(e.done)previousById[e.id]=lastExercisePerformance(history,e.id);}
 history.unshift({date:new Date().toISOString(),day:selected,plan:snapshot});history=history.slice(0,200);localStorage.setItem('history',JSON.stringify(history));
 plan.exercises=plan.exercises.map(raw=>{const e=normalizeExercise(raw);return {...e,setReps:[...e.plannedReps],setWeights:[...e.plannedWeights],reps:e.plannedReps[0],weight:e.plannedWeights[0],done:0,rir:null,note:'',effort:'',form:'',discomfort:''};});
 timer={};undo=null;save();render();tick();showSessionComparison(snapshot,comparison,previousById);if(apiKey)refreshNextWeekRecommendation('session');
};
function tick(){const left=secondsLeft(timer);$('timerLabel').textContent=timer.day?dayName(timer.day)+' · REST':'REST BETWEEN SETS';$('timer').hidden=!timer.end&&timer.paused==null;$('time').textContent=`${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')}`;$('pause').textContent=timer.paused!=null?'Resume':'Pause';if(timer.end&&left===0){timer={};save();$('timer').hidden=true;toast('Rest complete — ready for your next set.');navigator.vibrate?.([150,80,150]);}}
$('pause').onclick=()=>{timer=timer.paused!=null?{...timer,end:Date.now()+timer.paused*1000,paused:null}:{...timer,end:null,paused:secondsLeft(timer)};save();tick();};$('plus').onclick=()=>{if(timer.paused!=null)timer.paused+=15;else timer.end=Math.max(timer.end||0,Date.now())+15000;save();tick();};$('skip').onclick=()=>{timer={};save();tick();};setInterval(tick,250);document.addEventListener('visibilitychange',tick);

function chartSvg(points,keyA,keyB=null,labelA='Actual',labelB='Target'){
 const values=points.flatMap(p=>[Number(p[keyA])||0,keyB==null?null:Number(p[keyB])||0].filter(v=>v!==null));
 if(points.length<2)return '<div class="chart-empty">More sessions needed</div>';
 const w=320,h=112,pad=14,min=Math.min(...values),max=Math.max(...values),span=Math.max(1,max-min);
 const xy=(value,i)=>[(pad+i*(w-pad*2)/Math.max(1,points.length-1)).toFixed(1),(h-pad-(Number(value)-min)*(h-pad*2)/span).toFixed(1)];
 const line=key=>points.map((p,i)=>xy(p[key],i).join(',')).join(' ');
 const start=new Date(points[0].date).toLocaleDateString(undefined,{month:'short',day:'numeric'}),end=new Date(points.at(-1).date).toLocaleDateString(undefined,{month:'short',day:'numeric'});
 return '<svg class="progress-svg" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" aria-label="'+escape(labelA+(keyB?' and '+labelB:''))+' progression"><polyline class="chart-line actual" points="'+line(keyA)+'"/>'+(keyB?'<polyline class="chart-line target" points="'+line(keyB)+'"/>':'')+'</svg><div class="chart-axis"><span>'+escape(start)+'</span><span>'+escape(end)+'</span></div><div class="chart-legend"><span class="actual">'+escape(labelA)+'</span>'+(keyB?'<span class="target">'+escape(labelB)+'</span>':'')+'</div>';
}
function formatTrend(value){if(value==null)return 'Building baseline';return (value>0?'+':'')+value.toFixed(1)+'%';}
function localDateKey(value){const d=value instanceof Date?value:new Date(value);if(Number.isNaN(d.getTime()))return '';return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
let calendarCursor=new Date(new Date().getFullYear(),new Date().getMonth(),1),selectedCalendarDate=localDateKey(new Date());
function anatomyHeatmapUrl(load){
 const safe=(load||[]).filter(x=>ANATOMICAL_NAMES[x.slug]&&x.sets>0);if(!safe.length)return '';
 const max=Math.max(...safe.map(x=>x.sets)),strong=safe.filter(x=>x.sets/max>=.67).map(x=>x.slug),medium=safe.filter(x=>x.sets/max>=.34&&x.sets/max<.67).map(x=>x.slug),light=safe.filter(x=>x.sets/max<.34).map(x=>x.slug);
 const layers=[strong.length?'DC2626:'+strong.join(','):'',medium.length?'F97316:'+medium.join(','):'',light.length?'FACC15:'+light.join(','):''].filter(Boolean).join('|');
 return 'https://api.anatome.dev/generateImage?gender=male&view=dual&layers='+encodeURIComponent(layers)+'&background=transparent&body_color=575757&contour_color=e5e7eb&border_color=c8c8c8&output=raw';
}
function renderWeeklyReview(){
 const review=weeklyTrainingReview(history,catalog,{days:7,now:Date.now()}),end=new Date(),start=new Date(Date.now()-6*86400000);
 $('weeklyReviewRange').textContent=start.toLocaleDateString(undefined,{month:'short',day:'numeric'})+'–'+end.toLocaleDateString(undefined,{month:'short',day:'numeric'});
 if(!review.sessions){$('weeklyReview').innerHTML='<div class="notice">No logged workouts in the last 7 days yet.</div>';return;}
 const top=review.muscles.slice(0,4).map(x=>(ANATOMICAL_NAMES[x.slug]||prettyMuscle(x.slug))+' '+x.sets+' set exposure').join(' · ');
 $('weeklyReview').innerHTML='<div class="review-stats"><div><strong>'+review.sessions+'</strong><small>workouts</small></div><div><strong>'+review.sets+'</strong><small>logged sets</small></div><div><strong>'+review.adherencePct+'%</strong><small>targets met</small></div><div><strong>'+(review.avgRir==null?'—':review.avgRir)+'</strong><small>avg RIR</small></div></div>'+(top?'<p class="small muted"><b>Most trained:</b> '+escape(top)+'</p>':'')+(review.formWarnings?'<p class="small muted">'+review.formWarnings+' exercise rating'+(review.formWarnings===1?'':'s')+' reported form breaking down.</p>':'')+(review.discomfortReports?'<p class="small warning-text">'+review.discomfortReports+' discomfort report'+(review.discomfortReports===1?'':'s')+' logged. Progression is paused for those exercises until you reassess them.</p>':'');
}
function renderTrainingCalendar(){
 const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth(),first=new Date(y,m,1),days=new Date(y,m+1,0).getDate(),offset=(first.getDay()+6)%7;
 $('calendarTitle').textContent=first.toLocaleDateString(undefined,{month:'long',year:'numeric'});
 const sessionsByDate=new Map();for(const h of history){const key=localDateKey(h.date);if(!key)continue;const list=sessionsByDate.get(key)||[];list.push(h);sessionsByDate.set(key,list);}
 const today=localDateKey(new Date()),cells=[];
 for(let i=0;i<offset;i++)cells.push('<span class="calendar-cell blank" aria-hidden="true"></span>');
 for(let d=1;d<=days;d++){
  const date=new Date(y,m,d),key=localDateKey(date),dayId=DAYS[(date.getDay()+6)%7],scheduled=week.days[DAYS.indexOf(dayId)]?.enabled,logged=sessionsByDate.has(key),classes=['calendar-cell'];
  if(logged)classes.push('logged');if(scheduled)classes.push('planned');if(key===today)classes.push('today');if(key===selectedCalendarDate)classes.push('selected');
  cells.push('<button class="'+classes.join(' ')+'" data-calendar-date="'+key+'" aria-label="'+escape(date.toLocaleDateString())+(logged?' logged workout':'')+(scheduled?' scheduled workout':'')+'"><span>'+d+'</span><i class="calendar-markers">'+(logged?'<b class="logged">✓</b>':'')+(scheduled?'<b class="planned">•</b>':'')+'</i></button>');
 }
 $('calendarGrid').innerHTML=cells.join('');
 const chosen=selectedCalendarDate?new Date(Number(selectedCalendarDate.slice(0,4)),Number(selectedCalendarDate.slice(5,7))-1,Number(selectedCalendarDate.slice(8,10))):null;
 if(!chosen||chosen.getFullYear()!==y||chosen.getMonth()!==m){$('calendarDayDetails').innerHTML='Tap a day to see its workout.';return;}
 const list=sessionsByDate.get(selectedCalendarDate)||[],dayId=DAYS[(chosen.getDay()+6)%7],scheduled=week.days[DAYS.indexOf(dayId)];
 let html='<b>'+escape(chosen.toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'}))+'</b>';
 if(list.length)html+=list.map(h=>{const p=normalizePlan(h.plan),sets=completedSetTotal(p);return '<div class="calendar-session"><span>'+escape(p.name)+'</span><small>'+sets+' sets · '+p.exercises.filter(e=>normalizeExercise(e).done>0).length+' exercises · '+escape(new Date(h.date).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}))+'</small></div>';}).join('');
 else if(scheduled?.enabled&&scheduled.plan)html+='<div class="calendar-session scheduled"><span>'+escape(scheduled.plan.name)+' scheduled</span><small>'+scheduled.plan.exercises.length+' exercises · '+scheduled.minutes+' min target</small></div>';
 else html+='<div class="calendar-session"><span>Rest / no logged workout</span></div>';
 $('calendarDayDetails').innerHTML=html;
}
function renderMuscleProgress(){
 const rows=muscleProgress(history,catalog,{days:56,now:Date.now()}),load=muscleTrainingLoad(history,catalog,7,Date.now()),mapUrl=anatomyHeatmapUrl(load);
 $('weeklyMuscleMap').innerHTML=mapUrl?'<div class="weekly-muscle-map"><img loading="lazy" src="'+escape(mapUrl)+'" alt="Muscles trained during the last seven days"><div><b>Last 7 days muscle map</b><small><i class="heat strong"></i>Higher exposure <i class="heat medium"></i>Medium <i class="heat light"></i>Lower</small><p class="small muted">Primary sets count fully; secondary-muscle exposure counts as half a set for this visual only.</p></div></div>':'<div class="notice">Log workouts to build your muscle map.</div>';
 if(!rows.length){$('muscleProgressList').innerHTML='';return;}
 $('muscleProgressList').innerHTML='<div class="muscle-progress-list">'+rows.slice(0,14).map(r=>{
  const label=ANATOMICAL_NAMES[r.slug]||prettyMuscle(r.slug),trendClass=r.trendPct==null?'baseline':r.trendPct>1?'up':r.trendPct<-1?'down':'flat';
  return '<details class="muscle-progress-row"><summary><span><b>'+escape(label)+'</b><small>'+r.sessions+' logged session'+(r.sessions===1?'':'s')+' · '+r.confidence+' confidence</small></span><strong class="'+trendClass+'">'+escape(formatTrend(r.trendPct))+'</strong></summary><div class="muscle-progress-components"><span>Estimated strength <b>'+escape(formatTrend(r.strengthPct))+'</b></span><span>Training volume <b>'+escape(formatTrend(r.volumePct))+'</b></span><span>Target completion <b>'+r.adherencePct+'%</b></span><span>Average RIR <b>'+(r.avgRir==null?'—':r.avgRir)+'</b></span></div><p class="small muted">Trend combines 70% estimated performance change and 30% volume change when both are available. RIR and target completion are shown separately so you can see whether improvement came with harder effort.</p></details>';
 }).join('')+'</div>';
}
function renderProgressCharts(){
 if(!$('progressExercise')||!$('progressCharts'))return;
 const id=$('progressExercise').value;
 if(!id){$('progressHighlights').innerHTML='';$('progressCharts').innerHTML='<div class="notice">Complete an exercise to see progression.</div>';return;}
 const points=exerciseProgress(history,id),hasLoad=points.some(p=>p.actualVolume>0||p.estimated1RM>0),records=exerciseRecords(history,id),signal=exerciseProgressionSignal(history,id);
 $('progressHighlights').innerHTML=records?'<div class="progress-highlights"><div><strong>'+records.sessions+'</strong><small>sessions</small></div>'+(records.bestWeight?'<div><strong>'+records.bestWeight+' lb</strong><small>best load</small></div>':'')+'<div><strong>'+Math.round(records.bestVolume).toLocaleString()+'</strong><small>'+(records.bestWeight?'best volume':'best reps volume')+'</small></div><div><strong>'+escape(signal.label)+'</strong><small>'+escape(signal.reason)+'</small></div></div>':'';
 $('progressCharts').innerHTML='<div class="progress-chart"><h3>Reps · target vs actual</h3>'+chartSvg(points,'actualReps','plannedReps','Actual','Target')+'</div>'+(hasLoad?'<div class="progress-chart"><h3>Training volume</h3>'+chartSvg(points,'actualVolume','plannedVolume','Actual','Target')+'</div><div class="progress-chart"><h3>Estimated strength</h3>'+chartSvg(points,'estimated1RM',null,'Est. 1RM')+'</div>':'')+(points.some(p=>p.rir!=null)?'<div class="progress-chart"><h3>Reps in reserve</h3>'+chartSvg(points,'rir',null,'RIR')+'</div>':'');
}
function renderHistory(){
 renderWeeklyReview();renderTrainingCalendar();renderMuscleProgress();
 const used=[...new Set(history.flatMap(h=>(h.plan?.exercises||[]).filter(e=>normalizeExercise(e).done>0).map(e=>e.id)))];
 const select=$('progressExercise'),previous=select.value;
 select.innerHTML=used.map(id=>'<option value="'+escape(id)+'">'+escape(catalog.find(c=>c.id===id)?.name||id)+'</option>').join('');
 if(used.includes(previous))select.value=previous;else if(used.length)select.value=used[0];
 $('progressionCard').hidden=!used.length;renderProgressCharts();select.onchange=renderProgressCharts;
 $('historyList').innerHTML=history.length?history.map(h=>{
  const p=normalizePlan(h.plan),comparison=comparePlanPerformance(p),sets=completedSetTotal(p);
  const exercises=p.exercises.filter(e=>e.done>0).map(raw=>{
   const e=normalizeExercise(raw),name=catalog.find(c=>c.id===e.id)?.name||e.id;
   const detail=Array.from({length:e.done},(_,i)=>'S'+(i+1)+' '+e.plannedReps[i]+'→'+e.setReps[i]+(e.setWeights[i]>0?' @ '+e.setWeights[i]+' lb':' BW')).join(' · ');
   const feedback=[e.rir!=null?'RIR '+(e.rir===4?'4+':e.rir):'',e.effort?e.effort.replaceAll('_',' '):'',e.form?'form '+e.form:'',e.discomfort&&e.discomfort!=='none'?'discomfort '+e.discomfort:''].filter(Boolean).join(' · ');
   return '<p class="small muted"><b>'+escape(name)+'</b>'+(feedback?' · '+escape(feedback):'')+'<br>'+escape(detail)+(e.note?'<br>“'+escape(e.note)+'”':'')+'</p>';
  }).join('');
  return '<details class="card history-session"><summary><div><span class="tag">'+escape(new Date(h.date).toLocaleString())+'</span><h2>'+escape(p.name)+'</h2></div><span>'+comparison.metRepSets+'/'+sets+' sets on target</span></summary>'+exercises+'</details>';
 }).join(''):'<div class="notice">No saved workouts yet.</div>';
}

$('calendarPrev').onclick=()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1);selectedCalendarDate='';renderTrainingCalendar();};
$('calendarNext').onclick=()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1);selectedCalendarDate='';renderTrainingCalendar();};
$('calendarGrid').onclick=e=>{const b=e.target.closest('[data-calendar-date]');if(!b)return;selectedCalendarDate=b.dataset.calendarDate;renderTrainingCalendar();};

function renderProfilePage(){
 $('profileGoal').value=profile.goal;$('profileExperience').value=profile.experience;$('profileEquipment').value=profile.equipment;
 $('heightFeet').value=profile.heightIn==null?'':Math.floor(profile.heightIn/12);$('heightInches').value=profile.heightIn==null?'':Math.round(profile.heightIn%12);$('weightLb').value=profile.weightLb??'';
 $('coachMemory').value=coachMemory;
}
function showTab(tab){document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==tab);document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));if(tab==='history')renderHistory();if(tab==='profilePage')renderProfilePage();if(tab==='coach')renderHandoff();document.body.classList.toggle('coach-active',tab==='coach');window.scrollTo(0,0);window.syncInlineChat?.();}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
if($('dashboardCoachOpen'))$('dashboardCoachOpen').onclick=()=>showTab('coach');
$('saveProfilePage').onclick=()=>{const ft=$('heightFeet').value.trim(),inch=$('heightInches').value.trim(),weight=$('weightLb').value.trim();const height=ft===''&&inch===''?null:Number(ft||0)*12+Number(inch||0);const next=normalizeProfile({goal:$('profileGoal').value,experience:$('profileExperience').value,equipment:$('profileEquipment').value,heightIn:height,weightLb:weight===''?null:Number(weight)});if((height!==null&&next.heightIn===null)||(weight!==''&&next.weightLb===null))return toast('Check your height and weight values.');profile=next;saveProfile();markNextWeekStale();renderProfilePage();drawProposal();toast('Profile saved.');};
$('saveMemory').onclick=()=>{coachMemory=$('coachMemory').value.trim().slice(0,4000);saveMemory();toast('Coach memory saved.');};
$('clearMemory').onclick=()=>{coachMemory='';saveMemory();$('coachMemory').value='';toast('Coach memory cleared.');};

$('settings').onclick=()=>{
 modal('<h2>Settings</h2><p class="small muted">v'+APP_VERSION+' · '+catalog.length+' exercises</p><label for="appTheme">Theme</label><select id="appTheme"><option value="dark">Dark · Default</option><option value="light">Light</option><option value="green">Green · Classic</option></select><label for="geminiModel">Gemini model</label><select id="geminiModel">'+MODELS.map((m,i)=>'<option value="'+escape(m.id)+'">'+escape(m.name)+(i===0?' · Recommended':'')+'</option>').join('')+'</select><label for="apiKey">Gemini API key</label><input id="apiKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="512" placeholder="Paste key"><div class="row"><button id="showKey" class="secondary">Show</button><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Get key ↗</a></div><button id="saveSettings" class="primary wide">Save</button><button id="clearKey" class="secondary wide">Remove key</button><button id="clearDemoCache" class="secondary wide">Clear demo cache ('+Object.keys(demoMetaCache).length+')</button><button id="resetDemoProblems" class="secondary wide">Reset skipped demos ('+Object.values(demoProblems).reduce((n,v)=>n+Object.keys(v||{}).length,0)+')</button><button id="viewErrorReports" class="secondary wide">Error reports ('+errorReports.length+')</button><p class="small muted">Demo videos are never bulk-downloaded. Only videos you open can enter the Android WebView cache.</p>');
 $('apiKey').value=apiKey;$('geminiModel').value=geminiModel;$('appTheme').value=theme;
 $('showKey').onclick=()=>{const show=$('apiKey').type==='password';$('apiKey').type=show?'text':'password';$('showKey').textContent=show?'Hide':'Show';};
 $('appTheme').onchange=()=>applyTheme($('appTheme').value);
 const setKey=value=>{try{if(window.TrainerKeys&&!window.TrainerKeys.saveKey(value))throw new Error();}catch{toast('Could not save your key.');return false;}apiKey=value;return true;};
 $('saveSettings').onclick=()=>{const value=$('apiKey').value.trim(),model=$('geminiModel').value,nextTheme=$('appTheme').value;if(value&&/\s/.test(value))return toast('API key cannot contain spaces.');if(value!==apiKey&&!setKey(value))return;geminiModel=MODELS.some(m=>m.id===model)?model:DEFAULT_MODEL;localStorage.setItem('geminiModel',JSON.stringify(geminiModel));applyTheme(nextTheme);$('modal').close();render();toast('Settings saved.');};
 $('clearKey').onclick=()=>{if(setKey('')){$('apiKey').value='';$('modal').close();render();toast('Gemini key removed.');}};
 $('clearDemoCache').onclick=()=>{demoMetaCache={};localStorage.removeItem('demoMetaCache');wgerExerciseIndexPromise=null;youtubeDemoIndexPromise=null;try{window.TrainerShare?.clearMediaCache?.();}catch{};$('clearDemoCache').textContent='Clear demo cache (0)';toast('Demo cache cleared.');};
 $('resetDemoProblems').onclick=()=>{demoProblems={};localStorage.removeItem('demoProblems');$('resetDemoProblems').textContent='Reset skipped demos (0)';toast('Skipped demo list reset.');};
 $('viewErrorReports').onclick=showErrorReports;
};
function renderHandoff(){
 if(!$('handoffPreview'))return;
 $('handoffPreview').hidden=!handoffDraft;
 $('interpretHandoff').disabled=busy;$('copyChatGPTContext').disabled=busy;$('useCopiedResponse').disabled=busy;
 if($('restoreLastHandoff')){$('restoreLastHandoff').hidden=!lastHandoff;$('restoreLastHandoff').disabled=busy||!lastHandoff;}
 if($('lastHandoffStatus'))$('lastHandoffStatus').textContent=lastHandoffLabel();
 if(!handoffDraft)return;
 const preview=handoffDraft.preview,batch=handoffDraft.batch;
 const engine=batch.translationPath==='local'?'On-device fast parser':(MODELS.find(m=>m.id===batch.modelUsed)?.name||batch.modelUsed||'Gemini');
 $('handoffSummary').innerHTML='<p>'+escape(batch.summary||'ChatGPT changes interpreted.')+'</p><p class="small muted">Translator: '+escape(engine)+'</p>';
 $('handoffWarnings').innerHTML=batch.warnings?.length?'<div class="notice"><b>Needs attention</b><ul>'+batch.warnings.map(w=>'<li>'+escape(w)+'</li>').join('')+'</ul></div>':'';
 $('handoffCommands').innerHTML=preview.descriptions.length?'<h3>Local commands</h3><ul>'+preview.descriptions.map(d=>'<li>'+escape(d)+'</li>').join('')+'</ul>':'<p class="muted">No executable changes were found in the ChatGPT response.</p>';
 $('applyHandoff').disabled=busy||!preview.descriptions.length;$('discardHandoff').disabled=busy;
}
function showManualContext(context){modal('<h2>Trainer context for ChatGPT</h2><p class="small muted">Copy the text below into ChatGPT.</p><textarea id="manualContext" rows="16" readonly></textarea>');$('manualContext').value=context;$('manualContext').focus();$('manualContext').select();}
function copyTrainerContext(){
 const context=buildChatGPTContext({week,profile,memory:coachMemory,recentTraining:summarizeHistory(history,catalog,20)},catalog);
 try{if(window.TrainerShare?.copyText){window.TrainerShare.copyText(context);toast('Trainer context copied. Paste it into the in-app ChatGPT message box.');return;}}catch{}
 if(navigator.clipboard?.writeText){navigator.clipboard.writeText(context).then(()=>toast('Trainer context copied. Paste it into ChatGPT.')).catch(()=>showManualContext(context));}else showManualContext(context);
}
$('copyChatGPTContext').onclick=copyTrainerContext;
// Anchor the isolated Android WebView to a box on this same page.
let chatFrame=0;
function syncInlineChat(){
 cancelAnimationFrame(chatFrame);
 chatFrame=requestAnimationFrame(()=>{
  const bridge=window.TrainerShare,slot=$('inlineChatSlot');
  if(!bridge?.positionChat)return;
  if($('coach').hidden||$('modal').open||document.hidden){bridge.hideChat();return;}
  const rect=slot.getBoundingClientRect(),nav=document.querySelector('nav').getBoundingClientRect();
  const viewport=window.visualViewport;
  const top=Math.max(rect.top,viewport?.offsetTop||0);
  let bottom=Math.min(rect.bottom,nav.top,(viewport?.offsetTop||0)+(viewport?.height||innerHeight));
  if(!$('timer').hidden)bottom=Math.min(bottom,$('timer').getBoundingClientRect().top);
  if(bottom-top<80){bridge.hideChat();return;}
  $('inlineChatFallback').hidden=true;
  bridge.positionChat(rect.left,top,rect.width,bottom-top,innerWidth);
 });
}
window.syncInlineChat=syncInlineChat;
window.showTrainerWorkout=()=>showTab('workout');
window.addEventListener('scroll',syncInlineChat,{passive:true});
window.addEventListener('resize',syncInlineChat);
window.visualViewport?.addEventListener('resize',syncInlineChat);
window.visualViewport?.addEventListener('scroll',syncInlineChat);
document.addEventListener('visibilitychange',syncInlineChat);
new ResizeObserver(syncInlineChat).observe($('inlineChatSlot'));
new MutationObserver(syncInlineChat).observe($('modal'),{attributes:true,attributeFilter:['open']});
new MutationObserver(syncInlineChat).observe($('timer'),{attributes:true,attributeFilter:['hidden']});
$('reloadChatGPT').onclick=()=>{window.TrainerShare?.reloadChat?.();syncInlineChat();};
$('useCopiedResponse').onclick=async()=>{
 try{
  if(window.TrainerShare?.useCopiedResponse){window.TrainerShare.useCopiedResponse();return;}
  window.receiveTrainerShare(await navigator.clipboard.readText());
 }catch{toast('Paste the copied response in the box below.');}
};
window.receiveTrainerShare=value=>{
 const shared=typeof value==='string'?value.trim().slice(0,24000):'';if(!shared)return;
 $('handoffText').value=shared;handoffDraft=null;showTab('coach');$('handoffPanel').open=true;renderHandoff();$('handoffText').scrollIntoView({block:'center',behavior:'smooth'});toast('ChatGPT response received.');
};
if(typeof window.__trainerSharedText==='string'&&window.__trainerSharedText.trim()){const shared=window.__trainerSharedText;window.__trainerSharedText='';queueMicrotask(()=>window.receiveTrainerShare(shared));}
$('interpretHandoff').onclick=async()=>{
 if(busy)return;
 const sourceText=$('handoffText').value.trim();if(!sourceText)return toast('Paste or share a ChatGPT response first.');
 busy=true;handoffDraft=null;$('handoffStatus').textContent='Translating response… exact workout blocks are parsed on-device first; Gemini is used only when needed.';render();renderHandoff();
 try{
  const batch=await interpretChatGPTResponse({sourceText,week,profile,memory:coachMemory,selectedDay:selected,model:geminiModel,timing:handoffTiming},catalog,apiKey);
  recordHandoffAttempts(batch.attempts);
  const preview=applyCommandBatch(batch,{week,profile,memory:coachMemory},catalog);
  handoffDraft={sourceText,batch,preview};
  lastHandoff={sourceText,batch:structuredClone(batch),translatedAt:new Date().toISOString(),status:'ready'};saveLastHandoff();
  const fallback=batch.translationPath==='local'
   ?' Parsed on-device without waiting for Gemini.'
   :batch.fallbackFrom&&batch.modelUsed?' '+(MODELS.find(m=>m.id===batch.fallbackFrom)?.name||batch.fallbackFrom)+' was unavailable or slow, so '+(MODELS.find(m=>m.id===batch.modelUsed)?.name||batch.modelUsed)+' completed it.':'';
  $('handoffStatus').textContent='Command translation complete.'+fallback+' Nothing has been changed yet.';
  renderHandoff();toast(preview.descriptions.length?'Commands ready for review.':'No executable changes found.');
 }catch(err){
  recordHandoffAttempts(err.diagnostic?.attempts);
  recordErrorReport(err.diagnostic||{category:'handoff_client_error'},sourceText,err.message);
  $('handoffStatus').textContent=err.message+' Error report saved in Settings → Error reports.';
  toast('Could not interpret the ChatGPT response.');
 }finally{busy=false;render();renderHandoff();}
};
$('applyHandoff').onclick=()=>{
 if(busy||!handoffDraft)return;
 let beforeState=null;
 try{
  const result=applyCommandBatch(handoffDraft.batch,{week,profile,memory:coachMemory},catalog);
  if(!result.descriptions.length)return toast('There are no commands to apply.');
  const workoutDelta=weekChanges(week,result.week,catalog),profileDelta=profileChanges(profile,result.profile),memoryChanged=result.memory!==coachMemory;
  const workoutDays=workoutDelta.map(x=>x.id);
  beforeState={week:structuredClone(week),profile:structuredClone(profile),memory:coachMemory,selected,timer:structuredClone(timer)};
  undo=structuredClone(beforeState);
  week=normalizeWeek(result.week);profile=normalizeProfile(result.profile);coachMemory=result.memory;pending=null;timer={};
  const targetDay=workoutDays.includes(beforeState.selected)?beforeState.selected:(workoutDays[0]||beforeState.selected);
  selectDay(targetDay);
  save();saveProfile();saveMemory();saveChat();
  const persistedWeek=read('week',null),persistedProfile=read('profile',null),persistedMemory=read('coachMemory','');
  if(!validWeek(persistedWeek,ids)||weekKey(persistedWeek)!==weekKey(week)||profileKey(persistedProfile)!==profileKey(profile)||String(persistedMemory||'')!==coachMemory)throw new Error('The translated changes could not be verified after saving. The previous trainer state was restored.');
  const hadWorkout=workoutDelta.length>0,hadProfile=profileDelta.length>0;
  if(lastHandoff){lastHandoff={...lastHandoff,status:'applied',appliedAt:new Date().toISOString(),appliedWeekKey:weekKey(week)};saveLastHandoff();}
  const appliedParts=[];if(hadWorkout)appliedParts.push('workout: '+workoutDays.map(dayName).join(', '));if(hadProfile)appliedParts.push('profile/body data');if(memoryChanged)appliedParts.push('coach memory');
  const note=appliedParts.length?'Applied '+appliedParts.join(' and ')+'.':'These translated commands were already reflected in your trainer data.';
  $('updateNotice').textContent=note;$('updateNotice').hidden=!hadWorkout;
  handoffDraft=null;$('handoffText').value='';$('handoffStatus').textContent=note+' The most recent translation is still saved and can be restored.';
  if(hadWorkout||hadProfile)markNextWeekStale();render();renderHandoff();tick();showTab(hadWorkout?'workout':hadProfile?'profilePage':'coach');toast(note);window.scrollTo({top:0,behavior:'smooth'});
 }catch(err){
  if(beforeState){
   week=normalizeWeek(beforeState.week);profile=normalizeProfile(beforeState.profile);coachMemory=beforeState.memory;timer=beforeState.timer;selectDay(beforeState.selected);save();saveProfile();saveMemory();saveChat();
  }
  if(lastHandoff){lastHandoff={...lastHandoff,status:'apply_failed',applyError:String(err.message||'Apply failed').slice(0,500)};saveLastHandoff();}
  recordErrorReport({category:'handoff_apply_error',message:err.message},handoffDraft?.sourceText||lastHandoff?.sourceText||'',err.message);render();renderHandoff();toast(err.message);
 }
};
$('discardHandoff').onclick=()=>{handoffDraft=null;renderHandoff();$('handoffStatus').textContent='Commands discarded. Your trainer data is unchanged. The last successful translation remains saved.';toast('Handoff commands discarded.');};
$('restoreLastHandoff').onclick=()=>{
 if(busy||!lastHandoff?.batch)return;
 try{
  const preview=applyCommandBatch(lastHandoff.batch,{week,profile,memory:coachMemory},catalog);
  handoffDraft={sourceText:lastHandoff.sourceText||'',batch:structuredClone(lastHandoff.batch),preview};
  $('handoffText').value=lastHandoff.sourceText||'';$('handoffPanel').open=true;
  $('handoffStatus').textContent='Restored the most recent successful translation for review. Nothing has been changed yet.';
  renderHandoff();$('handoffPreview').scrollIntoView({block:'center',behavior:'smooth'});toast('Last translation restored.');
 }catch(err){recordErrorReport({category:'handoff_restore_error',message:err.message},lastHandoff.sourceText||'',err.message);toast('Could not restore the last translation.');}
};

$('undo').onclick=()=>{
 if(!undo||busy)return;
 week=normalizeWeek(undo.week);profile=normalizeProfile(undo.profile||profile);if(typeof undo.memory==='string')coachMemory=undo.memory;timer=undo.timer;selectDay(undo.selected);undo=null;pending=null;save();saveProfile();saveMemory();saveChat();render();tick();
 $('updateNotice').textContent='Last AI change undone.';$('updateNotice').hidden=false;
 markNextWeekStale();messages.push({role:'assistant',content:'You undid the last applied AI change. The previous planner/profile state is restored.'});saveChat();drawMessages();toast('Previous week restored.');
};
function drawMessages(){
 $('messages').innerHTML=messages.length?messages.map(m=>`<div class="message ${m.role}${m.error?' error':''}"><small>${m.role==='user'?'YOU':'GEMINI COACH'}</small>${escape(m.content)}</div>`).join(''):'<div class="notice">Ask Gemini about training or planning.</div>';
 $('messages').scrollTop=$('messages').scrollHeight;
}
function renderWeek(){
 const count=week.days.filter(d=>d.enabled).length;
 $('weekSummary').textContent=`${count} training ${count===1?'day':'days'} · ${7-count} rest ${7-count===1?'day':'days'}`;
 $('weekDays').innerHTML=week.days.map(d=>`<button class="day-button ${d.id===selected?'selected':''}" data-select-day="${d.id}" aria-pressed="${d.id===selected}" ${busy?'disabled':''}><b>${dayName(d.id).slice(0,3)}</b><span>${d.enabled?escape(d.plan.name):'Rest'}</span><small>${d.enabled?d.plan.exercises.length+' exercises · '+d.minutes+'m':'Recovery'}</small></button>`).join('');
}
$('weekDays').onclick=e=>{const b=e.target.closest('[data-select-day]');if(!b||busy)return;selectDay(b.dataset.selectDay);render();};
$('refreshNextWeek').onclick=()=>refreshNextWeekRecommendation('manual');
$('viewNextWeek').onclick=showNextWeekRecommendation;
$('useNextWeek').onclick=()=>{if(!nextWeekRecommendation)return;undo={week:structuredClone(week),profile:structuredClone(profile),memory:coachMemory,selected,timer:structuredClone(timer)};week=normalizeWeek(structuredClone(nextWeekRecommendation.week));nextWeekRecommendation=null;saveNextWeekRecommendation();selectDay(selected);timer={};save();render();tick();toast('Next-week plan is now your active week.');};
$('editWeek').onclick=()=>{
 modal(`<h2>Weekly schedule</h2><p class="small muted">Choose training days and approximate minutes.</p><label for="dayCount">Training days</label><select id="dayCount">${Array.from({length:8},(_,i)=>`<option value="${i}" ${i===week.days.filter(d=>d.enabled).length?'selected':''}>${i} days</option>`).join('')}</select><div id="scheduleRows">${week.days.map(d=>`<div class="schedule-row"><label class="day-check"><input type="checkbox" data-enable="${d.id}" ${d.enabled?'checked':''}>${dayName(d.id)}</label><label>Minutes<input type="number" data-minutes="${d.id}" min="5" max="180" step="5" value="${d.minutes}"></label></div>`).join('')}</div><button id="saveWeek" class="primary wide">Save week</button>`);
 const checks=()=>Array.from($('scheduleRows').querySelectorAll('[data-enable]'));
 const sync=()=>{checks().forEach(c=>{const row=c.closest('.schedule-row');row.querySelector('[data-minutes]').disabled=!c.checked;});$('dayCount').value=checks().filter(c=>c.checked).length;};
 $('scheduleRows').onchange=sync;
 $('dayCount').onchange=()=>{const want=Number($('dayCount').value),enabled=checks().filter(c=>c.checked).map(c=>c.dataset.enable);const order=['mon','wed','fri','tue','thu','sat','sun'];while(enabled.length>want)enabled.pop();for(const id of order)if(enabled.length<want&&!enabled.includes(id))enabled.push(id);checks().forEach(c=>c.checked=enabled.includes(c.dataset.enable));sync();};sync();
 $('saveWeek').onclick=()=>{
  let ordinal=0;const next=structuredClone(week);
  for(const d of next.days){
   const row=$('scheduleRows').querySelector(`[data-enable="${d.id}"]`).closest('.schedule-row');d.enabled=row.querySelector('[data-enable]').checked;
   if(!d.enabled){d.plan=null;continue;}
   d.minutes=Number(row.querySelector('[data-minutes]').value);
   if(!Number.isInteger(d.minutes)||d.minutes<5||d.minutes>180)return toast('Use 5–180 approximate training minutes for each training day.');
   if(!d.plan)d.plan=makePlan(['Push','Pull','Legs'][ordinal%3]);ordinal++;
  }
  if(!validWeek(next,ids))return toast('Check the schedule values.');
  week=next;selectDay(selected);timer={};undo=null;save();markNextWeekStale();render();tick();$('modal').close();toast('Week saved.');
 };
};
function drawProposal(){
 const coachTab=document.querySelector('[data-tab="coach"]');
 if(coachTab){
  const label=coachTab.querySelector('.nav-label'),badge=coachTab.querySelector('.nav-badge');
  if(label)label.textContent=pending?'Coach · Draft':'Coach';else coachTab.textContent=pending?'Coach · Draft':'Coach';
  if(badge)badge.hidden=!pending;
 }
 $('proposal').hidden=!pending;if(!pending)return;
 const weekChangesList=pending.week?weekChanges(week,pending.week,catalog):[],profileChangesList=pending.profile?profileChanges(profile,pending.profile):[];
 const staleWeek=!!pending.week&&pending.base!==weekKey(week),staleProfile=!!pending.profile&&pending.profileBase!==profileKey(profile),stale=staleWeek||staleProfile;
 let html='<p>'+(stale?'Your saved data changed since this draft. Ask the coach to refine it before applying.':'Draft only — nothing below is saved until you tap Apply.')+'</p>';
 html+=weekChangesList.map(d=>'<h3>'+escape(dayName(d.id))+'</h3><ul>'+d.changes.map(c=>'<li>'+escape(c)+'</li>').join('')+'</ul><p class="small muted">Estimated session: ~'+estimatePlanMinutes(pending.week.days[DAYS.indexOf(d.id)].plan)+' min · target '+pending.week.days[DAYS.indexOf(d.id)].minutes+' min</p>').join('');
 if(profileChangesList.length)html+='<h3>Profile & body data</h3><ul>'+profileChangesList.map(c=>'<li>'+escape(c)+'</li>').join('')+'</ul>';
 $('proposalDetails').innerHTML=html;
 $('applyProposal').disabled=busy||stale||(weekChangesList.length===0&&profileChangesList.length===0);$('refineProposal').disabled=busy;$('discardProposal').disabled=busy;
}
$('applyProposal').onclick=()=>{
 if(busy||!pending)return;
 try{
  const changes=pending.week?weekChanges(week,pending.week,catalog):[],pChanges=pending.profile?profileChanges(profile,pending.profile):[];
  if(!changes.length&&!pChanges.length)throw new Error('No changes to apply.');
  if(pending.profile&&pending.profileBase!==profileKey(profile))throw new Error('Your profile changed after this draft. Ask the coach to refine it again.');
  if(pending.week&&pending.base!==weekKey(week))throw new Error('Your schedule changed after this draft. Ask the coach to refine it again.');
  const nextWeek=pending.week&&changes.length?applyProposal(week,{week:pending.week,base:pending.base},ids):week;
  const nextProfile=pending.profile&&pChanges.length?normalizeProfile(pending.profile):profile;
  undo={week:structuredClone(week),profile:structuredClone(profile),selected,timer:structuredClone(timer)};
  week=nextWeek;profile=nextProfile;saveProfile();
  if(changes.length){const target=changes.find(d=>week.days[DAYS.indexOf(d.id)].enabled)?.id||changes[0].id;selectDay(target);}
  timer={};pending=null;save();saveChat();render();tick();showTab(changes.length?'workout':'profilePage');
  const parts=[];if(changes.length)parts.push('workout: '+changes.map(d=>dayName(d.id)).join(', '));if(pChanges.length)parts.push('profile/body data');
  const note='Applied '+parts.join(' and ')+'.';$('updateNotice').textContent=note;$('updateNotice').hidden=!changes.length;
  if(changes.length||pChanges.length)markNextWeekStale();messages.push({role:'assistant',content:'You applied the proposed changes: '+parts.join(' and ')+'.'});saveChat();drawMessages();toast(note);window.scrollTo({top:0,behavior:'smooth'});
 }catch(err){toast(err.message);}
};
$('refineProposal').onclick=()=>{$('chatInput').value='Please refine the draft: ';$('chatInput').focus();$('chatInput').scrollIntoView({block:'center',behavior:'smooth'});};
$('discardProposal').onclick=()=>{if(busy)return;pending=null;messages.push({role:'assistant',content:'Draft discarded. Your saved workout and profile are unchanged.'});saveChat();drawProposal();drawMessages();};
$('clearChat').onclick=()=>{if(busy)return;modal('<h2>Start a new conversation?</h2><p>This clears the visible chat and pending draft. Your long-term coach memory, profile, logged sessions, and weekly plan stay.</p><button id="confirmClearChat" class="primary wide">Clear chat</button>');$('confirmClearChat').onclick=()=>{messages=[];pending=null;saveChat();drawMessages();drawProposal();$('modal').close();};};
document.querySelectorAll('[data-prompt]').forEach(b=>b.onclick=()=>{$('chatInput').value=b.dataset.prompt;$('chatInput').focus();});
$('chatForm').onsubmit=async e=>{
 e.preventDefault();if(busy)return;if(!apiKey){toast('Add your Gemini API key in Settings first.');return;}
 const message=$('chatInput').value.trim();if(!message)return;
 const previous=messages.filter(m=>!m.error).slice(-50);
 messages.push({role:'user',content:message});saveChat();drawMessages();busy=true;render();$('clearChat').disabled=true;$('send').disabled=true;$('send').textContent='Coach is thinking…';
 try{
  const data=await askGemini({message,week,selectedDay:selected,proposal:pending?.week||null,history:previous,profile,memory:coachMemory,recentTraining:summarizeHistory(history,catalog,20),preferences:compactPreferences(),model:geminiModel},catalog,apiKey);
  messages.push({role:'assistant',content:data.reply});
  if(data.fallbackFrom&&data.modelUsed){const from=MODELS.find(m=>m.id===data.fallbackFrom)?.name||data.fallbackFrom,to=MODELS.find(m=>m.id===data.modelUsed)?.name||data.modelUsed;messages.push({role:'assistant',content:from+' was busy, so I automatically completed this request with '+to+'.'});}
  if(typeof data.memory==='string'&&data.memory.trim()){coachMemory=data.memory.trim().slice(0,4000);saveMemory();}
  if(data.warning){pending=null;if(data.diagnostic)recordErrorReport(data.diagnostic,message,data.warning);messages.push({role:'assistant',content:data.warning+(data.diagnostic?' Open Settings → Error reports for details.':''),error:true});}
  if(data.action==='proposal'){
   const changes=data.week?weekChanges(week,data.week,catalog):[],pChanges=data.profile?profileChanges(profile,data.profile):[];
   if(changes.length||pChanges.length){pending={week:data.week||null,base:data.week?weekKey(week):null,profile:data.profile||null,profileBase:data.profile?profileKey(profile):null};if(data.durationAdjusted?.length)messages.push({role:'assistant',content:'I also expanded '+data.durationAdjusted.map(dayName).join(', ')+' toward the requested training-time target. Warm-up is excluded and there is no automatic +5 minute ceiling.'});toast('Draft ready. Review it before applying.');}
   else{pending=null;messages.push({role:'assistant',content:'No actual saved-data changes were returned. Your planner and profile are unchanged.'});}
  }
  $('chatInput').value='';
 }catch(err){recordErrorReport(err.diagnostic||{category:'client_error'},message,err.message);messages.push({role:'assistant',content:err.message+' Error report saved in Settings → Error reports.',error:true});}
 finally{busy=false;saveChat();$('clearChat').disabled=false;$('send').disabled=false;$('send').textContent='Send ↗';drawMessages();render();}
};
save();render();drawMessages();renderHandoff();tick();
