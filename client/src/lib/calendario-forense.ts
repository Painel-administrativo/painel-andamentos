// Suspensões confirmadas por ato oficial. Aplicar somente ao tribunal indicado;
// não transformar ponto facultativo local em feriado nacional.
export const SUSPENSOES_CONFIRMADAS = [{
  tribunal: "TJRJ", data: "2026-10-30", ato: "Aviso TJRJ nº 290/2026",
  fonte: "https://www.tjrj.jus.br/web/portal-conhecimento/noticias/noticia/-/visualizar-conteudo/5736540/406979295",
}] as const;

export function feriadosParaTribunal(base: Set<string>, tribunal: string | null): Set<string> {
  const calendario = new Set(base);
  for (const suspensao of SUSPENSOES_CONFIRMADAS) {
    if (suspensao.tribunal === tribunal?.toUpperCase()) calendario.add(suspensao.data);
  }
  return calendario;
}
