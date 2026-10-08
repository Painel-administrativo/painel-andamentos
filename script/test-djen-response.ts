import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { DjenResponseError, lerRespostaDjen } from "../server/djen-response";

// Testa o handler real sem banco, credenciais ou consultas ao DJEN de produção.
const source = readFileSync("server/routes.ts", "utf8");
const start = source.indexOf('  app.post("/api/publicacoes/atualizar"');
const end = source.indexOf("\n  // === Publicação pública", start);
assert(start >= 0 && end > start);
const handlerCode = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 });
const publication = { hash: "teste-hash", data_disponibilizacao: "2026-10-08", tipoDocumento: "Despacho" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let checks = 0;

async function run(responses: Array<Response | Error>, options: { processes?: number; inserted?: number; storageError?: boolean } = {}) {
  const count = options.processes ?? 1;
  let handler: any;
  let result: any;
  let writes = 0;
  let requests = 0;
  const logs: string[] = [];
  const sandbox = {
    app: { post(_path: string, callback: unknown) { handler = callback; } },
    pool: { async query() { return { rows: Array.from({ length: count }, (_, i) => ({
      id: i + 1, numero: "50011467620204025115", apelido: "Processo de teste",
    })) }; } },
    storage: { async inserirPublicacoes(_id: number, items: unknown[]) {
      writes++;
      if (options.storageError) throw new Error("sensitive database detail");
      return { inseridas: options.inserted ?? items.length };
    } },
    async fetch(url: string, init: any) {
      assert(url.includes("itensPorPagina=50"));
      assert.equal(init.method, "GET");
      requests++;
      const response = responses.shift();
      assert(response, "Requisição inesperada");
      if (response instanceof Error) throw response;
      return response;
    },
    normalizarNumero: (number: string) => number.replace(/\D/g, ""),
    lerRespostaDjen, DjenResponseError, URLSearchParams,
    setTimeout(callback: () => void) { callback(); },
    console: { error(...args: unknown[]) { logs.push(args.join(" ")); } },
  };
  vm.runInNewContext(handlerCode, sandbox);
  let status = 200;
  const res = { status(value: number) { status = value; return this; }, json(value: unknown) { result = value; } };
  await handler({ query: { limite: "5", offset: "0", dias: "3" } }, res);
  assert.equal(status, 200, "Contrato paginado deve continuar compatível");
  assert.equal(result.processados, count);
  assert.equal(result.concluido, count < 5);
  assert.equal(result.proximoOffset, count);
  assert.equal(responses.length, 0);
  checks++;
  return { result, writes, requests, logs };
}

for (const envelope of [{ status: "success", items: [], count: 0 }, { items: [] }]) {
  const { result, writes } = await run([json(envelope)]);
  assert.equal(result.erros, 0);
  assert.equal(result.novasPublicacoes, 0);
  assert.equal(result.consultaCompleta, true);
  assert.equal(writes, 0);
}
const invalid = [
  () => new Response("<html>sensitive remote body</html>", { status: 200 }),
  () => new Response('{"items":', { status: 200 }),
  ...[null, [], {}, { message: "offline" }, { items: null }, { items: {} },
    { status: "error", items: [], count: 0 }, { error: "offline", items: [] },
    { items: [], count: 1 }, { items: [], count: -1 }, { items: [], count: "0" },
    { items: [null] }, { items: [{}] }, { items: [{ ...publication, hash: "" }] },
    { items: [{ ...publication, data_disponibilizacao: "2026-02-30" }] },
  ].map(body => () => json(body)),
];
for (const response of invalid) {
  for (const retry of [false, true]) {
    const { result, writes, logs } = await run(retry ? [json({}, 429), response()] : [response()]);
    assert.equal(result.erros, 1);
    assert.equal(result.errosRespostaInvalida, 1);
    assert.equal(result.erros429, retry ? 1 : 0);
    assert.equal(result.consultaCompleta, false);
    assert.equal(result.falhas.length, 1);
    assert.equal(result.falhas[0].processoId, 1);
    assert.equal(result.novasPublicacoes, 0);
    assert.equal(writes, 0);
    assert(!logs.join("").includes("sensitive"));
  }
}
for (const retry of [false, true]) {
  const response = json({ items: [publication], count: 1 });
  const { result, writes, requests } = await run(retry ? [json({}, 429), response] : [response]);
  assert.equal(result.erros, 0);
  assert.equal(result.novasPublicacoes, 1);
  assert.equal(result.consultaCompleta, true);
  assert.equal(result.erros429, retry ? 1 : 0);
  assert.equal(writes, 1);
  assert.equal(requests, retry ? 2 : 1);
}
const duplicate = await run([json({ items: [publication], count: 1 })], { inserted: 0 });
assert.equal(duplicate.result.erros, 0);
assert.equal(duplicate.result.consultaCompleta, true);
assert.equal(duplicate.result.novasPublicacoes, 0);
const emptyRetry = await run([json({}, 429), json({ items: [], count: 0 })]);
assert.equal(emptyRetry.result.erros, 0);
assert.equal(emptyRetry.result.consultaCompleta, true);
for (const responses of [[json({}, 500)], [json({}, 429), json({}, 429)], [new Error("sensitive network data")]]) {
  const { result, writes, logs } = await run(responses);
  assert.equal(result.erros, 1);
  assert.equal(result.consultaCompleta, false);
  assert.equal(writes, 0);
  assert(!logs.join("").includes("sensitive"));
}
const mixed = await run([json({ items: [] }), json({ broken: true }), json({ items: [publication] })], { processes: 3 });
assert.equal(mixed.result.erros, 1);
assert.equal(mixed.result.novasPublicacoes, 1);
assert.equal(mixed.result.consultaCompleta, false);
assert.equal(mixed.result.falhas[0].processoId, 2);
const dbError = await run([json({ items: [publication] })], { storageError: true });
assert.equal(dbError.result.erros, 1);
assert.equal(dbError.result.consultaCompleta, false);
assert(!dbError.logs.join("").includes("sensitive"));
console.log(`PASS: ${checks} cenários do handler DJEN, incluindo respostas inválidas, vazio válido, repetição 429, duplicatas, falha parcial e logs sem conteúdo remoto.`);
