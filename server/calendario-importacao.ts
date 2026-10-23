import {createHash} from "node:crypto";
import {extractText,getDocumentProxy} from "unpdf";
import {dataValida} from "../shared/calendario";
export const MAX_PDF=8_000_000;
export const hash = (v:string|Buffer)=>createHash("sha256").update(v).digest("hex");
export function urlOficial(valor:string) {
 const u=new URL(valor);
 const hosts=["www.tjrj.jus.br","portaltj.tjrj.jus.br","www3.tjrj.jus.br"];
 if(u.protocol!=="https:" || u.username || u.password || u.port || !hosts.includes(u.hostname) ||
   !/^\/(?:documents\/|web\/portal-conhecimento\/|consultadje\/|gedcacheweb\/)/i.test(u.pathname)) throw Error("Use um endereço HTTPS oficial de documento do TJRJ.");
 u.hash="";return u.toString();
}
export function linkCaderno(data:string) {
 if(!dataValida(data)) throw Error("Data inválida.");
 const [a,m,d]=data.split("-");return `https://www3.tjrj.jus.br/consultadje/pdf.aspx?dtPub=${d}/${m}/${a}&caderno=A&pagina=-1`;
}
function decodificar(s:string) {return s.replace(/&amp;/g,"&").replace(/&#38;/g,"&");}
export function pdfNoVisualizador(html:string,base:string) {
 const path=html.match(/id=["']hdnPrintUrl["'][^>]*value=["']([^"']+)["']/i)?.[1];
 if(!path) throw Error("A fonte não retornou um PDF reconhecível. Abra o documento no TJ e importe o arquivo.");
 return urlOficial(new URL(decodificar(path),base).toString());
}
export async function baixarDocumento(url:string,transport:typeof fetch=fetch) {
 let atual=urlOficial(url);
 const signal=AbortSignal.timeout(25_000);
 for(let passos=0;passos<5;passos++) {
  const r=await transport(atual,{redirect:"manual",signal,headers:{Accept:"application/pdf,text/html"}});
  if([301,302,303,307,308].includes(r.status)) {
   const to=r.headers.get("location");if(!to) throw Error("Redirecionamento sem destino.");
   await r.body?.cancel();atual=urlOficial(new URL(to,atual).toString());continue;
  }
  if(!r.ok) {await r.body?.cancel();throw Error(`Fonte indisponível (HTTP ${r.status}).`);}
  if(Number(r.headers.get("content-length")||0)>MAX_PDF) {await r.body?.cancel();throw Error("Documento excede 8 MB.");}
  const reader=r.body?.getReader();if(!reader) throw Error("Documento vazio.");
  const partes:Uint8Array[]=[];let size=0;
  try {while(true) {const {done,value}=await reader.read();if(done) break;size+=value.length;if(size>MAX_PDF) throw Error("Documento excede 8 MB.");partes.push(value);}}
  finally {await reader.cancel().catch(()=>{});}
  const bytes=Buffer.concat(partes);
  if(bytes.subarray(0,5).toString()==="%PDF-") return {bytes,url:atual};
  atual=pdfNoVisualizador(bytes.toString("utf8"),atual);
 }
 throw Error("Excesso de redirecionamentos/visualizadores.");
}
export function extrairPropostas(pages:string[]) {
 const out:{chave:string;pagina:number;trecho:string;sugestao:{ato:string;datas:string[]}}[]=[];
 for(let pagina=0;pagina<pages.length;pagina++) {
  const text=pages[pagina].replace(/\r/g,"");
  // Search for candidates, never infer the legal effect or geographic scope.
  const spans:{inicio:number;fim:number}[]=[];
  for(const m of Array.from(text.matchAll(/suspens[aã]o|suspend(?:er|e|em|endo)|feriado|ponto facultativo|recesso|indisponibilidade|retifica[çc][aã]o|revoga[çc][aã]o/gi))) {
   const inicio=Math.max(0,m.index!-450),fim=Math.min(text.length,m.index!+1350);
   const last=spans.at(-1);if(last && inicio<=last.fim) last.fim=Math.min(text.length,Math.max(last.fim,fim));else spans.push({inicio,fim});
  }
  for(const span of spans) {
   const trecho=text.slice(span.inicio,Math.min(span.fim,span.inicio+12000)).trim();
   const ato=trecho.match(/(?:ATO EXECUTIVO(?: CONJUNTO)?|AVISO(?: CONJUNTO)?|PORTARIA|RESOLU[ÇC][ÃA]O|PROVIMENTO|DECRETO)[^\n]{0,120}/i)?.[0]||"";
   const datas=Array.from(new Set(Array.from(trecho.matchAll(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/g)).map(m=>`${m[3]}-${m[2]}-${m[1]}`).filter(dataValida)));
   out.push({chave:hash(`${pagina+1}:${trecho}`),pagina:pagina+1,trecho,sugestao:{ato,datas}});
   if(out.length>=250) throw Error("Mais de 250 trechos candidatos: importe um documento menor ou páginas selecionadas.");
  }
 }
 return out;
}
export async function lerPdf(bytes:Buffer) {
 if(bytes.length>MAX_PDF || bytes.subarray(0,5).toString()!=="%PDF-") throw Error("Arquivo PDF inválido ou superior a 8 MB.");
 const pdf=await getDocumentProxy(new Uint8Array(bytes));
 try {
  if(pdf.numPages>350) throw Error("PDF excede 350 páginas. Divida o caderno para importar.");
  const r=await extractText(pdf,{mergePages:false});
  const text=r.text.join("\f");if(text.trim().length<50) throw Error("PDF sem texto pesquisável. É necessário OCR antes da importação.");
  if(text.length>2_000_000) throw Error("Texto do documento excede o limite de importação.");
  return {paginas:r.totalPages,texto:text,propostas:extrairPropostas(r.text)};
 } finally {await pdf.loadingTask.destroy();}
}
