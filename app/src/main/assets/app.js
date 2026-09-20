import {DAYS,dayName,makeWeek,validWeek,weekKey,weekChanges,applyProposal} from './week.js';
import {askGemini} from './gemini.js';
import {templates,makePlan,validPlan,mergePlan,secondsLeft} from './core.js';
const $=id=>document.getElementById(id);
const catalog=await (await fetch('catalog.json')).json(), ids=catalog.map(e=>e.id);
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const legacy=read('plan',null);
let week=read('week',null);
if(!validWeek(week,ids))week=makeWeek(validPlan(legacy,ids)?legacy:undefined);
for(const d of week.days)if(d.plan)d.plan.exercises.forEach(e=>e.done=Math.max(0,Math.min(e.sets,Number.isInteger(e.done)?e.done:0)));
let selected=read('selectedDay',validPlan(legacy,ids)?'mon':DAYS[(new Date().getDay()+6)%7]);
if(!DAYS.includes(selected))selected='mon';
let plan=week.days[DAYS.indexOf(selected)].plan||makePlan(),timer=read('timer',{}),history=read('history',[]),undo=null,busy=false,demoInterval;
if(!Array.isArray(history))history=[];
let apiKey='',messages=read('chat',[]),pending=read('proposal',null);
if(!Array.isArray(messages))messages=[];
messages=messages.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').slice(-80);
if(!pending||!validWeek(pending.week,ids)||typeof pending.base!=='string')pending=null;
const currentDay=()=>week.days[DAYS.indexOf(selected)];
function selectDay(id){selected=id;plan=currentDay().plan||makePlan();localStorage.setItem('selectedDay',JSON.stringify(selected));}
try { apiKey=window.TrainerKeys?.getKey()||''; } catch {}
localStorage.removeItem('endpoint');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function save(){
 if(currentDay().enabled)currentDay().plan=plan;
 localStorage.setItem('week',JSON.stringify(week));localStorage.setItem('selectedDay',JSON.stringify(selected));
 localStorage.setItem('plan',JSON.stringify(plan));localStorage.setItem('timer',JSON.stringify(timer));
}
function saveChat(){messages=messages.slice(-80);localStorage.setItem('chat',JSON.stringify(messages));localStorage.setItem('proposal',JSON.stringify(pending));}

function toast(s){$('toast').textContent=s;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,4500);}
function modal(html){clearInterval(demoInterval);$('modalBody').innerHTML=html;$('modal').showModal();}
$('closeModal').onclick=()=>$('modal').close();$('modal').onclose=()=>{clearInterval(demoInterval);$('modalBody').innerHTML='';};
function render(){
 renderWeek();
 const active=currentDay().enabled;
 $('sessionLabel').textContent=dayName(selected).toUpperCase()+' · '+(active?currentDay().minutes+' MIN BUDGET':'REST DAY');
 $('trainingDetails').hidden=!active;$('newWorkout').hidden=!active;$('progress').hidden=!active;
 $('planName').textContent=active?plan.name:'Rest & recover';const done=plan.exercises.reduce((n,e)=>n+e.done,0),total=plan.exercises.reduce((n,e)=>n+e.sets,0);
 $('summary').textContent=active?`${plan.exercises.length} exercises · ${done} / ${total} sets completed`:'No workout scheduled. Choose another day or edit your week.';$('progress').value=done;$('progress').max=total;$('undo').disabled=!undo||busy;
 $('exercises').innerHTML=plan.exercises.map((e,i)=>{const c=catalog.find(x=>x.id===e.id);return `<article class="card"><div class="card-top"><button data-demo="${e.id}" aria-label="Demonstration for ${escape(c.name)}" style="padding:0"><img class="thumb" src="${c.images[0]}" alt="${escape(c.name)} starting position"></button><div><h3>${escape(c.name)}</h3><span class="tag">${escape(c.muscle)} · ${escape(c.equipment)}</span></div></div><div class="fields">${[['sets','Sets'],['reps','Reps'],['weight','Load (lb)'],['rest','Rest (s)']].map(([key,label])=>`<label>${label}<input aria-label="${escape(c.name)} ${label}" type="number" data-index="${i}" data-field="${key}" value="${e[key]}" min="${key==='weight'?0:key==='rest'?15:1}" max="${key==='sets'?10:key==='reps'?50:key==='rest'?600:1000}" step="${key==='weight'?0.5:1}" ${busy?'disabled':''}></label>`).join('')}</div><div class="row">${Array.from({length:e.sets},(_,n)=>`<button class="set-button ${n<e.done?'done':''}" data-set="${i}" data-n="${n}" ${busy?'disabled':''} aria-label="${escape(c.name)} set ${n+1}${n<e.done?', completed':''}">${n<e.done?'✓':n+1}</button>`).join('')}</div><div class="row" style="margin-top:12px"><button class="secondary" data-demo="${e.id}">View demonstration</button><button class="secondary" data-remove="${i}" ${busy?'disabled':''}>Remove</button></div></article>`;}).join('');
 $('add').disabled=busy;$('newWorkout').disabled=busy;$('finish').disabled=busy;$('settings').disabled=busy;$('editWeek').disabled=busy;drawProposal();
 $('connection').textContent=apiKey?'Gemini ready · Ask for advice, plan your week, or refine a draft. You choose when to apply changes.':'Add your Gemini API key in Settings to start coaching. Workout tracking works offline.';
}
$('exercises').onchange=e=>{if(!e.target.dataset.field)return;const i=+e.target.dataset.index,key=e.target.dataset.field,value=Number(e.target.value),next=structuredClone(plan);next.exercises[i][key]=value;if(e.target.value===''||!validPlan(next,ids)){toast('Please enter a value within the allowed range.');render();return;}next.exercises[i].done=Math.min(next.exercises[i].done,next.exercises[i].sets);plan=next;undo=null;save();render();};
$('exercises').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.demo){const c=catalog.find(x=>x.id===b.dataset.demo);modal(`<h2>${escape(c.name)}</h2><img id="demoImage" class="demo" src="${c.images[0]}" alt="Exercise demonstration"><p class="small muted">Looping start/end photos · free-exercise-db · Unlicense</p><button id="demoToggle" class="secondary">Pause images</button><ol>${c.instructions.map(s=>`<li>${escape(s)}</li>`).join('')}</ol>`);let frame=0;const play=()=>setInterval(()=>{$('demoImage').src=c.images[(++frame)%c.images.length];},1300);demoInterval=play();$('demoToggle').onclick=()=>{if(demoInterval){clearInterval(demoInterval);demoInterval=null;$('demoToggle').textContent='Play images';}else{demoInterval=play();$('demoToggle').textContent='Pause images';}};return;}if(busy)return;if(b.dataset.remove!==undefined){if(plan.exercises.length===1)return toast('Keep at least one exercise.');plan.exercises.splice(+b.dataset.remove,1);}if(b.dataset.set!==undefined){const ex=plan.exercises[+b.dataset.set],n=+b.dataset.n;if(n<ex.done){ex.done=n;timer={};}else if(n===ex.done){ex.done++;timer={end:Date.now()+ex.rest*1000};}else return toast('Complete the next set in order.');}undo=null;save();render();tick();};
$('add').onclick=()=>{modal('<h2>Add an exercise</h2>'+catalog.filter(c=>!plan.exercises.some(e=>e.id===c.id)).map(c=>`<button class="wide secondary" data-add="${c.id}">${escape(c.name)}</button>`).join(''));$('modalBody').onclick=e=>{const id=e.target.dataset.add;if(!id)return;plan.exercises.push({id,sets:3,reps:12,rest:90,weight:0,done:0});undo=null;save();render();$('modal').close();};};
$('newWorkout').onclick=()=>{modal('<h2>Start a fresh session</h2><p>Save your current session first if you want it in Progress.</p>'+Object.keys(templates).map(day=>`<button class="wide" data-day="${day}">${day}</button>`).join(''));$('modalBody').onclick=e=>{if(!e.target.dataset.day)return;plan=makePlan(e.target.dataset.day);timer={};undo=null;save();render();tick();$('modal').close();};};
$('finish').onclick=()=>{const count=plan.exercises.reduce((n,e)=>n+e.done,0);if(!count)return toast('Complete a set before saving.');history.unshift({date:new Date().toISOString(),day:selected,plan:structuredClone(plan)});history=history.slice(0,200);localStorage.setItem('history',JSON.stringify(history));plan.exercises.forEach(e=>e.done=0);timer={};undo=null;save();render();tick();toast('Session saved. Nice work showing up!');};
function tick(){const left=secondsLeft(timer);$('timer').hidden=!timer.end&&timer.paused==null;$('time').textContent=`${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')}`;$('pause').textContent=timer.paused!=null?'Resume':'Pause';if(timer.end&&left===0){timer={};save();$('timer').hidden=true;toast('Rest complete — ready for your next set.');navigator.vibrate?.([150,80,150]);}}
$('pause').onclick=()=>{timer=timer.paused!=null?{end:Date.now()+timer.paused*1000}:{paused:secondsLeft(timer)};save();tick();};$('plus').onclick=()=>{if(timer.paused!=null)timer.paused+=15;else timer.end=Math.max(timer.end||0,Date.now())+15000;save();tick();};$('skip').onclick=()=>{timer={};save();tick();};setInterval(tick,250);document.addEventListener('visibilitychange',tick);
function showTab(tab){document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==tab);document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));if(tab==='history')$('historyList').innerHTML=history.length?history.map(h=>`<article class="card"><span class="tag">${escape(new Date(h.date).toLocaleString())}</span><h2>${escape(h.plan.name)}</h2><p>${h.plan.exercises.reduce((n,e)=>n+e.done,0)} sets completed</p>${h.plan.exercises.map(e=>`<p class="small muted">${escape(catalog.find(c=>c.id===e.id)?.name||e.id)} · ${e.done} × ${e.reps} · ${e.weight} lb</p>`).join('')}</article>`).join(''):'<div class="notice">Your saved workouts will appear here. Complete a set and finish your first session.</div>';}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$('settings').onclick=()=>{
 modal(`<h2>Gemini settings</h2><p class="muted">AI Personal Trainer · v0.3.0</p><label for="apiKey">Your Gemini API key</label><input id="apiKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="512" placeholder="Paste your Gemini API key"><div class="row"><button id="showKey" class="secondary">Show key</button><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Get a Gemini API key ↗</a></div><button id="saveSettings" class="primary wide">Save key</button><button id="clearKey" class="secondary wide">Remove key</button><p class="small muted">${window.TrainerKeys?'Your key is encrypted on this Android device and used only to contact Google Gemini.':'Browser preview: your key stays in memory until you reload or close this page.'}</p><p class="small muted">Gemini 2.5 Flash · No backend or Google login required here. Free-tier limits and any charges depend on your Google API project. Chat context and your weekly schedule are sent to Google; free-tier data may be used to improve Google products.</p><p class="small muted">Exercise photos: free-exercise-db (Unlicense). Rest alerts work while the app is active.</p>`);
 $('apiKey').value=apiKey;
 $('showKey').onclick=()=>{const show=$('apiKey').type==='password';$('apiKey').type=show?'text':'password';$('showKey').textContent=show?'Hide key':'Show key';};
 const setKey=value=>{try{if(window.TrainerKeys&&!window.TrainerKeys.saveKey(value))throw new Error();}catch{toast('Could not save your key on this device. Please try again.');return false;}apiKey=value;return true;};
 $('saveSettings').onclick=()=>{const value=$('apiKey').value.trim();if(!value||/\s/.test(value))return toast('Paste a Gemini API key without spaces.');if(setKey(value)){$('modal').close();render();toast('Gemini key saved. Open AI coach to chat.');}};
 $('clearKey').onclick=()=>{if(setKey('')){$('apiKey').value='';$('modal').close();render();toast('Gemini key removed.');}};
};
$('undo').onclick=()=>{
 if(!undo||busy)return;
 week=undo.week;timer=undo.timer;selectDay(undo.selected);undo=null;pending=null;save();saveChat();render();tick();
 $('updateNotice').textContent='Last AI change undone.';$('updateNotice').hidden=false;
 messages.push({role:'assistant',content:'You undid the last applied schedule change. The previous week is restored.'});saveChat();drawMessages();toast('Previous week restored.');
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
 modal(`<h2>Your weekly schedule</h2><p class="muted">Choose training days, minutes available, and exercises per day. These are time budgets; the coach can refine the sessions to fit.</p><label for="dayCount">Training days per week</label><select id="dayCount">${Array.from({length:8},(_,i)=>`<option value="${i}" ${i===week.days.filter(d=>d.enabled).length?'selected':''}>${i} days</option>`).join('')}</select><div id="scheduleRows">${week.days.map(d=>`<div class="schedule-row"><label class="day-check"><input type="checkbox" data-enable="${d.id}" ${d.enabled?'checked':''}>${dayName(d.id)}</label><label>Minutes<input type="number" data-minutes="${d.id}" min="5" max="180" step="5" value="${d.minutes}"></label><label>Exercises<input type="number" data-count="${d.id}" min="1" max="12" value="${d.plan?.exercises.length||4}"></label></div>`).join('')}</div><button id="saveWeek" class="primary wide">Save weekly schedule</button>`);
 const checks=()=>Array.from($('scheduleRows').querySelectorAll('[data-enable]'));
 const sync=()=>{checks().forEach(c=>{const row=c.closest('.schedule-row');row.querySelector('[data-minutes]').disabled=!c.checked;row.querySelector('[data-count]').disabled=!c.checked;});$('dayCount').value=checks().filter(c=>c.checked).length;};
 $('scheduleRows').onchange=sync;
 $('dayCount').onchange=()=>{const want=Number($('dayCount').value),enabled=checks().filter(c=>c.checked).map(c=>c.dataset.enable);const order=['mon','wed','fri','tue','thu','sat','sun'];while(enabled.length>want)enabled.pop();for(const id of order)if(enabled.length<want&&!enabled.includes(id))enabled.push(id);checks().forEach(c=>c.checked=enabled.includes(c.dataset.enable));sync();};sync();
 $('saveWeek').onclick=()=>{
  let ordinal=0;const next=structuredClone(week);
  for(const d of next.days){
   const row=$('scheduleRows').querySelector(`[data-enable="${d.id}"]`).closest('.schedule-row');d.enabled=row.querySelector('[data-enable]').checked;
   if(!d.enabled){d.plan=null;continue;}
   d.minutes=Number(row.querySelector('[data-minutes]').value);const count=Number(row.querySelector('[data-count]').value);
   if(!Number.isInteger(count)||count<1||count>12||!Number.isInteger(d.minutes)||d.minutes<5||d.minutes>180)return toast('Use 5–180 minutes and 1–12 exercises for each training day.');
   if(!d.plan)d.plan=makePlan(['Push','Pull','Legs'][ordinal%3]);ordinal++;
   const exercises=d.plan.exercises;
   for(const id of ids)if(exercises.length<count&&!exercises.some(e=>e.id===id))exercises.push({id,sets:3,reps:12,rest:90,weight:0,done:0});
   d.plan.exercises=exercises.slice(0,count);
  }
  if(!validWeek(next,ids))return toast('Check the schedule values.');
  week=next;selectDay(selected);timer={};undo=null;save();render();tick();$('modal').close();toast('Weekly schedule saved. Ask your coach to refine it.');
 };
};
function drawProposal(){
 $('proposal').hidden=!pending;if(!pending)return;
 const changes=weekChanges(week,pending.week,catalog),stale=pending.base!==weekKey(week);
 $('proposalDetails').innerHTML=`<p>${stale?'Your schedule changed since this draft. Ask the coach to refine it before applying.':'Draft only — your saved workouts have not changed.'}</p>`+changes.map(d=>`<h3>${dayName(d.id)}</h3><ul>${d.changes.map(c=>`<li>${escape(c)}</li>`).join('')}</ul>`).join('');
 $('applyProposal').disabled=busy||stale||changes.length===0;$('refineProposal').disabled=busy;$('discardProposal').disabled=busy;
}
$('applyProposal').onclick=()=>{
 if(busy||!pending)return;
 try{
  const changes=weekChanges(week,pending.week,catalog),next=applyProposal(week,pending,ids);
  undo={week:structuredClone(week),selected,timer:structuredClone(timer)};
  week=next;selectDay(changes.find(d=>next.days[DAYS.indexOf(d.id)].enabled)?.id||changes[0].id);timer={};pending=null;
  save();saveChat();render();tick();showTab('workout');
  const note='Applied changes to '+changes.map(d=>dayName(d.id)).join(', ')+'.';
  $('updateNotice').textContent=note+' Showing '+dayName(selected)+'.';$('updateNotice').hidden=false;
  messages.push({role:'assistant',content:'You applied the proposed schedule. '+note});saveChat();drawMessages();toast(note);window.scrollTo({top:0,behavior:'smooth'});
 }catch(err){toast(err.message);}
};
$('refineProposal').onclick=()=>{$('chatInput').value='Please refine the draft: ';$('chatInput').focus();$('chatInput').scrollIntoView({block:'center',behavior:'smooth'});};
$('discardProposal').onclick=()=>{if(busy)return;pending=null;messages.push({role:'assistant',content:'Draft discarded. Your saved weekly schedule is unchanged.'});saveChat();drawProposal();drawMessages();};
$('clearChat').onclick=()=>{if(busy)return;modal('<h2>Start a new conversation?</h2><p>This clears chat history and the pending draft. Your weekly schedule and saved sessions stay.</p><button id="confirmClearChat" class="primary wide">Clear chat</button>');$('confirmClearChat').onclick=()=>{messages=[];pending=null;saveChat();drawMessages();drawProposal();$('modal').close();};};
document.querySelectorAll('[data-prompt]').forEach(b=>b.onclick=()=>{$('chatInput').value=b.dataset.prompt;$('chatInput').focus();});
$('chatForm').onsubmit=async e=>{
 e.preventDefault();if(busy)return;if(!apiKey){toast('Add your Gemini API key in Settings first.');return;}
 const message=$('chatInput').value.trim();if(!message)return;
 const previous=messages.filter(m=>!m.error).slice(-30);
 messages.push({role:'user',content:message});saveChat();drawMessages();busy=true;render();$('clearChat').disabled=true;$('send').disabled=true;$('send').textContent='Coach is thinking…';
 try{
  const data=await askGemini({message,week,selectedDay:selected,proposal:pending?.week||null,history:previous},catalog,apiKey);
  messages.push({role:'assistant',content:data.reply});
  if(data.warning){pending=null;messages.push({role:'assistant',content:data.warning,error:true});}
  if(data.action==='proposal'){
   const changes=weekChanges(week,data.week,catalog);
   if(changes.length){pending={week:data.week,base:weekKey(week)};toast('Draft ready. Review or refine it, then tap Apply.');}
   else{pending=null;messages.push({role:'assistant',content:'No actual schedule changes were returned. Your planner is unchanged. Tell me which day, exercise, reps, or timing you want different.'});}
  }
  $('chatInput').value='';
 }catch(err){messages.push({role:'assistant',content:err.message,error:true});}
 finally{busy=false;saveChat();$('clearChat').disabled=false;$('send').disabled=false;$('send').textContent='Send to Gemini ↗';drawMessages();render();}
};
save();render();drawMessages();tick();
