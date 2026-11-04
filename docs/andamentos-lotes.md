# Atualização de andamentos em lotes

O botão de andamentos fixa os IDs selecionados no início e consulta até três processos por requisição. Os modos Todos, Só pendentes e 2º grau formam essa seleção inicial; mudanças posteriores de status ou cadastro não deslocam a lista. Processos removidos durante a execução são identificados como removidos, sem consultar outra posição em seu lugar.

A página mostra contagem de consultas confirmadas, sucessos, não encontrados, 2º grau, removidos e erros. A tabela continua visível. Os snapshots são gravados por processo e a lista é recarregada ao pausar, concluir ou ocorrer interrupção. A contagem de sucesso não equivale à garantia de atualização da fonte no tribunal.

**Pausar após este lote** aguarda a requisição em andamento, registra seu resultado e pausa. **Retomar atualização** continua a seleção salva no mesmo navegador, inclusive depois de recarregar a página. O progresso é salvo no localStorage sem credenciais, números processuais ou textos: contém somente IDs, posição, contadores e instantes. O navegador deve permitir armazenamento local e permanecer aberto durante a execução. Não é uma fila de execução em segundo plano.

Se houver falha de conexão, timeout ou resposta de lote incompleta, a posição não avança. Ao retomar, o lote não confirmado é consultado novamente. Isso pode repetir consultas/gravações de até três snapshots que já tivessem sido processados pelo servidor, sem duplicar processos nem enviar mensagens. As consultas anteriores confirmadas não são repetidas.

Depois de percorrer a seleção, **Reconsultar erros** cria uma nova seleção somente dos IDs com erro confirmado. **Encerrar acompanhamento** remove apenas o progresso salvo, preservando os resultados no banco. Navegadores com Web Locks impedem duas abas de executar a sequência simultaneamente; as abas acompanham as mudanças no progresso via evento storage.

Cada chamada ao DataJud tem timeout de 12 segundos, incluindo leitura da resposta. HTTP 524/429/5xx, JSON inválido, ausência de envelope válido e respostas de outro processo são erros inconclusivos, não “não encontrado”. As chamadas em lote não repetem automaticamente esses erros. O botão individual preserva as tentativas existentes, agora com limite de espera por chamada. Um resultado com erro preserva o JSON anterior do snapshot e registra a falha, sem apresentá-lo como consulta bem-sucedida.

## API

`POST /api/processos/atualizar` recebe `{ "ids": [1, 2, 3] }`, até três IDs únicos, e responde com resultados por ID. A seleção consulta somente os metadados desses processos, sem carregar todos os snapshots. O cliente valida a resposta completa antes de gravar o próximo checkpoint.

Os endpoints anteriores de pendentes/2º grau continuam disponíveis com lotes explícitos. Consumidores antigos que usavam uma chamada sem IDs nem limite recebem erro orientando a atualizar a página. A paginação explícita legada aceita limite máximo de três; para uma varredura estável de pendentes, usar IDs fixados no início, como faz a interface.

As regras existentes de sessão, origem e escopo das automações permanecem em vigor. Não há alterações em DJEN, WhatsApp, calendário ou agendamento. Não exige migração de schema.

Validação: `node --import tsx script/test-andamentos-lotes.ts`, TypeScript, testes de autenticação e builds. Teste PostgreSQL revertido verificou preservação do snapshot anterior em erro. Os testes não fazem uma nova varredura real de todos os processos.
