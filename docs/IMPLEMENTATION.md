# Primeira versão

Escopo autorizado: ciclo real de conta → espaço → importação → revisão → publicação → consulta → edição → histórico → exportação, sem domínio fixo.

## Contratos e decisões

- React/Vite/TypeScript, Express, Better Auth, Drizzle e PostgreSQL. Produção usa DATABASE_URL (Neon compatível); desenvolvimento usa PostgreSQL local.
- Papéis por espaço: proprietário, editor e leitor. Projetos herdam estes papéis nesta versão. Somente proprietário gerencia membros (adicionar, alterar papel, remover) e exclui projetos (exclusão definitiva de conjuntos, registros, histórico e vínculos, em uma transação); proprietário/editor importam, criam e editam registros; todos consultam e exportam. Registros têm exclusão lógica (`deleted_at`): somem de listas, exportação e vínculos, ficam visíveis em “Ver excluídos”, podem ser restaurados e mantêm o histórico (revisões com ação `delete`/`restore`). Uma reimportação que traga a chave de um registro excluído o restaura como atualização.
- CSV UTF-8 e XLSX, até 5 MB por arquivo, 5 arquivos, 20 abas, 10 mil linhas de dados por lote, 100 colunas. Arquivos maiores são recusados antes da publicação. XLS/XLSM, macros e cálculos dinâmicos não fazem parte desta versão.
- Uma região retangular configurável por aba nesta versão; cabeçalho, início/fim de linhas e colunas revisáveis. Outras regiões exigem separar o arquivo. Nenhuma consolidação automática. Abas de resumo/listas são explicitamente classificadas. Fórmulas são fotografias somente leitura.
- Google Sheets: importação pelo link de planilhas públicas (“qualquer pessoa com o link”), via exportação XLSX de docs.google.com, host fixo e limite de 5 MB; sem OAuth nesta versão. O link fica salvo no conjunto e alimenta “Atualizar do Google Sheets” (revisão manual pela reconciliação) e a sincronização automática opcional por conjunto: agendador no processo (SYNC_INTERVAL_MINUTES, padrão 15) reaplica o último mapeamento com política “manter edições locais”; se o cabeçalho da aba mudar, nada é aplicado e o erro fica registrado. Autoria das alterações: quem ligou a sincronização.
- Configuração manual e diagnóstico determinístico local; nenhuma integração de IA ativa. Campos sugeridos são conservadores: número e sim/não quando toda a coluna tem esse tipo nativo, data apenas quando o Excel já trazia datas (ISO), identificadores sempre texto; ao escolher “seleção” na revisão, as opções partem dos valores distintos da coluna. Não corrigir, completar nem unir registros.
- Rascunhos armazenam os valores originais no banco por 24h; sem retenção do arquivo binário. Publicação preserva origem e mapeamento; rascunhos expirados são removidos nas próximas requisições de importação.
- Publicação é atômica e idempotente por lote. Reenvio divergente falha. Uma aba pode criar um conjunto novo ou atualizar um existente do mesmo projeto (reconciliação pela chave externa): inclui, atualiza e mantém ausentes; registros editados no Preenche desde a última importação só são sobrescritos com a política “usar o arquivo”. Nada é apagado por reimportação.
- Esquema publicado é imutável (versão 1); mudanças de tipo após publicação não são expostas.
- Chaves externas têm escopo no conjunto; chaves únicas e relações N:1 são verificadas antes de publicar. Vínculos explícitos referenciam IDs internos estáveis.
- Edições usam versão otimista; gravação e revisão compartilham a transação. Campos extras e campos calculados são rejeitados. Lista pagina/filtra/ordena no servidor.

## Verificação

Testes de conversão/diagnóstico, transações e permissões com PostgreSQL real; browser com fluxo de importação, edição e recarga; layout 320/768/1024/1440; auditoria de acessibilidade; build e tipagem estritos.

Estado em 17/09/2026: `npm run typecheck`, `npm test` (4 arquivos, 9 testes), `npm run build` e `npm run test:e2e` (fluxo completo com axe em 320/768/1024/1440) passam. Instruções de execução no README.

## Fronteiras de confiança

Uploads e campos são dados não confiáveis. Não executar fórmulas, SQL ou instruções das células. Autenticar e verificar espaço em toda rota; consultas parametrizadas; validar origem para mutações; cookies HttpOnly; respostas privadas sem cache; limites de upload/descompactação; CSV exportado neutraliza fórmulas. Não registrar conteúdo das planilhas em logs.

## Entregas posteriores

Google Sheets privado (OAuth), escrita de volta na planilha, IA assistiva com revisão de metadados, jobs persistentes para grandes arquivos, regiões múltiplas, edição versionada de esquemas, permissões por projeto/campo, cálculos dinâmicos, convites por e-mail, recuperação de senha e políticas organizacionais de retenção. Publicação Vercel/Render exige configuração de contas e teste de autenticação no domínio final.
