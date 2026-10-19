# WhatsApp da Meta no Prazzo

A integração acrescenta **Enviar WhatsApp** ao lado de **Copiar pro WhatsApp**, em cada publicação. O administrador revisa o nome, o número com país/DDD, o resumo e a curadoria antes de confirmar. Esta versão envia um aviso por vez; a coleta diária DJEN não dispara mensagens automaticamente.

## Ativar na Vercel

Em Settings → Environment Variables do projeto backend, configurar em Production e fazer novo deploy:

| Variável | Valor |
| --- | --- |
| `META_WHATSAPP_TOKEN` | Token de acesso do usuário de sistema com acesso ao número e permissão `whatsapp_business_messaging`. Guardar como segredo. |
| `META_WHATSAPP_PHONE_NUMBER_ID` | ID do número de telefone na plataforma Meta (não é o número com DDD). |
| `META_GRAPH_VERSION` | Versão suportada da Graph API indicada no painel da Meta, no formato `vNN.0`. Obrigatória; não há versão antiga implícita. |
| `META_WHATSAPP_TEMPLATE` | Nome exato do modelo aprovado, por exemplo `prazzo_aviso_publicacao`. |
| `META_WHATSAPP_LANGUAGE` | Código do idioma aprovado. Padrão `pt_BR`. |
| `META_APP_SECRET` | Segredo do aplicativo Meta; valida assinaturas dos callbacks. |
| `META_WEBHOOK_VERIFY_TOKEN` | Segredo aleatório escolhido para verificar o webhook. Diferente do token de acesso e do App Secret. |

Não colocar esses segredos em variáveis `VITE_*`, no código ou em mensagens de chat. O endpoint de configuração informa apenas se a integração está preenchida; não testa validade/permissões do token nem aprovação do modelo.

## Modelo a submeter à Meta

Criar um modelo somente com corpo, sem cabeçalho, rodapé ou botões. Idioma: Português (Brasil). A aprovação e a classificação do modelo são decisões da Meta.

```text
Atualização do processo {{1}}.
Publicação: {{2}}
Curadoria: {{3}}
```

Exemplos fictícios para aprovação: `0000000-00.2026.8.19.0000`; `Despacho disponibilizado em 19/10/2026: apresentação de documentos.`; `Conferir os autos e providenciar os documentos solicitados.`

A integração envia os três parâmetros nessa ordem. Resumo até 500 caracteres, curadoria até 350, mensagem completa até 1.024. O formulário começa com tipo/data da publicação e a anotação atual. O administrador pode completar o resumo. O texto integral e o cálculo de prazo do botão Copiar continuam disponíveis separadamente. Não há truncamento silencioso nem envio livre fora de modelo.

## Webhook

- Callback URL: `https://painel-andamentos-backend.vercel.app/api/whatsapp/webhook`
- Verify token: mesmo valor de `META_WEBHOOK_VERIFY_TOKEN`.
- Assinar o campo `messages` do objeto WhatsApp Business Account e vincular o aplicativo à conta/número correto.
- GET valida o desafio. POST exige `X-Hub-Signature-256` válido sobre o corpo original, usando `META_APP_SECRET`.
- Confirmar na Vercel que a proteção de deploy não bloqueia o callback público de produção.

A resposta da API com um `wamid` significa **aceita**, não entregue. Os callbacks atualizam para enviada, entregue, lida ou falha. Eventos repetidos ou fora de ordem não rebaixam entrega/leitura. A publicação só recebe `informado_em` automaticamente após confirmação de entrega/leitura. O botão manual existente de marcar informada continua independente. Não são armazenadas mensagens recebidas dos assinantes.

## Banco e prevenção de duplicidade

`scripts/meta-whatsapp.sql` cria a tabela privada `painel_whatsapp_envios`, com RLS e sem acesso para `anon`/`authenticated`. O backend usa a conexão Postgres já existente. Migração aplicada no projeto Supabase em 19/10/2026.

A chave única `(publicacao_id, telefone)` reserva a tentativa antes de chamar a Meta, inclusive entre instâncias diferentes do backend. Não há reenvio automático nem botão de reenvio nesta versão. Após falha definitiva, um administrador técnico deve verificar o código, corrigir a causa e deliberadamente liberar uma nova tentativa; não apagar registros para reenvio enquanto o resultado for incerto. Em timeout, falha 5xx, resposta inesperada ou queda do processo, conferir a Meta antes de qualquer nova tentativa. Um registro “reservada” persistente exige a mesma conferência.

## Validação antes de uso

1. Aprovar o modelo e configurar os segredos; publicar o código.
2. Cadastrar o webhook e sua assinatura no campo `messages`.
3. Usar um número de teste explicitamente autorizado, confirmar a prévia e enviar um único aviso.
4. Conferir a transição aceita → entregue, a marcação de informada e o histórico.
5. Conferir que o mesmo aviso/número é bloqueado em uma segunda tentativa.

Testes locais: `node --import tsx script/test-meta-whatsapp.ts`, `npm run check`, `node --import tsx script/test-production-auth.ts`, `node script/test-whatsapp-order.mjs`, `node --import tsx script/build.ts`, `node script/build-api.mjs`, `node script/test-meta-bundle.mjs`.

Referências oficiais: https://developers.facebook.com/docs/whatsapp/cloud-api/ ; https://www.postman.com/meta/whatsapp-business-platform ; https://github.com/fbsamples/whatsapp-api-examples .
