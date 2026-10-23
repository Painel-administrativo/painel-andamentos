# Relatórios assistidos por escritório

A aba **Relatórios** mantém seleções de casos por escritório, gera uma consulta independente do DJEN, permite revisão/curadoria do texto e copia o relatório para o WhatsApp. Esta etapa não envia mensagens, não agenda a remessa e não usa a integração Meta.

## Carteira inicial

A migração cria **CARTAXO & VILLA** e vincula exatamente os 13 números indicados pelo administrador, buscando os IDs dos cadastros existentes. Não duplica os processos. A migração é interrompida se não conseguir formar os 13 vínculos.

Editar seleção permite acrescentar/retirar CNJs já cadastrados em **Meus processos**. Outros escritórios podem ter seleções próprias e um processo pode pertencer a vários grupos. Relatórios arquivados preservam nome e carteira do momento da geração, independentemente de edições posteriores da seleção.

## Geração e referência

1. Escolher o escritório e período (padrão: últimos sete dias, inclusive hoje, no calendário de Brasília; até 31 dias por relatório).
2. Gerar e consultar. O servidor cria um retrato da seleção e congela, para cada caso, a última referência bem-sucedida de relatório **conferido** daquele grupo e número. Rascunhos, relatórios descartados e consultas inconclusivas não viram referência.
3. Coletar em lotes de três processos, com requisições paralelas de até 15 segundos cada. É possível pausar e continuar. Leases com token, expiração de 90 segundos e condição de estado evitam que uma resposta atrasada escreva em rascunho descartado ou substitua outra tentativa.
4. Revisar a cobertura, incluir curadoria e salvar a edição. A conferência exige aceitação explícita das consultas inconclusivas, quando houver.
5. Confirmar o relatório. O texto final fica preservado, com autoria e data, e os itens bem-sucedidos tornam-se referência da próxima comparação. Essa é uma referência de **relatório conferido**, não uma comprovação de entrega ao escritório.
6. Copiar o texto completo ou em partes de até 3.500 caracteres para facilitar a remessa manual. O registro “cópia registrada” não significa enviado ou recebido.

Há apenas um rascunho aberto por grupo. Um rascunho interrompido pode ser retomado; para refazer as consultas já concluídas, descarte-o e gere outro. O descarte preserva o histórico. Edições do texto usam versão otimista para impedir sobrescrita silenciosa por outra sessão.

## Fonte e comparação

Consulta a API Pública do DataJud/CNJ com o número CNJ e tribunal do cadastro. Não depende das publicações DJEN nem sobrescreve os snapshots antigos do painel de andamentos.

A consulta preserva todos os registros retornados para o número (graus/classes), em vez de escolher apenas o primeiro hit. Limite de 100 hits com contagem total exata; se houver truncamento, inconsistência de número, descrição/data inválida, HTTP inválido, timeout, histórico acima dos limites ou regressão da quantidade de movimentos, o caso fica **inconclusivo**, sem avançar sua referência.

Movimentos são identificados por hash estável do tribunal/grau e conteúdo do movimento, com complementos ordenados. Mudanças de classe ou órgão atuais não recriam a identidade de todo o histórico. Registros de graus distintos permanecem distintos. Correções no conteúdo do movimento podem aparecer como novos registros da fonte, cabendo revisão; não há inferência de novo ato judicial.

O primeiro relatório estabelece a referência: mostra os registros com data no período e o último movimento disponibilizado. Não despeja todo o histórico antigo como novidade. Comparações posteriores incluem novos registros identificados, mesmo com data anterior ao período, destacando a incorporação tardia. Itens com data posterior ao período são sinalizados e não são absorvidos como conhecidos na referência até o período os alcançar.

O relatório separa data da consulta da atualização declarada pela fonte. Esta última pode ser antiga e não prova, isoladamente, que o processo ficou parado ou que a base contém todos os atos do tribunal. O texto inclui a atribuição ao CNJ/DataJud e a ressalva de que ausência de novos registros não certifica ausência de andamento no TJ. O conteúdo da API é metadado processual, não o inteiro teor do processo.

## Limites, segurança e operação

- Até 100 casos por seleção; até 5 mil movimentos normalizados por consulta e 200 movimentos a relatar por caso. Descrições acima de quatro mil caracteres e respostas acima de 4 MB exigem conferência individual. Não há truncamento silencioso desses resultados.
- Relatório editável de até 200 mil caracteres. Carteiras com volume superior precisam ser divididas.
- Tabelas privadas com RLS e privilégios revogados de `anon`/`authenticated`. Somente a sessão administrativa existente acessa o recurso. A chave de automação não tem acesso a relatórios, carteiras, coleta, revisão ou cópia.
- O texto original calculado pode ser reconstituído dos itens arquivados; edições ficam no rascunho e a versão final confirmada é imutável pelas rotas existentes. Não se alteram os números de dias/prazos de publicações nem o histórico de mensagens Meta.
- O período é uma janela dos movimentos observados na consulta atual. Selecionar um período histórico não reconstrói uma consulta que não foi realizada naquela época.
- Não há consulta autenticada ao portal TJRJ/eproc/PJe, captura de inteiro teor, envio automático, agendamento semanal ou confirmação de recebimento nesta fase. Isso depende de validação posterior e dos dados/autorização do destinatário.

## Validação

`node --import tsx script/test-relatorios.ts`; `node --import tsx script/test-relatorios-coleta.ts`; verificações de autenticação; TypeScript; builds do frontend/backend e handler Vercel. Casos cobertos: referência inicial, ausência de novidades, registro antigo incorporado depois, dados futuros, reordenação, múltiplos graus, metadados de redistribuição, falhas/truncamento de fonte, preservação de referência, tokens de lease, partes do texto e período em Brasília.

Referências oficiais: https://www.cnj.jus.br/sistemas/datajud/api-publica/ e https://datajud-wiki.cnj.jus.br/api-publica/glossario/ .
