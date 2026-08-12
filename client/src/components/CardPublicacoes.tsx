import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useInfiniteQuery, useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight, ExternalLink, CheckCheck, Inbox, Copy } from "lucide-react";
import { formatarCNJ, inferirTribunal, urlPortal } from "@/lib/cnj";
import type { PublicacaoComProcesso } from "@shared/schema";

type Filtro = "todas" | "nao_lidas";

interface RespListagem {
  items: PublicacaoComProcesso[];
  proximoCursor: string | null;
}

// ============================================================
// Utilidades locais
// ============================================================
function formatarDataPub(iso: string): string {
  // dataDisponibilizacao vem como "YYYY-MM-DDT00:00:00.000Z" ou "YYYY-MM-DD".
  // Só nos importa a parte da data.
  const s = iso.slice(0, 10);
  const [ano, mes, dia] = s.split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}

function limparTexto(t: string | null): string {
  if (!t) return "";
  return t.replace(/\s+/g, " ").trim();
}

// Retorna a data no formato DD/MM/AAAA a partir de um objeto Date.
function formatarBR(d: Date): string {
  const dia = String(d.getUTCDate()).padStart(2, "0");
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  const ano = d.getUTCFullYear();
  return `${dia}/${mes}/${ano}`;
}

// Avança N dias úteis a partir de uma data (pulando sábado/domingo).
// Não considera feriados forenses — mantido simples de propósito.
function proximoDiaUtil(base: Date, pular: number): Date {
  const d = new Date(base.getTime());
  let restam = pular;
  while (restam > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay(); // 0=domingo, 6=sábado
    if (wd !== 0 && wd !== 6) restam -= 1;
  }
  return d;
}

// Retorna { publicacao, inicio } calculadas a partir da data de disponibilização.
// Regra CPC art. 224 §3º: publicação = 1º dia útil seguinte à disponibilização;
// início do prazo = 1º dia útil seguinte à publicação.
function calcularDatasPrazo(dataDispIso: string): {
  publicacao: string;
  inicio: string;
} | null {
  const s = dataDispIso.slice(0, 10);
  const [ano, mes, dia] = s.split("-").map(Number);
  if (!ano || !mes || !dia) return null;
  // Constrói em UTC pra evitar salto de fuso.
  const disp = new Date(Date.UTC(ano, mes - 1, dia));
  const pub = proximoDiaUtil(disp, 1);
  const inicio = proximoDiaUtil(pub, 1);
  return { publicacao: formatarBR(pub), inicio: formatarBR(inicio) };
}

// ============================================================
// Componente principal
// ============================================================
export function CardPublicacoes() {
  const { toast } = useToast();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [expandidas, setExpandidas] = useState<Set<number>>(new Set());
  const sentinelaRef = useRef<HTMLDivElement | null>(null);

  // -------- Contador de não lidas (badge) --------
  const { data: countData } = useQuery<{ naoLidas: number }>({
    queryKey: ["/api/publicacoes/nao-lidas-count"],
    refetchInterval: 60_000, // a cada minuto (baratíssimo — só COUNT)
  });
  const naoLidasTotal = countData?.naoLidas ?? 0;

  // -------- Listagem paginada por cursor --------
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = useInfiniteQuery<RespListagem>({
    queryKey: ["/api/publicacoes", filtro],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limite: "30" });
      if (filtro === "nao_lidas") params.set("naoLidas", "true");
      if (pageParam) params.set("antesDe", String(pageParam));
      const resp = await apiRequest("GET", `/api/publicacoes?${params.toString()}`);
      return resp.json();
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.proximoCursor,
  });

  const publicacoes: PublicacaoComProcesso[] = useMemo(() => {
    return data?.pages.flatMap((p) => p.items) ?? [];
  }, [data]);

  // -------- Scroll infinito com IntersectionObserver --------
  useEffect(() => {
    if (!sentinelaRef.current) return;
    if (!hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinelaRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // -------- Marcar como lida (ao expandir) --------
  const marcarLidaMut = useMutation({
    mutationFn: async (id: number) => {
      const resp = await apiRequest("POST", `/api/publicacoes/${id}/marcar-lida`);
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/publicacoes/nao-lidas-count"] });
      // Não invalido a listagem — dá pra atualizar in-place pra evitar re-render.
    },
  });

  // -------- Marcar todas como lidas --------
  const marcarTodasMut = useMutation({
    mutationFn: async () => {
      const resp = await apiRequest("POST", "/api/publicacoes/marcar-todas-lidas");
      return resp.json();
    },
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ["/api/publicacoes/nao-lidas-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/publicacoes"] });
      toast({
        title: `${d.marcadas} publicação(ões) marcadas como lidas`,
      });
    },
  });

  const handleToggle = useCallback(
    (id: number, jaLida: boolean) => {
      setExpandidas((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
          // Ao expandir uma não lida, marca como lida no back
          if (!jaLida) {
            marcarLidaMut.mutate(id);
          }
        }
        return next;
      });
    },
    [marcarLidaMut]
  );

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Cabeçalho do card */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Publicações DJEN</h2>
          {naoLidasTotal > 0 && (
            <Badge
              variant="default"
              className="h-5 px-1.5 text-[10px]"
              data-testid="badge-nao-lidas"
            >
              {naoLidasTotal} não lida{naoLidasTotal === 1 ? "" : "s"}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Tabs value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
            <TabsList className="h-8">
              <TabsTrigger
                value="todas"
                className="h-7 text-xs px-3"
                data-testid="tab-pub-todas"
              >
                Todas
              </TabsTrigger>
              <TabsTrigger
                value="nao_lidas"
                className="h-7 text-xs px-3"
                data-testid="tab-pub-nao-lidas"
              >
                Não lidas
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {naoLidasTotal > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => marcarTodasMut.mutate()}
              disabled={marcarTodasMut.isPending}
              data-testid="button-marcar-todas-lidas"
              title="Marcar todas como lidas"
            >
              <CheckCheck className="h-4 w-4 mr-1.5" />
              <span className="hidden sm:inline">Marcar todas</span>
            </Button>
          )}
        </div>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="p-4 space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : publicacoes.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">
          <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
          {filtro === "nao_lidas"
            ? "Nenhuma publicação não lida."
            : "Ainda não há publicações registradas. Aguardando o próximo cron do DJEN (5h Brasília)."}
        </div>
      ) : (
        <ul className="divide-y divide-border" role="list">
          {publicacoes.map((pub) => {
            const expandida = expandidas.has(pub.id);
            const naoLida = pub.lidoEm === null;
            return (
              <li key={pub.id} data-testid={`pub-${pub.id}`}>
                {/* Linha compacta (sempre visível) */}
                <button
                  onClick={() => handleToggle(pub.id, !naoLida)}
                  className="w-full text-left px-4 py-2.5 hover:bg-muted/40 transition-colors flex items-start gap-3"
                  data-testid={`button-pub-toggle-${pub.id}`}
                >
                  {/* Bolinha de não lida */}
                  <span
                    className={`mt-1.5 flex-shrink-0 h-2 w-2 rounded-full ${
                      naoLida ? "bg-primary" : "bg-transparent"
                    }`}
                    aria-label={naoLida ? "Não lida" : "Lida"}
                  />

                  {/* Ícone chevron */}
                  <span className="mt-0.5 flex-shrink-0 text-muted-foreground">
                    {expandida ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </span>

                  {/* Conteúdo compacto */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-xs font-mono text-muted-foreground">
                        {formatarDataPub(pub.dataDisponibilizacao)}
                      </span>
                      {pub.tipoDocumento && (
                        <span className={`text-sm ${naoLida ? "font-semibold text-foreground" : "text-foreground/80"}`}>
                          {pub.tipoDocumento}
                        </span>
                      )}
                      <span
                        className="text-xs text-primary truncate max-w-[240px]"
                        title={pub.processoApelido || formatarCNJ(pub.processoNumero)}
                      >
                        · {pub.processoApelido || formatarCNJ(pub.processoNumero)}
                      </span>
                    </div>
                    {pub.nomeOrgao && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {pub.nomeOrgao}
                      </div>
                    )}
                  </div>
                </button>

                {/* Bloco expandido */}
                {expandida && (
                  <div className="px-4 pb-4 pl-11 space-y-3 bg-muted/20">
                    {pub.tipoComunicacao && pub.tipoComunicacao !== pub.tipoDocumento && (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium">Tipo:</span> {pub.tipoComunicacao}
                      </div>
                    )}
                    {pub.nomeClasse && (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium">Classe:</span> {pub.nomeClasse}
                      </div>
                    )}
                    {/* Datas calculadas (art. 224 §3º CPC) */}
                    {(() => {
                      const datas = calcularDatasPrazo(pub.dataDisponibilizacao);
                      if (!datas) return null;
                      return (
                        <div
                          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
                          data-testid={`datas-prazo-${pub.id}`}
                        >
                          <span className="text-muted-foreground">
                            <span className="font-medium">Disponibilizado:</span>{" "}
                            {formatarDataPub(pub.dataDisponibilizacao)}
                          </span>
                          <span className="text-muted-foreground">
                            <span className="font-medium">Publicado:</span>{" "}
                            {datas.publicacao}
                          </span>
                          <span
                            className="font-medium text-primary"
                            title="1º dia útil após a publicação. Não considera feriados forenses."
                          >
                            Prazo começa: {datas.inicio}
                          </span>
                        </div>
                      );
                    })()}
                    <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                      {limparTexto(pub.texto) || <em className="text-muted-foreground">Sem texto disponível.</em>}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      {pub.link && (
                        <a
                          href={pub.link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          data-testid={`link-pub-${pub.id}`}
                        >
                          <ExternalLink className="h-3 w-3" /> Abrir documento
                        </a>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        data-testid={`button-copiar-cnj-${pub.id}`}
                        onClick={async (e) => {
                          e.stopPropagation();
                          const cnj = formatarCNJ(pub.processoNumero);
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
                        <Copy className="h-3 w-3 mr-1.5" /> Copiar número
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        data-testid={`button-portal-${pub.id}`}
                        onClick={async (e) => {
                          e.stopPropagation();
                          // Nenhum portal aceita deep-link com o número preenchido,
                          // então copiamos o CNJ pro clipboard antes de abrir. O usuário
                          // cola (Ctrl+V) no campo "Nº Processo" após carregar / logar.
                          const cnj = formatarCNJ(pub.processoNumero);
                          const tribunal = inferirTribunal(pub.processoNumero);
                          try {
                            await navigator.clipboard.writeText(cnj);
                            toast({
                              title: "Número copiado",
                              description: `${cnj} · cole no portal após carregar`,
                            });
                          } catch {
                            // Se clipboard falhar (contexto não-seguro), só abre
                          }
                          const url = urlPortal(
                            tribunal ?? "TJRJ",
                            pub.processoNumero
                          );
                          window.open(url, "_blank", "noopener,noreferrer");
                        }}
                        title="Abrir portal do tribunal (copia o número antes)"
                      >
                        <ExternalLink className="h-3 w-3 mr-1.5" /> Abrir portal
                      </Button>
                      <span className="text-xs text-muted-foreground font-mono ml-auto">
                        {formatarCNJ(pub.processoNumero)}
                      </span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Sentinela pro scroll infinito */}
      {hasNextPage && (
        <div ref={sentinelaRef} className="p-4 text-center text-xs text-muted-foreground">
          {isFetchingNextPage ? "Carregando mais..." : "Rolar para carregar mais"}
        </div>
      )}
    </div>
  );
}
