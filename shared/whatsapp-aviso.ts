export const LIMITE_AVISO = 1600;
export const linhaAviso=(v:string)=>v.replace(/\s+/g,' ').trim();
export type CamposAviso={carimbo:string;identificacao:string;numero:string;tipo:string;disponibilizacao:string;publicacao:string;prazo:string;texto:string;acao:string;curadoria:string};
export function comporAviso(c:CamposAviso){
 const values=[c.carimbo,c.identificacao,c.numero,c.tipo,c.disponibilizacao,c.publicacao,c.prazo,c.texto,c.acao,c.curadoria].map(v=>v.trim());
 const texto=`Painel · Aviso · ${values[0]}\n━━━━━━━━━━━━━━\n${values[1]} · Processo ${values[2]}\n${values[3]} · disponibilizada ${values[4]} · publicada ${values[5]}\nPrazo começa: ${values[6]}\n\nConfira o teor da comunicação processual:\n${values[7]}\n\nAção necessária: ${values[8]}\n› Curadoria para acompanhamento: ${values[9]}\n━━━━━━━━━━━━━━\nAviso de acompanhamento processual do Painel.`;
 return{values,texto};
}
export function separarCuradoria(anotacao:string){
 let acao='';const outras:string[]=[];
 for(const original of anotacao.split(/\r?\n/)){
  const l=original.trim().replace(/^[›•]\s*/, '');
  if(/^(?:a[çc][aã]o(?: necess[aá]ria)?|providenciar)\s*:/i.test(l))acao=linhaAviso(l.replace(/^(?:a[çc][aã]o(?: necess[aá]ria)?|providenciar)\s*:\s*(?:necess[aá]ria\s*:\s*)?/i,''));
  else if(l)outras.push(l.replace(/^curadoria\s*:\s*/i,''));
 }
 return{acao:acao||'Não definida.',curadoria:linhaAviso(outras.join(' '))||'Não informada.'};
}
