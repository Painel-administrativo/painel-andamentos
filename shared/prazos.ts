export function formatarBR(d: Date): string {
  const dia = String(d.getUTCDate()).padStart(2, "0");
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  const ano = d.getUTCFullYear();
  return `${dia}/${mes}/${ano}`;
}

// É dia útil = não é fim de semana nem feriado.
export function ehDiaUtil(d: Date, feriados: Set<string>): boolean {
  const wd = d.getUTCDay(); // 0=domingo, 6=sábado
  if (wd === 0 || wd === 6) return false;
  const iso = d.toISOString().slice(0, 10);
  return !feriados.has(iso);
}

// Avança N dias úteis a partir de uma data (pulando fim de semana e feriados).
export function proximoDiaUtil(base: Date, pular: number, feriados: Set<string>): Date {
  const d = new Date(base.getTime());
  let restam = pular;
  while (restam > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (ehDiaUtil(d, feriados)) restam -= 1;
  }
  return d;
}

// Retorna { publicacao, inicio } calculadas a partir da data de disponibilização.
// Regra CPC art. 224 §3º: publicação = 1º dia útil seguinte à disponibilização;
// início do prazo = 1º dia útil seguinte à publicação.
// Agora considera feriados (Fase 4).
export function calcularDatasPrazo(dataDispIso: string, feriados: Set<string>, suspensoes: Set<string> = new Set()): {
  publicacao: Date;
  inicio: Date;
  publicacaoStr: string;
  inicioStr: string;
} | null {
  const s = dataDispIso.slice(0, 10);
  const [ano, mes, dia] = s.split("-").map(Number);
  if (!ano || !mes || !dia) return null;
  // Constrói em UTC pra evitar salto de fuso.
  const disp = new Date(Date.UTC(ano, mes - 1, dia));
  const pub = proximoDiaUtil(disp, 1, feriados);
  const inicio = proximoDiaUtil(pub, 1, feriados);
  while (suspensoes.has(inicio.toISOString().slice(0,10))) {
    inicio.setUTCDate(inicio.getUTCDate()+1);
    while (!ehDiaUtil(inicio,feriados)) inicio.setUTCDate(inicio.getUTCDate()+1);
  }
  return {
    publicacao: pub,
    inicio,
    publicacaoStr: formatarBR(pub),
    inicioStr: formatarBR(inicio),
  };
}

// Nome do dia da semana em pt-BR (ex: 'sexta').
const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export function diaSemanaBR(d: Date): string {
  return DIAS_SEMANA[d.getUTCDay()];
}

// Calcula quando o prazo termina.
// - dias úteis: dia 1 = 'inicio'; termina em (dias-1) dias úteis à frente.
//   Se cair em dia não útil (impossivel com essa lógica, mas defensivo), avança.
// - corridos: dia 1 = 'inicio'; termina em (dias-1) dias à frente.
//   Se cair em dia não útil, prorroga pro próximo útil (CPC art. 224 §1º).
export function calcularFimPrazo(
  inicio: Date,
  dias: number,
  tipo: "uteis" | "corridos",
  feriados: Set<string>,
  suspensoes: Set<string> = new Set()
): Date | null {
  if (!Number.isInteger(dias) || dias <= 0 || dias > 365) return null;
  const d = new Date(inicio.getTime());
  if (tipo === "uteis") {
    // Contamos o próprio 'inicio' como dia 1. Avançamos (dias - 1) dias úteis.
    let restam = dias - 1;
    while (restam > 0) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (ehDiaUtil(d, feriados) && !suspensoes.has(d.toISOString().slice(0,10))) restam -= 1;
    }
    return d;
  }
  // Corridos: soma calendário, com prorrogação se cair em não útil.
  let restam = dias - 1;
  while(restam > 0) {
    d.setUTCDate(d.getUTCDate()+1);
    if(!suspensoes.has(d.toISOString().slice(0,10))) restam--;
  }
  while (!ehDiaUtil(d, feriados) || suspensoes.has(d.toISOString().slice(0,10))) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

