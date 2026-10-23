import { z } from "zod";
import { calcularDatasPrazo, calcularFimPrazo } from "./prazos";
export function dataValida(s: string) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s; }
export const regraSchema = z.object({
  ato: z.string().trim().min(3).max(160).transform(s=>s.toUpperCase()),
  motivo: z.string().trim().min(5).max(1500),
  inicio: z.string().refine(dataValida), fim: z.string().refine(dataValida),
  alcance: z.enum(["tribunal","origem"]), origem: z.string().regex(/^\d{4}$/).nullable(),
  local: z.string().trim().min(3).max(150),
  efeito: z.enum(["dia_nao_util","suspensao_prazo","informativo"]),
}).strict().superRefine((v,ctx)=>{
  if(v.fim<v.inicio || Date.parse(v.fim)-Date.parse(v.inicio)>366*86400000) ctx.addIssue({code:"custom",message:"Intervalo inválido ou superior a 367 dias."});
  if((v.alcance==="origem") !== (v.origem!==null)) ctx.addIssue({code:"custom",message:"Informe o código CNJ de origem para alcance local."});
});
export type RegraCalendario = z.infer<typeof regraSchema> & {id?:string; fonte?:string};
export function tribunalDaPublicacao(numero:string,sigla?:string|null) {
  if(sigla?.trim()) return sigla.trim().toUpperCase();
  const n=numero.replace(/\D/g,"");return n.length===20 && n.slice(13,16)==="819" ? "TJRJ":null;
}
export function regrasAplicaveis(regras:RegraCalendario[],numero:string,sigla?:string|null) {
  const n=numero.replace(/\D/g,"");
  if(tribunalDaPublicacao(numero,sigla)!=="TJRJ") return [];
  return regras.filter(r=>r.alcance==="tribunal" || (n.length===20 && n.slice(-4)===r.origem));
}
export function montarCalendario(base:Set<string>,regras:RegraCalendario[],numero:string,sigla?:string|null) {
  const feriados=new Set(base),suspensoes=new Set<string>();
  const aplicaveis=regrasAplicaveis(regras,numero,sigla);
  for(const r of aplicaveis) {
    if(r.efeito==="informativo") continue;
    for(let d=new Date(r.inicio+"T00:00:00Z");d.toISOString().slice(0,10)<=r.fim;d.setUTCDate(d.getUTCDate()+1)) {
      (r.efeito==="dia_nao_util"?feriados:suspensoes).add(d.toISOString().slice(0,10));
    }
  }
  return {feriados,suspensoes,aplicaveis};
}
export function resumoPrazo(pub:{numero:string;sigla?:string|null;disponibilizacao:string;dias:number;tipo:"uteis"|"corridos"},base:Set<string>,regras:RegraCalendario[]) {
  const c=montarCalendario(base,regras,pub.numero,pub.sigla);
  const datas=calcularDatasPrazo(pub.disponibilizacao,c.feriados,c.suspensoes);
  if(!datas) return null;
  const fim=calcularFimPrazo(datas.inicio,pub.dias,pub.tipo,c.feriados,c.suspensoes);
  return {publicacao:datas.publicacao.toISOString().slice(0,10),inicio:datas.inicio.toISOString().slice(0,10),fim:fim?.toISOString().slice(0,10)??null};
}
