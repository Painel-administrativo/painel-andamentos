import {comporAviso,LIMITE_AVISO,type CamposAviso} from "@shared/whatsapp-aviso";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Send, Loader2 } from "lucide-react";
import type { PublicacaoComProcesso } from "@shared/schema";

type Envio = { provedor?: "meta" | "twilio"; id: string; nome: string; telefone: string; status: string; erro_codigo: string | null; criado_em: string };
const labels: Record<string, string> = { reservada: "Em processamento — não repita", aceita: "Aceita pelo provedor; aguardando entrega",
  enviada: "Enviada; aguardando entrega", entregue: "Entregue", lida: "Lida", falha: "Falha no envio", incerto: "Resultado inconclusivo — não repita" };
const linha = (v: string) => v.replace(/\s+/g, " ");
export function EnviarWhatsApp({ pub, anotacao }: { pub: PublicacaoComProcesso; anotacao: string }) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [previa,setPrevia]=useState<{campos:CamposAviso;contexto:string;geradaEm:string;versaoModelo:"aviso10"}|null>(null);
  const [textoPublicacao,setTextoPublicacao]=useState("");
  const [acao,setAcao]=useState("");
  const [conferido,setConferido]=useState(false);
  const [curadoria, setCuradoria] = useState("");
  const [consentimento, setConsentimento] = useState(false);
  const config = useQuery<{ configurado: boolean; provedor: string; pendencias: string[] }>({ queryKey: ["/api/whatsapp/config"], enabled: aberto, staleTime: 0 });
  const key = [`/api/publicacoes/${pub.id}/whatsapp`];
  const historico = useQuery<Envio[]>({ queryKey: key, enabled: aberto, staleTime: 0, refetchInterval: aberto ? 5000 : false });
  const enviar = useMutation({
    mutationFn: async () => (await apiRequest("POST", key[0], { nome, telefone, texto:textoPublicacao, acao, curadoria, consentimento, conferido, contexto:previa?.contexto, geradaEm:previa?.geradaEm, versaoModelo:"aviso10" })).json(),
    onSettled: () => { queryClient.invalidateQueries({ queryKey: key }); },
  });
  const preparar=useMutation({mutationFn:async()=>(await apiRequest("GET",`/api/publicacoes/${pub.id}/whatsapp/previa`)).json(),onSuccess:(p)=>{setPrevia(p);setTextoPublicacao(p.campos.texto);setAcao(p.campos.acao);setCuradoria(p.campos.curadoria);setConferido(false);enviar.reset();}});
  const digits = telefone.replace(/[\s()+.-]/g, "");
  const texto = previa ? comporAviso({...previa.campos,texto:textoPublicacao,acao,curadoria}).texto : "";
  const existente = historico.data?.some(v => v.telefone === digits);
  const valido = previa && nome.trim().length >= 2 && /^[1-9]\d{7,14}$/.test(digits) && textoPublicacao.trim() && acao.trim() && curadoria.trim() &&
    textoPublicacao.length<=4000 && acao.length<=350 && curadoria.length<=1000 && texto.length<=LIMITE_AVISO && consentimento && conferido && !existente;
  function abrir() {
    setPrevia(null);setConferido(false);setConsentimento(false);enviar.reset();setAberto(true);preparar.mutate();
  }
  return <>
    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={e => { e.stopPropagation(); abrir(); }}>
      <Send className="h-3 w-3 mr-1.5" /> Enviar WhatsApp
    </Button>
    <Dialog open={aberto} onOpenChange={v => { if (!enviar.isPending) setAberto(v); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <DialogHeader><DialogTitle>Enviar aviso pelo WhatsApp · Twilio</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground break-words">{pub.processoApelido} · {pub.processoNumero}</p>
        {config.isLoading ? <p>Verificando integração…</p> : config.isError ? <p role="alert">Não foi possível verificar a integração.</p> : !config.data?.configurado &&
          <p className="text-sm text-amber-700" role="status">A integração Twilio ainda precisa ser configurada no servidor. Você já pode preparar e revisar o aviso.</p>}
        <div className="space-y-3">
          <label className="block text-sm">Nome do destinatário<Input value={nome} maxLength={100} onChange={e => {setNome(e.target.value);setConsentimento(false);}} placeholder="Advogado ou assinante" /></label>
          <label className="block text-sm">WhatsApp com país e DDD<Input type="tel" value={telefone} onChange={e => {setTelefone(e.target.value);setConsentimento(false);}} placeholder="55 21 99999-9999" /></label>
          {preparar.isPending && <p role="status">Preparando publicação, datas e prazo…</p>}
          {preparar.isError && <p role="alert" className="text-destructive">{preparar.error.message}</p>}
          <Button variant="outline" size="sm" disabled={preparar.isPending||enviar.isPending} onClick={()=>{setPrevia(null);setConferido(false);preparar.mutate();}}>Atualizar prévia e dados da publicação</Button>
          {previa && <>
          <label className="block text-sm">Texto da publicação para o aviso
            <textarea className="w-full rounded-md border bg-background p-2 mt-1" rows={5} value={textoPublicacao} maxLength={4000} onChange={e=>{setTextoPublicacao(linha(e.target.value));setConferido(false);}} />
          </label>
          <label className="block text-sm">Ação necessária<Input value={acao} maxLength={350} onChange={e=>{setAcao(linha(e.target.value));setConferido(false);}} /></label>
          <label className="block text-sm">Curadoria para acompanhamento
            <textarea className="w-full rounded-md border bg-background p-2 mt-1" rows={3} value={curadoria} maxLength={1000} onChange={e=>{setCuradoria(linha(e.target.value));setConferido(false);}} />
          </label>
          <div className="rounded-md border bg-muted/30 p-3"><p className="text-xs font-medium mb-2">Prévia do modelo · {texto.length}/{LIMITE_AVISO} caracteres</p><p className="whitespace-pre-wrap break-words text-sm">{texto}</p></div>
          {texto.length>LIMITE_AVISO&&<p role="alert" className="text-sm text-destructive">O aviso excede {LIMITE_AVISO} caracteres. Reduza o texto ou a curadoria; o sistema não corta a mensagem automaticamente.</p>}
          <label className="flex gap-2 text-sm items-start"><input type="checkbox" checked={conferido} onChange={e=>setConferido(e.target.checked)}/>Conferi a mensagem completa, as datas e o prazo da prévia.</label>
          </>}
          <label className="flex gap-2 text-sm items-start"><input type="checkbox" checked={consentimento} onChange={e => setConsentimento(e.target.checked)} className="mt-1" />
            Conferi que este número pertence ao destinatário indicado e que ele autorizou o recebimento dos avisos.</label>
          {existente && <p role="status" className="text-sm">Já existe uma tentativa para este número. Confira o resultado abaixo.</p>}
          {enviar.isError && <p role="alert" className="text-sm text-destructive">{enviar.error.message}</p>}
          {enviar.isSuccess && <p role="status" className="text-sm">{labels[enviar.data.status] || "Tentativa registrada"}. Confira o histórico.</p>}
          <Button disabled={!valido || !config.data?.configurado || !historico.isSuccess || preparar.isPending || enviar.isPending || enviar.isSuccess} onClick={() => enviar.mutate()}>
            {enviar.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />} Confirmar envio para {digits || "o destinatário"}
          </Button>
        </div>
        <div className="border-t pt-3 space-y-2"><p className="text-sm font-medium">Histórico desta publicação</p>
          {historico.isLoading && <p className="text-sm">Carregando…</p>}
          {historico.isError && <p className="text-sm" role="alert">Histórico indisponível. O envio fica bloqueado até ser possível consultá-lo.</p>}
          {historico.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum envio registrado.</p>}
          {historico.data?.map(v => <div key={v.id} className="text-sm border rounded p-2 break-words"><p>{v.nome} · +{v.telefone} · {v.provedor === "twilio" ? "Twilio" : "Meta (histórico)"}</p>
            <p>{labels[v.status] || v.status}{v.erro_codigo ? ` · Código ${v.erro_codigo}` : ""}</p><p className="text-xs text-muted-foreground">{new Date(v.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div>)}
          <p className="text-xs text-muted-foreground">“Informada” é marcada automaticamente quando o provedor confirma entrega ou leitura. Resultados inconclusivos exigem conferência antes de qualquer novo envio.</p>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
