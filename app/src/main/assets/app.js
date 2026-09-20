import {DAYS,dayName,makeWeek,normalizeWeek,validWeek,weekKey,weekChanges,applyProposal} from './week.js';
import {askGemini,MODELS,DEFAULT_MODEL} from './gemini.js';
import {templates,makePlan,validPlan,secondsLeft} from './core.js';
import {normalizeExercise,normalizePlan,resizeSets,setSetValue,completedSetTotal,totalSets,estimatePlanMinutes,summarizeHistory} from './training.js';
const $=id=>document.getElementById(id);
const catalog=await (await fetch('catalog.json')).json(), ids=catalog.map(e=>e.id);
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const legacy=read('plan',null);
let week=read('week',null);
if(!validWeek(week,ids))week=makeWeek(validPlan(legacy,ids)?legacy:undefined);
week=normalizeWeek(week);
let selected=read('selectedDay',validPlan(legacy,ids)?'mon':DAYS[(new Date().getDay()+6)%7]);
if(!DAYS.includes(selected))selected='mon';
let plan=week.days[DAYS.indexOf(selected)].plan||makePlan(),timer=read('timer',{}),history=read('history',[]),undo=null,busy=false,demoInterval;
if(!Array.isArray(history))history=[];
const APP_VERSION='0.6.1';
let apiKey='',messages=read('chat',[]),pending=read('proposal',null),geminiModel=read('geminiModel',DEFAULT_MODEL),errorReports=read('errorReports',[]);
if(!MODELS.some(m=>m.id===geminiModel))geminiModel=DEFAULT_MODEL;
if(!Array.isArray(errorReports))errorReports=[];errorReports=errorReports.filter(r=>r&&typeof r==='object').slice(0,20);
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
if(!Array.isArray(messages))messages=[];
messages=messages.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').slice(-200);
if(pending){const hasWeek=pending.week&&validWeek(pending.week,ids)&&typeof pending.base==='string';const hasProfile=pending.profile&&validProfile(pending.profile)&&typeof pending.profileBase==='string';if(!hasWeek&&!hasProfile)pending=null;}
const currentDay=()=>week.days[DAYS.indexOf(selected)];
function selectDay(id){selected=id;plan=currentDay().plan?normalizePlan(currentDay().plan):makePlan();if(currentDay().enabled)currentDay().plan=plan;localStorage.setItem('selectedDay',JSON.stringify(selected));}
try { apiKey=window.TrainerKeys?.getKey()||''; } catch {}
localStorage.removeItem('endpoint');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function save(){
 if(currentDay().enabled)currentDay().plan=plan;
 localStorage.setItem('week',JSON.stringify(week));localStorage.setItem('selectedDay',JSON.stringify(selected));
 localStorage.setItem('plan',JSON.stringify(plan));localStorage.setItem('timer',JSON.stringify(timer));
}
function saveChat(){messages=messages.slice(-200);localStorage.setItem('chat',JSON.stringify(messages));localStorage.setItem('proposal',JSON.stringify(pending));saveMemory();}
const redact=value=>{let out=typeof value==='string'?value:JSON.stringify(value,null,2);if(apiKey)out=out.split(apiKey).join('[REDACTED API KEY]');return out.replace(/AIza[A-Za-z0-9_-]{20,}/g,'[REDACTED API KEY]');};
function recordErrorReport(diagnostic,request='',visibleMessage=''){
 const report={id:'E'+Date.now().toString(36).toUpperCase(),time:new Date().toISOString(),appVersion:APP_VERSION,model:geminiModel,selectedDay:selected,category:diagnostic?.category||'unknown',visibleMessage:String(visibleMessage||'').slice(0,1000),request:String(request||'').slice(0,1200),diagnostic:diagnostic&&typeof diagnostic==='object'?diagnostic:{}};
 errorReports.unshift(report);errorReports=errorReports.slice(0,20);localStorage.setItem('errorReports',JSON.stringify(errorReports));return report;
}
function errorReportText(){
 if(!errorReports.length)return 'No AI error reports saved.';
 return errorReports.map(r=>['AI Personal Trainer error '+r.id,'Time: '+r.time,'App: v'+r.appVersion,'Model: '+r.model,'Category: '+r.category,'Selected day: '+r.selectedDay,'Message: '+r.visibleMessage,'Request: '+r.request,'Diagnostic: '+redact(r.diagnostic)].join('\n')).join('\n\n--------------------\n\n');
}
function showErrorReports(){
 modal('<h2>AI error reports</h2><p class="small muted">Reports never include your saved Gemini API key. They contain the failed request text, selected model, error category, and validation/API details so a problem can be diagnosed.</p><textarea id="errorReportText" rows="16" readonly></textarea><div class="row"><button id="copyErrorReport" class="primary">Copy reports</button><button id="clearErrorReports" class="secondary">Clear reports</button></div>');
 $('errorReportText').value=errorReportText();
 $('copyErrorReport').onclick=async()=>{const text=$('errorReportText').value;try{await navigator.clipboard.writeText(text);toast('Error report copied.');}catch{$('errorReportText').focus();$('errorReportText').select();toast('Report selected. Use Copy.');}};
 $('clearErrorReports').onclick=()=>{errorReports=[];localStorage.removeItem('errorReports');$('errorReportText').value=errorReportText();toast('Error reports cleared.');};
}

function toast(s){$('toast').textContent=s;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,4500);}
function modal(html){clearInterval(demoInterval);$('modalBody').innerHTML=html;$('modal').showModal();}
$('closeModal').onclick=()=>$('modal').close();$('modal').onclose=()=>{clearInterval(demoInterval);$('modalBody').innerHTML='';};
function renderExerciseCard(raw,i){
 const e=normalizeExercise(raw),c=catalog.find(x=>x.id===e.id);plan.exercises[i]=e;
 const rows=e.setReps.map((reps,n)=>'<div class="set-row '+(n<e.done?'done':'')+'"><b>Set '+(n+1)+'</b><label>Reps<input aria-label="'+escape(c.name)+' set '+(n+1)+' reps" type="number" data-index="'+i+'" data-set-index="'+n+'" data-set-field="reps" min="1" max="50" value="'+reps+'" '+(busy?'disabled':'')+'></label><label>Load (lb)<input aria-label="'+escape(c.name)+' set '+(n+1)+' load" type="number" data-index="'+i+'" data-set-index="'+n+'" data-set-field="weight" min="0" max="1000" step="0.5" value="'+e.setWeights[n]+'" '+(busy?'disabled':'')+'></label><button class="set-button '+(n<e.done?'done':'')+'" data-set="'+i+'" data-n="'+n+'" '+(busy?'disabled':'')+'>'+(n<e.done?'✓ Done':'Complete')+'</button></div>').join('');
 return '<article class="card"><div class="card-top"><button data-demo="'+e.id+'" aria-label="Demonstration for '+escape(c.name)+'" style="padding:0"><img class="thumb" src="'+c.images[0]+'" alt="'+escape(c.name)+' starting position"></button><div><h3>'+escape(c.name)+'</h3><span class="tag">'+escape(c.muscle)+' · '+escape(c.equipment)+'</span></div></div><div class="fields two"><label>Sets<input type="number" data-index="'+i+'" data-field="sets" value="'+e.sets+'" min="1" max="10" '+(busy?'disabled':'')+'></label><label>Rest (s)<input type="number" data-index="'+i+'" data-field="rest" value="'+e.rest+'" min="15" max="600" '+(busy?'disabled':'')+'></label></div><div class="set-list"><div class="set-head"><span>Set</span><span>Reps</span><span>Load</span><span>Status</span></div>'+rows+'</div><div class="row" style="margin-top:12px"><button class="secondary" data-demo="'+e.id+'">View demonstration</button><button class="secondary" data-remove="'+i+'" '+(busy?'disabled':'')+'>Remove</button></div></article>';
}
function render(){
 renderWeek();
 const active=currentDay().enabled;
 $('sessionLabel').textContent=dayName(selected).toUpperCase()+' · '+(active?currentDay().minutes+' MIN BUDGET':'REST DAY');
 $('trainingDetails').hidden=!active;$('newWorkout').hidden=!active;$('progress').hidden=!active;
 $('planName').textContent=active?plan.name:'Rest & recover';const done=completedSetTotal(plan),total=totalSets(plan),estimate=estimatePlanMinutes(plan);
 $('summary').textContent=active?plan.exercises.length+' exercises · '+done+' / '+total+' sets completed · ~'+estimate+' min estimated':'No workout scheduled. Choose another day or edit your week.';$('progress').value=done;$('progress').max=total;$('undo').disabled=!undo||busy;
 $('exercises').innerHTML=plan.exercises.map(renderExerciseCard).join('');
 $('add').disabled=busy;$('newWorkout').disabled=busy;$('finish').disabled=busy;$('settings').disabled=busy;$('editWeek').disabled=busy;drawProposal();
 const modelName=MODELS.find(m=>m.id===geminiModel)?.name||geminiModel;$('connection').textContent=apiKey?(pending?modelName+' ready · A draft is waiting. Your saved workout has not changed until you apply it.':modelName+' ready · Ask for advice, plan your week, or refine a draft. You choose when to apply changes.'):'Add your Gemini API key in Settings to start coaching. Workout tracking works offline.';
}
$('exercises').onchange=e=>{
 const i=Number(e.target.dataset.index);if(!Number.isInteger(i))return;const value=Number(e.target.value),next=normalizePlan(structuredClone(plan));
 if(e.target.dataset.setField){const n=Number(e.target.dataset.setIndex);next.exercises[i]=setSetValue(next.exercises[i],n,e.target.dataset.setField,value);}
 else if(e.target.dataset.field==='sets')next.exercises[i]=resizeSets(next.exercises[i],value);
 else if(e.target.dataset.field==='rest')next.exercises[i].rest=value;else return;
 if(e.target.value===''||!validPlan(next,ids)){toast('Please enter a value within the allowed range.');render();return;}
 plan=next;undo=null;save();render();
};
$('exercises').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.demo){const c=catalog.find(x=>x.id===b.dataset.demo);modal(`<h2>${escape(c.name)}</h2><img id="demoImage" class="demo" src="${c.images[0]}" alt="Exercise demonstration"><p class="small muted">Looping start/end photos · free-exercise-db · Unlicense</p><button id="demoToggle" class="secondary">Pause images</button><ol>${c.instructions.map(s=>`<li>${escape(s)}</li>`).join('')}</ol>`);let frame=0;const play=()=>setInterval(()=>{$('demoImage').src=c.images[(++frame)%c.images.length];},1300);demoInterval=play();$('demoToggle').onclick=()=>{if(demoInterval){clearInterval(demoInterval);demoInterval=null;$('demoToggle').textContent='Play images';}else{demoInterval=play();$('demoToggle').textContent='Pause images';}};return;}if(busy)return;if(b.dataset.remove!==undefined){if(plan.exercises.length===1)return toast('Keep at least one exercise.');plan.exercises.splice(+b.dataset.remove,1);}if(b.dataset.set!==undefined){const i=+b.dataset.set,n=+b.dataset.n,ex=normalizeExercise(plan.exercises[i]);if(n<ex.done){ex.done=n;timer={};}else if(n===ex.done){ex.done++;timer={end:Date.now()+ex.rest*1000};}else return toast('Complete the next set in order.');plan.exercises[i]=ex;}undo=null;save();render();tick();};
$('add').onclick=()=>{modal('<h2>Add an exercise</h2>'+catalog.filter(c=>!plan.exercises.some(e=>e.id===c.id)).map(c=>`<button class="wide secondary" data-add="${c.id}">${escape(c.name)}</button>`).join(''));$('modalBody').onclick=e=>{const id=e.target.dataset.add;if(!id)return;plan.exercises.push(normalizeExercise({id,sets:3,reps:12,rest:90,weight:0,done:0}));undo=null;save();render();$('modal').close();};};
$('newWorkout').onclick=()=>{modal('<h2>Start a fresh session</h2><p>Save your current session first if you want it in Progress.</p>'+Object.keys(templates).map(day=>`<button class="wide" data-day="${day}">${day}</button>`).join(''));$('modalBody').onclick=e=>{if(!e.target.dataset.day)return;plan=makePlan(e.target.dataset.day);timer={};undo=null;save();render();tick();$('modal').close();};};
$('finish').onclick=()=>{const count=completedSetTotal(plan);if(!count)return toast('Complete a set before saving.');history.unshift({date:new Date().toISOString(),day:selected,plan:normalizePlan(structuredClone(plan))});history=history.slice(0,200);localStorage.setItem('history',JSON.stringify(history));plan.exercises=plan.exercises.map(e=>({...normalizeExercise(e),done:0}));timer={};undo=null;save();render();tick();toast('Session saved. Your set-by-set performance is now available to the coach.');};
function tick(){const left=secondsLeft(timer);$('timer').hidden=!timer.end&&timer.paused==null;$('time').textContent=`${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')}`;$('pause').textContent=timer.paused!=null?'Resume':'Pause';if(timer.end&&left===0){timer={};save();$('timer').hidden=true;toast('Rest complete — ready for your next set.');navigator.vibrate?.([150,80,150]);}}
$('pause').onclick=()=>{timer=timer.paused!=null?{end:Date.now()+timer.paused*1000}:{paused:secondsLeft(timer)};save();tick();};$('plus').onclick=()=>{if(timer.paused!=null)timer.paused+=15;else timer.end=Math.max(timer.end||0,Date.now())+15000;save();tick();};$('skip').onclick=()=>{timer={};save();tick();};setInterval(tick,250);document.addEventListener('visibilitychange',tick);
function renderHistory(){
 $('historyList').innerHTML=history.length?history.map(h=>{
  const p=normalizePlan(h.plan),sets=completedSetTotal(p);
  const exercises=p.exercises.filter(e=>e.done>0).map(raw=>{const e=normalizeExercise(raw),name=catalog.find(c=>c.id===e.id)?.name||e.id;const detail=Array.from({length:e.done},(_,i)=>'S'+(i+1)+': '+e.setReps[i]+' reps'+(e.setWeights[i]>0?' @ '+e.setWeights[i]+' lb':' · bodyweight')).join(' · ');return '<p class="small muted"><b>'+escape(name)+'</b><br>'+escape(detail)+'</p>';}).join('');
  return '<article class="card"><span class="tag">'+escape(new Date(h.date).toLocaleString())+'</span><h2>'+escape(p.name)+'</h2><p>'+sets+' sets completed</p>'+exercises+'</article>';
 }).join(''):'<div class="notice">Your saved workouts will appear here. Complete a set and finish your first session.</div>';
}
function renderProfilePage(){
 $('profileGoal').value=profile.goal;$('profileExperience').value=profile.experience;$('profileEquipment').value=profile.equipment;
 $('heightFeet').value=profile.heightIn==null?'':Math.floor(profile.heightIn/12);$('heightInches').value=profile.heightIn==null?'':Math.round(profile.heightIn%12);$('weightLb').value=profile.weightLb??'';
 $('coachMemory').value=coachMemory;
}
function showTab(tab){document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==tab);document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));if(tab==='history')renderHistory();if(tab==='profilePage')renderProfilePage();}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$('saveProfilePage').onclick=()=>{const ft=$('heightFeet').value.trim(),inch=$('heightInches').value.trim(),weight=$('weightLb').value.trim();const height=ft===''&&inch===''?null:Number(ft||0)*12+Number(inch||0);const next=normalizeProfile({goal:$('profileGoal').value,experience:$('profileExperience').value,equipment:$('profileEquipment').value,heightIn:height,weightLb:weight===''?null:Number(weight)});if((height!==null&&next.heightIn===null)||(weight!==''&&next.weightLb===null))return toast('Check your height and weight values.');profile=next;saveProfile();renderProfilePage();drawProposal();toast('Training profile saved.');};
$('saveMemory').onclick=()=>{coachMemory=$('coachMemory').value.trim().slice(0,4000);saveMemory();toast('Coach memory saved.');};
$('clearMemory').onclick=()=>{coachMemory='';saveMemory();$('coachMemory').value='';toast('Coach memory cleared.');};
$('settings').onclick=()=>{
 modal('<h2>Gemini settings</h2><p class="muted">AI Personal Trainer · v'+APP_VERSION+'</p><label for="geminiModel">AI model</label><select id="geminiModel">'+MODELS.map((m,i)=>'<option value="'+escape(m.id)+'">'+escape(m.name)+(i===0?' · Recommended':'')+'</option>').join('')+'</select><p class="small muted">3.8 Flash is the newest stable option here. All three use high reasoning for workout planning.</p><label for="apiKey">Your Gemini API key</label><input id="apiKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="512" placeholder="Paste your Gemini API key"><div class="row"><button id="showKey" class="secondary">Show key</button><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Get a Gemini API key ↗</a></div><button id="saveSettings" class="primary wide">Save Gemini settings</button><button id="clearKey" class="secondary wide">Remove key</button><button id="viewErrorReports" class="secondary wide">Error reports ('+errorReports.length+')</button><p class="small muted">'+(window.TrainerKeys?'Your key is encrypted on this Android device and used only to contact Google Gemini.':'Browser preview: your key stays in memory until you reload or close this page.')+'</p><p class="small muted">Coach requests can include your profile, body data, recent workout history, long-term coach memory, and weekly plan.</p>');
 $('apiKey').value=apiKey;$('geminiModel').value=geminiModel;
 $('showKey').onclick=()=>{const show=$('apiKey').type==='password';$('apiKey').type=show?'text':'password';$('showKey').textContent=show?'Hide key':'Show key';};
 const setKey=value=>{try{if(window.TrainerKeys&&!window.TrainerKeys.saveKey(value))throw new Error();}catch{toast('Could not save your key on this device. Please try again.');return false;}apiKey=value;return true;};
 $('saveSettings').onclick=()=>{const value=$('apiKey').value.trim(),model=$('geminiModel').value;if(value&&/\s/.test(value))return toast('Paste a Gemini API key without spaces.');if(value!==apiKey&&!setKey(value))return;geminiModel=MODELS.some(m=>m.id===model)?model:DEFAULT_MODEL;localStorage.setItem('geminiModel',JSON.stringify(geminiModel));$('modal').close();render();toast('Gemini settings saved.');};
 $('clearKey').onclick=()=>{if(setKey('')){$('apiKey').value='';$('modal').close();render();toast('Gemini key removed.');}};
 $('viewErrorReports').onclick=showErrorReports;
};
$('undo').onclick=()=>{
 if(!undo||busy)return;
 week=normalizeWeek(undo.week);profile=normalizeProfile(undo.profile||profile);timer=undo.timer;selectDay(undo.selected);undo=null;pending=null;save();saveProfile();saveChat();render();tick();
 $('updateNotice').textContent='Last AI change undone.';$('updateNotice').hidden=false;
 messages.push({role:'assistant',content:'You undid the last applied AI change. The previous planner/profile state is restored.'});saveChat();drawMessages();toast('Previous week restored.');
};
function drawMessages(){
 $('messages').innerHTML=messages.length?messages.map(m=>`<div class="message ${m.role}${m.error?' error':''}"><small>${m.role==='user'?'YOU':'GEMINI COACH'}</small>${escape(m.content)}</div>`).join(''):'<div class="notice">Ask about technique, recovery, or how to organize your training. We can work through a draft together before you apply it.</div>';
 $('messages').scrollTop=$('messages').scrollHeight;
}
function renderWeek(){
 const count=week.days.filter(d=>d.enabled).length;
 $('weekSummary').textContent=`${count} training ${count===1?'day':'days'} · ${7-count} rest ${7-count===1?'day':'days'}`;
 $('weekDays').innerHTML=week.days.map(d=>`<button class="day-button ${d.id===selected?'selected':''}" data-select-day="${d.id}" aria-pressed="${d.id===selected}" ${busy?'disabled':''}><b>${dayName(d.id).slice(0,3)}</b><span>${d.enabled?escape(d.plan.name):'Rest'}</span><small>${d.enabled?d.plan.exercises.length+' exercises · '+d.minutes+'m':'Recovery'}</small></button>`).join('');
}
$('weekDays').onclick=e=>{const b=e.target.closest('[data-select-day]');if(!b||busy)return;selectDay(b.dataset.selectDay);render();};
$('editWeek').onclick=()=>{
 modal(`<h2>Your weekly schedule</h2><p class="muted">Choose training days and an approximate training-time target. Warm-up is not counted. Exercise count is intentionally flexible—the coach can choose as many exercises as make sense for the split, volume and time.</p><label for="dayCount">Training days per week</label><select id="dayCount">${Array.from({length:8},(_,i)=>`<option value="${i}" ${i===week.days.filter(d=>d.enabled).length?'selected':''}>${i} days</option>`).join('')}</select><div id="scheduleRows">${week.days.map(d=>`<div class="schedule-row"><label class="day-check"><input type="checkbox" data-enable="${d.id}" ${d.enabled?'checked':''}>${dayName(d.id)}</label><label>Approx. training minutes<input type="number" data-minutes="${d.id}" min="5" max="180" step="5" value="${d.minutes}"></label></div>`).join('')}</div><p class="small muted">Minutes are a target, not a hard ceiling. You can tell the AI coach “about an hour,” “no strict ceiling,” or give a tighter limit in chat.</p><button id="saveWeek" class="primary wide">Save weekly schedule</button>`);
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
  week=next;selectDay(selected);timer={};undo=null;save();render();tick();$('modal').close();toast('Weekly schedule saved. Exercise count stays flexible.');
 };
};
function drawProposal(){
 const coachTab=document.querySelector('[data-tab="coach"]');if(coachTab)coachTab.textContent=pending?'✦ AI coach · Draft':'✦ AI coach';
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
  undo={week:structuredClone(week),profile:structuredClone(profile),selected,timer:structuredClone(timer)};
  if(pending.week&&changes.length)week=applyProposal(week,{week:pending.week,base:pending.base},ids);
  if(pending.profile&&pChanges.length){if(pending.profileBase!==profileKey(profile))throw new Error('Your profile changed after this draft. Ask the coach to refine it again.');profile=normalizeProfile(pending.profile);saveProfile();}
  if(changes.length){const target=changes.find(d=>week.days[DAYS.indexOf(d.id)].enabled)?.id||changes[0].id;selectDay(target);}
  timer={};pending=null;save();saveChat();render();tick();showTab(changes.length?'workout':'profilePage');
  const parts=[];if(changes.length)parts.push('workout: '+changes.map(d=>dayName(d.id)).join(', '));if(pChanges.length)parts.push('profile/body data');
  const note='Applied '+parts.join(' and ')+'.';$('updateNotice').textContent=note;$('updateNotice').hidden=!changes.length;
  messages.push({role:'assistant',content:'You applied the proposed changes: '+parts.join(' and ')+'.'});saveChat();drawMessages();toast(note);window.scrollTo({top:0,behavior:'smooth'});
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
  const data=await askGemini({message,week,selectedDay:selected,proposal:pending?.week||null,history:previous,profile,memory:coachMemory,recentTraining:summarizeHistory(history,catalog,20),model:geminiModel},catalog,apiKey);
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
 finally{busy=false;saveChat();$('clearChat').disabled=false;$('send').disabled=false;$('send').textContent='Send to Gemini ↗';drawMessages();render();}
};
save();render();drawMessages();tick();
