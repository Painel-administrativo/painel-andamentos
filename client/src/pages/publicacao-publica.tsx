// Página pública isolada de uma publicação — usada nos links do WhatsApp.
// Rota: /#/pub/:idToken   (ex.: /#/pub/1234-abc123)
//
// Design deliberadamente minimalista:
// - Não mostra sidebar, lista de outros processos, ou qualquer link pro painel.
// - Não revela existência de outras publicações.
// - Se token inválido ou id inexistente: 404 amigável, sem pista.

import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { formatarCNJ } from "@/lib/cnj";

const API_BASE =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1")
    ? ""
    : "https://painel-andamentos-backend.vercel.app";

interface PublicacaoPublica {
  id: number;
  processoApelido: string | null;
  processoNumero: string;
  tipoDocumento: string | null;
  nomeOrgao: string | null;
  dataDisponibilizacao: string;
  texto: string | null;
  anotacao: string | null;
  prazoDias: number | null;
  prazoTipo: "uteis" | "corridos" | null;
}

interface Feriado {
  data: string;
}

// ---------- helpers de data/texto (versão local, desacoplada do CardPublicacoes) ----------

function formatarData(iso: string): string {
  const s = iso.slice(0, 10);
  const [ano, mes, dia] = s.split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}

function diaSemanaBR(d: Date): string {
  return ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()];
}

function ehDiaUtil(d: Date, feriados: Set<string>): boolean {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
  return !feriados.has(iso);
}

function proximoDiaUtil(base: Date, pular: number, feriados: Set<string>): Date {
  const d = new Date(base);
  let restam = pular;
  while (restam > 0) {
    d.setDate(d.getDate() + 1);
    if (ehDiaUtil(d, feriados)) restam--;
  }
  return d;
}

function calcularDatasPrazo(
  dispIso: string,
  feriados: Set<string>
): { publicacao: Date; inicio: Date } | null {
  const s = dispIso.slice(0, 10);
  const [a, m, dia] = s.split("-").map((x) => parseInt(x, 10));
  if (!a || !m || !dia) return null;
  // Date no fuso local, meio-dia pra evitar problema de DST
  const disp = new Date(a, m - 1, dia, 12, 0, 0);
  // Publicação = 1º dia útil após a disponibilização
  const publicacao = proximoDiaUtil(disp, 1, feriados);
  // Início do prazo = 1º dia útil após a publicação
  const inicio = proximoDiaUtil(publicacao, 1, feriados);
  return { publicacao, inicio };
}

function calcularFimPrazo(
  inicio: Date,
  dias: number,
  tipo: "uteis" | "corridos",
  feriados: Set<string>
): Date | null {
  if (!dias || dias < 1) return null;
  if (tipo === "uteis") {
    // Dia 1 = próprio início. Avança (dias-1) dias úteis.
    return proximoDiaUtil(inicio, dias - 1, feriados);
  }
  // Corridos: soma calendário e prorroga se cair em fds/feriado (CPC 224 §1º)
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + (dias - 1));
  while (!ehDiaUtil(fim, feriados)) {
    fim.setDate(fim.getDate() + 1);
  }
  return fim;
}

// Limpa entidades HTML básicas do texto (versão simplificada)
function limparTexto(t: string | null): string {
  if (!t) return "";
  return t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&([a-zA-Z]+);/g, (m) => m) // deixa as demais como estão
    .trim();
}

// ---------- página ----------

export default function PublicacaoPublica() {
  const [, params] = useRoute<{ idToken: string }>("/pub/:idToken");
  const [pub, setPub] = useState<PublicacaoPublica | null>(null);
  const [feriados, setFeriados] = useState<Set<string>>(new Set());
  const [estado, setEstado] = useState<"carregando" | "ok" | "nao_encontrada" | "erro">(
    "carregando"
  );

  useEffect(() => {
    const raw = params?.idToken || "";
    const sep = raw.lastIndexOf("-");
    if (sep < 1 || sep === raw.length - 1) {
      setEstado("nao_encontrada");
      return;
    }
    const idStr = raw.slice(0, sep);
    const token = raw.slice(sep + 1);
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id) || id <= 0 || !token) {
      setEstado("nao_encontrada");
      return;
    }

    (async () => {
      try {
        const [respPub, respFer] = await Promise.all([
          fetch(
            `${API_BASE}/api/publicacoes/${id}/publica?token=${encodeURIComponent(token)}`
          ),
          fetch(`${API_BASE}/api/feriados`),
        ]);
        if (respPub.status === 404) {
          setEstado("nao_encontrada");
          return;
        }
        if (!respPub.ok) {
          setEstado("erro");
          return;
        }
        const dados = (await respPub.json()) as PublicacaoPublica;
        setPub(dados);
        if (respFer.ok) {
          const jf = await respFer.json();
          const arr = (jf.items || []) as Feriado[];
          setFeriados(new Set(arr.map((f) => f.data)));
        }
        setEstado("ok");
      } catch {
        setEstado("erro");
      }
    })();
  }, [params?.idToken]);

  // ---------- render ----------

  if (estado === "carregando") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-sm text-muted-foreground">Carregando…</div>
      </div>
    );
  }

  if (estado === "nao_encontrada") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-2">
          <div className="text-lg font-medium text-foreground">Publicação não encontrada</div>
          <div className="text-sm text-muted-foreground">
            O link pode estar incorreto ou ter expirado.
          </div>
        </div>
      </div>
    );
  }

  if (estado === "erro" || !pub) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-2">
          <div className="text-lg font-medium text-foreground">Não foi possível carregar</div>
          <div className="text-sm text-muted-foreground">Tente novamente em alguns instantes.</div>
        </div>
      </div>
    );
  }

  const datasPrazo = calcularDatasPrazo(pub.dataDisponibilizacao, feriados);
  const cnj = formatarCNJ(pub.processoNumero);
  const texto = limparTexto(pub.texto);
  const anotacao = (pub.anotacao || "").trim();

  let fimPrazoStr: string | null = null;
  if (datasPrazo && pub.prazoDias && pub.prazoTipo) {
    const fim = calcularFimPrazo(datasPrazo.inicio, pub.prazoDias, pub.prazoTipo, feriados);
    if (fim) {
      const pad = (n: number) => String(n).padStart(2, "0");
      fimPrazoStr = `${pad(fim.getDate())}/${pad(fim.getMonth() + 1)}/${fim.getFullYear()} (${diaSemanaBR(fim)})`;
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-4 py-8 md:py-12 space-y-6">
        {/* Cabeçalho: apelido em destaque, CNJ como legenda */}
        <header className="space-y-1 border-b border-border pb-4">
          <h1 className="text-xl md:text-2xl font-semibold leading-tight">
            {pub.processoApelido || cnj}
          </h1>
          {pub.processoApelido && (
            <div className="text-xs font-mono text-muted-foreground">{cnj}</div>
          )}
        </header>

        {/* Metadados do documento */}
        <section className="space-y-1 text-sm">
          <div>
            <span className="text-muted-foreground">Documento: </span>
            <span className="font-medium">{pub.tipoDocumento || "Publicação"}</span>
          </div>
          {pub.nomeOrgao && (
            <div>
              <span className="text-muted-foreground">Órgão: </span>
              <span>{pub.nomeOrgao}</span>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Disponibilizada em: </span>
            <span>{formatarData(pub.dataDisponibilizacao)}</span>
          </div>
          {datasPrazo && (
            <>
              <div>
                <span className="text-muted-foreground">Publicada em: </span>
                <span>{formatarData(datasPrazo.publicacao.toISOString())}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Prazo começa em: </span>
                <span className="font-medium">
                  {formatarData(datasPrazo.inicio.toISOString())} ({diaSemanaBR(datasPrazo.inicio)})
                </span>
              </div>
            </>
          )}
          {fimPrazoStr && pub.prazoDias && pub.prazoTipo && (
            <div>
              <span className="text-muted-foreground">Prazo termina em: </span>
              <span className="font-medium">{fimPrazoStr}</span>
              <span className="text-muted-foreground text-xs ml-1">
                ({pub.prazoDias} dias {pub.prazoTipo})
              </span>
            </div>
          )}
        </section>

        {/* Anotação (curadoria do escritório) */}
        {anotacao && (
          <section className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Observações do escritório
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed p-3 rounded-md bg-muted/40 border border-border">
              {anotacao}
            </div>
          </section>
        )}

        {/* Texto integral */}
        {texto && (
          <section className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Texto integral da publicação
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed font-serif text-foreground/90">
              {texto}
            </div>
          </section>
        )}

        <footer className="pt-6 text-center text-xs text-muted-foreground border-t border-border">
          Painel de Andamentos · {new Date().getFullYear()}
        </footer>
      </div>
    </div>
  );
}
