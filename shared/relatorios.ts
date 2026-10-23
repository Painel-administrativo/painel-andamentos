export type MovimentoRelatorio={id:string;data:string;dia:string;descricao:string;grau:string;orgao:string};
export type ResultadoRelatorio={
 inicial:boolean;novos:MovimentoRelatorio[];noPeriodo:MovimentoRelatorio[];anteriores:MovimentoRelatorio[];
 ultimo:MovimentoRelatorio|null;totalMovimentos:number;avisos:string[];atualizacaoFonte:string|null;vistos:string[];
};
export type ItemRelatorio={id:string;numero:string;apelido:string|null;tribunal:string;estado:string;consultado_em:string|null;erro:string|null;resultado:ResultadoRelatorio|null};
export function cnjRelatorio(numero:string){const d=numero.replace(/\D/g,"");return d.length===20?`${d.slice(0,7)}-${d.slice(7,9)}.${d.slice(9,13)}.${d.slice(13,14)}.${d.slice(14,16)}.${d.slice(16)}`:numero;}
export const dataRelatorio=(s:string)=>s.slice(0,10).split("-").reverse().join("/");
export function periodoSemanal(agora=new Date()) {
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(agora);
 const value=(k:string)=>parts.find(p=>p.type===k)!.value;
 const fim=`${value('year')}-${value('month')}-${value('day')}`;const d=new Date(fim+"T00:00:00Z");d.setUTCDate(d.getUTCDate()-6);
 return {inicio:d.toISOString().slice(0,10),fim};
}
const descricaoMov=(m:MovimentoRelatorio)=>`${dataRelatorio(m.dia)} — ${m.descricao}${m.grau?` [${m.grau}]`:""}${m.orgao?` · ${m.orgao}`:""}`;
export function formatarRelatorio(nome:string,inicio:string,fim:string,itens:ItemRelatorio[]) {
 const ok=itens.filter(i=>i.estado==='ok'),inconclusivos=itens.length-ok.length;
 const linhas=[`*${nome} — Relatório de andamentos*`,`Período: ${dataRelatorio(inicio)} a ${dataRelatorio(fim)}`,`Carteira: ${itens.length} processos · consultas concluídas: ${ok.length} · inconclusivas: ${inconclusivos}`,"Comparação com o último relatório conferido de cada processo; independente das publicações do DJEN.",""];
 itens.forEach((i,n)=>{
  linhas.push(`*${n+1}. ${cnjRelatorio(i.numero)}*`);if(i.apelido)linhas.push(i.apelido);
  if(i.estado!=='ok'||!i.resultado){linhas.push(`*CONSULTA INCONCLUSIVA:* ${i.erro||'Consulta ainda não concluída.'}`,'Não é possível afirmar ausência de novos andamentos. Conferir no tribunal.',"");return;}
  const r=i.resultado;
  if(r.inicial)linhas.push('Primeiro relatório: referência inicial, sem comparação anterior.');
  const movs=r.inicial?r.noPeriodo:r.novos;
  if(movs.length){linhas.push(r.inicial?'Registros da fonte com data no período:':'Novos registros identificados desde a referência anterior:');for(const m of movs)linhas.push(`• ${descricaoMov(m)}${m.dia<inicio?' — Registro antigo incorporado posteriormente à comparação':m.dia>fim?' — Data posterior ao período: conferir na fonte':''}`);}
  else linhas.push(r.inicial?'Nenhum movimento com data no período foi localizado na fonte consultada.':'Sem novos registros identificados no DataJud desde a referência anterior.');
  if(r.ultimo)linhas.push(`Último movimento disponibilizado: ${descricaoMov(r.ultimo)}`);else linhas.push('A fonte não disponibilizou movimentos.');
  linhas.push(`Última atualização declarada pela fonte: ${r.atualizacaoFonte?dataRelatorio(r.atualizacaoFonte):'não informada'}.`);
  if(i.consultado_em)linhas.push(`Consulta realizada em ${new Date(i.consultado_em).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}.`);
  for(const a of r.avisos)linhas.push(`Atenção: ${a}`);
  linhas.push('');
 });
 linhas.push('Fonte: Conselho Nacional de Justiça (CNJ) — Base Nacional de Dados do Poder Judiciário (DataJud), API Pública.','A consulta ao DataJud não comprova atualização integral do andamento no TJRJ. Ausência de novos registros na base não certifica ausência de movimentação no tribunal.');
 return linhas.join('\n');
}
export function partesWhatsApp(texto:string,max=3500) {
 if(!texto.trim())return [];
 const partes:string[]=[];let atual='';
 for(const linha of texto.split('\n')) {
  if(linha.length>max){if(atual){partes.push(atual);atual='';}const chars=Array.from(linha);let trecho='';for(const c of chars){if(trecho.length+c.length>max){partes.push(trecho);trecho='';}trecho+=c;}atual=trecho;continue;}
  if(atual.length+linha.length+1>max){partes.push(atual);atual=linha;}else atual+=(atual?'\n':'')+linha;
 }
 if(atual)partes.push(atual);return partes;
}
