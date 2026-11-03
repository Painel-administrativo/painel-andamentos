# WhatsApp com Twilio

Novos envios do card usam a API da Twilio. A troca mantém a revisão, o consentimento, o histórico e o bloqueio de duplicidade. Não ativa disparos automáticos e não envia mensagens ao publicar o código.

## Ativação no servidor (Vercel → projeto painel-andamentos-backend → Settings → Environment Variables)

Configure no ambiente Production e faça um novo deploy:

| Variável | Valor |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | SID da conta ou subconta que possui o remetente, começando por AC |
| `TWILIO_AUTH_TOKEN` | Auth Token dessa mesma conta/subconta. Segredo exclusivo do servidor |
| `TWILIO_WHATSAPP_FROM` | Remetente habilitado para WhatsApp, por exemplo `whatsapp:+5521999999999` |
| `TWILIO_CONTENT_SID` | SID HX do modelo aprovado com as dez variáveis descritas abaixo |
| `TWILIO_WEBHOOK_ORIGIN` | Opcional se AUTH_ORIGIN já for a URL pública correta. Usar `https://painel-andamentos-backend.vercel.app`, sem caminho nem parâmetros |

Não colocar Auth Token no código, no navegador, em prints ou na conversa. As credenciais antigas META_* não autorizam mais novos envios; só são usadas pelo callback histórico Meta. Não há fallback de envio para Meta.

A indicação “configurada” confirma os campos locais, não a validade da credencial, saldo, aprovação do remetente ou do modelo na Twilio. A validação real depende de um envio explicitamente autorizado após configurar a conta.

## Modelo no Content Template Builder — aviso10

Criar o modelo `painel_aviso_processual`, em português do Brasil, com este texto exato:

```
Painel · Aviso · {{1}}
━━━━━━━━━━━━━━
{{2}} · Processo {{3}}
{{4}} · disponibilizada {{5}} · publicada {{6}}
Prazo começa: {{7}}

Confira o teor da comunicação processual:
{{8}}

Ação necessária: {{9}}
› Curadoria para acompanhamento: {{10}}
━━━━━━━━━━━━━━
Aviso de acompanhamento processual do Painel.
```

| Variável | Conteúdo |
| --- | --- |
| 1 | Data/hora da prévia em Brasília, DD/MM HH:mm |
| 2 | Identificação/apelido do processo |
| 3 | Número CNJ formatado |
| 4 | Tipo de documento |
| 5 | Data de disponibilização |
| 6 | Data de publicação calculada pelo calendário cadastrado |
| 7 | Início do prazo; inclui término calculado ou ajustado manualmente quando houver |
| 8 | Texto da comunicação revisado |
| 9 | Ação necessária revisada |
| 10 | Curadoria revisada |

Informar exemplos e submeter o modelo à aprovação do WhatsApp pela Twilio. O HX desse modelo de **dez variáveis** deve substituir qualquer HX antigo de três variáveis em TWILIO_CONTENT_SID. Modelos anteriores de três variáveis não correspondem à nova prévia.

A prévia busca os dados salvos no servidor e calcula as datas com feriados, suspensão confirmada para o tribunal e regras aprovadas. Mantém o ajuste manual do vencimento. O texto, a ação e a curadoria podem ser editados antes da confirmação. As variáveis são de uma linha; quebras e espaços do texto de origem são normalizados para a apresentação no modelo. Sem ação/curadoria cadastrada, o painel informa “Não definida.”/“Não informada.”, sem inventar providências.

O limite conservador de 1024 caracteres continua sendo aplicado à mensagem renderizada inteira. Se excedido, o revisor deve reduzir o texto antes de enviar; não há truncamento automático. O formato estático da prévia e as dez variáveis enviadas usam o mesmo compositor compartilhado entre cliente e servidor.

A prévia expira em 30 minutos. Antes da reserva e do envio, o servidor reconstrói o conteúdo de origem e recusa uma prévia se o processo, publicação, datas, prazo ou curadoria tiverem mudado. A revisão do texto completo e o consentimento do destinatário são confirmações separadas. A data/hora apresentada é a da prévia conferida.

Usamos ContentSid + ContentVariables, sem Body livre. Esta mudança **não habilita modo Sandbox sem Content SID**.

A Twilio é um provedor da plataforma WhatsApp Business: remetente e modelos continuam sujeitos à habilitação/aprovação do WhatsApp. O Sandbox tem participantes e modelos próprios; não é uma substituição direta para o modelo de produção. Não configure um HX de modelo de agendamento com variáveis de outro significado para enviar publicações.

## Retornos de entrega

Cada envio inclui automaticamente o StatusCallback:

```
https://painel-andamentos-backend.vercel.app/api/whatsapp/twilio/status/ID-DA-TENTATIVA
```

Não é necessário colar um ID manualmente no Console. O aplicativo gera essa URL por tentativa e a envia à API. O callback é POST application/x-www-form-urlencoded e usa X-Twilio-Signature, validada pelo SDK oficial com a origem pública configurada e todos os parâmetros recebidos. Não usa token de verificação nem challenge da Meta. O Auth Token precisa corresponder à conta que assina os callbacks.

O retorno deve corresponder a conta, tentativa, remetente, destinatário e MessageSid. Callbacks fora de ordem não rebaixam entrega/leitura. Eventos de fila e aceite não marcam “Informada”; somente confirmação de entrega/leitura faz isso. O ACK da API não sobrescreve um callback recebido antes dele.

Se a chamada externa ficar inconclusiva ou a gravação falhar depois do envio, a tentativa permanece bloqueada. Não há repetição automática. Conferir Messaging Logs da Twilio e o histórico antes de qualquer nova tentativa. A restrição única por publicação/número permanece global, inclusive para registros antigos Meta.

## Migração e validação

Aplicar `scripts/whatsapp-twilio.sql` antes do deploy. A migração conserva registros e IDs Meta e adiciona provedor, SID Twilio e conta. Não precisa expor tabelas pela API pública do Supabase.

Testes: `node --import tsx script/test-whatsapp-aviso10.ts && node --import tsx script/test-twilio-whatsapp.ts`; testes históricos Meta permanecem para callbacks e compatibilidade. O teste do bundle Vercel verifica também o parser de formulário e a assinatura Twilio antes da sessão. Nenhum teste usa credenciais reais ou envia mensagens externas.

Fontes: https://www.twilio.com/docs/whatsapp/api ; https://www.twilio.com/docs/content/using-variables-with-content-api ; https://www.twilio.com/docs/usage/webhooks/webhooks-security ; https://www.twilio.com/docs/messaging/guides/track-outbound-message-status
