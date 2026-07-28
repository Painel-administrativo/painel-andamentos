# Painel de Andamentos

Painel web para acompanhamento de processos judiciais brasileiros. Consulta automatizada de movimentações no Datajud (CNJ), com atualização diária agendada.

**Publicado em:** https://andamentos-cf.pplx.app

## Funcionalidades

- Cadastro individual e em lote de processos (TJRJ, TRF2)
- Consulta automática ao Datajud (CNJ) com retry
- Snapshot do histórico de movimentações por processo
- Botão de atualização individual (por processo) e em massa
- PWA — instalável no iPhone/Android/Desktop como app
- Modo escuro
- Atualização automática diária às 3h da manhã

## Stack

- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Express (Node.js)
- **Banco**: Supabase (Postgres gerenciado)
- **Hospedagem**: Perplexity Computer (pplx.app)
- **Fonte de dados**: [API Pública Datajud](https://datajud-wiki.cnj.jus.br/api-publica/acesso)

## Estrutura

```
painel-andamentos/
├── client/              # Frontend React
│   ├── src/
│   │   ├── pages/       # Páginas (Home, etc.)
│   │   ├── components/  # Componentes shadcn/ui + próprios
│   │   └── lib/         # queryClient (React Query)
│   └── public/          # Manifest PWA, ícones, service worker
├── server/              # Backend Express
│   ├── index.ts         # Entry point
│   ├── routes.ts        # Rotas da API
│   └── storage.ts       # Camada de dados (Supabase)
├── shared/              # Tipos compartilhados frontend/backend
│   └── schema.ts        # Tipos Processo, Snapshot, DatajudSource
├── script/build.ts      # Build de produção
└── vite.config.ts       # Config Vite
```

## Desenvolvimento local

Requer Node.js 20+.

```bash
# 1. Instalar dependências
npm install

# 2. Copiar .env.example para .env e preencher com credenciais do Supabase
cp .env.example .env

# 3. Iniciar dev server (frontend + backend na mesma porta)
npm run dev
```

Abra http://localhost:5000.

## Deploy

O deploy é feito via `pplx-tool publish_website`, passando credenciais Supabase como variáveis via proxy (não ficam no bundle). Ver histórico de conversas em Perplexity Computer.

## Banco de dados

Duas tabelas em Postgres:

**processos**
- id (bigint, PK)
- numero (text, unique) — 20 dígitos sem formatação
- tribunal (text) — "TJRJ" | "TRF2"
- apelido (text)
- observacoes (text)
- criado_em (timestamptz)

**snapshots**
- id (bigint, PK)
- processo_id (bigint, FK → processos, ON DELETE CASCADE)
- consultado_em (timestamptz)
- status (text) — "ok" | "nao_encontrado" | "erro"
- erro (text)
- dados_json (jsonb) — payload cru do Datajud

RLS desabilitado (backend é o único cliente).

## API

- `GET /api/processos` — lista todos os processos com último snapshot
- `POST /api/processos` — cria processo `{ numero, tribunal, apelido?, observacoes? }`
- `PATCH /api/processos/:id` — atualiza
- `DELETE /api/processos/:id` — remove (cascata em snapshots)
- `POST /api/processos/atualizar` — atualiza todos (30-90s)
- `POST /api/processos/:id/atualizar` — atualiza um só (com retry)

## Cronologia

- **2026-07-24**: Primeira versão publicada com SQLite local
- **2026-07-27**: Migração para novo sandbox após instabilidade
- **2026-07-28**: Migração para Supabase (persistência definitiva)

## Autor

Cesar Heitor Rodrigues de Faria
