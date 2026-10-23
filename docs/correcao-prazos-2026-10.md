# Correção do prazo no card e no aviso copiado

## Caso reproduzido

Disponibilização: 23/10/2026; publicação: 26/10/2026; primeiro dia da contagem: 27/10/2026; duração informada pelo administrador: cinco dias úteis.

O cálculo anterior, sem a suspensão de 30/10, chegava a 03/11 (terça). O texto copiado formatava uma data de calendário UTC com getDate/getMonth locais e, em America/Sao_Paulo, exibiria 02/11, mantendo “terça” por usar getUTCDay. Isso explica exatamente o aviso recebido: “02/11 (terça)”.

## Correção

- Usar a mesma formatação UTC do card ao compor a data final no texto copiado. Não alterar o horário local do carimbo de envio nem timestamps de leitura/informação.
- Acrescentar 30/10/2026 somente ao calendário das publicações do TJRJ. Usar prioritariamente a sigla do tribunal da publicação; na ausência, inferir pelo CNJ. Assim, uma publicação do STJ em um processo originário do RJ não herda a suspensão local.
- Manter 28/10 como dia útil, pois não há bloqueio dessa data no calendário cadastrado.
- Não apresentar nem copiar datas calculadas antes do carregamento dos feriados. Oferecer nova tentativa em caso de falha na consulta.

Contagem corrigida: 27/10 (1), 28/10 (2), 29/10 (3), 03/11 (4), 04/11 (5). Dia 30/10: suspensão TJRJ. Dias 31/10 e 01/11: fim de semana. Dia 02/11: Finados, já cadastrado no banco.

Resultado: **04/11/2026 (quarta-feira)**, tanto no card quanto no texto copiado.

Fonte oficial: Aviso TJRJ nº 290/2026, divulgado em 15/10/2026: https://www.tjrj.jus.br/web/portal-conhecimento/noticias/noticia/-/visualizar-conteudo/5736540/406979295 .

## Escopo e validação

Os testes executam os próprios helpers e o próprio handler do botão Copiar, em UTC, America/Sao_Paulo e Asia/Tokyo, com o exemplo acima, prorrogação em dias corridos, duração de um dia, bloqueio sem calendário e isolamento da suspensão TJRJ.

Esta correção não constitui uma auditoria de todos os calendários: a tabela existente continua fornecendo os feriados nacionais e estaduais do RJ que já fornecia. Não foram adicionados todos os feriados municipais, calendários de outros tribunais ou regras de suspensão de recesso. O prazo depende também da duração/tipo informados pelo administrador e do meio de intimação aplicável; o app mantém neste card a regra de publicação no diário. O número de dias salvo não foi alterado e nenhum aviso externo foi enviado.
