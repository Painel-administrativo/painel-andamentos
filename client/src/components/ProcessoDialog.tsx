import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { normalizarNumero, inferirTribunal } from "@/lib/cnj";
import type { Processo } from "@shared/schema";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  processo?: Processo | null;
}

export function ProcessoDialog({ open, onOpenChange, processo }: Props) {
  const { toast } = useToast();
  const editing = !!processo;
  const [numero, setNumero] = useState("");
  const [tribunal, setTribunal] = useState<string>("TJRJ");
  const [apelido, setApelido] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setNumero(processo?.numero ?? "");
      setTribunal(processo?.tribunal ?? "TJRJ");
      setApelido(processo?.apelido ?? "");
      setObservacoes(processo?.observacoes ?? "");
    }
  }, [open, processo]);

  // Auto-infere tribunal ao digitar número (só na criação)
  useEffect(() => {
    if (!editing) {
      const inf = inferirTribunal(numero);
      if (inf) setTribunal(inf);
    }
  }, [numero, editing]);

  const numeroDigitos = normalizarNumero(numero);
  const numeroValido = numeroDigitos.length === 20;

  async function handleSave() {
    if (!numeroValido) {
      toast({
        title: "Número inválido",
        description: `O número deve ter 20 dígitos (você digitou ${numeroDigitos.length}).`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        numero: numeroDigitos,
        tribunal,
        apelido: apelido.trim() || null,
        observacoes: observacoes.trim() || null,
      };
      if (editing && processo) {
        await apiRequest("PATCH", `/api/processos/${processo.id}`, payload);
        toast({ title: "Processo atualizado" });
      } else {
        await apiRequest("POST", "/api/processos", payload);
        toast({ title: "Processo adicionado" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/processos"] });
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Erro ao salvar",
        description: e?.message ?? "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar processo" : "Adicionar processo"}</DialogTitle>
          <DialogDescription>
            Informe o número CNJ. Pontuação é opcional — normalizamos para 20 dígitos.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="numero">Número do processo</Label>
            <Input
              id="numero"
              data-testid="input-numero"
              placeholder="0003632-45.2020.8.19.0061"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              className="font-mono"
            />
            <span
              className={`text-xs ${numeroValido ? "text-muted-foreground" : "text-destructive"}`}
              data-testid="text-numero-status"
            >
              {numeroDigitos.length}/20 dígitos
            </span>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tribunal">Tribunal</Label>
            <Select value={tribunal} onValueChange={setTribunal}>
              <SelectTrigger id="tribunal" data-testid="select-tribunal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TJRJ">TJRJ — Tribunal de Justiça do RJ</SelectItem>
                <SelectItem value="TRF2">TRF2 — Tribunal Regional Federal 2ª Região</SelectItem>
                <SelectItem value="TRT1">TRT1 — Tribunal Regional do Trabalho 1ª Região (RJ)</SelectItem>
                <SelectItem value="TJSP">TJSP — Tribunal de Justiça de São Paulo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="apelido">Apelido (opcional)</Label>
            <Input
              id="apelido"
              data-testid="input-apelido"
              placeholder="Ex.: Usucapião Teresópolis"
              value={apelido}
              onChange={(e) => setApelido(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="observacoes">Observações (opcional)</Label>
            <Textarea
              id="observacoes"
              data-testid="input-observacoes"
              placeholder="Anotações internas sobre o processo"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-cancelar">
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving} data-testid="button-salvar">
            {saving ? "Salvando..." : editing ? "Salvar alterações" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
