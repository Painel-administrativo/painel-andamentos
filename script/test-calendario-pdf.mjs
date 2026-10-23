import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const dir=await mkdtemp(join(tmpdir(),'prazzo-pdf-'));
try{
 const output=join(dir,'pdf.cjs');
 await build({entryPoints:['server/calendario-importacao.ts'],bundle:true,platform:'node',target:'node22',format:'cjs',outfile:output,logLevel:'error'});
 const {lerPdf}=createRequire(import.meta.url)(output);
 const content='BT /F1 12 Tf 20 120 Td (AVISO TESTE 01/2026 - suspensao de prazos em 30/10/2026.) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
 let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const start=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(v=>String(v).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
 const r=await lerPdf(Buffer.from(pdf));assert.equal(r.paginas,1);assert.equal(r.propostas.length,1);assert.ok(r.texto.includes('30/10/2026'));
 console.log('PASS: PDF extraction and cleanup in a CJS bundle with the Vercel build settings.');
}finally{await rm(dir,{recursive:true,force:true});}
