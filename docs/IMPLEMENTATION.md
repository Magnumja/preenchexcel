# Primeira versão

Escopo autorizado: ciclo real de conta → espaço → importação → revisão → publicação → consulta → edição → histórico → exportação, sem domínio fixo.

## Contratos e decisões
- React/Vite/TypeScript, Express, Better Auth, Drizzle e PostgreSQL. Produção usa DATABASE_URL (Neon compatível); desenvolvimento usa PostgreSQL local.
- Papéis por espaço: proprietário, editor e leitor. Projetos herdam estes papéis nesta versão. Somente proprietário gerencia membros; proprietário/editor importam e editam; todos consultam e exportam.
- CSV UTF-8 e XLSX, até 5 MB por arquivo, 5 arquivos, 20 abas, 10 mil linhas de dados por lote, 100 colunas. Arquivos maiores são recusados antes da publicação. XLS/XLSM, macros e cálculos dinâmicos não fazem parte desta versão.
- Uma região retangular configurável por aba nesta versão; cabeçalho, início/fim de linhas e colunas revisáveis. Outras regiões exigem separar o arquivo. Nenhuma consolidação automática. Abas de resumo/listas são explicitamente classificadas. Fórmulas são fotografias somente leitura.
- Configuração manual e diagnóstico determinístico local; nenhuma integração de IA ativa. Campos sugeridos são conservadores. Não corrigir, completar nem unir registros.
- Rascunhos armazenam os valores originais no banco por 24h; sem retenção do arquivo binário. Publicação preserva origem e mapeamento; rascunhos expirados são removidos nas próximas requisições de importação.
- Publicação é atômica e idempotente por lote. Reenvio divergente falha. Nesta primeira versão a importação cria novos conjuntos; reimportação sobre registros existentes está indisponível até implementar reconciliação.
- Esquema publicado é imutável (versão 1); mudanças de tipo após publicação não são expostas.
- Chaves externas têm escopo no conjunto; chaves únicas e relações N:1 são verificadas antes de publicar. Vínculos explícitos referenciam IDs internos estáveis.
- Edições usam versão otimista; gravação e revisão compartilham a transação. Campos extras e campos calculados são rejeitados. Lista pagina/filtra/ordena no servidor.

## Verificação
Testes de conversão/diagnóstico, transações e permissões com PostgreSQL real; browser com fluxo de importação, edição e recarga; layout 320/768/1024/1440; auditoria de acessibilidade; build e tipagem estritos.

## Fronteiras de confiança
Uploads e campos são dados não confiáveis. Não executar fórmulas, SQL ou instruções das células. Autenticar e verificar espaço em toda rota; consultas parametrizadas; validar origem para mutações; cookies HttpOnly; respostas privadas sem cache; limites de upload/descompactação; CSV exportado neutraliza fórmulas. Não registrar conteúdo das planilhas em logs.

## Entregas posteriores
Google Sheets, IA assistiva com revisão de metadados, jobs persistentes para grandes arquivos, regiões múltiplas, reconciliação/reimportação, edição versionada de esquemas, permissões por projeto/campo, cálculos dinâmicos, convites por e-mail, recuperação de senha e políticas organizacionais de retenção. Publicação Vercel/Render exige configuração de contas e teste de autenticação no domínio final.
