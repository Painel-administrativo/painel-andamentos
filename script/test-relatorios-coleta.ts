import assert from 'node:assert/strict';
import {coletarRelatorio} from '../server/relatorios-routes';
import {normalizarFonte,compararFonte} from '../server/relatorios-datajud';
const numero='00048726420218190213';
const raw={hits:{total:{value:1,relation:'eq'},hits:[{_source:{numeroProcesso:numero,tribunal:'TJRJ',grau:'G1',movimentos:[{codigo:1,nome:'Juntada',dataHora:'2026-10-20T10:00:00'}]}}]}};
const fonte=normalizarFonte(raw,numero),referencia=compararFonte(fonte,null,'2026-10-17','2026-10-23');
const updates:{sql:string;params:any[]}[]=[];
const itens=[{id:'ok',numero,tribunal:'TJRJ',tentativa:'lease-ok',referencia},{id:'falha',numero:'00176810720258190000',tribunal:'TJRJ',tentativa:'lease-falha',referencia}];
const query=async(sql:string,params:any[]=[])=>{
 if(sql.includes('FOR UPDATE')&&sql.includes('painel_rel_relatorios'))return{rows:[{estado:'coletando',inicio:'2026-10-17',fim:'2026-10-23'}]};
 if(sql.includes('WITH proximos'))return{rows:itens};
 if(sql.includes('AS concluidos'))return{rows:[{total:2,concluidos:2}]};
 if(sql.includes('UPDATE public.painel_rel_itens'))updates.push({sql,params});
 return{rows:[]};
};
const pool={query,async connect(){return{query,release(){}};}} as any;
const result=await coletarRelatorio(pool,'report',async n=>{if(n!==numero)throw Error('network unavailable');return{raw,...fonte};});
assert.ok(result.finalizado);assert.equal(updates.length,2);
const ok=updates.find(u=>u.params[0]==='ok')!,falha=updates.find(u=>u.params[0]==='falha')!;
assert.ok(ok.sql.includes("estado='ok'"));assert.ok(falha.sql.includes("estado='inconclusivo'"));
assert.equal(ok.params[2].novos.length,0);assert.ok(!falha.sql.includes('referencia='),'A failed consultation cannot overwrite the previous successful baseline');
for(const u of updates){assert.ok(u.sql.includes('tentativa=$2'));assert.ok(u.sql.includes("r.estado='coletando'"));}
assert.ok(falha.params[2].includes('Conferir diretamente no tribunal'));
console.log('PASS: batch collection preserves baseline on source failure and guards writes with lease token and report state.');
