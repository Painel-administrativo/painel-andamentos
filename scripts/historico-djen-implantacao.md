# Histórico de atualizações do DJEN

1. Fazer backup e executar `scripts/2026-10-09-historico-djen.sql` no banco usado pelo backend, com o proprietário das tabelas.
2. Confirmar que a conta de conexão do backend pode inserir, atualizar e consultar `public.painel_djen_logs` e usar sua sequência.
3. Publicar a branch após a migração. O build Vercel gera a interface e `api/index.js`.
4. Entrar no painel e conferir o estado vazio. Na próxima coleta, verificar horário em Brasília, offset, contadores e detalhes. Não é necessário disparar coleta para testar o estado vazio.
5. Validar em homologação: lote sem erros, resposta inválida, HTTP 429 recuperado, falha persistente e interrupção antes do encerramento. Confirmar que o endpoint não é acessível sem sessão nem com o token de automação.

Cada POST de atualização registra um lote, não uma rodada diária inteira. Os registros anteriores da tabela `execucoes` não são importados: a origem deles ainda não foi identificada. O painel mostra até 200 lotes de sete dias; não remove registros do banco.

`Sem erros registrados` não certifica paginação/completude. HTTP 429 conta ocorrências de limitação, inclusive recuperadas; `Erros` conta processos com falha final. Uma execução interrompida fica sem término registrado. A coleta exige a tabela de logs: sem a migração, falha antes de consultar o DJEN. Se a gravação final falhar, a chamada não retorna sucesso.

Não são armazenados corpos de publicação, tokens ou mensagens de erro externas. Apenas IDs internos e códigos controlados de falha. O acesso utiliza a autenticação existente e RLS sem concessões a anon/authenticated.

Rollback: reverter o código da branch; manter a tabela para preservar o histórico. A migração não modifica dados de processos ou publicações.
