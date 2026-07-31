import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/lib/theme";
import { Logo } from "@/components/Logo";
import { ProcessoDialog } from "@/components/ProcessoDialog";
import { BulkAddDialog } from "@/components/BulkAddDialog";
import { Timeline } from "@/components/Timeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sun,
  Moon,
  RefreshCw,
  Plus,
  ClipboardPaste,
  Search,
  ChevronRight,
  ExternalLink,
  Pencil,
  Trash2,
  Inbox,
  Copy,
  Mail,
} from "lucide-react";
import {
  formatarCNJ,
  formatarData,
  tempoRelativo,
  urlPortal,
  ultimaMovimentacao,
} from "@/lib/cnj";
import type { ProcessoComSnapshot } from "@shared/schema";

const TRINTA_DIAS = 30 * 24 * 60 * 60 * 1000;

export default function Home() {
  const { toast } = useToast();
  const { theme, toggle } = useTheme();

  const [aba, setAba] = useState<"painel" | "processos">("painel");
  const [busca, setBusca] = useState("");
  const [filtroTribunal, setFiltroTribunal] = useState<"Todos" | "TJRJ" | "TRF2">("Todos");
  const [soRecentes, setSoRecentes] = useState(false);
  const [soNaoLidos, setSoNaoLidos] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editando, setEditando] = useState<ProcessoComSnapshot | null>(null);
  const [expandido, setExpandido] = useState<number | null>(null);
  const [confirmarDelete, setConfirmarDelete] = useState<ProcessoComSnapshot | null>(null);

  const [atualizando, setAtualizando] = useState(false);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<string | null>(null);
  const [atualizandoIds, setAtualizandoIds] = useState<Set<number>>(new Set());
  // Modo de atualização: 'todos' (padrão), 'pendentes' (erro/nao_encontrado/sem
  // snapshot) ou '2ograu' (só os marcados como acompanhamento manual).
  const [modoAtualizar, setModoAtualizar] = useState<"todos" | "pendentes" | "2ograu">("todos");
  const soPendentes = modoAtualizar === "pendentes";
  const so2oGrau = modoAtualizar === "2ograu";

  async function handleAtualizarEste(id: number, apelido: string) {
    setAtualizandoIds((prev) => new Set(prev).add(id));
    try {
      const resp = await apiRequest("POST", `/api/processos/${id}/atualizar`, {});
      const data = await resp.json();
      queryClient.invalidateQueries({ queryKey: ["/api/processos"] });
      const status = data?.resultado?.status;
      if (status === "ok") {
        toast({ title: "Atualizado", description: apelido });
      } else if (status === "2o_grau") {
        toast({
          title: "2º grau — acompanhamento manual",
          description: `${apelido} — sem cobertura no Datajud. Acompanhe pelo Portal de Serviços (botão "Abrir no portal").`,
        });
      } else if (status === "nao_encontrado") {
        toast({
          title: "Não encontrado no Datajud",
          description: `${apelido} — tentei 3 vezes. Verifique o número ou tente mais tarde.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Erro na consulta",
          description: data?.resultado?.erro || "Falha ao consultar",
          variant: "destructive",
        });
      }
    } catch (e: any) {
      toast({ title: "Falha ao atualizar", description: e?.message, variant: "destructive" });
    } finally {
      setAtualizandoIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const { data: processos = [], isLoading } = useQuery<ProcessoComSnapshot[]>({
    queryKey: ["/api/processos"],
  });

  // Conta processos pendentes (erro / não encontrado / sem snapshot)
  const totalPendentes = useMemo(
    () =>
      processos.filter((p) => {
        const s = p.snapshot?.status;
        return !s || s === "erro" || s === "nao_encontrado";
      }).length,
    [processos],
  );

  // Conta processos marcados como 2º grau (acompanhamento manual)
  const total2oGrau = useMemo(
    () => processos.filter((p) => p.snapshot?.status === "2o_grau").length,
    [processos],
  );

  async function handleAtualizar() {
    if (processos.length === 0) return;

    // Avisa se o modo escolhido não tem processos alvo
    if (soPendentes && totalPendentes === 0) {
      toast({
        title: "Nenhum processo pendente",
        description: "Todos os processos estão com status ok ou 2º grau.",
      });
      return;
    }
    if (so2oGrau && total2oGrau === 0) {
      toast({
        title: "Nenhum processo em 2º grau",
        description: "Não há processos marcados como acompanhamento manual.",
      });
      return;
    }

    let endpoint: string;
    let qtd: number;
    let tituloOk: string;
    if (soPendentes) {
      endpoint = "/api/processos/atualizar-pendentes";
      qtd = totalPendentes;
      tituloOk = "Pendentes atualizados";
    } else if (so2oGrau) {
      endpoint = "/api/processos/atualizar-2ograu";
      qtd = total2oGrau;
      tituloOk = "2º grau reverificado";
    } else {
      endpoint = "/api/processos/atualizar";
      qtd = processos.length;
      tituloOk = "Andamentos atualizados";
    }

    setAtualizando(true);
    setProgresso(`Consultando ${qtd} processo(s)...`);
    try {
      const resp = await apiRequest("POST", endpoint, {});
      const data = await resp.json();
      setUltimaAtualizacao(data.atualizadoEm);
      // Rebase do Set congelado assim que os dados novos chegarem
      rebaseNaoLidos();
      queryClient.invalidateQueries({ queryKey: ["/api/processos"] });
      const partes = [
        `${data.ok} ok`,
        data.segundoGrau ? `${data.segundoGrau} de 2º grau` : null,
        data.naoEncontrado ? `${data.naoEncontrado} não encontrado(s)` : null,
        data.erro ? `${data.erro} erro(s)` : null,
      ].filter(Boolean);
      toast({
        title: tituloOk,
        description: partes.join(" · "),
      });
    } catch (e: any) {
      toast({ title: "Falha ao atualizar", description: e?.message, variant: "destructive" });
    } finally {
      setAtualizando(false);
      setProgresso(null);
    }
  }

  async function handleDelete() {
    if (!confirmarDelete) return;
    try {
      await apiRequest("DELETE", `/api/processos/${confirmarDelete.id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/processos"] });
      toast({ title: "Processo removido" });
    } catch (e: any) {
      toast({ title: "Erro ao remover", description: e?.message, variant: "destructive" });
    } finally {
      setConfirmarDelete(null);
    }
  }

  // Função pura para calcular "não lido" a partir dos dados vivos
  function calcularNaoLido(p: ProcessoComSnapshot): boolean {
    const um = ultimaMovimentacao(p.dados);
    return !!um.data && (
      !p.vistoAte || new Date(um.data).getTime() > new Date(p.vistoAte).getTime()
    );
  }

  // Ordem congelada enquanto um card está expandido — evita que a linha
  // "pule" pra outra posição ao marcar como lido. A ordem é recalculada
  // quando o card fecha.
  const [ordemCongelada, setOrdemCongelada] = useState<Map<number, number> | null>(null);

  // Função pra rebasear manualmente (não usada mais, mas mantida por segurança)
  function rebaseNaoLidos() {
    setOrdemCongelada(null);
  }

  // Enriquecimento + ordenação + filtros
  const enriquecidos = useMemo(() => {
    const agora = Date.now();
    return processos
      .map((p) => {
        const um = ultimaMovimentacao(p.dados);
        const classe = p.dados?.classe?.nome ?? null;
        const orgao = p.dados?.orgaoJulgador?.nome ?? null;
        const recente = um.data ? agora - new Date(um.data).getTime() <= TRINTA_DIAS : false;
        const status = p.snapshot?.status ?? "pendente";
        // "Não lido" é sempre calculado dos dados vivos (etiqueta some assim que
        // o backend confirma). O que congela é só a **ordem** da lista.
        const naoLido = calcularNaoLido(p);
        return {
          ...p,
          _ultimaData: um.data,
          _ultimoNome: um.nome,
          _classe: classe,
          _orgao: orgao,
          _recente: recente,
          _naoLido: naoLido,
          _status: status,
        };
      })
      .sort((a, b) => {
        // Se há ordem congelada (card expandido), usa ela
        if (ordemCongelada) {
          const oa = ordemCongelada.get(a.id) ?? Number.MAX_SAFE_INTEGER;
          const ob = ordemCongelada.get(b.id) ?? Number.MAX_SAFE_INTEGER;
          if (oa !== ob) return oa - ob;
        }
        // Ordem natural: não lidos primeiro, depois por data desc
        if (a._naoLido !== b._naoLido) return a._naoLido ? -1 : 1;
        const ta = a._ultimaData ? new Date(a._ultimaData).getTime() : 0;
        const tb = b._ultimaData ? new Date(b._ultimaData).getTime() : 0;
        return tb - ta;
      });
  }, [processos, ordemCongelada]);

  // Total de não lidos (pra chip no filtro)
  const totalNaoLidos = useMemo(
    () => enriquecidos.filter((p) => p._naoLido).length,
    [enriquecidos],
  );

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return enriquecidos.filter((p) => {
      if (filtroTribunal !== "Todos" && p.tribunal !== filtroTribunal) return false;
      if (soRecentes && !p._recente) return false;
      if (soNaoLidos && !p._naoLido) return false;
      if (q) {
        const alvo = [
          p.apelido ?? "",
          p.numero,
          formatarCNJ(p.numero),
          p._classe ?? "",
          p._orgao ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!alvo.includes(q)) return false;
      }
      return true;
    });
  }, [enriquecidos, busca, filtroTribunal, soRecentes, soNaoLidos]);

  // Guard pra evitar PATCHes duplicados (React re-render, clique duplo)
  const marcandoLidoRef = useRef<Set<number>>(new Set());

  // Marca processo como lido no backend + invalida query pra etiqueta sumir.
  // A ordem é congelada externamente por handleToggle antes de chamar.
  async function marcarComoLido(id: number) {
    if (marcandoLidoRef.current.has(id)) return;
    marcandoLidoRef.current.add(id);
    try {
      await apiRequest("PATCH", `/api/processos/${id}/visto`, {});
      queryClient.invalidateQueries({ queryKey: ["/api/processos"] });
    } catch {
      // silencioso
    } finally {
      marcandoLidoRef.current.delete(id);
    }
  }

  // Marca processo como não lido (botão explícito no card expandido)
  async function marcarComoNaoLido(id: number) {
    try {
      await apiRequest("PATCH", `/api/processos/${id}/visto`, { vistoAte: null });
      queryClient.invalidateQueries({ queryKey: ["/api/processos"] });
      toast({ title: "Marcado como não lido" });
    } catch (e: any) {
      toast({ title: "Falha ao marcar", description: e?.message, variant: "destructive" });
    }
  }

  // Toggle expandir/recolher com congelamento de ordem.
  // Ao expandir: congela a ordem atual (snapshot dos IDs em posição)
  // Ao recolher: descongela (lista reordena naturalmente)
  function handleToggleExpandido(id: number) {
    if (expandido === id) {
      // Recolhendo: libera a ordem
      setExpandido(null);
      setOrdemCongelada(null);
    } else {
      // Expandindo: congela a ordem atual antes de tudo
      const ordem = new Map<number, number>();
      filtrados.forEach((p, idx) => ordem.set(p.id, idx));
      setOrdemCongelada(ordem);
      setExpandido(id);
    }
  }

  const semProcessos = !isLoading && processos.length === 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-primary">
            <Logo />
            <div className="leading-tight">
              <h1 className="text-sm font-semibold text-foreground">Painel de Andamentos</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Acompanhamento processual · TJRJ e TRF2
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label="Alternar tema"
              data-testid="button-tema"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-4 sm:px-6 py-6">
        {/* Barra de controle */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <Tabs value={aba} onValueChange={(v) => setAba(v as any)}>
            <TabsList>
              <TabsTrigger value="painel" data-testid="tab-painel">
                Painel de andamentos
              </TabsTrigger>
              <TabsTrigger value="processos" data-testid="tab-processos">
                Meus processos
                {processos.length > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">({processos.length})</span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkOpen(true)}
              data-testid="button-adicionar-lote"
            >
              <ClipboardPaste className="h-4 w-4 mr-1.5" /> Adicionar em lote
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditando(null);
                setAddOpen(true);
              }}
              data-testid="button-adicionar"
            >
              <Plus className="h-4 w-4 mr-1.5" /> Adicionar
            </Button>
            <div className="flex items-center gap-3 pl-2 border-l ml-1">
              <label
                htmlFor="chk-so-pendentes"
                className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none"
                title="Atualiza apenas processos com erro, não encontrado ou sem consulta"
              >
                <Checkbox
                  id="chk-so-pendentes"
                  checked={soPendentes}
                  onCheckedChange={(v) =>
                    setModoAtualizar(v === true ? "pendentes" : "todos")
                  }
                  disabled={atualizando}
                  data-testid="checkbox-so-pendentes"
                />
                Só pendentes{totalPendentes > 0 ? ` (${totalPendentes})` : ""}
              </label>
              <label
                htmlFor="chk-so-2ograu"
                className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none"
                title="Reverifica se os processos em 2º grau ganharam cobertura no Datajud"
              >
                <Checkbox
                  id="chk-so-2ograu"
                  checked={so2oGrau}
                  onCheckedChange={(v) =>
                    setModoAtualizar(v === true ? "2ograu" : "todos")
                  }
                  disabled={atualizando}
                  data-testid="checkbox-so-2ograu"
                />
                Só 2º grau{total2oGrau > 0 ? ` (${total2oGrau})` : ""}
              </label>
            </div>
            <Button
              size="sm"
              onClick={handleAtualizar}
              disabled={
                atualizando ||
                processos.length === 0 ||
                (soPendentes && totalPendentes === 0) ||
                (so2oGrau && total2oGrau === 0)
              }
              data-testid="button-atualizar"
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${atualizando ? "animate-spin" : ""}`} />
              {soPendentes
                ? "Atualizar pendentes"
                : so2oGrau
                  ? "Reverificar 2º grau"
                  : "Atualizar andamentos"}
            </Button>
          </div>
        </div>

        {/* Empty state */}
        {semProcessos ? (
          <EmptyState onAdd={() => setAddOpen(true)} onBulk={() => setBulkOpen(true)} />
        ) : (
          <>
            {/* Filtros */}
            <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por apelido, número, classe ou órgão"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="pl-9"
                  data-testid="input-busca"
                />
              </div>
              <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
                {(["Todos", "TJRJ", "TRF2"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setFiltroTribunal(t)}
                    data-testid={`filtro-tribunal-${t}`}
                    className={`px-3 py-1 text-sm rounded transition-colors ${
                      filtroTribunal === t
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover-elevate"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="nao-lidos"
                  checked={soNaoLidos}
                  onCheckedChange={setSoNaoLidos}
                  data-testid="switch-nao-lidos"
                />
                <Label htmlFor="nao-lidos" className="text-sm text-muted-foreground cursor-pointer">
                  Só não lidos{totalNaoLidos > 0 ? ` (${totalNaoLidos})` : ""}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="recentes"
                  checked={soRecentes}
                  onCheckedChange={setSoRecentes}
                  data-testid="switch-recentes"
                />
                <Label htmlFor="recentes" className="text-sm text-muted-foreground cursor-pointer">
                  Só movimentação recente (30 dias)
                </Label>
              </div>
            </div>

            {/* Status da última atualização + progresso */}
            <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground min-h-[20px]">
              <span className="flex items-center gap-2 flex-wrap" data-testid="text-contagem">
                <span>
                  {filtrados.length} de {processos.length} processo(s)
                </span>
                {(() => {
                  const total2oGrau = enriquecidos.filter((p) => p._status === "2o_grau").length;
                  if (total2oGrau === 0) return null;
                  return (
                    <span
                      className="inline-flex items-center rounded-md border border-blue-400/40 bg-blue-50 dark:bg-blue-950/30 px-1.5 py-0.5 text-blue-700 dark:text-blue-300"
                      title="Processos de 2º grau do TJRJ — acompanhamento manual pelo portal"
                      data-testid="badge-total-2grau"
                    >
                      {total2oGrau} de 2º grau · manual
                    </span>
                  );
                })()}
              </span>
              {atualizando ? (
                <span className="text-primary" data-testid="text-progresso">
                  {progresso}
                </span>
              ) : (
                ultimaAtualizacao && (
                  <span data-testid="text-ultima-atualizacao">
                    Atualizado {tempoRelativo(ultimaAtualizacao)}
                  </span>
                )
              )}
            </div>

            {/* Tabela */}
            {isLoading || atualizando ? (
              <TabelaSkeleton />
            ) : filtrados.length === 0 ? (
              <div className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground">
                Nenhum processo corresponde aos filtros.
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden bg-card">
                {/* Cabeçalho da tabela (desktop) */}
                <div className="hidden lg:grid grid-cols-[minmax(0,2.5fr)_88px_minmax(0,1.6fr)_minmax(0,2fr)_128px_40px] gap-3 px-4 py-2.5 border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  <span>Processo</span>
                  <span>Tribunal</span>
                  <span>Classe</span>
                  <span>Última movimentação</span>
                  <span>Data</span>
                  <span></span>
                </div>
                <ul className="divide-y divide-border" role="list">
                  {filtrados.map((p) => (
                    <LinhaProcesso
                      key={p.id}
                      p={p}
                      aba={aba}
                      expandido={expandido === p.id}
                      onToggle={() => handleToggleExpandido(p.id)}
                      onEdit={() => {
                        setEditando(p);
                        setAddOpen(true);
                      }}
                      onDelete={() => setConfirmarDelete(p)}
                      onAtualizarEste={() =>
                        handleAtualizarEste(p.id, p.apelido || formatarCNJ(p.numero))
                      }
                      onMarcarLido={() => marcarComoLido(p.id)}
                      onMarcarNaoLido={() => marcarComoNaoLido(p.id)}
                      toast={toast}
                      atualizandoEste={atualizandoIds.has(p.id)}
                    />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </main>

      <ProcessoDialog open={addOpen} onOpenChange={setAddOpen} processo={editando} />
      <BulkAddDialog open={bulkOpen} onOpenChange={setBulkOpen} />

      <AlertDialog open={!!confirmarDelete} onOpenChange={(v) => !v && setConfirmarDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover processo?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmarDelete?.apelido || formatarCNJ(confirmarDelete?.numero ?? "")} será removido
              do painel. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancelar">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              data-testid="button-delete-confirmar"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function LinhaProcesso({
  p,
  aba,
  expandido,
  onToggle,
  onEdit,
  onDelete,
  onAtualizarEste,
  onMarcarLido,
  onMarcarNaoLido,
  atualizandoEste,
  toast,
}: {
  p: any;
  aba: "painel" | "processos";
  expandido: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAtualizarEste: () => void;
  onMarcarLido: () => void;
  onMarcarNaoLido: () => void;
  atualizandoEste: boolean;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const titulo = p.apelido || formatarCNJ(p.numero);
  const naoEncontrado = p._status === "nao_encontrado";
  const erro = p._status === "erro";
  const segundoGrau = p._status === "2o_grau";

  return (
    <li className="text-sm" data-testid={`row-processo-${p.id}`}>
      <div
        className="grid grid-cols-1 lg:grid-cols-[minmax(0,2.5fr)_88px_minmax(0,1.6fr)_minmax(0,2fr)_128px_40px] gap-x-3 gap-y-1 px-4 py-3 hover-elevate cursor-pointer items-center"
        onClick={() => {
          // Ao expandir um processo não lido, marca como lido automaticamente
          if (!expandido && p._naoLido) {
            onMarcarLido();
          }
          onToggle();
        }}
      >
        {/* Processo */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expandido ? "rotate-90" : ""}`}
            />
            <span className="font-medium text-foreground truncate">{titulo}</span>
            {p._naoLido && !naoEncontrado && !erro && !segundoGrau && (
              <Badge className="bg-primary text-primary-foreground shrink-0" data-testid={`badge-nao-lido-${p.id}`}>
                Não lido
              </Badge>
            )}
            {p._recente && !p._naoLido && !naoEncontrado && !erro && !segundoGrau && (
              <Badge
                variant="outline"
                className="text-blue-700 dark:text-blue-300 border-blue-400/50 bg-blue-50 dark:bg-blue-950/30 shrink-0"
                data-testid={`badge-recente-${p.id}`}
                title="Movimentação processual nos últimos 30 dias"
              >
                Recente
              </Badge>
            )}
            {segundoGrau && (
              <Badge
                variant="outline"
                className="text-blue-700 dark:text-blue-300 border-blue-400/50 bg-blue-50 dark:bg-blue-950/40 shrink-0"
                data-testid={`badge-2grau-${p.id}`}
              >
                2º grau · manual
              </Badge>
            )}
            {naoEncontrado && (
              <Badge variant="outline" className="text-destructive border-destructive/40 shrink-0">
                Não encontrado
              </Badge>
            )}
            {erro && (
              <Badge variant="outline" className="text-destructive border-destructive/40 shrink-0">
                Erro
              </Badge>
            )}
          </div>
          {p.apelido && (
            <span className="ml-6 font-mono text-xs text-muted-foreground block truncate">
              {formatarCNJ(p.numero)}
            </span>
          )}
        </div>

        {/* Tribunal */}
        <div className="ml-6 lg:ml-0">
          <Badge variant="secondary">{p.tribunal}</Badge>
        </div>

        {/* Classe */}
        <span className="ml-6 lg:ml-0 text-muted-foreground truncate">
          {p._classe || <span className="text-muted-foreground/60">—</span>}
        </span>

        {/* Última movimentação */}
        <span className="ml-6 lg:ml-0 text-foreground truncate">
          {segundoGrau ? (
            <span className="text-muted-foreground italic">Consultar diretamente no portal do TJRJ</span>
          ) : (
            p._ultimoNome || <span className="text-muted-foreground/60">Sem dados — atualize</span>
          )}
        </span>

        {/* Data */}
        <span className="ml-6 lg:ml-0 font-mono text-xs text-muted-foreground tabular-nums">
          {p._ultimaData ? formatarData(p._ultimaData) : "—"}
        </span>

        {/* Ações */}
        <div className="ml-6 lg:ml-0 flex justify-end">
          <span className="hidden lg:inline-flex gap-1">
            {!segundoGrau && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={(e) => {
                  e.stopPropagation();
                  onAtualizarEste();
                }}
                disabled={atualizandoEste}
                aria-label="Atualizar este processo"
                title="Atualizar este processo"
                data-testid={`button-atualizar-${p.id}`}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${atualizandoEste ? "animate-spin" : ""}`} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={async (e) => {
                e.stopPropagation();
                const cnj = formatarCNJ(p.numero);
                try {
                  await navigator.clipboard.writeText(cnj);
                  toast({ title: "Número copiado", description: cnj });
                } catch {
                  toast({
                    title: "Não consegui copiar",
                    description: cnj,
                    variant: "destructive",
                  });
                }
              }}
              aria-label="Copiar número CNJ"
              title="Copiar número CNJ"
              data-testid={`button-copiar-inline-${p.id}`}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              aria-label="Editar"
              data-testid={`button-editar-${p.id}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </span>
        </div>
      </div>

      {/* Expandido */}
      {expandido && (
        <div className="px-4 pb-5 pt-1 bg-muted/30 border-t border-border" data-testid={`detalhe-${p.id}`}>
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2 mb-4 pl-6 pt-3 text-sm">
            <InfoItem label="Número CNJ" value={formatarCNJ(p.numero)} mono />
            <InfoItem label="Órgão julgador" value={p._orgao || "—"} />
            <InfoItem label="Classe" value={p._classe || "—"} />
            <InfoItem label="Formato" value={p.dados?.formato?.nome || "—"} />
            <InfoItem
              label="Ajuizamento"
              value={
                p.dados?.dataAjuizamento
                  ? formatarData(
                      `${p.dados.dataAjuizamento.slice(0, 4)}-${p.dados.dataAjuizamento.slice(4, 6)}-${p.dados.dataAjuizamento.slice(6, 8)}`
                    )
                  : "—"
              }
            />
            <InfoItem label="Grau" value={p.dados?.grau || "—"} />
          </div>

          {p.observacoes && (
            <div className="mb-4 pl-6 text-sm">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Observações</span>
              <p className="mt-0.5 text-foreground">{p.observacoes}</p>
            </div>
          )}

          {erro && p.snapshot?.erro && (
            <p className="mb-4 pl-6 text-sm text-destructive">Erro na consulta: {p.snapshot.erro}</p>
          )}

          {segundoGrau && (
            <div className="mb-4 pl-6 text-sm">
              <div className="rounded-md border border-blue-400/40 bg-blue-50 dark:bg-blue-950/30 p-3 text-blue-900 dark:text-blue-200">
                <p className="font-medium mb-1">Processo de 2º grau do TJRJ</p>
                <p className="text-xs leading-relaxed">
                  O TJRJ não disponibiliza processos de 2º grau na base pública do Datajud (CNJ). Este processo
                  precisa ser acompanhado manualmente pelo portal do tribunal. O painel não tentará mais
                  consultá-lo automaticamente.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pl-6 mb-4">
            <Button
              variant="outline"
              size="sm"
              data-testid={`button-copiar-${p.id}`}
              onClick={async () => {
                const cnj = formatarCNJ(p.numero);
                try {
                  await navigator.clipboard.writeText(cnj);
                  toast({
                    title: "Número copiado",
                    description: cnj,
                  });
                } catch {
                  toast({
                    title: "Não consegui copiar",
                    description: cnj,
                    variant: "destructive",
                  });
                }
              }}
              title="Copiar o número CNJ formatado"
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Copiar número
            </Button>
            <Button
              variant={segundoGrau ? "default" : "outline"}
              size="sm"
              data-testid={`button-portal-${p.id}`}
              onClick={async () => {
                // Nenhum portal aceita deep-link com o número preenchido, então
                // copiamos o CNJ pro clipboard automaticamente antes de abrir.
                // O usuário cola (Ctrl+V) no campo "Nº Processo" após carregar
                // (ou logar, no caso do TJRJ).
                const cnj = formatarCNJ(p.numero);
                try {
                  await navigator.clipboard.writeText(cnj);
                  toast({
                    title: "Número copiado",
                    description: `${cnj} · cole no portal após carregar`,
                  });
                } catch {
                  // Se clipboard falhar (contexto não-seguro), só abre
                }
                window.open(urlPortal(p.tribunal, p.numero), "_blank", "noopener,noreferrer");
              }}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Abrir no portal
            </Button>
            {!segundoGrau && (
              <Button
                variant="outline"
                size="sm"
                onClick={onAtualizarEste}
                disabled={atualizandoEste}
                data-testid={`button-atualizar-exp-${p.id}`}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${atualizandoEste ? "animate-spin" : ""}`} />{" "}
                {atualizandoEste ? "Atualizando..." : "Atualizar este"}
              </Button>
            )}
            {!segundoGrau && !p._naoLido && p._ultimaData && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onMarcarNaoLido}
                data-testid={`button-marcar-nao-lido-${p.id}`}
                title="Voltar este processo para a fila de não lidos"
              >
                <Mail className="h-3.5 w-3.5 mr-1.5" /> Marcar como não lido
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onEdit} data-testid={`button-editar-exp-${p.id}`}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" /> Editar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-destructive hover:text-destructive"
              data-testid={`button-excluir-${p.id}`}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remover
            </Button>
          </div>

          <div className="pl-6">
            <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
              Linha do tempo de movimentações
            </h4>
            <Timeline movimentos={p.dados?.movimentos ?? []} />
          </div>
        </div>
      )}
    </li>
  );
}

function InfoItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <p className={`text-foreground ${mono ? "font-mono text-sm" : ""}`}>{value}</p>
    </div>
  );
}

function EmptyState({ onAdd, onBulk }: { onAdd: () => void; onBulk: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border py-16 px-6 text-center" data-testid="empty-state">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Inbox className="h-6 w-6" />
      </div>
      <h2 className="text-base font-semibold text-foreground">Nenhum processo cadastrado</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
        Cadastre seu primeiro processo ou cole a lista da sua planilha de controle. Depois clique em
        “Atualizar andamentos” para consultar o Datajud do CNJ.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <Button onClick={onBulk} data-testid="button-empty-lote">
          <ClipboardPaste className="h-4 w-4 mr-1.5" /> Colar lista da planilha
        </Button>
        <Button variant="outline" onClick={onAdd} data-testid="button-empty-add">
          <Plus className="h-4 w-4 mr-1.5" /> Adicionar um processo
        </Button>
      </div>
    </div>
  );
}

function TabelaSkeleton() {
  return (
    <div className="rounded-lg border border-border overflow-hidden bg-card" data-testid="skeleton">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5 border-b border-border last:border-0">
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-4 flex-1 max-w-[240px]" />
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-4 w-28 hidden lg:block" />
          <Skeleton className="h-4 w-40 hidden lg:block" />
          <Skeleton className="h-4 w-20 ml-auto" />
        </div>
      ))}
    </div>
  );
}
