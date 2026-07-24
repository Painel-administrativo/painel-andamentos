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
export function inferirTribunal(numero: string): "TJRJ" | "TRF2" | null {
  const d = normalizarNumero(numero);
  if (d.length !== 20) return null;
  const j = d.substring(13, 14);
  const tr = d.substring(14, 16);
  if (j === "8" && tr === "19") return "TJRJ";
  if (j === "4" && tr === "02") return "TRF2";
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

// Formata data+hora ISO como dd/mm/aaaa HH:mm
export function formatarDataHora(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

// URL do portal do tribunal
export function urlPortal(tribunal: string, numero: string): string {
  if (tribunal === "TRF2") {
    return `https://processual.trf2.jus.br/consulta/numero?proc=${formatarCNJ(numero)}`;
  }
  // TJRJ não aceita número via query — abre a consulta pública
  return "https://www3.tjrj.jus.br/consultaprocessual/#/consultapublica";
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
