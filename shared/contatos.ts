import {z} from 'zod';
export function telefoneContato(valor:string){
 const v=valor.trim();if(!/^[+\d\s().-]+$/.test(v)||v.slice(1).includes('+'))return null;
 let n=v.replace(/\D/g,'');
 if(!v.startsWith('+') && (n.length===10||n.length===11))n='55'+n;
 if(!/^[1-9]\d{7,14}$/.test(n))return null;
 if(n.startsWith('55')&&!/^55[1-9]\d{9,10}$/.test(n))return null;
 return n;
}
export const contatoInput=z.object({nome:z.string().trim().min(2).max(100),telefone:z.string().max(50).transform((v,ctx)=>{const n=telefoneContato(v);if(!n){ctx.addIssue({code:z.ZodIssueCode.custom,message:'Informe DDD e número ou o telefone internacional com + e código do país.'});return z.NEVER;}return n;})}).strict();
export type Contato={id:string;nome:string;telefone:string;versao:number;processos:number[]};
