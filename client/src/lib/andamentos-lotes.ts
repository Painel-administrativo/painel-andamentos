import {aplicarLoteAndamentos,TAMANHO_LOTE_ANDAMENTOS,type PlanoAndamentos} from '@shared/andamentos-lotes';
export async function executarLotesAndamentos(plano:PlanoAndamentos,op:{consultar:(ids:number[])=>Promise<unknown>;salvar:(p:PlanoAndamentos)=>void;progresso:(p:PlanoAndamentos)=>void;parar:()=>boolean;esperar?:()=>Promise<void>}){
 let p=plano;op.salvar(p);op.progresso(p);
 while(p.cursor<p.ids.length&&!op.parar()){
  const resposta=await op.consultar(p.ids.slice(p.cursor,p.cursor+TAMANHO_LOTE_ANDAMENTOS));
  const novo=aplicarLoteAndamentos(p,resposta);
  // Only acknowledge a complete, validated response; persistence precedes advancement.
  op.salvar(novo);p=novo;op.progresso(p);
  if(p.cursor<p.ids.length&&!op.parar())await op.esperar?.();
 }
 return p;
}
