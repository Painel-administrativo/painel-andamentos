import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { normalizarNumero, inferirTribunal, formatarCNJ } from "@/lib/cnj";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

interface ParsedLine {
  raw: string;
  numero: string;
  tribunal: "TJRJ" | "TRF2" | null;
  apelido: string | null;
  valido: boolean;
  motivo?: string;
}

function parseLinhas(texto: string, tribunalPadrao: "TJRJ" | "TRF2" | ""): ParsedLine[] {
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return linhas.map((raw) => {
    // separadores: pipe | tab | ; | vírgula
    const partes = raw.split(/[|\t;,]/).map((p) => p.trim());
    const numeroRaw = partes[0];
    const numero = normalizarNumero(numeroRaw);
    let tribunal: "TJRJ" | "TRF2" | null = null;
    let apelido: string | null = null;

    // Parte 2 pode ser tribunal
    if (partes[1]) {
      const up = partes[1].toUpperCase();
      if (up === "TJRJ" || up === "TRF2") tribunal = up;
      else apelido = partes[1];
    }
    // Parte 3 = apelido
    if (partes[2]) apelido = partes[2];

    // Se não veio tribunal explícito, infere pelo número
    if (!tribunal) tribunal = inferirTribunal(numero);
    // Fallback: tribunal padrão selecionado
    if (!tribunal && tribunalPadrao) tribunal = tribunalPadrao;

    let valido = true;
    let motivo: string | undefined;
    if (numero.length !== 20) {
      valido = false;
      motivo = `Número tem ${numero.length} dígitos (esperado 20)`;
    } else if (!tribunal) {
      valido = false;
      motivo = "Tribunal não identificado — selecione um padrão";
    }
    return { raw, numero, tribunal, apelido, valido, motivo };
  });
}

export function BulkAddDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const [texto, setTexto] = useState("");
  const [tribunalPadrao, setTribunalPadrao] = useState<"TJRJ" | "TRF2" | "">("");
  const [saving, setSaving] = useState(false);

  const parsed = useMemo(
    () => parseLinhas(texto, tribunalPadrao),
    [texto, tribunalPadrao]
  );
  const validos = parsed.filter((p) => p.valido);
  const invalidos = parsed.filter((p) => !p.valido);

  async function handleImport() {
    if (validos.length === 0) {
      toast({ title: "Nada para importar", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = validos.map((p) => ({
        numero: p.numero,
        tribunal: p.tribunal!,
        apelido: p.apelido,
        observacoes: null,
      }));
      const resp = await apiRequest("POST", "/api/processos", payload);
      const data = await resp.json();
      const criados = data.criados?.length ?? 0;
      const erros = data.erros?.length ?? 0;
      queryClient.invalidateQueries({ queryKey: ["/api/processos"] });
      toast({
        title: `${criados} processo(s) importado(s)`,
        description: erros > 0 ? `${erros} linha(s) com erro foram ignoradas.` : undefined,
      });
      setTexto("");
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Erro na importação", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Adicionar em lote</DialogTitle>
          <DialogDescription>
            Cole um número por linha. Formatos aceitos: <code className="font-mono text-xs">NUMERO</code>,{" "}
            <code className="font-mono text-xs">NUMERO|TRIBUNAL|APELIDO</code> ou colado direto da
            planilha (<code className="font-mono text-xs">NUMERO&#9;TRIBUNAL</code>). O tribunal é
            inferido pelo número quando possível.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <Textarea
            data-testid="input-lote"
            placeholder={"0003632-45.2020.8.19.0061\n5012345-67.2021.4.02.5101|TRF2|Mandado de Segurança\n00098765420198190001\tTJRJ"}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={8}
            className="font-mono text-sm"
          />

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Tribunal padrão (quando não identificado):</span>
            <Select value={tribunalPadrao || "auto"} onValueChange={(v) => setTribunalPadrao(v === "auto" ? "" : (v as any))}>
              <SelectTrigger className="w-40" data-testid="select-tribunal-padrao">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automático</SelectItem>
                <SelectItem value="TJRJ">TJRJ</SelectItem>
                <SelectItem value="TRF2">TRF2</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {parsed.length > 0 && (
            <div className="rounded-md border border-border bg-muted/40 max-h-52 overflow-auto">
              <div className="flex items-center gap-4 px-3 py-2 border-b border-border text-sm">
                <span className="flex items-center gap-1.5 text-primary">
                  <CheckCircle2 className="h-4 w-4" /> {validos.length} válido(s)
                </span>
                {invalidos.length > 0 && (
                  <span className="flex items-center gap-1.5 text-destructive">
                    <AlertTriangle className="h-4 w-4" /> {invalidos.length} com problema
                  </span>
                )}
              </div>
              <ul className="divide-y divide-border">
                {parsed.map((p, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
                    data-testid={`row-preview-${i}`}
                  >
                    <span className="font-mono truncate">
                      {p.numero.length === 20 ? formatarCNJ(p.numero) : p.raw}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {p.tribunal && <Badge variant="secondary">{p.tribunal}</Badge>}
                      {p.valido ? (
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      ) : (
                        <span className="text-xs text-destructive">{p.motivo}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-lote-cancelar">
            Cancelar
          </Button>
          <Button onClick={handleImport} disabled={saving || validos.length === 0} data-testid="button-lote-importar">
            {saving ? "Importando..." : `Importar ${validos.length} processo(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
