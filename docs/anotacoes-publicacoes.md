# Orientações para o advogado

A anotação da publicação tem três campos opcionais: Ação necessária, Curadoria e Prompt para IA. A gravação continua automática no campo de anotação existente, usando marcadores textuais; não há alteração de schema ou migração dos dados salvos.

Textos antigos com marcadores são apresentados nos campos correspondentes. Texto antigo sem marcador fica em Curadoria, sem inferência de uma ação. O Prompt para IA fica por último e preserva instruções em várias linhas, inclusive exemplos que mencionem os nomes das seções.

Copiar pro WhatsApp inclui as seções preenchidas com títulos separados. A sugestão de prompt é escrita pelo operador para o advogado usar na própria IA; não há execução de IA, abertura de conversa ou envio automático.

O modelo Twilio de dez variáveis permanece compatível: quando preenchido, o prompt integra a décima variável, depois da curadoria, com o marcador Prompt para IA. É exibido na prévia editável do envio e conta nos limites existentes. A aprovação do template não é alterada por código.

Validação: script/test-anotacao-campos.ts cobre formato antigo, texto livre, marcadores com acentos e formatação, prompt em várias linhas, cópia manual e composição com dez variáveis. Testes de aviso Twilio, TypeScript, build e handler Vercel permanecem aplicáveis.
