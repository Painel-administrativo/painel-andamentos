import {dataPrazoManual} from "@shared/prazo-manual";
import {formatarBR} from "@shared/prazos";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Send, Loader2 } from "lucide-react";
import type { PublicacaoComProcesso } from "@shared/schema";

type Envio = { id: string; nome: string; telefone: string; status: string; erro_codigo: string | null; criado_em: string };
const labels: Record<string, string> = { reservada: "Em processamento — não repita", aceita: "Aceita pela Meta; aguardando entrega",
  enviada: "Enviada; aguardando entrega", entregue: "Entregue", lida: "Lida", falha: "Falha no envio", incerto: "Resultado inconclusivo — não repita" };
const linha = (v: string) => v.replace(/[\r\n\t]+/g, " ").trim();
export function EnviarWhatsApp({ pub, anotacao }: { pub: PublicacaoComProcesso; anotacao: string }) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [resumo, setResumo] = useState("");
  const [curadoria, setCuradoria] = useState("");
  const [consentimento, setConsentimento] = useState(false);
  const config = useQuery<{ configurado: boolean }>({ queryKey: ["/api/whatsapp/config"], enabled: aberto, staleTime: 0 });
  const key = [`/api/publicacoes/${pub.id}/whatsapp`];
  const historico = useQuery<Envio[]>({ queryKey: key, enabled: aberto, staleTime: 0, refetchInterval: aberto ? 5000 : false });
  const enviar = useMutation({
    mutationFn: async () => (await apiRequest("POST", key[0], { nome, telefone, resumo, curadoria, consentimento })).json(),
    onSettled: () => { queryClient.invalidateQueries({ queryKey: key }); },
  });
  const digits = telefone.replace(/[\s()+.-]/g, "");
  const texto = `Atualização do processo ${pub.processoNumero}.\nPublicação: ${resumo}\nCuradoria: ${curadoria}`;
  const existente = historico.data?.some(v => v.telefone === digits);
  const valido = nome.trim().length >= 2 && /^[1-9]\d{7,14}$/.test(digits) && resumo.trim() && curadoria.trim() &&
    resumo.length <= 500 && curadoria.length <= 350 && texto.length <= 1024 && consentimento && !existente;
  function abrir() {
    const manual = dataPrazoManual(pub.prazoManual);
    setResumo(linha(`${pub.tipoDocumento || "Publicação"} disponibilizada em ${pub.dataDisponibilizacao}.${manual ? ` Prazo ajustado manualmente: ${formatarBR(manual)}.` : ""}`));
    setCuradoria(linha(anotacao)); setConsentimento(false); enviar.reset(); setAberto(true);
  }
  return <>
    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={e => { e.stopPropagation(); abrir(); }}>
      <Send className="h-3 w-3 mr-1.5" /> Enviar WhatsApp
    </Button>
    <Dialog open={aberto} onOpenChange={v => { if (!enviar.isPending) setAberto(v); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <DialogHeader><DialogTitle>Enviar aviso pelo WhatsApp</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground break-words">{pub.processoApelido} · {pub.processoNumero}</p>
        {config.isLoading ? <p>Verificando integração…</p> : config.isError ? <p role="alert">Não foi possível verificar a integração.</p> : !config.data?.configurado &&
          <p className="text-sm text-amber-700" role="status">A integração Meta ainda precisa ser configurada no servidor. Você já pode preparar e revisar o aviso.</p>}
        <div className="space-y-3">
          <label className="block text-sm">Nome do destinatário<Input value={nome} maxLength={100} onChange={e => setNome(e.target.value)} placeholder="Advogado ou assinante" /></label>
          <label className="block text-sm">WhatsApp com país e DDD<Input type="tel" value={telefone} onChange={e => setTelefone(e.target.value)} placeholder="55 21 99999-9999" /></label>
          <label className="block text-sm">Resumo da publicação ({resumo.length}/500)<Input value={resumo} onChange={e => setResumo(linha(e.target.value))} /></label>
          <label className="block text-sm">Curadoria — ação recomendada ({curadoria.length}/350)
            <textarea className="w-full rounded-md border bg-background p-2 mt-1" rows={3} value={curadoria} onChange={e => setCuradoria(e.target.value.replace(/[\r\n\t]/g, " "))} />
          </label>
          <div className="rounded-md border bg-muted/30 p-3"><p className="text-xs font-medium mb-2">Prévia do modelo</p><p className="whitespace-pre-wrap break-words text-sm">{texto}</p></div>
          {texto.length > 1024 && <p role="alert" className="text-sm text-destructive">Reduza o texto para até 1.024 caracteres.</p>}
          <label className="flex gap-2 text-sm items-start"><input type="checkbox" checked={consentimento} onChange={e => setConsentimento(e.target.checked)} className="mt-1" />
            Conferi que este número pertence ao destinatário indicado e que ele autorizou o recebimento dos avisos.</label>
          {existente && <p role="status" className="text-sm">Já existe uma tentativa para este número. Confira o resultado abaixo.</p>}
          {enviar.isError && <p role="alert" className="text-sm text-destructive">{enviar.error.message}</p>}
          {enviar.isSuccess && <p role="status" className="text-sm">{labels[enviar.data.status] || "Tentativa registrada"}. Confira o histórico.</p>}
          <Button disabled={!valido || !config.data?.configurado || !historico.isSuccess || enviar.isPending || enviar.isSuccess} onClick={() => enviar.mutate()}>
            {enviar.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />} Confirmar envio para {digits || "o destinatário"}
          </Button>
        </div>
        <div className="border-t pt-3 space-y-2"><p className="text-sm font-medium">Histórico desta publicação</p>
          {historico.isLoading && <p className="text-sm">Carregando…</p>}
          {historico.isError && <p className="text-sm" role="alert">Histórico indisponível. O envio fica bloqueado até ser possível consultá-lo.</p>}
          {historico.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum envio registrado.</p>}
          {historico.data?.map(v => <div key={v.id} className="text-sm border rounded p-2 break-words"><p>{v.nome} · +{v.telefone}</p>
            <p>{labels[v.status] || v.status}{v.erro_codigo ? ` · Código ${v.erro_codigo}` : ""}</p><p className="text-xs text-muted-foreground">{new Date(v.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div>)}
          <p className="text-xs text-muted-foreground">“Informada” é marcada automaticamente quando a Meta confirma entrega ou leitura. Resultados inconclusivos exigem conferência antes de qualquer novo envio.</p>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
