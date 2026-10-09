import { useRef, useState, useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Log = {
  rodada_id?: string | null;
  id: string; iniciado_em: string; finalizado_em: string | null;
  status: "em_andamento" | "sem_erros" | "parcial" | "falha";
  processos: number; novidades: number; erros: number; rate_limits: number;
  respostas_invalidas: number; lote_offset: number;
  falhas: Array<{ processoId?: number; codigo: string }>;
};
const labels = { em_andamento: "Sem término registrado", sem_erros: "Sem erros registrados", parcial: "Parcial", falha: "Falha" };
export function HistoricoDjen() {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const stop = useRef(false);
  useEffect(() => () => { stop.current = true; }, []);
  async function atualizarDjen() {
    if (busy.current) return;
    busy.current = true; stop.current = false; setRunning(true);
    const rodada = crypto.randomUUID();
    let offset = 0, processos = 0, novidades = 0, erros = 0;
    try {
      while (!stop.current) {
        setMessage(`Consultando DJEN: ${processos} processos consultados, ${novidades} novidades, ${erros} falhas.`);
        // Lotes pequenos respeitam o limite de execução do backend.
        const response = await apiRequest("POST", `/api/publicacoes/atualizar?limite=5&offset=${offset}&dias=3&rodada=${rodada}`);
        const data = await response.json();
        if (![data.processados, data.novasPublicacoes, data.erros, data.proximoOffset].every(n => Number.isSafeInteger(n) && n >= 0) ||
            typeof data.concluido !== "boolean" || (!data.concluido && data.proximoOffset <= offset)) {
          throw new Error("Resposta inconclusiva do servidor; a consulta foi interrompida.");
        }
        processos += data.processados; novidades += data.novasPublicacoes; erros += data.erros;
        await queryClient.invalidateQueries({ queryKey: ["/api/monitoramento/logs"] });
        await queryClient.invalidateQueries({ queryKey: ["/api/publicacoes"] });
        await queryClient.invalidateQueries({ queryKey: ["/api/publicacoes/nao-lidas-count"] });
        offset = data.proximoOffset;
        if (data.concluido) {
          setMessage(`${erros ? "Consulta parcial" : "Consulta encerrada sem erros registrados"}: ${processos} processos, ${novidades} novidades e ${erros} falhas. Confira os detalhes no histórico.`);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
      setMessage(`Consulta interrompida: ${processos} processos consultados, ${novidades} novidades e ${erros} falhas. Os lotes concluídos foram preservados.`);
    } catch (error) {
      setMessage(`Consulta inconclusiva após ${processos} processos: ${error instanceof Error ? error.message : "Falha de conexão"}. Confira o histórico antes de repetir.`);
    } finally { busy.current = false; setRunning(false); }
  }
  const query = useQuery<Log[]>({ queryKey: ["/api/monitoramento/logs"], staleTime: 30000, refetchInterval: 60000 });
  const grupos = new Map<string, Log[]>();
  for (const log of query.data || []) {
    const key = log.rodada_id || `lote-${log.id}`;
    grupos.set(key, [...(grupos.get(key) || []), log]);
  }
  const linhas = Array.from(grupos.entries()).map(([id, lotes]) => {
    const oldest = lotes[lotes.length - 1];
    return { ...oldest, id, lotes,
      processos: lotes.reduce((n,l) => n+l.processos,0),
      novidades: lotes.reduce((n,l) => n+l.novidades,0),
      erros: lotes.reduce((n,l) => n+l.erros,0),
      rate_limits: lotes.reduce((n,l) => n+l.rate_limits,0),
      status: lotes.some(l => l.status === "em_andamento") ? "em_andamento" :
        lotes.some(l => l.erros > 0 || l.status === "falha") ? "parcial" : "sem_erros",
      falhas: lotes.flatMap(l => l.falhas),
    };
  });
  return <section className="mb-6 rounded-xl border bg-card p-5" aria-label="Histórico de atualizações">
    <div className="flex items-start justify-between gap-4">
      <div><h2 className="font-semibold">Histórico de atualizações</h2>
        <p className="text-sm text-muted-foreground">Uma linha por atualização manual. Histórico de até 200 lotes dos últimos 7 dias; registros antigos e automações sem identificação aparecem por lote. Falhas indicam consultas inconclusivas. Ausência de erros não comprova cobertura integral do DJEN.</p></div>
      <Button variant="outline" size="icon" aria-label="Atualizar histórico" disabled={query.isFetching} onClick={() => query.refetch()}>
        <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
      </Button>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button onClick={atualizarDjen} disabled={running} data-testid="button-atualizar-djen">
        <RefreshCw className={`mr-2 h-4 w-4 ${running ? "animate-spin" : ""}`} />
        {running ? "Consultando DJEN…" : "Atualizar DJEN manualmente"}
      </Button>
      {running && <Button variant="outline" onClick={() => { stop.current = true; setMessage("Interrompendo após o lote em andamento…"); }}>Interromper</Button>}
      <p className="text-sm text-muted-foreground">Consulta os processos cadastrados na janela de 3 dias. Mantenha esta página aberta.</p>
    </div>
    {message && <p className="mt-3 text-sm" role="status" aria-live="polite">{message}</p>}
    {query.isPending ? <p className="mt-4 text-sm" role="status">Carregando histórico…</p>
      : query.isError ? <p className="mt-4 text-sm text-destructive" role="alert">{query.error.message}</p>
      : !query.data?.length ? <p className="mt-4 text-sm text-muted-foreground">Nenhuma execução registrada nos últimos 7 dias. O histórico começa após a implantação.</p>
      : <div className="mt-4 overflow-x-auto"><table className="w-full text-sm text-left">
        <thead className="text-xs uppercase text-muted-foreground"><tr>{["Quando (Brasília)", "Detalhes", "Processos", "Novidades", "HTTP 429", "Erros", "Resultado"].map(t => <th key={t} className="border-b p-2 font-medium">{t}</th>)}</tr></thead>
        <tbody>{linhas.map(log => <tr key={log.id}>
          <td className="border-b p-2 whitespace-nowrap">{new Date(log.iniciado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}</td>
          <td className="border-b p-2"><details><summary className="cursor-pointer">{log.lotes.length} lote(s)</summary>
            <ul className="min-w-48">{log.lotes.map(l => <li key={l.id}>Lote {l.lote_offset}: {l.processos} processos, {l.novidades} novidades, {l.erros} erros</li>)}</ul>
            <p className="text-xs text-muted-foreground">Totais dos lotes disponíveis neste histórico.</p>
          </details></td><td className="border-b p-2">{log.processos}</td>
          <td className="border-b p-2 text-emerald-600">{log.novidades}</td>
          <td className="border-b p-2">{log.rate_limits}</td>
          <td className="border-b p-2"><span className={log.erros ? "text-destructive" : ""}>{log.erros}</span>
            {log.falhas.length > 0 && <details><summary className="cursor-pointer text-xs">Detalhes</summary><ul className="min-w-48">{log.falhas.map((f, i) => <li key={i}>{f.processoId ? `Processo ID ${f.processoId}: ` : ""}{f.codigo}</li>)}</ul></details>}
          </td><td className={`border-b p-2 ${log.status !== "sem_erros" ? "text-destructive" : "text-muted-foreground"}`}>{labels[log.status as keyof typeof labels]}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}
