# Preenche

Transforma planilhas (CSV e XLSX) em aplicações de consulta e preenchimento: importe o arquivo, revise a estrutura e os campos, publique e trabalhe em listas e fichas com histórico, controle de concorrência e exportação. O domínio (clientes, estoque, pacientes…) vem da configuração, não do código.

Escopo, decisões e limites da primeira versão: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

## Requisitos

- Node.js 22.12 ou superior
- PostgreSQL 15 ou superior (local em desenvolvimento; Neon ou equivalente em produção)

## Configuração

```sh
npm install
cp .env.example .env   # ajuste DATABASE_URL, BETTER_AUTH_SECRET (≥ 32 caracteres), APP_ORIGIN
createdb preenchexcel  # ou aponte DATABASE_URL para um banco existente
npm run db:migrate
npm run db:seed        # opcional: conta demo@example.test / demo123456 com um espaço pronto
npm run dev            # API em http://127.0.0.1:3001 e web em APP_ORIGIN (padrão http://localhost:5173)
```

Também é possível importar pelo link de uma planilha pública do Google Sheets (Compartilhar → “Qualquer pessoa com o link”); o link fica salvo para atualizar o conjunto depois, manualmente ou com sincronização automática (`SYNC_INTERVAL_MINUTES`, padrão 15; `0` desliga o agendador).

Arquivos de exemplo ficam em [public/examples](public/examples) (`clientes.csv` e `estoque.xlsx`, este com lista auxiliar, relação e aba de resumo). Regere-os com `npx tsx scripts/examples.ts`.

## Scripts

| Comando               | O que faz                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm run dev`         | API (tsx watch) e Vite com proxy de `/api`                                                           |
| `npm run typecheck`   | `tsc --noEmit` estrito                                                                               |
| `npm test`            | Vitest: conversão, diagnóstico, transações, permissões (PostgreSQL real)                             |
| `npm run test:e2e`    | Playwright: conta → importação → edição → recarga → exportação, com axe e larguras 320/768/1024/1440 |
| `npm run build`       | Tipagem, bundle do cliente (`dist/client`) e do servidor (`dist/server`)                             |
| `npm start`           | Servidor de produção (`NODE_ENV=production`), servindo API e cliente                                 |
| `npm run db:generate` | Gera migração a partir de `src/server/schema.ts`                                                     |
| `npm run db:migrate`  | Aplica migrações versionadas                                                                         |
| `npm run db:seed`     | Cria a conta de demonstração local (bloqueado em produção)                                           |
| `npm run format`      | Prettier                                                                                             |

Os testes usam o banco de `.env`; cada execução cria contas e espaços novos e não apaga dados. O e2e sobe `npm run dev` sozinho. Sem navegadores do Playwright instalados, use o Chrome local: `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` (ou `npx playwright install chromium`).

## Estrutura

```
src/shared/contracts.ts   contratos Zod compartilhados (campos, mapeamentos, confirmação)
src/server/               Express + Better Auth + Drizzle
  importer.ts             leitura CSV/XLSX, diagnóstico, proposta de mapeamento, preparação
  publish.ts              publicação atômica e idempotente do lote
  record-service.ts       edição com versão otimista, vínculos e revisão na mesma transação
  access.ts               verificação de espaço/conjunto/registro em toda rota
src/client/               React + Vite: painel, assistente de importação, listas, fichas, equipe
migrations/               SQL versionado (drizzle-kit)
tests/                    Vitest (API e conversão) e Playwright (tests/e2e)
```

## Produção

Uma instância Node serve API e cliente estático (`npm run build && NODE_ENV=production npm start`). Variáveis necessárias: `DATABASE_URL` (TLS), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` e `APP_ORIGIN` iguais à URL pública, `PORT`. Mutações exigem cabeçalho `Origin` igual a `APP_ORIGIN`; respostas de `/api` são `no-store`. Se o cliente for hospedado em outro domínio (ex.: Vercel com rewrite de `/api` para Render), `APP_ORIGIN` deve ser o domínio do cliente e a autenticação deve ser testada nesse domínio antes de liberar acesso.
