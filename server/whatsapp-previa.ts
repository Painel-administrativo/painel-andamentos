import {textoPublicacaoPlano} from '../shared/texto-publicacao';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {envioSchema} from './whatsapp';
import {comporAviso,linhaAviso,separarCuradoria,type CamposAviso,LIMITE_AVISO} from '../shared/whatsapp-aviso';
import {montarCalendario,type RegraCalendario} from '../shared/calendario';
import {calcularDatasPrazo,calcularFimPrazo,formatarBR} from '../shared/prazos';
import {dataPrazoManual} from '../shared/prazo-manual';
import {feriadosParaTribunal} from '../client/src/lib/calendario-forense';
const umaLinha=(max:number)=>z.string().trim().min(1).max(max).refine(s=>!/[\r\n\t]/.test(s),'Use uma única linha.');
export const envioAvisoSchema=envioSchema.pick({nome:true,telefone:true,consentimento:true}).extend({
 texto:umaLinha(4000),acao:umaLinha(350),curadoria:umaLinha(1000),conferido:z.literal(true),versaoModelo:z.literal('aviso10'),
 geradaEm:z.string().datetime(),contexto:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
type Db={query:(sql:string,values?:any[])=>Promise<any>};
function cnj(v:string){const n=v.replace(/\D/g,'');return n.length===20?`${n.slice(0,7)}-${n.slice(7,9)}.${n.slice(9,13)}.${n.slice(13,14)}.${n.slice(14,16)}.${n.slice(16)}`:v;}
export async function prepararAviso(db:Db,pub:any,geradaEm=new Date().toISOString()){
 const baseRows=await db.query("SELECT to_char(data,'YYYY-MM-DD') AS data FROM public.feriados");
 const regras=(await db.query("SELECT regra FROM public.painel_cal_propostas WHERE status='aprovada' ORDER BY revisado_em")).rows.map((r:any)=>r.regra) as RegraCalendario[];
 const n=String(pub.processoNumero||''),sigla=pub.siglaTribunal||(n.replace(/\D/g,'').slice(13,16)==='819'?'TJRJ':null);
 const c=montarCalendario(feriadosParaTribunal(new Set<string>(baseRows.rows.map((r:any)=>r.data)),sigla),regras,n,sigla);
 const dataDisp=(pub.dataDisponibilizacao instanceof Date?pub.dataDisponibilizacao.toISOString():String(pub.dataDisponibilizacao)).slice(0,10);
 const disp=dataPrazoManual(dataDisp);if(!disp)throw Error('Data de disponibilização inválida.');
 const datas=calcularDatasPrazo(dataDisp,c.feriados,c.suspensoes);
 if(!datas)throw Error('Data de disponibilização inválida. Confira a publicação antes de preparar o aviso.');
 let prazo=datas.inicioStr;
 const manual=dataPrazoManual(pub.prazoManual);
 if(manual)prazo+=` · término ajustado manualmente: ${formatarBR(manual)}`;
 else if(pub.prazoDias&&pub.prazoTipo){const f=calcularFimPrazo(datas.inicio,pub.prazoDias,pub.prazoTipo,c.feriados,c.suspensoes);if(f)prazo+=` · término: ${formatarBR(f)} (${pub.prazoDias} dias ${pub.prazoTipo==='uteis'?'úteis':'corridos'})`;}
 const d=new Date(geradaEm),parts=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);
 const part=(t:string)=>parts.find(x=>x.type===t)?.value;
 const campos:CamposAviso={carimbo:`${part('day')}/${part('month')} ${part('hour')}:${part('minute')}`,identificacao:linhaAviso(pub.processoApelido||'Processo acompanhado'),numero:cnj(n),tipo:linhaAviso(pub.tipoDocumento||'Publicação'),disponibilizacao:formatarBR(disp),publicacao:datas.publicacaoStr,prazo,texto:textoPublicacaoPlano(pub.texto||'Texto não disponibilizado na fonte.'),...separarCuradoria(pub.anotacao||'')};
 // Exclude the clock from the source fingerprint; compare all publication/calendar-derived fields.
 const {carimbo,...source}=campos;
 const contexto=createHash('sha256').update(JSON.stringify({id:pub.id,...source})).digest('hex');
 return{campos,contexto,geradaEm,versaoModelo:'aviso10' as const,limite:LIMITE_AVISO};
}
export function confirmarAviso(previa:Awaited<ReturnType<typeof prepararAviso>>,input:z.infer<typeof envioAvisoSchema>,agora=Date.now()){
 const age=agora-Date.parse(input.geradaEm);
 if(age< -60000||age>30*60000||previa.contexto!==input.contexto)throw Error('A publicação, o prazo ou a curadoria mudou, ou a prévia expirou. Atualize a prévia e confira novamente.');
 const aviso=comporAviso({...previa.campos,texto:input.texto,acao:input.acao,curadoria:input.curadoria});
 if(aviso.texto.length>LIMITE_AVISO)throw Error(`O aviso excede ${LIMITE_AVISO} caracteres. Reduza o texto ou a curadoria e confira a prévia.`);
 return aviso;
}
