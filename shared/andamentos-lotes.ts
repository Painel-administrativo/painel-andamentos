import {z} from 'zod';
export const TAMANHO_LOTE_ANDAMENTOS=3;
export const modoAndamentos=z.enum(['todos','pendentes','2ograu','falhas']);
export const resultadoAndamento=z.object({id:z.number().int().positive().safe(),status:z.enum(['ok','nao_encontrado','erro','2o_grau','removido']),erro:z.string().nullable().optional()});
export type ResultadoAndamento=z.infer<typeof resultadoAndamento>;
const idsSchema=z.array(z.number().int().positive().safe()).min(1).max(10000).refine(v=>new Set(v).size===v.length);
export const planoAndamentosSchema=z.object({versao:z.literal(1),id:z.string().uuid(),modo:modoAndamentos,ids:idsSchema,cursor:z.number().int().nonnegative(),ok:z.number().int().nonnegative(),naoEncontrado:z.number().int().nonnegative(),erro:z.number().int().nonnegative(),segundoGrau:z.number().int().nonnegative(),removidos:z.number().int().nonnegative(),falhas:z.array(z.number().int().positive().safe()),iniciadaEm:z.string().datetime(),atualizadaEm:z.string().datetime()}).strict().refine(p=>p.cursor<=p.ids.length&&p.ok+p.naoEncontrado+p.erro+p.segundoGrau+p.removidos===p.cursor&&p.falhas.length===p.erro&&new Set(p.falhas).size===p.falhas.length&&p.falhas.every(id=>p.ids.slice(0,p.cursor).includes(id)));
export type PlanoAndamentos=z.infer<typeof planoAndamentosSchema>;
export function novoPlanoAndamentos(ids:number[],modo:PlanoAndamentos['modo'],id:string,agora=new Date().toISOString()):PlanoAndamentos{
 return planoAndamentosSchema.parse({versao:1,id,modo,ids:Array.from(new Set(ids)),cursor:0,ok:0,naoEncontrado:0,erro:0,segundoGrau:0,removidos:0,falhas:[],iniciadaEm:agora,atualizadaEm:agora});
}
export function aplicarLoteAndamentos(plano:PlanoAndamentos,resposta:unknown,agora=new Date().toISOString()):PlanoAndamentos{
 const r=z.object({resultados:z.array(resultadoAndamento).max(TAMANHO_LOTE_ANDAMENTOS)}).parse(resposta);
 const esperados=plano.ids.slice(plano.cursor,plano.cursor+TAMANHO_LOTE_ANDAMENTOS);
 if(r.resultados.length!==esperados.length||new Set(r.resultados.map(x=>x.id)).size!==esperados.length||r.resultados.some(x=>!esperados.includes(x.id)))throw Error('Resposta do lote incompleta ou com processos diferentes. Atualize o painel antes de retomar.');
 const p={...plano,falhas:[...plano.falhas],cursor:plano.cursor+esperados.length,atualizadaEm:agora};
 for(const x of r.resultados){if(x.status==='ok')p.ok++;else if(x.status==='nao_encontrado')p.naoEncontrado++;else if(x.status==='2o_grau')p.segundoGrau++;else if(x.status==='removido')p.removidos++;else{p.erro++;p.falhas.push(x.id);}}
 return planoAndamentosSchema.parse(p);
}
