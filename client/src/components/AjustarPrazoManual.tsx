import {useState} from 'react';
import {useMutation,useQuery} from '@tanstack/react-query';
import {apiRequest,queryClient} from '@/lib/queryClient';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogTrigger} from '@/components/ui/dialog';
import type {PublicacaoComProcesso} from '@shared/schema';
import {dataValida} from '@shared/calendario';
import {dataPrazoManual} from '@shared/prazo-manual';
import {formatarBR} from '@shared/prazos';
type Revisao={id:string;versao:number;anterior:string|null;nova:string|null;justificativa:string;autor:string;criado_em:string;ja_informada:boolean;calculo_automatico:{fim?:string|null}};
const br=(v?:string|null)=>{const d=dataPrazoManual(v);return d?formatarBR(d):'Cálculo automático';};
export function AjustarPrazoManual({pub,automatico}:{pub:PublicacaoComProcesso;automatico:Date|null}){
 const [aberto,setAberto]=useState(false),[data,setData]=useState(''),[motivo,setMotivo]=useState(''),[ciente,setCiente]=useState(false);
 const historico=useQuery<{items:Revisao[]}>({queryKey:[`/api/publicacoes/${pub.id}/prazo-manual/historico`],enabled:aberto});
 const salvar=useMutation({mutationFn:async(restaurar:boolean)=>{
  const r=await apiRequest('PATCH',`/api/publicacoes/${pub.id}/prazo-manual`,{data:restaurar?null:data,justificativa:motivo,versao:pub.prazoManualVersao??0,retificacaoReconhecida:ciente});return r.json();
 },onSuccess:async()=>{await Promise.all([queryClient.invalidateQueries({queryKey:['/api/publicacoes']}),queryClient.invalidateQueries({queryKey:[`/api/publicacoes/${pub.id}/prazo-manual/historico`]})]);setAberto(false);}});
 const valido=motivo.trim().length>=10&&motivo.trim().length<=1500&&(!pub.informadoEm||ciente)&&!salvar.isPending;
 return <Dialog open={aberto} onOpenChange={v=>{if(salvar.isPending)return;setAberto(v);if(v){setData(pub.prazoManual??automatico?.toISOString().slice(0,10)??'');setMotivo('');setCiente(false);salvar.reset();}}}>
  <DialogTrigger asChild><Button type="button" variant="outline" size="sm" onClick={e=>e.stopPropagation()}>Ajustar prazo manualmente</Button></DialogTrigger>
  <DialogContent className="max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
   <DialogHeader><DialogTitle>Ajustar prazo manualmente</DialogTitle><DialogDescription>A data informada prevalece sobre o cálculo automático até você restaurá-lo. Alterações do calendário e da quantidade de dias não removem o ajuste.</DialogDescription></DialogHeader>
   <p className="text-sm">{pub.processoApelido||pub.processoNumero}<br/>Cálculo automático atual: <strong>{automatico?formatarBR(automatico):'indisponível'}</strong><br/>Data manual atual: <strong>{pub.prazoManual?br(pub.prazoManual):'nenhuma'}</strong></p>
   <label className="text-sm space-y-1">Nova data final<input type="date" aria-label="Nova data final" className="block w-full border rounded p-2 bg-background" value={data} onChange={e=>setData(e.target.value)} disabled={salvar.isPending}/></label>
   {dataValida(data)&&[0,6].includes(new Date(`${data}T00:00:00Z`).getUTCDay())&&<p className="text-sm text-amber-700">A data escolhida cai em fim de semana. Confira a exceção antes de salvar.</p>}
   <label className="text-sm space-y-1">Justificativa obrigatória<textarea aria-label="Justificativa do ajuste" className="block w-full border rounded p-2 bg-background" rows={3} maxLength={1500} placeholder="Explique o fundamento do ajuste (mínimo de 10 caracteres)." value={motivo} onChange={e=>setMotivo(e.target.value)} disabled={salvar.isPending}/></label>
   {pub.informadoEm&&<label className="flex gap-2 text-sm"><input type="checkbox" checked={ciente} onChange={e=>setCiente(e.target.checked)} disabled={salvar.isPending}/>Esta publicação já foi informada. Estou ciente de que devo comunicar a retificação; salvar não envia mensagem.</label>}
   {salvar.isError&&<p role="alert" className="text-sm text-destructive">{salvar.error.message}</p>}
   <div className="flex flex-wrap gap-2"><Button disabled={!valido||!dataValida(data)||data===pub.prazoManual} onClick={()=>salvar.mutate(false)}>{salvar.isPending?'Salvando…':'Salvar data manual'}</Button>{pub.prazoManual&&<Button variant="outline" disabled={!valido} onClick={()=>salvar.mutate(true)}>Voltar ao cálculo automático</Button>}</div>
   <details className="text-sm border-t pt-3"><summary>Histórico de ajustes (últimos 100)</summary>{historico.isLoading?<p>Carregando…</p>:historico.isError?<p>Não foi possível carregar o histórico. <button className="underline" onClick={()=>historico.refetch()}>Tentar novamente</button></p>:!historico.data?.items.length?<p>Nenhum ajuste registrado.</p>:historico.data.items.map(r=><div key={r.id} className="border-b py-2 space-y-1"><p>{new Date(r.criado_em).toLocaleString('pt-BR')} · revisão {r.versao} · {r.autor}</p><p>{br(r.anterior)} → {br(r.nova)}</p>{r.calculo_automatico?.fim&&<p>Automático na revisão: {br(r.calculo_automatico.fim)}</p>}<p className="whitespace-pre-wrap break-words">{r.justificativa}</p>{r.ja_informada&&<p>Publicação já informada nesta revisão.</p>}</div>)}</details>
  </DialogContent>
 </Dialog>;
}
