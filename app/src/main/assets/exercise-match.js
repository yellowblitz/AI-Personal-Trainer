const aliasMap={
 Pushups:['push up','push-up','push ups'],
 Bodyweight_Squat:['air squat','body weight squat'],
 Dumbbell_Bench_Press:['dumbbell chest press','flat dumbbell press','db bench press'],
 Seated_Cable_Rows:['seated cable row','cable row','low cable row'],
 Triceps_Pushdown:['tricep pushdown','triceps pressdown','cable pushdown','cable pressdown'],
 Cable_Crossover:['cable fly','cable chest fly','standing cable fly'],
 'Wide-Grip_Lat_Pulldown':['lat pulldown','wide grip pulldown','wide grip lat pulldown'],
 Dumbbell_Bicep_Curl:['dumbbell curl','bicep curl','db curl'],
 Dumbbell_Lunges:['dumbbell lunge','db lunge'],
 Standing_Calf_Raises:['standing calf raise','calf raise'],
 Side_Lateral_Raise:['lateral raise','side raise','dumbbell lateral raise'],
 Face_Pull:['cable face pull','rope face pull'],
 Pushdowns:['pushdown','tricep pushdown'],
 'Triceps_Pushdown_-_Rope_Attachment':['rope pushdown','rope tricep pushdown','rope pressdown'],
 'Incline_Dumbbell_Press':['incline dumbbell press','incline db press'],
 'Decline_Dumbbell_Bench_Press':['decline dumbbell press','decline db press'],
 'One-Arm_Dumbbell_Row':['one arm dumbbell row','single arm dumbbell row','db row'],
 'Standing_Biceps_Cable_Curl':['cable curl','cable bicep curl'],
 'Cable_Hammer_Curls_-_Rope_Attachment':['rope hammer curl','cable hammer curl'],
 'Cable_Incline_Pushdown':['incline cable pushdown'],
 'Straight-Arm_Pulldown':['straight arm pulldown','cable pullover'],
 'Single-Arm_Cable_Crossover':['single arm cable fly','one arm cable fly'],
 'Cable_Internal_Rotation':['cable internal rotation'],
 'Cable_External_Rotation':['cable external rotation']
};

export const normalizeExerciseText=value=>String(value??'').toLowerCase().normalize('NFKD')
 .replace(/[’']/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();

const singular=word=>word.length>4&&word.endsWith('s')&&!word.endsWith('ss')?word.slice(0,-1):word;
const tokens=value=>normalizeExerciseText(value).split(' ').filter(Boolean).map(singular);
export const exerciseAliases=id=>aliasMap[id]||[];

function itemText(item){
 return [item.id,item.name,item.muscle,item.equipment,...exerciseAliases(item.id),...(Array.isArray(item.aliases)?item.aliases:[])].filter(Boolean).join(' ');
}

export function resolveExerciseRef(ref,catalog){
 const needle=normalizeExerciseText(ref);
 if(!needle)return null;
 const exact=catalog.filter(item=>{
  if(normalizeExerciseText(item.id)===needle||normalizeExerciseText(item.name)===needle)return true;
  return [...exerciseAliases(item.id),...(Array.isArray(item.aliases)?item.aliases:[])].some(a=>normalizeExerciseText(a)===needle);
 });
 if(exact.length===1)return exact[0].id;
 if(exact.length>1)return null;
 const q=new Set(tokens(needle)); if(!q.size)return null;
 const scored=catalog.map(item=>{
  const nameTokens=new Set(tokens(itemText(item)));
  let hit=0;for(const t of q)if(nameTokens.has(t))hit++;
  const coverage=hit/q.size;
  const specificity=hit/Math.max(nameTokens.size,1);
  const normName=normalizeExerciseText(item.name);
  const containment=normName.includes(needle)||needle.includes(normName)?0.25:0;
  return {id:item.id,score:coverage*0.75+specificity*0.25+containment};
 }).sort((a,b)=>b.score-a.score);
 const best=scored[0],second=scored[1];
 if(!best||best.score<0.72||(second&&best.score-second.score<0.12))return null;
 return best.id;
}

export function rankExerciseCatalog(query,catalog,{limit=220,includeIds=[]}={}){
 const qnorm=normalizeExerciseText(query),q=new Set(tokens(query)),must=new Set(includeIds||[]);
 const ranked=catalog.map(item=>{
  if(must.has(item.id))return {item,score:10000};
  const name=normalizeExerciseText(item.name),id=normalizeExerciseText(item.id);
  const aliases=[...exerciseAliases(item.id),...(Array.isArray(item.aliases)?item.aliases:[])].map(normalizeExerciseText);
  let score=0;
  if(name&&qnorm.includes(name))score+=500;
  if(id&&qnorm.includes(id))score+=450;
  if(aliases.some(a=>a&&qnorm.includes(a)))score+=480;
  const nameTokens=new Set(tokens([item.name,...aliases].join(' ')));
  const metaTokens=new Set(tokens([item.muscle,item.equipment].join(' ')));
  for(const t of q){if(nameTokens.has(t))score+=18;if(metaTokens.has(t))score+=4;}
  if(qnorm.includes(normalizeExerciseText(item.equipment)))score+=6;
  if(qnorm.includes(normalizeExerciseText(item.muscle)))score+=5;
  return {item,score};
 }).sort((a,b)=>b.score-a.score||String(a.item.name).localeCompare(String(b.item.name)));
 const selected=ranked.slice(0,Math.max(1,limit)).map(x=>x.item);
 for(const id of must){if(!selected.some(x=>x.id===id)){const item=catalog.find(x=>x.id===id);if(item)selected.push(item);}}
 return selected;
}

export function compactCatalog(query,catalog,options={}){
 return rankExerciseCatalog(query,catalog,options).map(item=>({
  id:item.id,name:item.name,equipment:item.equipment,muscle:item.muscle,
  aliases:[...exerciseAliases(item.id),...(Array.isArray(item.aliases)?item.aliases:[])].slice(0,6)
 }));
}
