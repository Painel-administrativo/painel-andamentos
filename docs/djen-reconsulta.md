# Reconsultar falhas DJEN

No Histórico de atualizações, cada consulta com falhas identificadas e ainda pendentes oferece **Reconsultar somente os processos com falha**. O botão consulta um processo por requisição, na janela original de datas registrada no banco, e permite interromper após a requisição em andamento. Não envia mensagens.

Apenas IDs de processos presentes nas falhas daquele registro concluído são aceitos. O servidor conserva o log original e vincula cada tentativa a ele. Se uma reconsulta já recuperou aquele processo, novas chamadas não fazem outra consulta à fonte. A interface indica a recuperação sem apagar as contagens e erros originais. Falhas sem identificação de processo exigem a atualização completa.

Cada chamada admite no máximo duas tentativas remotas, com timeout de 12 segundos por tentativa. Repete conexão/timeout, HTTP 5xx e 429, respeitando uma espera curta. Respostas malformadas, truncadas e falhas de gravação permanecem inconclusivas. A inserção existente por hash evita duplicar publicações.

O banco bloqueia reconsultas simultâneas para a mesma falha/processo. Tentativas sem término podem ser retomadas pelo registro de origem após 10 minutos, preservando a interrupção no histórico. O botão exige sessão autenticada e verificação de origem; a chave das automações não autoriza essa operação.

Aplicar `scripts/djen-reconsulta.sql` antes de publicar. A listagem mantém o limite de 200 registros dos últimos 7 dias; somente falhas disponíveis nessa listagem são oferecidas na interface. Não equivale a certificação da cobertura integral do DJEN.
