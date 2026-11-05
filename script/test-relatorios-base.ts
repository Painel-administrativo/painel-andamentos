import assert from 'node:assert/strict';
import {once} from 'node:events';
import express from 'express';
import {criarRelatorio,registrarRelatorios} from '../server/relatorios-routes';
const grupo='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',base='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',novo='cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';
const texto='  *Relatório personalizado*\r\n2. Processo B — dados pontuais: manter!\r\n\r\n1. Processo A — observações detalhadas.\n';
const checked='2026-10-29T17:42:44.723Z',created='2026-11-05T22:00:00.000Z';
async function caso(op:{base?:boolean;invalid?:boolean;conflict?:boolean}={base:true}){
 const calls:{sql:string;params:any[]}[]=[];let commit=false,rollback=false,released=false;
 const query=async(sql:string,params:any[]=[]):Promise<any>=>{
  calls.push({sql,params});if(sql==='COMMIT')commit=true;if(sql==='ROLLBACK')rollback=true;
  if(sql.startsWith('SELECT nome'))return{rows:[{nome:'CARTAXO & VILLA'}]};
  if(sql.startsWith('SELECT id,texto_final')){assert.ok(sql.includes("grupo_id=$2 AND estado='conferido'"));assert.deepEqual(params,[base,grupo]);return{rows:op.invalid?[]:[{id:base,texto_final:texto,conferido_em:checked}]};}
  if(sql.includes('FROM public.painel_rel_selecao'))return{rows:[{id:1,numero:'00176810720258190000',apelido:'A',tribunal:'TJRJ'},{id:2,numero:'01320741520208190001',apelido:'B',tribunal:'TJRJ'}]};
  if(sql.startsWith('INSERT INTO public.painel_rel_relatorios')){if(op.conflict)throw Object.assign(Error('duplicate'),{code:'23505'});return{rows:[{id:novo,criado_em:created}]};}
  if(sql.startsWith('SELECT i.id,i.resultado'))return{rows:[{id:'referencia',resultado:{vistos:['hash-antigo']}}]};return{rows:[]};
 };
 const pool={connect:async()=>({query,release(){released=true;}})} as any;
 const run=()=>criarRelatorio(pool,grupo,{inicio:'2026-10-30',fim:'2026-11-05'},op.base?base:undefined);
 if(op.invalid||op.conflict){await assert.rejects(run);assert.ok(rollback&&!commit&&released);return;}
 const r=await run();assert.equal(r.id,novo);assert.ok(commit&&!rollback&&released);
 const insert=calls.find(c=>c.sql.startsWith('INSERT INTO public.painel_rel_relatorios'))!;assert.equal(insert.params[4],op.base?base:null);assert.equal(insert.params[5],op.base?texto:null);
 const refs=calls.filter(c=>c.sql.startsWith('SELECT i.id,i.resultado'));assert.ok(refs.every(r=>r.params[2]===(op.base?checked:created)),'The selected report is the comparison cutoff, even if newer checked reports exist');
 assert.equal(calls.filter(c=>c.sql.startsWith('INSERT INTO public.painel_rel_itens')).length,2);
 assert.ok(calls.every(c=>!c.sql.startsWith('UPDATE')),'Copying cannot mutate an existing report');
}
await caso();await caso({base:false});await caso({base:true,invalid:true});await caso({base:true,conflict:true});
let version=0;
const report={id:novo,grupo_id:grupo,nome_escritorio:'CARTAXO & VILLA',inicio:'2026-10-30',fim:'2026-11-05',estado:'rascunho',versao:0,texto_editado:texto,base_relatorio_id:base};
const itens=[{id:'item',numero:'00176810720258190000',apelido:'A',tribunal:'TJRJ',estado:'inconclusivo',consultado_em:created,erro:'Fonte indisponível',resultado:null}];
const db={async query(sql:string,params:any[]=[]):Promise<any>{
 if(sql.includes('FROM public.painel_rel_relatorios r WHERE r.id=$1'))return{rows:[report]};
 if(sql.includes('SELECT id,nome_escritorio'))return{rows:[{id:base,inicio:'2026-10-17',fim:'2026-10-23'}]};
 if(sql.startsWith('SELECT numero'))return{rows:[{numero:'01320741520208190001'}]};
 if(sql.includes('FROM public.painel_rel_itens'))return{rows:itens};
 if(sql.startsWith('UPDATE public.painel_rel_relatorios SET estado=')){version++;return{rows:[]};}return{rows:[]};
},release(){}};
const pool={query:db.query,connect:async()=>db} as any;
const app=express();app.use(express.json());registrarRelatorios(app,pool);const server=app.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as any).port}`;
try{
 const r=await(await fetch(origin+`/api/relatorios/${novo}`)).json();
 assert.equal(r.texto,texto);assert.ok(r.atualizacoesTexto.includes('CONSULTA INCONCLUSIVA'));assert.ok(r.atualizacoesTexto.includes('até a conferência do relatório escolhido como base'));
 assert.deepEqual(r.diferencasBase,{adicionados:['00176810720258190000'],foraSelecao:['01320741520208190001']});
 const post=(body:any)=>fetch(origin+`/api/relatorios/${novo}/conferir`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post({versao:0,conferido:true,inconclusivosReconhecidos:true})).status,400);assert.equal(version,0);
 assert.equal((await post({versao:0,conferido:true,inconclusivosReconhecidos:true,baseRevisada:true})).status,200);assert.equal(version,1);
 console.log('PASS: exact customized text copy, original immutable, selected-base cutoff, normal generation, invalid source/concurrent draft rollback, separate fresh updates, portfolio changes and mandatory review of reused content.');
}finally{server.close();server.closeAllConnections();}
