import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual clipboard handler, not a duplicated formatter.
const source = readFileSync("client/src/components/CardPublicacoes.tsx", "utf8");
const handler = source.slice(
  source.indexOf("  const copiarComContexto = async"),
  source.indexOf("\n  return (", source.indexOf("  const copiarComContexto = async")),
);
assert.ok(handler.includes("navigator.clipboard.writeText"));
const js = ts.transpile(handler, { target: ts.ScriptTarget.ES2022 });

async function message(anotacao, texto, pending = false) {
  let copied;
  let saves = 0;
  const sandbox = {
    pub: { id: 1, processoApelido: "Processo de teste", processoNumero: "123",
      tipoDocumento: "Despacho", dataDisponibilizacao: "2026-10-06",
      prazoDias: null, prazoTipo: null, texto },
    valor: anotacao, feriados: [], timerRef: { current: pending ? 1 : null },
    window: { clearTimeout() {}, setTimeout() {} },
    setSalvando() {}, onSalvar() { saves++; }, onToast() {},
    formatarCNJ: () => "0000000-00.2026.0.00.0000",
    formatarDataPub: () => "06/10",
    calcularDatasPrazo: () => ({ publicacaoStr: "07/10", inicioStr: "08/10" }),
    limparTexto: (value) => value || "",
    navigator: { clipboard: { async writeText(value) { copied = value; } } },
  };
  await vm.runInNewContext(
    js + "\ncopiarComContexto({stopPropagation(){}});", sandbox,
  );
  assert.equal(saves, pending ? 1 : 0);
  return copied;
}

const full = await message("Ação: Avaliar recurso.\nConferir documentos.", "Texto integral do despacho.", true);
assert.ok(full.indexOf("Prazo começa:") < full.indexOf("*Confira:*"));
assert.ok(full.indexOf("_Texto integral do despacho._") < full.indexOf("*Ação:* Avaliar recurso."));
assert.ok(full.includes("› Conferir documentos."));
assert.equal((full.match(/\*Ação:\*/g) || []).length, 1);
assert.ok(full.endsWith("› Conferir documentos.\n━━━━━━━━━━━━━━"));
assert.ok(!full.includes("https://"));
const noNote = await message("", "Texto integral.");
assert.ok(noNote.includes("_Texto integral._"));
assert.ok(!noNote.includes("*Ação:*"));
const noText = await message("Revisar prazo.", "");
assert.ok(!noText.includes("*Confira:*"));
assert.ok(noText.includes("*Ação:* Revisar prazo."));
const multiline = await message("Observação inicial.\nProvidenciar: Documentos.\nSegunda observação.", "Despacho.");
assert.ok(multiline.indexOf("_Despacho._") < multiline.indexOf("*Ação:* Documentos."));
assert.ok(multiline.includes("› Observação inicial.\n› Segunda observação."));
console.log("PASS: texto antes da recomendação; observações ao final; sem anotação; sem texto; debounce; formatação e ausência de link preservados.");
