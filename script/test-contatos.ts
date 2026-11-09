import assert from 'node:assert/strict';
import {once} from 'node:events';
import express from 'express';
import {telefoneContato,contatoInput} from '../shared/contatos';
import {registrarContatos} from '../server/contatos-routes';
assert.equal(telefoneContato('(21) 92000-1127'),'5521920001127');
assert.equal(telefoneContato('5521920001127'),'5521920001127');
assert.equal(telefoneContato('+1 (415) 523-8886'),'14155238886');
for(const v of ['','123','abc21920001127','+55 21','++5521920001127','21920001127;DROP TABLE contatos'])assert.equal(telefoneContato(v),null);
assert.equal(contatoInput.safeParse({nome:'A',telefone:'21920001127'}).success,false);
assert.equal(contatoInput.safeParse({nome:'Pessoa Teste',telefone:'21920001127',consentimento:true}).success,false);
const cid='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const contatos=new Map<string,any>(),vinculos=new Set<number>();let queries=0;
const db={async query(sql:string,args:any[]=[]){queries++;
 if(sql.startsWith('SELECT c.id')&&sql.includes('GROUP BY c.id'))return{rows:[...contatos.values()].map(c=>({...c,processos:[...vinculos].map(String)}))};
 if(sql.startsWith('SELECT c.id'))return{rows:vinculos.has(args[0])?[...contatos.values()]:[]};
 if(sql.startsWith('INSERT INTO public.painel_contatos')){if([...contatos.values()].some(c=>c.telefone===args[1]))throw {code:'23505'};const c={id:cid,nome:args[0],telefone:args[1],versao:0};contatos.set(cid,c);return{rows:[c],rowCount:1};}
 if(sql.startsWith('UPDATE public.painel_contatos')){const c=contatos.get(args[0]);if(!c||c.versao!==args[3])return{rows:[],rowCount:0};Object.assign(c,{nome:args[1],telefone:args[2],versao:c.versao+1});return{rows:[c],rowCount:1};}
 if(sql.startsWith('DELETE FROM public.painel_contatos')){const c=contatos.get(args[0]);if(!c||c.versao!==args[1])return{rows:[],rowCount:0};contatos.delete(args[0]);vinculos.clear();return{rows:[],rowCount:1};}
 if(sql.startsWith('INSERT INTO public.painel_processo_contatos')){if(!contatos.has(args[1])||![1,2].includes(args[0]))throw {code:'23503'};vinculos.add(args[0]);return{rows:[],rowCount:1};}
 if(sql.startsWith('DELETE FROM public.painel_processo_contatos')){vinculos.delete(args[0]);return{rows:[],rowCount:1};}
 throw Error('Unexpected query');
}};
const app=express();app.use(express.json());registrarContatos(app,db as any);const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}`;
async function request(path:string,method='GET',body?:any){return fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}
try{
 const before=queries;assert.equal((await request('/api/contatos','POST',{nome:'Pessoa Teste',telefone:'bad'})).status,400);assert.equal(queries,before);
 const created=await request('/api/contatos','POST',{nome:'  Pessoa Teste  ',telefone:'(21) 92000-1127'});assert.equal(created.status,201);assert.equal((await created.json()).telefone,'5521920001127');assert.equal(contatos.get(cid).nome,'Pessoa Teste');
 assert.equal((await request('/api/contatos','POST',{nome:'Duplicado',telefone:'+55 21 92000-1127'})).status,409);
 for(const id of [1,2,1])assert.equal((await request(`/api/processos/${id}/contatos/${cid}`,'PUT',{})).status,204);
 assert.equal((await request(`/api/processos/99/contatos/${cid}`,'PUT',{})).status,404);
 assert.deepEqual((await(await request('/api/contatos')).json())[0].processos,[1,2]);
 assert.equal((await(await request('/api/processos/1/contatos')).json())[0].id,cid);
 assert.equal((await request(`/api/contatos/${cid}`,'PATCH',{nome:'Editado',telefone:'+55 21 92000-1127',versao:0})).status,200);
 assert.equal((await request(`/api/contatos/${cid}`,'PATCH',{nome:'Edição antiga',telefone:'+55 21 92000-1127',versao:0})).status,409);
 assert.equal((await request(`/api/processos/1/contatos/${cid}`,'DELETE',{})).status,204);assert.equal(vinculos.has(2),true);
 assert.equal((await request('/api/processos/NaN/contatos')).status,400);
 assert.equal((await request(`/api/contatos/${cid}`,'DELETE',{versao:0})).status,409);
 assert.equal((await request(`/api/contatos/${cid}`,'DELETE',{versao:1})).status,204);assert.equal(vinculos.size,0);assert.equal((await(await request('/api/contatos')).json()).length,0);
 console.log('PASS: contact normalization, invalid input, duplicate number, multiple process links, idempotent link, stale edit/delete conflicts, missing references and unlink/delete.');
}finally{server.close();server.closeAllConnections();}
