const ENTIDADES_HTML: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  // Minúsculas com acento agudo
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", yacute: "ý",
  // Maiúsculas com acento agudo
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Yacute: "Ý",
  // Minúsculas com til
  atilde: "ã", otilde: "õ", ntilde: "ñ",
  // Maiúsculas com til
  Atilde: "Ã", Otilde: "Õ", Ntilde: "Ñ",
  // Minúsculas com circunflexo
  acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û",
  // Maiúsculas com circunflexo
  Acirc: "Â", Ecirc: "Ê", Icirc: "Î", Ocirc: "Ô", Ucirc: "Û",
  // Minúsculas com grave
  agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù",
  // Maiúsculas com grave
  Agrave: "À", Egrave: "È", Igrave: "Ì", Ograve: "Ò", Ugrave: "Ù",
  // Trema
  auml: "ä", euml: "ë", iuml: "ï", ouml: "ö", uuml: "ü",
  Auml: "Ä", Euml: "Ë", Iuml: "Ï", Ouml: "Ö", Uuml: "Ü",
  // Cedilha e outros comuns em português/latim
  ccedil: "ç", Ccedil: "Ç", oslash: "ø", Oslash: "Ø",
  aring: "å", Aring: "Å", aelig: "æ", AElig: "Æ",
  szlig: "ß", ordm: "º", ordf: "ª",
  // Pontuação e símbolos
  hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„",
  para: "¶", sect: "§", copy: "©", reg: "®", trade: "™",
  deg: "°", middot: "·", bull: "•", times: "×", divide: "÷",
  euro: "€", pound: "£", yen: "¥", cent: "¢",
};

export function textoPublicacaoPlano(texto:string){
 return texto.replace(/<[^>]+>/g,' ').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(raw,n:string)=>{
  const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10);
  return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):raw;
 }).replace(/&([A-Za-z]+);/g,(raw,n:string)=>Object.prototype.hasOwnProperty.call(ENTIDADES_HTML,n)?ENTIDADES_HTML[n]:raw).replace(/\s+/g,' ').trim();
}
