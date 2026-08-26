import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useInfiniteQuery, useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  CheckCheck,
  Inbox,
  Copy,
  MessageSquare,
  FileText,
  Loader2,
  Check,
  X,
  Pencil,
} from "lucide-react";
import { formatarCNJ, inferirTribunal, urlPortal } from "@/lib/cnj";
import type { PublicacaoComProcesso } from "@shared/schema";

type Filtro = "todas" | "nao_lidas";

// ============================================================
// Bloco de anotação (textarea persistente + botão copiar)
// ============================================================
interface AnotacaoBlocoProps {
  pub: PublicacaoComProcesso;
  onSalvar: (id: number, anotacao: string) => void;
  onToast: (t: { title: string; description?: string; variant?: "destructive" }) => void;
}

function AnotacaoBloco({ pub, onSalvar, onToast }: AnotacaoBlocoProps) {
  const [valor, setValor] = useState(pub.anotacao ?? "");
  const [salvando, setSalvando] = useState<"idle" | "pendente" | "salvo">("idle");
  const timerRef = useRef<number | null>(null);

  // Se a publicação mudar (por ex. refetch da lista), sincroniza.
  useEffect(() => {
    setValor(pub.anotacao ?? "");
    setSalvando("idle");
  }, [pub.id, pub.anotacao]);

  // Salva com debounce de 800ms após parar de digitar
  const handleChange = (novo: string) => {
    setValor(novo);
    setSalvando("pendente");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      onSalvar(pub.id, novo);
      setSalvando("salvo");
      window.setTimeout(() => setSalvando("idle"), 1500);
    }, 800);
  };

  const copiarComContexto = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // Se houver debounce pendente, salva agora antes de copiar
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      onSalvar(pub.id, valor);
      setSalvando("salvo");
      window.setTimeout(() => setSalvando("idle"), 1500);
    }
    const apelido = pub.processoApelido;
    const cnj = formatarCNJ(pub.processoNumero);
    const tipoDoc = pub.tipoDocumento || "Publicação";
    const dataDisp = formatarDataPub(pub.dataDisponibilizacao);
    const datasPrazo = calcularDatasPrazo(pub.dataDisponibilizacao);
    const orgao = pub.nomeOrgao?.trim();
    const texto = limparTexto(pub.texto);
    const anot = (valor || "").trim();

    // Cabeçalho corrido: [Apelido · ]CNJ — tipoDoc · Disp DD/MM[ · Publicado DD/MM · Prazo começa DD/MM][ · Órgão]
    const partes: string[] = [];
    if (apelido) partes.push(`${apelido} · ${cnj}`);
    else partes.push(cnj);
    partes.push(`${tipoDoc} · Disp. ${dataDisp}`);
    if (datasPrazo) {
      partes.push(`Publicado ${datasPrazo.publicacao} · Prazo começa ${datasPrazo.inicio}`);
    }
    if (orgao) partes.push(orgao);
    const cabecalho = partes.join(" — ");

    // Monta corpo: cabeçalho → (linha em branco → texto)? → (linha em branco → anotação)?
    const linhas: string[] = [cabecalho];
    if (texto) linhas.push("", texto);
    if (anot) linhas.push("", `Anotação: ${anot}`);
    const bloco = linhas.join("\n");
    try {
      await navigator.clipboard.writeText(bloco);
      onToast({ title: "Copiado", description: "Pronto pra colar no WhatsApp" });
    } catch {
      onToast({ title: "Não consegui copiar", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-1.5" data-testid={`bloco-anotacao-${pub.id}`}>
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={`anotacao-${pub.id}`}
          className="text-xs font-medium text-muted-foreground"
        >
          Minha anotação
        </label>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground min-w-[54px] text-right">
            {salvando === "pendente" ? "salvando…" : salvando === "salvo" ? "salvo" : ""}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={copiarComContexto}
            data-testid={`button-copiar-anotacao-${pub.id}`}
            title="Copia um bloco pronto: Processo [Apelido] — [tipo doc · data]: [sua anotação]"
          >
            <Copy className="h-3 w-3 mr-1.5" /> Copiar pro WhatsApp
          </Button>
        </div>
      </div>
      <textarea
        id={`anotacao-${pub.id}`}
        value={valor}
        onChange={(e) => handleChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        placeholder="Anote aqui sua compreensão da publicação — salva sozinho e você pode copiar pra mandar pro cliente/advogado."
        className="w-full min-h-[64px] resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        data-testid={`textarea-anotacao-${pub.id}`}
      />
    </div>
  );
}

// ============================================================
// Modal "Gerar cabeçalho da petição" (2 chamadas LLM)
// ============================================================
interface GerarCabecalhoModalProps {
  pub: PublicacaoComProcesso;
  onFechar: () => void;
  onUsarComoApelido: (nome: string) => void;
  onToast: (t: { title: string; description?: string; variant?: "destructive" }) => void;
}
interface Polo {
  tipo: string;
  nome: string;
}

function GerarCabecalhoModal({ pub, onFechar, onUsarComoApelido, onToast }: GerarCabecalhoModalProps) {
  const [etapa, setEtapa] = useState<"extraindo" | "escolha" | "gerando" | "pronto" | "erro">(
    "extraindo"
  );
  const [polos, setPolos] = useState<Polo[]>([]);
  const [observacao, setObservacao] = useState<string | null>(null);
  const [clienteEscolhido, setClienteEscolhido] = useState<string>("");
  const [cabecalho, setCabecalho] = useState<string>("");
  const [erro, setErro] = useState<string>("");

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const resp = await apiRequest("POST", `/api/publicacoes/${pub.id}/extrair-partes`, {});
        const data = await resp.json();
        if (cancelado) return;
        setPolos(Array.isArray(data.polos) ? data.polos : []);
        setObservacao(data.observacao || null);
        setEtapa("escolha");
      } catch (e: any) {
        if (cancelado) return;
        setErro(e?.message || String(e));
        setEtapa("erro");
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [pub.id]);

  const gerar = async (clienteNome: string) => {
    setClienteEscolhido(clienteNome);
    setEtapa("gerando");
    try {
      const resp = await apiRequest("POST", `/api/publicacoes/${pub.id}/gerar-cabecalho`, {
        clienteNome,
        polos,
      });
      const data = await resp.json();
      setCabecalho(data.cabecalho || "");
      setEtapa("pronto");
    } catch (e: any) {
      setErro(e?.message || String(e));
      setEtapa("erro");
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(cabecalho);
      onToast({ title: "Cabeçalho copiado", description: "Cole no Word." });
    } catch {
      onToast({ title: "Não consegui copiar", variant: "destructive" });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onFechar}
    >
      <div
        className="bg-background border border-border rounded-lg shadow-lg max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold text-foreground">Gerar cabeçalho da petição</h3>
          <button
            onClick={onFechar}
            className="text-muted-foreground hover:text-foreground"
            data-testid="button-fechar-modal-cabecalho"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {etapa === "extraindo" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Lendo a publicação e extraindo partes...
            </div>
          )}

          {etapa === "escolha" && (
            <div className="space-y-3">
              {polos.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    A IA não conseguiu identificar partes na publicação. Digite o nome do cliente manualmente:
                  </p>
                  {observacao && (
                    <p className="text-xs text-muted-foreground italic">{observacao}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-foreground font-medium">
                    Qual dessas partes é o cliente do subscritor?
                  </p>
                  <ul className="space-y-1.5">
                    {polos.map((p, i) => (
                      <li key={i}>
                        <button
                          onClick={() => gerar(p.nome)}
                          className="w-full text-left px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors"
                          data-testid={`button-escolher-polo-${i}`}
                        >
                          <span className="text-xs uppercase text-muted-foreground mr-2">
                            {p.tipo}
                          </span>
                          <span className="text-sm text-foreground">{p.nome}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <ManualClienteInput onConfirmar={gerar} />
            </div>
          )}

          {etapa === "gerando" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Montando o cabeçalho...
            </div>
          )}

          {etapa === "pronto" && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                Cliente: <span className="font-medium text-foreground">{clienteEscolhido}</span>
              </div>
              <textarea
                readOnly
                value={cabecalho}
                className="w-full min-h-[220px] resize-y rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-mono text-foreground focus:outline-none"
                data-testid="textarea-cabecalho-gerado"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" onClick={copiar} data-testid="button-copiar-cabecalho">
                  <Copy className="h-3 w-3 mr-1.5" /> Copiar cabeçalho
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onUsarComoApelido(clienteEscolhido);
                    onFechar();
                  }}
                  data-testid="button-usar-apelido"
                >
                  <Pencil className="h-3 w-3 mr-1.5" /> Usar como apelido
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEtapa("escolha")} data-testid="button-voltar-escolha">
                  Voltar
                </Button>
              </div>
            </div>
          )}

          {etapa === "erro" && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">Erro: {erro}</p>
              <Button size="sm" variant="outline" onClick={onFechar}>
                Fechar
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ManualClienteInput({ onConfirmar }: { onConfirmar: (nome: string) => void }) {
  const [valor, setValor] = useState("");
  return (
    <div className="flex gap-2 pt-2 border-t border-border">
      <input
        type="text"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder="Ou digite o nome do cliente"
        className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        data-testid="input-cliente-manual"
      />
      <Button size="sm" disabled={!valor.trim()} onClick={() => onConfirmar(valor.trim())} data-testid="button-confirmar-cliente-manual">
        Gerar
      </Button>
    </div>
  );
}

// ============================================================
// Editor inline de apelido do processo
// ============================================================
interface EditorApelidoProps {
  processoId: number;
  apelidoAtual: string | null;
  valorInicial?: string;
  onSalvar: (apelido: string) => Promise<void>;
  onCancelar: () => void;
}

function EditorApelido({ processoId, apelidoAtual, valorInicial, onSalvar, onCancelar }: EditorApelidoProps) {
  const [valor, setValor] = useState(valorInicial || apelidoAtual || "");
  const [salvando, setSalvando] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const salvar = async () => {
    setSalvando(true);
    try {
      await onSalvar(valor.trim());
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        type="text"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") salvar();
          if (e.key === "Escape") onCancelar();
        }}
        disabled={salvando}
        className="flex-1 min-w-[240px] rounded-md border border-primary bg-background px-2 py-1 text-sm text-foreground focus:outline-none"
        data-testid={`input-apelido-${processoId}`}
      />
      <button
        onClick={salvar}
        disabled={salvando}
        className="text-primary hover:opacity-80 disabled:opacity-50"
        title="Salvar (Enter)"
        data-testid={`button-salvar-apelido-${processoId}`}
      >
        {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </button>
      <button
        onClick={onCancelar}
        disabled={salvando}
        className="text-muted-foreground hover:text-foreground disabled:opacity-50"
        title="Cancelar (Esc)"
        data-testid={`button-cancelar-apelido-${processoId}`}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

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

// Mapa case-sensitive de entidades HTML nomeadas que aparecem em textos de publicações.
// A case IMPORTA: &Ecirc; = Ê, &ecirc; = ê.
const ENTIDADES_HTML: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  // Minúsculas com acento agudo
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", yacute: "ý",
  // Maiúsculas com acento agudo
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Yacute: "Ý",
  // Minúsculas com til
  atilde: "ã", otilde: "õ", ntilde: "ñ",
  // Maiúsculas com til
  Atilde: "Ã", Otilde: "Õ", Ntilde: "Ñ",
  // Minúsculas com circunflexo
  acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û",
  // Maiúsculas com circunflexo
  Acirc: "Â", Ecirc: "Ê", Icirc: "Î", Ocirc: "Ô", Ucirc: "Û",
  // Minúsculas com grave
  agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù",
  // Maiúsculas com grave
  Agrave: "À", Egrave: "È", Igrave: "Ì", Ograve: "Ò", Ugrave: "Ù",
  // Trema
  auml: "ä", euml: "ë", iuml: "ï", ouml: "ö", uuml: "ü",
  Auml: "Ä", Euml: "Ë", Iuml: "Ï", Ouml: "Ö", Uuml: "Ü",
  // Cedilha e outros comuns em português/latim
  ccedil: "ç", Ccedil: "Ç", oslash: "ø", Oslash: "Ø",
  aring: "å", Aring: "Å", aelig: "æ", AElig: "Æ",
  szlig: "ß", ordm: "º", ordf: "ª",
  // Pontuação e símbolos
  hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„",
  para: "¶", sect: "§", copy: "©", reg: "®", trade: "™",
  deg: "°", middot: "·", bull: "•", times: "×", divide: "÷",
  euro: "€", pound: "£", yen: "¥", cent: "¢",
};

function decodificarEntidades(s: string): string {
  return s
    // Entidades numéricas decimais: &#233;
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    // Entidades numéricas hexadecimais: &#xE9;
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    // Entidades nomeadas (case-sensitive)
    .replace(/&([A-Za-z]+);/g, (raw, nome: string) => {
      return Object.prototype.hasOwnProperty.call(ENTIDADES_HTML, nome)
        ? ENTIDADES_HTML[nome]
        : raw; // preserva desconhecidas em vez de apagar
    });
}

function limparTexto(t: string | null): string {
  if (!t) return "";
  // Alguns tribunais entregam o texto da publicação em HTML (com <br>, <p>, &Ecirc;, etc).
  const semTags = t
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*p\s*>/gi, "\n\n")
    .replace(/<\s*\/?\s*(div|li|tr|h[1-6])\s*[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const semEntidades = decodificarEntidades(semTags);
  // Colapsa espaços por linha, mas preserva quebras
  return semEntidades
    .split("\n")
    .map((linha) => linha.replace(/[\t ]+/g, " ").trim())
    .filter((linha, i, arr) => !(linha === "" && arr[i - 1] === ""))
    .join("\n")
    .trim();
}

// Retorna a data no formato DD/MM/AAAA a partir de um objeto Date.
function formatarBR(d: Date): string {
  const dia = String(d.getUTCDate()).padStart(2, "0");
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  const ano = d.getUTCFullYear();
  return `${dia}/${mes}/${ano}`;
}

// Retorna DD/MM/AAAA a partir de um ISO 8601 (timestamptz).
// Usa fuso local do navegador para exibir a data que o usuário percebe.
function formatarISOLocalBR(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const ano = d.getFullYear();
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

  // Estado do modal de gerar cabeçalho + editor de apelido
  const [modalCabecalhoPub, setModalCabecalhoPub] = useState<PublicacaoComProcesso | null>(null);
  const [editandoApelido, setEditandoApelido] = useState<{ processoId: number; sugestao?: string } | null>(null);

  const salvarApelidoMut = useMutation({
    mutationFn: async ({ processoId, apelido }: { processoId: number; apelido: string }) => {
      const resp = await apiRequest("PATCH", `/api/processos/${processoId}`, { apelido });
      return resp.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.setQueriesData<{ pages: RespListagem[] }>(
        { queryKey: ["/api/publicacoes"] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((p) =>
                p.processoId === vars.processoId ? { ...p, processoApelido: vars.apelido || null } : p
              ),
            })),
          };
        }
      );
      queryClient.invalidateQueries({ queryKey: ["/api/processos"] });
      toast({ title: "Apelido atualizado" });
      setEditandoApelido(null);
    },
    onError: (e: any) => {
      toast({
        title: "Não consegui salvar o apelido",
        description: e?.message || String(e),
        variant: "destructive",
      });
    },
  });

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
  // Otimistic update: seta lidoEm=agora na cache antes da resposta chegar.
  const marcarLidaMut = useMutation({
    mutationFn: async (id: number) => {
      const resp = await apiRequest("POST", `/api/publicacoes/${id}/marcar-lida`);
      return resp.json();
    },
    onMutate: async (id: number) => {
      const agora = new Date().toISOString();
      queryClient.setQueriesData<{ pages: RespListagem[] }>(
        { queryKey: ["/api/publicacoes"] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((p) =>
                p.id === id && p.lidoEm === null ? { ...p, lidoEm: agora } : p
              ),
            })),
          };
        }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/publicacoes/nao-lidas-count"] });
    },
  });

  // -------- Toggle informado --------
  // Otimistic update também — alterna entre null e now() na cache.
  const alternarInformadaMut = useMutation({
    mutationFn: async (id: number) => {
      const resp = await apiRequest(
        "POST",
        `/api/publicacoes/${id}/alternar-informada`
      );
      return resp.json() as Promise<{ informadoEm: string | null }>;
    },
    onMutate: async (id: number) => {
      const agora = new Date().toISOString();
      queryClient.setQueriesData<{ pages: RespListagem[] }>(
        { queryKey: ["/api/publicacoes"] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((p) =>
                p.id === id
                  ? { ...p, informadoEm: p.informadoEm === null ? agora : null }
                  : p
              ),
            })),
          };
        }
      );
    },
    onSuccess: (data, id) => {
      // Sincroniza com o valor real do servidor (pode diferir por milissegundos).
      queryClient.setQueriesData<{ pages: RespListagem[] }>(
        { queryKey: ["/api/publicacoes"] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((p) =>
                p.id === id ? { ...p, informadoEm: data.informadoEm } : p
              ),
            })),
          };
        }
      );
    },
  });

  // -------- Salvar anotação --------
  // Otimista local: atualizamos a cache imediatamente ao digitar; o servidor
  // é chamado com debounce (via useDebouncedCallback logo abaixo).
  const salvarAnotacaoMut = useMutation({
    mutationFn: async ({ id, anotacao }: { id: number; anotacao: string }) => {
      const resp = await apiRequest(
        "PATCH",
        `/api/publicacoes/${id}/anotacao`,
        { anotacao }
      );
      return resp.json() as Promise<{ anotacao: string | null }>;
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
                      {editandoApelido?.processoId === pub.processoId ? (
                        <EditorApelido
                          processoId={pub.processoId}
                          apelidoAtual={pub.processoApelido}
                          valorInicial={editandoApelido.sugestao}
                          onSalvar={async (apelido) => {
                            await salvarApelidoMut.mutateAsync({
                              processoId: pub.processoId,
                              apelido,
                            });
                          }}
                          onCancelar={() => setEditandoApelido(null)}
                        />
                      ) : (
                        <span
                          className="text-xs text-primary truncate max-w-[240px] inline-flex items-center gap-1"
                          title={pub.processoApelido || formatarCNJ(pub.processoNumero)}
                        >
                          · {pub.processoApelido || formatarCNJ(pub.processoNumero)}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditandoApelido({ processoId: pub.processoId });
                            }}
                            className="text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100"
                            title="Editar apelido do processo"
                            data-testid={`button-editar-apelido-${pub.processoId}`}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </span>
                      )}
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
                    {/* Datas de prazo + status de leitura/comunicação */}
                    {(() => {
                      const datas = calcularDatasPrazo(pub.dataDisponibilizacao);
                      return (
                        <div
                          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
                          data-testid={`datas-prazo-${pub.id}`}
                        >
                          <span className="text-muted-foreground">
                            <span className="font-medium">Disponibilizado:</span>{" "}
                            {formatarDataPub(pub.dataDisponibilizacao)}
                          </span>
                          {datas && (
                            <>
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
                            </>
                          )}
                          {pub.lidoEm && (
                            <span
                              className="text-muted-foreground"
                              title={`Lido em ${new Date(pub.lidoEm).toLocaleString("pt-BR")}`}
                            >
                              <span className="font-medium">Lido em:</span>{" "}
                              {formatarISOLocalBR(pub.lidoEm)}
                            </span>
                          )}
                          {pub.informadoEm ? (
                            <span
                              className="text-muted-foreground inline-flex items-center gap-1"
                              title={`Informado em ${new Date(pub.informadoEm).toLocaleString("pt-BR")} · clique no botão para desmarcar`}
                            >
                              <span className="font-medium">Informado em:</span>{" "}
                              {formatarISOLocalBR(pub.informadoEm)}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  alternarInformadaMut.mutate(pub.id);
                                }}
                                className="ml-1 text-primary hover:underline"
                                data-testid={`button-desmarcar-informada-${pub.id}`}
                                title="Desmarcar informado"
                              >
                                (desmarcar)
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                alternarInformadaMut.mutate(pub.id);
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted transition-colors"
                              data-testid={`button-marcar-informada-${pub.id}`}
                              title="Marcar como informado ao cliente (bate a data de hoje)"
                            >
                              <MessageSquare className="h-3 w-3" /> Marcar informado
                            </button>
                          )}
                        </div>
                      );
                    })()}
                    <AnotacaoBloco
                      pub={pub}
                      onSalvar={(id, anotacao) => {
                        // Otimista: atualiza cache local
                        queryClient.setQueriesData<{ pages: RespListagem[] }>(
                          { queryKey: ["/api/publicacoes"] },
                          (old) => {
                            if (!old) return old;
                            return {
                              ...old,
                              pages: old.pages.map((page) => ({
                                ...page,
                                items: page.items.map((p) =>
                                  p.id === id ? { ...p, anotacao: anotacao || null } : p
                                ),
                              })),
                            };
                          }
                        );
                        salvarAnotacaoMut.mutate({ id, anotacao });
                      }}
                      onToast={(t) => toast(t)}
                    />
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
                        data-testid={`button-gerar-cabecalho-${pub.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setModalCabecalhoPub(pub);
                        }}
                        title="Gerar cabeçalho da petição com IA (extrai partes e monta endereçamento)"
                      >
                        <FileText className="h-3 w-3 mr-1.5" /> Gerar cabeçalho
                      </Button>
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
                      {(() => {
                        const tribunalDetectado = inferirTribunal(pub.processoNumero);
                        const abrirPortal = async (e: React.MouseEvent, url: string) => {
                          e.stopPropagation();
                          // Nenhum portal aceita deep-link com o número preenchido,
                          // então copiamos o CNJ pro clipboard antes de abrir. O usuário
                          // cola (Ctrl+V) no campo "Nº Processo" após carregar / logar.
                          const cnj = formatarCNJ(pub.processoNumero);
                          try {
                            await navigator.clipboard.writeText(cnj);
                            toast({
                              title: "Número copiado",
                              description: `${cnj} · cole no portal após carregar`,
                            });
                          } catch {
                            // Se clipboard falhar (contexto não-seguro), só abre
                          }
                          window.open(url, "_blank", "noopener,noreferrer");
                        };

                        // TRT1, TJRS e TJSP: dois botões (1º e 2º grau)
                        if (tribunalDetectado === "TRT1" || tribunalDetectado === "TJRS" || tribunalDetectado === "TJSP") {
                          const label = tribunalDetectado === "TRT1" ? "PJe" : "e-Proc";
                          return (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                data-testid={`button-portal-1g-${pub.id}`}
                                onClick={(e) => abrirPortal(e, urlPortal(tribunalDetectado, pub.processoNumero, "1g"))}
                                title={`Abrir ${label} ${tribunalDetectado} 1º grau (copia o número antes)`}
                              >
                                <ExternalLink className="h-3 w-3 mr-1.5" /> {label} 1º grau
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                data-testid={`button-portal-2g-${pub.id}`}
                                onClick={(e) => abrirPortal(e, urlPortal(tribunalDetectado, pub.processoNumero, "2g"))}
                                title={`Abrir ${label} ${tribunalDetectado} 2º grau (copia o número antes)`}
                              >
                                <ExternalLink className="h-3 w-3 mr-1.5" /> {label} 2º grau
                              </Button>
                            </>
                          );
                        }

                        return (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            data-testid={`button-portal-${pub.id}`}
                            onClick={(e) => abrirPortal(e, urlPortal(tribunalDetectado ?? "TJRJ", pub.processoNumero))}
                            title="Abrir portal do tribunal (copia o número antes)"
                          >
                            <ExternalLink className="h-3 w-3 mr-1.5" /> Abrir portal
                          </Button>
                        );
                      })()}
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

      {/* Modal de gerar cabeçalho */}
      {modalCabecalhoPub && (
        <GerarCabecalhoModal
          pub={modalCabecalhoPub}
          onFechar={() => setModalCabecalhoPub(null)}
          onUsarComoApelido={(nome) => {
            const base = modalCabecalhoPub.processoApelido || "";
            const sugestao = base ? `${base} - ${nome}` : nome;
            setEditandoApelido({
              processoId: modalCabecalhoPub.processoId,
              sugestao,
            });
          }}
          onToast={(t) => toast(t)}
        />
      )}
    </div>
  );
}
