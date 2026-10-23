# Calendário e suspensões — importação assistida TJRJ

A aba **Calendário e suspensões** permite buscar um PDF oficial por URL, capturar o Caderno I Administrativo de uma data de publicação ou enviar o PDF baixado pelo administrador quando a fonte estiver indisponível. URLs são restritas a caminhos de documentos/consulta de três hosts oficiais do TJRJ, com validação a cada redirecionamento. PDFs obtidos por visualizador do DJERJ são resolvidos até o download do arquivo, sem executar scripts da página.

## Fluxo

1. Buscar o documento. O original PDF, hash SHA-256, endereço, método de aquisição, data da consulta e texto extraído ficam arquivados em tabelas privadas do Supabase. PDFs iguais não são duplicados e reimportar não reabre decisões já tomadas.
2. Conferir os trechos encontrados por palavras indicativas de feriados, suspensões, recesso, indisponibilidade e retificações. A extração não usa IA, não escolhe alcance nem confirma datas. Datas mencionadas podem ser datas de publicação ou assinatura. Zero candidatos não comprova ausência de atos.
3. Baixar o original para ler o contexto completo. Usar **Ler texto / criar proposta** se um ato não foi localizado ou se um trecho precisa ser dividido em mais de um ato.
4. Preencher ato, datas inicial/final inclusivas, motivo, alcance, local e efeito. Para alcance local, informar os quatro dígitos da origem CNJ. Publicações do STJ/STF não herdam uma suspensão local por terem processo de origem no RJ.
5. Confirmar leitura do original e justificar a decisão. Só a aprovação aplica a regra. Também é possível descartar o candidato ou revogar uma regra ativa, mantendo histórico.
6. Conferir a lista de impactos: guarda datas de publicação/início/fim antes e depois e destaca se a publicação já estava marcada como informada. Avisos não são reenviados, e o número de dias salvo pelo administrador não é alterado.

## Efeitos disponíveis

- **Dia não útil:** afeta publicação e contagem (feriado/ausência de expediente conforme ato conferido).
- **Suspensão da contagem:** não desloca por si só a publicação, mas exclui os dias da contagem processual e do início/vencimento. A opção de dias corridos existente no app continua sendo uma contagem processual; não serve como calculadora genérica de prazos materiais.
- **Apenas informativo:** não modifica cálculos. Usar para atos de alcance parcial (vara, sistema, classe, exceções específicas), que não são representáveis pelo filtro de origem, e para atos que apenas alterem horários sem efeito confirmado sobre o prazo.

A mesma rotina pura de datas é utilizada pelo card, texto copiado e histórico de recálculos. Durante indisponibilidade inicial do calendário, datas/cópia ficam bloqueadas. As regras confirmadas são atualizadas a cada minuto no painel aberto.

## Captura diária

O workflow `.github/workflows/calendario-tjrj.yml` captura o Caderno Administrativo às **05h30 de Brasília de segunda a sexta**, podendo sofrer atrasos do GitHub. Usa o secret `AUTH_AUTOMATION_TOKEN` já existente, limitado à rota `/api/calendario/coletar`: a automação não pode importar URLs arbitrárias, aprovar, rejeitar nem revogar regras.

Também executa quando o importador ou seu workflow é publicado na branch principal, com espera limitada pela nova implantação. Consulta uma janela de cinco dias corridos (somente datas de segunda a sexta) para rever arquivos já existentes e encontrar mudanças de conteúdo. Não é uma varredura de todo o arquivo histórico, nem garante descobrir republicações de qualquer data. Falhas, CAPTCHA, página inesperada, falta de edição ou PDF sem texto pesquisável não são tratados como sucesso; a consulta fica registrada como não confirmada e o workflow termina com falha. O último documento bem-sucedido permanece preservado. A captura não implica revisão jurídica nem calendário atualizado.

O calendário consolidado do Portal do Conhecimento começa com importação assistida por URL/arquivo. O host respondeu HTTP 503 durante o desenvolvimento; não há promessa de API pública ou disponibilidade. A importação manual do PDF é a alternativa nesta fase. PDFs escaneados precisam de OCR antes do envio.

## Limites e segurança

- Nesta primeira etapa os originais ficam no Postgres; o volume de PDFs deve ser acompanhado e migrado para armazenamento privado de arquivos antes de crescer além do plano contratado.
- Download até 8 MB; upload até 3 MB; até 350 páginas e 2 milhões de caracteres. Limites evitam exceder a execução serverless de 60 segundos e a requisição da Vercel. Documentos maiores devem ser divididos em arquivos menores mantendo a identificação das páginas originais na revisão.
- Até 250 trechos candidatos por documento; ao exceder, não arquiva um resultado parcial silencioso. Lista de propostas paginada, 50 por página; documentos recentes (30), consultas recentes (20) e impactos recentes (100). O original continua acessível pelo candidato correspondente.
- RLS e privilégios de clientes revogados em todas as tabelas novas. Somente o backend com sessão administrativa válida executa revisões. Download e texto dos originais também exigem sessão.
- Revisões são transacionais e serializadas por advisory lock. Uma falha em qualquer impacto reverte revisão, regra e histórico juntos. Rejeitar ou revogar não apaga o original.
- Atos com mesma identificação e alcance não podem ser aprovados duas vezes. Retificações/revogações não são interpretadas automaticamente: conferir o ato anterior e revogar explicitamente quando necessário.

## Escopo desta etapa

Não é uma auditoria completa do calendário-base anterior nem uma certificação automática de todos os prazos. A exceção confirmada de 30/10/2026 do TJRJ, incluída na correção anterior, permanece no baseline; ainda não é revogável pela nova tela. Calendários de outros tribunais, identificação de exceções por vara/sistema/classe, regras por matéria, investigação de indisponibilidades e notificações externas de retificação exigem etapas próprias. O histórico de impactos começa na implantação desta funcionalidade e não altera avisos enviados antes dela.

## Verificação

Testes: `npm run check`; `node --import tsx script/test-calendario.ts`; `node --import tsx script/test-calendario-revisao.ts`; `node script/test-calendario-pdf.mjs`; `node script/test-prazos.mjs`; `node script/test-whatsapp-order.mjs`; testes de autenticação e smoke test do handler da Vercel.

Validado localmente com PDF oficial do DJERJ de 23/10/2026: 135 páginas, mais de 720 mil caracteres e 23 trechos candidatos, sem aprovar nenhuma regra. Esse documento não foi inserido no banco de produção durante o desenvolvimento.
