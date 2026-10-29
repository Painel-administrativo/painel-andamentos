import assert from 'node:assert/strict';
import {consultarDjenNovamente,reconsultarFalha} from '../server/djen-reconsulta';
const numero='50002543620214025115',inicio='2026-10-26',fim='2026-10-29';
let calls=0;const waits:number[]=[];
const r=await consultarDjenNovamente(numero,inicio,fim,(async(url:any)=>{
 calls++;assert.ok(String(url).includes('dataDisponibilizacaoInicio=2026-10-26'));assert.ok(String(url).includes(numero));
 return calls===1?new Response('',{status:500}):Response.json({status:'success',items:[],count:0});
}) as any,async(ms)=>{waits.push(ms);});assert.equal(calls,2);assert.equal(r.items.length,0);assert.deepEqual(waits,[1500]);
await assert.rejects(()=>consultarDjenNovamente(numero,inicio,fim,(async()=>Response.json({erro:'fonte indisponivel'})) as any,async()=>{}),/DJEN_ERRO_NO_ENVELOPE/);
await assert.rejects(()=>consultarDjenNovamente(numero,inicio,fim,(async()=>new Response('',{status:500})) as any,async()=>{}),/DJEN_HTTP_500/);
await assert.rejects(()=>consultarDjenNovamente(numero,inicio,fim,(async()=>{throw Error('timeout');}) as any,async()=>{}),/DJEN_CONEXAO_OU_TIMEOUT/);
await assert.rejects(()=>consultarDjenNovamente(numero,inicio,fim,(async()=>Response.json({items:[],count:3})) as any,async()=>{}),/DJEN_CONTAGEM_INCONSISTENTE/);
await assert.rejects(()=>consultarDjenNovamente(numero,inicio,fim,(async()=>new Response('',{status:429})) as any,async()=>{}),e=>(e as any).rateLimits===2);
let rateCalls=0;const limited=await consultarDjenNovamente(numero,inicio,fim,(async()=>++rateCalls===1?new Response('',{status:429}):Response.json({items:[]})) as any,async()=>{});assert.equal(limited.rateLimits,1);
async function caso(opts:{failure?:boolean;storageFail?:boolean;wrong?:boolean;done?:boolean;conflict?:boolean}={}){
 let released=false,commit=false,rollback=false,consultas=0,gravacoes=0;let resultParams:any[]=[];let claim:any[]=[];
 const db={release(){released=true;},async query(sql:string,args:any[]=[]):Promise<any>{
  if(sql==='COMMIT'){commit=true;return{rows:[]};}if(sql==='ROLLBACK'){rollback=true;return{rows:[]};}
  if(sql.includes('FOR UPDATE'))return{rows:[{id:'2409',finalizado_em:'2026-10-29',falhas:[{processoId:'236',codigo:'DJEN_HTTP_500'}],inicio,fim}]};
  if(sql.startsWith('SELECT id FROM public.painel_djen_logs'))return{rows:opts.done?[{id:'recuperado'}]:[]};
  if(sql.includes('FROM public.processos'))return{rows:[{id:236,numero}]};
  if(sql.startsWith('INSERT')){claim=args;if(opts.conflict)throw Object.assign(Error('unique'),{code:'23505'});return{rows:[{id:'novo'}]};}
  return{rows:[]};
 }};
 const pool={connect:async()=>db,query:async(_sql:string,args:any[])=>{resultParams=args;return{rowCount:1};}} as any;
 const run=()=>reconsultarFalha(pool,2409,{processoId:opts.wrong?247:236,rodada:'b7d6323a-a4c6-452f-915d-14074f5a4b61'},async(id,items)=>{gravacoes++;assert.equal(id,236);assert.equal(items.length,0);if(opts.storageFail)throw Error('storage');return{inseridas:0};},async(n,i,f)=>{consultas++;assert.equal(n,numero);assert.equal(i,inicio);assert.equal(f,fim);assert.ok(released&&commit);if(opts.failure)throw Error('HTTP');return{items:[],rateLimits:0};});
 if(opts.wrong||opts.conflict){await assert.rejects(run);assert.ok(rollback&&released&&!commit);assert.equal(consultas,0);return;}
 const x=await run();assert.ok(commit&&released&&!rollback);
 if(opts.done){assert.equal(x.processados,0);assert.equal(consultas,0);assert.equal(gravacoes,0);return;}
 assert.deepEqual(claim.slice(0,2),[inicio,fim]);assert.deepEqual(claim.slice(3),['2409',236]);
 assert.equal(x.erros,opts.failure||opts.storageFail?1:0);assert.equal(resultParams[1],opts.failure||opts.storageFail?'falha':'sem_erros');
 assert.equal(gravacoes,opts.failure?0:1);assert.equal(x.recuperado,!opts.failure&&!opts.storageFail);
}
await caso();await caso({failure:true});await caso({storageFail:true});await caso({wrong:true});await caso({done:true});await caso({conflict:true});
console.log('PASS: only recorded failures, original period, successful recovery skips repeat, bounded 500/429/network retries, source/storage failures remain pending, claim before remote fetch and concurrent claim rollback.');
