# WhatsApp com Twilio

Novos envios do card usam a API da Twilio. A troca mantém a revisão, o consentimento, o histórico e o bloqueio de duplicidade. Não ativa disparos automáticos e não envia mensagens ao publicar o código.

## Ativação no servidor (Vercel → projeto painel-andamentos-backend → Settings → Environment Variables)

Configure no ambiente Production e faça um novo deploy:

| Variável | Valor |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | SID da conta ou subconta que possui o remetente, começando por AC |
| `TWILIO_AUTH_TOKEN` | Auth Token dessa mesma conta/subconta. Segredo exclusivo do servidor |
| `TWILIO_WHATSAPP_FROM` | Remetente habilitado para WhatsApp, por exemplo `whatsapp:+5521999999999` |
| `TWILIO_CONTENT_SID` | SID HX do modelo aprovado com as três variáveis descritas abaixo |
| `TWILIO_WEBHOOK_ORIGIN` | Opcional se AUTH_ORIGIN já for a URL pública correta. Usar `https://painel-andamentos-backend.vercel.app`, sem caminho nem parâmetros |

Não colocar Auth Token no código, no navegador, em prints ou na conversa. As credenciais antigas META_* não autorizam mais novos envios; só são usadas pelo callback histórico Meta. Não há fallback de envio para Meta.

A indicação “configurada” confirma os campos locais, não a validade da credencial, saldo, aprovação do remetente ou do modelo na Twilio. A validação real depende de um envio explicitamente autorizado após configurar a conta.

## Modelo no Content Template Builder

Criar um modelo com o mesmo texto da prévia do painel, em português:

```
Atualização do processo {{1}}.
Publicação: {{2}}
Curadoria: {{3}}
```

Variáveis: 1 = número CNJ, 2 = resumo revisado, 3 = curadoria revisada. Informar exemplos adequados e submeter à aprovação do WhatsApp pela Twilio. O SID HX desse modelo vai em TWILIO_CONTENT_SID. A prévia só corresponde ao envio se o modelo configurado tiver exatamente esse texto e essa ordem. Usamos ContentSid + ContentVariables, sem Body livre, pois os avisos podem iniciar conversa fora da janela de atendimento de 24 horas.

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

Testes: `node --import tsx script/test-twilio-whatsapp.ts`; testes históricos Meta permanecem para callbacks e compatibilidade. O teste do bundle Vercel verifica também o parser de formulário e a assinatura Twilio antes da sessão. Nenhum teste usa credenciais reais ou envia mensagens externas.

Fontes: https://www.twilio.com/docs/whatsapp/api ; https://www.twilio.com/docs/content/using-variables-with-content-api ; https://www.twilio.com/docs/usage/webhooks/webhooks-security ; https://www.twilio.com/docs/messaging/guides/track-outbound-message-status
