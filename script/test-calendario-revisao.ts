import assert from 'node:assert/strict';
import {revisar} from '../server/calendario-routes';
const regra={ato:'ATO TESTE',motivo:'Suspensão de teste',inicio:'2026-10-29',fim:'2026-10-29',alcance:'origem' as const,origem:'0061',local:'Teresópolis',efeito:'dia_nao_util' as const};
const pub={id:1,numero:'30013004420268190061',sigla:'TJRJ',disponibilizacao:'2026-10-23',dias:5,tipo:'uteis',ja_informada:true};
async function caso(acao:'aprovar'|'revogar',falhar=false){
 let mudou=false,rollback=false,commit=false;const impactos:any[]=[];
 const db={release(){},async query(sql:string,params:any[]=[]):Promise<any>{
  if(sql==='COMMIT'){commit=true;return{rows:[]};}if(sql==='ROLLBACK'){rollback=true;return{rows:[]};}
  if(sql.includes('SELECT status'))return{rows:[{status:acao==='aprovar'?'pendente':'aprovada'}]};
  if(sql.includes('SELECT p.id,p.regra'))return{rows:(acao==='aprovar'?mudou:!mudou)?[{id:'regra',regra,fonte:'https://www.tjrj.jus.br/documents/a'}]:[]};
  if(sql.startsWith('UPDATE public.painel_cal_propostas')){mudou=true;return{rows:[]};}
  if(sql.startsWith('INSERT INTO public.painel_cal_revisoes'))return{rows:[{id:'revisao'}]};
  if(sql.includes('FROM public.feriados'))return{rows:[{data:'2026-11-02'}]};
  if(sql.includes('p.prazo_dias AS dias'))return{rows:[pub]};
  if(sql.startsWith('INSERT INTO public.painel_cal_impactos')){if(falhar)throw Error('DB unavailable');impactos.push(params);return{rows:[]};}
  return{rows:[]};
 }};
 const pool={async connect(){return db;}} as any;
 const input={acao,justificativa:'Conferência feita no documento original.',conferido:true as const,...(acao==='aprovar'?{regra}:{})};
 if(falhar){await assert.rejects(()=>revisar(pool,'id',input,'admin'));assert.ok(rollback&&!commit);return;}
 const r=await revisar(pool,'id',input,'admin');assert.equal(r.impactos,1);assert.ok(commit&&!rollback);assert.equal(impactos[0][4],true);
 assert.equal(impactos[0][2].fim,acao==='aprovar'?'2026-11-04':'2026-11-05');assert.equal(impactos[0][3].fim,acao==='aprovar'?'2026-11-05':'2026-11-04');
}
await caso('aprovar');await caso('revogar');await caso('aprovar',true);
console.log('PASS: approval/revocation impact snapshots preserve notified flag; database failures roll back revision and impacts together.');
