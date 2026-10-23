# Ajuste manual do vencimento

No card da publicação, **Ajustar prazo manualmente** abre o cálculo automático atual, a data manual vigente e o histórico das últimas 100 revisões. Informe a data final e uma justificativa de 10 a 1500 caracteres. Mesmo sem prazo em dias ou calendário disponível, é possível registrar uma data expressamente conferida. Datas em fim de semana geram aviso, sem impedir exceções deliberadas.

A data manual prevalece no card, no texto copiado, na prévia inicial do envio Meta e na página isolada da publicação. Ela não altera a publicação, o início da contagem, a quantidade de dias ou as regras do calendário. Mudanças de calendário e de dias não removem o ajuste. As revisões de calendário não registram alterações automáticas como mudanças do vencimento desses cards.

**Voltar ao cálculo automático** exige justificativa e remove somente a data manual vigente; mantém todo o histórico. O cálculo passa a considerar o calendário atual, podendo ficar indisponível enquanto esse calendário não carrega.

Se a publicação já foi informada, o revisor deve reconhecer que precisa comunicar a retificação. Salvar ou restaurar não envia mensagens e não apaga o registro de comunicação anterior.

O servidor exige sessão autenticada e proteção de origem; a chave de automação não autoriza ajustes nem leitura do histórico. A gravação da data e da revisão é transacional. Um contador de versão impede a sobreposição silenciosa de duas revisões. O histórico registra autor autenticado configurado no servidor, instante, data manual anterior/nova, justificativa, situação de comunicação e cálculo automático disponível naquele instante. A justificativa e o histórico são privados; a página de leitura recebe apenas a data manual e sua identificação.

Aplicar `scripts/prazo-manual.sql` antes do deploy. Nenhuma publicação existente recebe data manual automaticamente.
