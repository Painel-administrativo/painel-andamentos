export type CamposAnotacao={acao:string;curadoria:string;promptIa:string};
export function separarAnotacao(texto:string):CamposAnotacao{
 const partes:{[K in keyof CamposAnotacao]:string[]}={acao:[],curadoria:[],promptIa:[]};
 let campo:keyof CamposAnotacao='curadoria';
 const cabecalho=/^\s*(?:[›•]\s*)?\*{0,2}(A[çc][aã]o(?:\s+necess[aá]ria)?|Providenciar|Fazer|Provid[êe]ncia|Urgente|Curadoria(?:\s+para\s+acompanhamento)?|Prompt(?:\s+para)?\s+IA)\s*:\*{0,2}\s*(.*)$/i;
 for(const linha of texto.replace(/\r\n?/g,'\n').split('\n')){
  // The prompt is the last section; its instructions may themselves contain labels.
  const m:RegExpMatchArray|null=campo!=='promptIa'?linha.match(cabecalho):null;
  if(m){campo=/^prompt/i.test(m[1])?'promptIa':/^curadoria/i.test(m[1])?'curadoria':'acao';partes[campo].push(campo==='acao'?m[2].replace(/^necess[aá]ria\s*:\s*/i,''):m[2]);}
  else partes[campo].push(linha);
 }
 return{acao:partes.acao.join('\n').trim(),curadoria:partes.curadoria.join('\n').trim(),promptIa:partes.promptIa.join('\n').trim()};
}
export function comporAnotacao(c:CamposAnotacao){
 return ([['Ação necessária',c.acao],['Curadoria',c.curadoria],['Prompt para IA',c.promptIa]] as const).filter(([,v])=>v.trim()).map(([k,v])=>`${k}: ${v.trim()}`).join('\n');
}
export function anotacaoParaWhatsApp(c:CamposAnotacao){
 return ([['Ação necessária',c.acao],['Curadoria',c.curadoria],['Prompt para IA',c.promptIa]] as const).filter(([,v])=>v.trim()).map(([k,v])=>`*${k}:* ${v.trim()}`).join('\n\n');
}
