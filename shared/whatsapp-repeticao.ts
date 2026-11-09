// Only provider-confirmed refusals may release a publication/recipient slot.
// Unknown, accepted, sent, delivered and ambiguous results stay blocked.
export function podeRepetirEnvio(v:{provedor?:string;status:string;erro_codigo:string|null;twilio_id?:string|null}){
 return v.provedor==='twilio' && v.status==='falha' && (
  (['20003','63007'].includes(v.erro_codigo||'') && v.twilio_id===null) || v.erro_codigo==='63016'
 );
}
