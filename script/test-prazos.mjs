import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";

if (!process.argv.includes("--caso")) {
  for (const TZ of ["UTC", "America/Sao_Paulo", "Asia/Tokyo"]) {
    const run = spawnSync(process.execPath, ["script/test-prazos.mjs", "--caso"], { env: {...process.env,TZ}, encoding: "utf8" });
    assert.equal(run.status, 0, `${TZ}: ${run.stderr || run.stdout}`);
    console.log(run.stdout.trim());
  }
} else {
  // Exercise the real card helpers and its actual clipboard handler.
  const source = readFileSync("client/src/components/CardPublicacoes.tsx", "utf8");
  const compile = text => ts.transpileModule(text, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const calendarContext = vm.createContext({exports:{},Set});
  vm.runInContext(compile(readFileSync("client/src/lib/calendario-forense.ts","utf8")),calendarContext);
  const {feriadosParaTribunal} = calendarContext.exports;
  const helpersContext = vm.createContext({});
  const helperSource = readFileSync("shared/prazos.ts", "utf8").replace(/export /g, "");
  vm.runInContext(compile(helperSource), helpersContext);
  const h = vm.runInContext("({calcularDatasPrazo,calcularFimPrazo,formatarBR,diaSemanaBR,ehDiaUtil})", helpersContext);
  const base = new Set(["2026-11-02"]);
  const feriados = feriadosParaTribunal(base,"TJRJ");
  assert.equal(base.has("2026-10-30"),false,"Do not mutate the shared base calendar");
  assert.equal(feriadosParaTribunal(base,"TJSP").has("2026-10-30"),false,"A TJRJ suspension is not nationwide");
  const datas=h.calcularDatasPrazo("2026-10-23",feriados);
  assert.equal(datas.publicacaoStr,"26/10/2026");
  assert.equal(datas.inicioStr,"27/10/2026");
  const fim=h.calcularFimPrazo(datas.inicio,5,"uteis",feriados);
  assert.equal(h.formatarBR(fim),"04/11/2026");assert.equal(h.diaSemanaBR(fim),"quarta");
  assert.equal(h.formatarBR(h.calcularFimPrazo(datas.inicio,1,"uteis",feriados)),"27/10/2026");
  assert.equal(h.formatarBR(h.calcularFimPrazo(datas.inicio,4,"corridos",feriados)),"03/11/2026","Calendar-day expiry on 30/10 extends past weekend and Finados");
  const old=h.calcularFimPrazo(h.calcularDatasPrazo("2026-10-23",base).inicio,5,"uteis",base);
  assert.equal(h.formatarBR(old),"03/11/2026","Reproduce the missing-suspension error separately from display timezone");
  let copied, toasted;
  const clipboard = source.slice(source.indexOf("  const copiarComContexto = async"), source.indexOf("\n  return (",source.indexOf("  const copiarComContexto = async")));
  const sandbox=vm.createContext({...h,
    pub:{id:1,processoApelido:"Processo de teste",processoNumero:"30013004420268190061",tipoDocumento:"Sentença",dataDisponibilizacao:"2026-10-23",prazoDias:5,prazoTipo:"uteis",texto:"Sentença de teste"},
    valor:"Avaliar embargos.",feriados,suspensoes: new Set(), calendarioDisponivel:true,timerRef:{current:null},
    formatarCNJ:()=>"3001300-44.2026.8.19.0061",formatarDataPub:()=>"23/10/2026",limparTexto:v=>v,
    onToast:t=>{toasted=t;},setSalvando(){},onSalvar(){},window:{clearTimeout(){},setTimeout(){}},
    navigator:{clipboard:{async writeText(value){copied=value;}}},
  });
  await vm.runInContext(compile(clipboard)+"\ncopiarComContexto({stopPropagation(){}})",sandbox);
  assert.ok(copied.includes("publicada 26/10/2026"));
  assert.ok(copied.includes("5 dias uteis → termina 04/11 (quarta)"));
  assert.ok(!copied.includes("termina 02/11"));
  assert.ok(copied.includes("Sentença de teste") && copied.includes("Avaliar embargos."));
  sandbox.calendarioDisponivel=false;copied=undefined;
  await vm.runInContext("copiarComContexto({stopPropagation(){}})",sandbox);
  assert.equal(copied,undefined);assert.equal(toasted.title,"Calendário indisponível");
  console.log(`PASS ${process.env.TZ}: 23/10 → publicada 26/10 → início 27/10 → 5 dias úteis 04/11 (quarta), card e texto copiado iguais, escopo TJRJ e calendário indisponível.`);
}
