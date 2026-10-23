import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ajustarPrazo,ajustePrazoSchema} from '../server/prazo-manual-routes';
import {fimEfetivo,dataPrazoManual} from '../shared/prazo-manual';
import {formatarBR,diaSemanaBR} from '../shared/prazos';
const automatico=new Date('2026-11-04T00:00:00Z');
assert.equal(fimEfetivo('2026-11-06',automatico)?.toISOString().slice(0,10),'2026-11-06');
assert.equal(fimEfetivo(null,automatico),automatico);
assert.equal(fimEfetivo('2026-11-06',null)?.toISOString().slice(0,10),'2026-11-06');
assert.equal(dataPrazoManual('2026-02-30'),null);
assert.equal(formatarBR(dataPrazoManual('2026-11-06')!),'06/11/2026');
assert.equal(diaSemanaBR(dataPrazoManual('2026-11-06')!),'sexta');
const input={data:'2026-11-06',justificativa:'Conferido no ato judicial específico.',versao:0,retificacaoReconhecida:true};
assert.equal(ajustePrazoSchema.safeParse({...input,data:'2026-02-30'}).success,false);
assert.equal(ajustePrazoSchema.safeParse({...input,justificativa:'x'}).success,false);
async function caso(opts:{manual?:string|null;versao?:number;informada?:boolean;input?:any;fail?:boolean;missing?:boolean}={}){
 let commit=false,rollback=false,release=false;const writes:{sql:string;args:any[]}[]=[];
 const db={release(){release=true;},async query(sql:string,args:any[]=[]):Promise<any>{
  if(sql==='BEGIN')return{rows:[]};if(sql==='COMMIT'){commit=true;return{rows:[]};}if(sql==='ROLLBACK'){rollback=true;return{rows:[]};}
  if(sql.includes('FOR UPDATE OF p'))return{rows:opts.missing?[]:[{prazo_manual:opts.manual??null,prazo_manual_versao:opts.versao??0,informado_em:opts.informada?'2026-10-23':null,numero:'30013004420268190061',sigla:'TJRJ',disponibilizacao:'2026-10-23',prazo_dias:5,prazo_tipo:'uteis'}]};
  if(sql.includes('FROM public.feriados'))return{rows:[{data:'2026-11-02'}]};
  if(sql.includes('FROM public.painel_cal_propostas'))return{rows:[]};
  writes.push({sql,args});if(opts.fail&&sql.startsWith('UPDATE'))throw Error('db failed');return{rows:[]};
 }};
 const run=()=>ajustarPrazo({connect:async()=>db} as any,42,opts.input??input,'reviewer-id');
 if(opts.fail||opts.missing||opts.versao===1||opts.informada&&opts.input?.retificacaoReconhecida===false){await assert.rejects(run);assert.ok(rollback&&!commit&&release);return;}
 const result=await run();assert.ok(commit&&!rollback&&release);assert.equal(result.prazoManual,(opts.input??input).data);
 const audit=writes.find(w=>w.sql.startsWith('INSERT'))!.args;
 assert.equal(audit[2],opts.manual??null);assert.equal(audit[3],(opts.input??input).data);assert.equal(audit[5].fim,'2026-11-04');assert.equal(audit[6],'reviewer-id');assert.equal(audit[7],!!opts.informada);
 assert.ok(writes.find(w=>w.sql.startsWith('UPDATE'))!.sql.includes('prazo_manual_versao+1'));
}
await caso();await caso({manual:'2026-11-06',input:{...input,data:null}});await caso({versao:1});await caso({informada:true,input:{...input,retificacaoReconhecida:false}});await caso({informada:true});await caso({fail:true});await caso({missing:true});
// Calendar review must preserve manual dates; both public rendering and clipboard use the adjustment.
assert.ok(readFileSync('server/calendario-routes.ts','utf8').includes('WHERE p.prazo_manual IS NULL AND p.prazo_dias>0'));
const card=readFileSync('client/src/components/CardPublicacoes.tsx','utf8');assert.ok(card.includes('Prazo ajustado manualmente: termina'));
const publica=readFileSync('client/src/pages/publicacao-publica.tsx','utf8');assert.ok(publica.includes('if (manual) fimPrazoStr'));
console.log('PASS: effective manual date, restoration, timezone-safe dates, validation, concurrent revision conflict, notified acknowledgement, atomic audit rollback, calendar preservation and public/clipboard integration.');
