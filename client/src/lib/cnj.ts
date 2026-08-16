// Utilitários para número CNJ e formatação de datas

export function normalizarNumero(numero: string): string {
  return (numero || "").replace(/[^\d]/g, "");
}

// Formata 20 dígitos como NNNNNNN-DD.AAAA.J.TR.OOOO
export function formatarCNJ(numero: string): string {
  const d = normalizarNumero(numero);
  if (d.length !== 20) return numero;
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
}

// Infere tribunal pelo segmento J.TR
// J = segmento do Poder Judiciário (5 = Justiça do Trabalho, 8 = Estadual, 4 = Federal)
// TR = tribunal dentro do segmento
export type Tribunal = "TJRJ" | "TRF2" | "TRT1";

export function inferirTribunal(numero: string): Tribunal | null {
  const d = normalizarNumero(numero);
  if (d.length !== 20) return null;
  const j = d.substring(13, 14);
  const tr = d.substring(14, 16);
  if (j === "8" && tr === "19") return "TJRJ";
  if (j === "4" && tr === "02") return "TRF2";
  if (j === "5" && tr === "01") return "TRT1";
  return null;
}

// Formata data ISO 8601 como dd/mm/aaaa
export function formatarData(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// Formata data+hora ISO como "dd/mm/aaaa às HH:mm" (padrão português)
export function formatarDataHora(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const data = d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const hora = d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${data} às ${hora}`;
}

// "Atualizado há X" — tempo relativo em português
export function tempoRelativo(iso?: string | null): string {
  if (!iso) return "nunca";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "nunca";
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.floor(h / 24);
  if (dias === 1) return "há 1 dia";
  if (dias < 30) return `há ${dias} dias`;
  return formatarData(iso);
}

// URL do portal do tribunal (nenhum aceita deep-link com número preenchido,
// mas o painel copia o CNJ pro clipboard antes de abrir).
// Para TRT1, passe grau="1g" ou "2g" pra escolher entre PJe 1º/2º grau.
// A consulta pública (sem login) do TRT1 só mostra decisões — pra ver petições
// das partes é preciso logar no PJe com certificado digital.
export function urlPortal(tribunal: string, numero: string, grau?: "1g" | "2g"): string {
  if (tribunal === "TRF2") {
    // e-Proc TRF2: consulta pública de processos (aceita chave/CPF/OAB também).
    // Não aceita deep-link com número — abre no formulário de busca.
    return "https://eproc.trf2.jus.br/eproc/externo_controlador.php?acao=processo_consulta_publica";
  }
  if (tribunal === "TRT1") {
    // PJe TRT1: acesso logado com token/certificado. Uma vez logado, acesso
    // completo aos autos (petições das partes, contestação etc.).
    // Não aceita deep-link — o painel copia o CNJ pro clipboard antes de abrir.
    return grau === "2g"
      ? "https://pje.trt1.jus.br/segundograu/login.seam"
      : "https://pje.trt1.jus.br/primeirograu/login.seam";
  }
  // TJRJ: Portal de Serviços (login com token/certificado). Uma vez logado,
  // acesso completo aos autos, inclusive segredo de justiça. Também não
  // aceita deep-link — o painel copia o CNJ pro clipboard antes de abrir.
  return "https://www3.tjrj.jus.br/idserverjus-front/#/login?indGet=true&sgSist=PORTALSERVICOS";
}

// Última movimentação (data ISO) do _source
export function ultimaMovimentacao(dados: any): { data: string | null; nome: string | null } {
  const movs = dados?.movimentos;
  if (!Array.isArray(movs) || movs.length === 0) {
    return { data: dados?.dataHoraUltimaAtualizacao ?? null, nome: null };
  }
  const ordenados = [...movs].sort(
    (a, b) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime()
  );
  return { data: ordenados[0].dataHora, nome: ordenados[0].nome };
}
