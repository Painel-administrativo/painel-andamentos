# Contatos e processos

Na aba **Contatos**, cadastre nome e WhatsApp. DDD e número brasileiros recebem o código 55; para outros países, informe + e o código do país. O cadastro mostra o número completo antes de salvar e impede duplicar o mesmo WhatsApp. Não importa automaticamente dados de clientes ou mensagens antigas.

Use **Vincular processos** para buscar por número/apelido e vincular ou desvincular. Um contato pode atender vários processos, e um processo pode ter vários contatos.

Em **Enviar WhatsApp**, os vinculados aparecem primeiro. Se houver um único contato vinculado, nome e número são preenchidos automaticamente ao abrir; com vários, escolha o destinatário. Também é possível selecionar outro contato cadastrado e vinculá-lo por essa janela, ou preencher manualmente. Nenhuma seleção ou vínculo dispara mensagem, e o consentimento/confirmação continuam obrigatórios.

Editar um contato atualiza suas seleções futuras. Excluir remove os vínculos, mas preserva o histórico independente de envios. Edições e exclusões usam controle de versão para impedir a perda de alterações simultâneas.

As tabelas painel_contatos e painel_processo_contatos têm RLS e acesso revogado aos papéis públicos. São acessadas pelo backend após a sessão administrativa; as rotas não são liberadas à chave de automação. Migração: scripts/contatos-processos.sql.

Validação: script/test-contatos.ts, script/test-production-auth.ts, TypeScript e builds. O teste transacional no banco verifica vínculos múltiplos e é revertido integralmente, sem contatos reais nem envios. Inspeções do catálogo confirmam as chaves, exclusão em cascata, RLS e privilégios revogados.
