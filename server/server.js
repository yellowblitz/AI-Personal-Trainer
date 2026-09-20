import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {coach,validateRequest} from './coach.js';
const key=process.env.OPENAI_API_KEY,token=process.env.TRAINER_ACCESS_TOKEN;
if(!key||!token||token.length<24){console.error('Set OPENAI_API_KEY and TRAINER_ACCESS_TOKEN (at least 24 characters).');process.exit(1);}
const origins=new Set(['https://appassets.androidplatform.net',...(process.env.ALLOWED_ORIGINS||'').split(',').filter(Boolean)]);
const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
let windowStart=Date.now(),requests=0,inflight=0;
http.createServer(async(req,res)=>{
 const origin=req.headers.origin;
 if(origin&&!origins.has(origin)){res.writeHead(403);res.end();return;}
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 if(origin)headers['Access-Control-Allow-Origin']=origin;
 headers['Access-Control-Allow-Headers']='Authorization, Content-Type';headers['Access-Control-Allow-Methods']='POST, OPTIONS';
 const send=(code,data)=>{res.writeHead(code,headers);res.end(JSON.stringify(data));};
 if(req.method==='OPTIONS'){res.writeHead(204,headers);res.end();return;}
 if(req.url==='/health'&&req.method==='GET'){send(200,{status:'ok'});return;}
 if(req.url!=='/api/coach'||req.method!=='POST'){send(404,{error:'Not found'});return;}
 if(!equal(req.headers.authorization||'',`Bearer ${token}`)){send(401,{error:'Invalid backend access token.'});return;}
 if(Date.now()-windowStart>60000){windowStart=Date.now();requests=0;}
 if(++requests>20||inflight>=2){send(429,{error:'Too many requests. Please wait a minute.'});return;}
 let chunks=[],bytes=0;
 try{for await(const chunk of req){bytes+=chunk.length;if(bytes>65536){send(413,{error:'Request too large.'});return;}chunks.push(chunk);}}catch{return;}
 let body;try{body=validateRequest(JSON.parse(Buffer.concat(chunks).toString()));}catch{send(400,{error:'Invalid message or workout.'});return;}
 inflight++;
 try{send(200,await coach(body,{apiKey:key,model:process.env.OPENAI_MODEL||'gpt-4.1-mini'}));}catch(error){send(502,{error:error.name==='TimeoutError'?'AI timed out. Please retry.':error.message});}finally{inflight--;}
}).listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('Trainer backend listening. Put behind HTTPS before connecting Android.'));
