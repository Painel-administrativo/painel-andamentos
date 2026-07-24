import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatarData } from "@/lib/cnj";
import type { DatajudMovimento } from "@shared/schema";

const PAGINA = 10;

export function Timeline({ movimentos }: { movimentos: DatajudMovimento[] }) {
  const [visiveis, setVisiveis] = useState(PAGINA);

  if (!movimentos || movimentos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4" data-testid="text-sem-movimentos">
        Nenhuma movimentação disponível. Atualize os andamentos.
      </p>
    );
  }

  const ordenados = [...movimentos].sort(
    (a, b) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime()
  );
  const lista = ordenados.slice(0, visiveis);

  return (
    <div className="pl-1">
      <ol className="relative border-l border-border ml-2" role="list">
        {lista.map((m, i) => (
          <li key={i} className="mb-5 ml-5" data-testid={`movimento-${i}`}>
            <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <time className="font-mono text-xs text-muted-foreground tabular-nums">
                {formatarData(m.dataHora)}
              </time>
              <span className="text-sm font-medium text-foreground">{m.nome}</span>
            </div>
            {m.complementosTabelados && m.complementosTabelados.length > 0 && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {m.complementosTabelados
                  .map((c) => c.nome || c.descricao)
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            {m.orgaoJulgador?.nome && (
              <p className="mt-0.5 text-xs text-muted-foreground">{m.orgaoJulgador.nome}</p>
            )}
          </li>
        ))}
      </ol>
      {visiveis < ordenados.length && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setVisiveis((v) => v + PAGINA)}
          data-testid="button-ver-mais"
          className="ml-2"
        >
          Ver mais ({ordenados.length - visiveis} restantes)
        </Button>
      )}
    </div>
  );
}
