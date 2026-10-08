import type { DjenItem } from "@shared/schema";

export class DjenResponseError extends Error {
  constructor(public readonly codigo: string) {
    super(codigo);
    this.name = "DjenResponseError";
  }
}

// A lista vazia só é conclusiva quando veio de um envelope válido.
// Nunca inclua o corpo remoto nos erros/logs: ele pode conter dados processuais.
export async function lerRespostaDjen(response: Response): Promise<DjenItem[]> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new DjenResponseError("DJEN_JSON_INVALIDO");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DjenResponseError("DJEN_FORMATO_INVALIDO");
  }
  const envelope = body as Record<string, unknown>;
  if ((envelope.status !== undefined && envelope.status !== "success") ||
      envelope.error || envelope.erro || envelope.success === false) {
    throw new DjenResponseError("DJEN_ERRO_NO_ENVELOPE");
  }
  if (!Array.isArray(envelope.items)) {
    throw new DjenResponseError("DJEN_ITEMS_INVALIDOS");
  }
  if (envelope.count !== undefined &&
      (typeof envelope.count !== "number" || !Number.isSafeInteger(envelope.count) ||
       envelope.count < envelope.items.length ||
       (envelope.count > 0 && envelope.items.length === 0))) {
    throw new DjenResponseError("DJEN_CONTAGEM_INCONSISTENTE");
  }
  // Campos mínimos exigidos pelo armazenamento. Sem eles, inserirPublicacoes
  // ignoraria o item e uma resposta malformada poderia parecer "sem novidades".
  for (const item of envelope.items) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        typeof item.hash !== "string" || !item.hash.trim() ||
        typeof item.data_disponibilizacao !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(item.data_disponibilizacao) ||
        !Number.isFinite(Date.parse(item.data_disponibilizacao)) ||
        new Date(item.data_disponibilizacao).toISOString().slice(0, 10) !== item.data_disponibilizacao) {
      throw new DjenResponseError("DJEN_ITEM_INVALIDO");
    }
  }
  return envelope.items as DjenItem[];
}
