import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Log = {
  id: string; iniciado_em: string; finalizado_em: string | null;
  status: "em_andamento" | "sem_erros" | "parcial" | "falha";
  processos: number; novidades: number; erros: number; rate_limits: number;
  respostas_invalidas: number; lote_offset: number;
  falhas: Array<{ processoId?: number; codigo: string }>;
};
const labels = { em_andamento: "Sem término registrado", sem_erros: "Sem erros registrados", parcial: "Parcial", falha: "Falha" };
export function HistoricoDjen() {
  const query = useQuery<Log[]>({ queryKey: ["/api/monitoramento/logs"], staleTime: 30000, refetchInterval: 60000 });
  return <section className="mb-6 rounded-xl border bg-card p-5" aria-label="Histórico de atualizações">
    <div className="flex items-start justify-between gap-4">
      <div><h2 className="font-semibold">Histórico de atualizações</h2>
        <p className="text-sm text-muted-foreground">Lotes dos últimos 7 dias (até 200 registros). Falhas indicam consultas inconclusivas. Ausência de erros não comprova cobertura integral do DJEN.</p></div>
      <Button variant="outline" size="icon" aria-label="Atualizar histórico" disabled={query.isFetching} onClick={() => query.refetch()}>
        <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
      </Button>
    </div>
    {query.isPending ? <p className="mt-4 text-sm" role="status">Carregando histórico…</p>
      : query.isError ? <p className="mt-4 text-sm text-destructive" role="alert">{query.error.message}</p>
      : !query.data?.length ? <p className="mt-4 text-sm text-muted-foreground">Nenhuma execução registrada nos últimos 7 dias. O histórico começa após a implantação.</p>
      : <div className="mt-4 overflow-x-auto"><table className="w-full text-sm text-left">
        <thead className="text-xs uppercase text-muted-foreground"><tr>{["Quando (Brasília)", "Lote", "Processos", "Novidades", "HTTP 429", "Erros", "Resultado"].map(t => <th key={t} className="border-b p-2 font-medium">{t}</th>)}</tr></thead>
        <tbody>{query.data.map(log => <tr key={log.id}>
          <td className="border-b p-2 whitespace-nowrap">{new Date(log.iniciado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}</td>
          <td className="border-b p-2">{log.lote_offset}</td><td className="border-b p-2">{log.processos}</td>
          <td className="border-b p-2 text-emerald-600">{log.novidades}</td>
          <td className="border-b p-2">{log.rate_limits}</td>
          <td className="border-b p-2"><span className={log.erros ? "text-destructive" : ""}>{log.erros}</span>
            {log.falhas.length > 0 && <details><summary className="cursor-pointer text-xs">Detalhes</summary><ul className="min-w-48">{log.falhas.map((f, i) => <li key={i}>{f.processoId ? `Processo ID ${f.processoId}: ` : ""}{f.codigo}</li>)}</ul></details>}
          </td><td className={`border-b p-2 ${log.status !== "sem_erros" ? "text-destructive" : "text-muted-foreground"}`}>{labels[log.status]}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}
