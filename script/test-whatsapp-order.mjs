import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual clipboard handler, not a duplicated formatter.
const source = readFileSync("client/src/components/CardPublicacoes.tsx", "utf8");
assert.ok(source.indexOf('data-testid={`texto-publicacao-${pub.id}`}') < source.indexOf("<AnotacaoBloco"),
  "O campo de anotações deve aparecer depois do texto integral no card.");
const handler = source.slice(
  source.indexOf("  const copiarComContexto = async"),
  source.indexOf("\n  return (", source.indexOf("  const copiarComContexto = async")),
);
assert.ok(handler.includes("navigator.clipboard.writeText"));
const js = ts.transpile(handler, { target: ts.ScriptTarget.ES2022 });

const anotacaoContext=vm.createContext({});
vm.runInContext(ts.transpile(readFileSync('shared/anotacao-campos.ts','utf8').replace(/export /g,''),{target:ts.ScriptTarget.ES2022}),anotacaoContext);
const anotacaoHelpers=vm.runInContext('({separarAnotacao,anotacaoParaWhatsApp})',anotacaoContext);

async function message(anotacao, texto, pending = false, manual = null) {
  let copied;
  let saves = 0;
  const sandbox = {
    ...anotacaoHelpers,
    pub: { id: 1, processoApelido: "Processo de teste", processoNumero: "123",
      tipoDocumento: "Despacho", dataDisponibilizacao: "2026-10-06",
      prazoDias: null, prazoTipo: null, prazoManual: manual, texto },
    suspensoes: new Set(), calendarioDisponivel: true, valor: anotacao, feriados: [], timerRef: { current: pending ? 1 : null },
    window: { clearTimeout() {}, setTimeout() {} },
    setSalvando() {}, onSalvar() { saves++; }, onToast() {},
    formatarCNJ: () => "0000000-00.2026.0.00.0000",
    formatarDataPub: () => "06/10",
    calcularDatasPrazo: () => ({ publicacaoStr: "07/10", inicioStr: "08/10" }),
    dataPrazoManual: v => new Date(`${v}T00:00:00Z`),
    formatarBR: d => d.toISOString().slice(0,10).split("-").reverse().join("/"),
    diaSemanaBR: () => "sexta",
    limparTexto: (value) => value || "",
    navigator: { clipboard: { async writeText(value) { copied = value; } } },
  };
  await vm.runInNewContext(
    js + "\ncopiarComContexto({stopPropagation(){}});", sandbox,
  );
  assert.equal(saves, pending ? 1 : 0);
  return copied;
}

const full = await message("Ação: Avaliar recurso.\nCuradoria: Conferir documentos.\nPrompt para IA: Analise a decisão com os documentos anexados.", "Texto integral do despacho.", true);
assert.ok(full.indexOf("Prazo começa:") < full.indexOf("*Confira:*"));
assert.ok(full.indexOf("_Texto integral do despacho._") < full.indexOf("*Ação necessária:* Avaliar recurso."));
assert.ok(full.includes("*Curadoria:* Conferir documentos."));
assert.ok(full.includes("*Prompt para IA:* Analise a decisão com os documentos anexados."));
assert.equal((full.match(/\*Ação necessária:\*/g) || []).length, 1);
assert.ok(full.indexOf("*Curadoria:*") < full.indexOf("*Prompt para IA:*"));
assert.ok(full.endsWith("Analise a decisão com os documentos anexados.\n━━━━━━━━━━━━━━"));
assert.ok(!full.includes("https://"));
const noNote = await message("", "Texto integral.");
assert.ok(noNote.includes("_Texto integral._"));
assert.ok(!noNote.includes("*Ação necessária:*"));
const noText = await message("Revisar prazo.", "");
assert.ok(!noText.includes("*Confira:*"));
assert.ok(noText.includes("*Curadoria:* Revisar prazo."));
const multiline = await message("Observação inicial.\nProvidenciar: Documentos.\nCuradoria: Segunda observação.", "Despacho.");
assert.ok(multiline.indexOf("_Despacho._") < multiline.indexOf("*Ação necessária:* Documentos."));
assert.ok(multiline.includes("*Curadoria:* Observação inicial.\nSegunda observação."));
console.log("PASS: texto antes da recomendação; observações ao final; sem anotação; sem texto; debounce; formatação e ausência de link preservados.");

const adjusted = await message("Avaliar recurso.", "Despacho.", false, "2026-11-06");
assert.ok(adjusted.includes("Prazo ajustado manualmente: termina 06/11/2026 (sexta)"));
assert.ok(!adjusted.includes("Prazo começa:"));
console.log("PASS: clipboard uses the saved manual deadline instead of the automatic date.");
