# Estrutura técnica da aplicação Luminno Orçamentos

Este documento descreve a estrutura atual do repositório, a responsabilidade de cada área e como as funcionalidades se conectam. O projeto é uma aplicação web monolítica: o frontend React, a API tRPC/Express e o acesso MySQL vivem no mesmo repositório e são entregues juntos.

> **Fluxo principal:** `página React` → `cliente tRPC` → `procedimento do servidor` → `camada de banco/regra de negócio` → `MySQL` ou armazenamento local. Os arquivos compartilhados concentram cálculos e regras que precisam ter o mesmo comportamento no navegador e no servidor.

## 1. Visão geral da árvore de diretórios

```text
luminno-orcamentos/
├── client/                    # Frontend React/Vite/Tailwind
│   ├── public/                # Arquivos públicos pequenos de suporte
│   └── src/                   # Interface, páginas, componentes e utilitários
├── drizzle/                   # Modelo do banco e migrações versionadas MySQL
├── server/                    # API, autenticação, regras de negócio e persistência
│   ├── _core/                 # Infraestrutura do template: HTTP, tRPC e Vite
│   └── routers/               # Agrupamento de procedimentos da API
├── shared/                    # Tipos, cálculos, validações e regras reutilizadas
├── uploads/                   # Dados locais de imagens em desenvolvimento; não é código
├── dist/                      # Saída gerada pelo build de produção; não editar
├── .manus-logs/               # Logs locais do servidor e do navegador; não versionar
├── package.json               # Scripts, dependências e metadados do projeto
├── pnpm-lock.yaml             # Versões exatas das dependências instaladas
├── tsconfig.json              # Regras do TypeScript e aliases de importação
├── vite.config.ts             # Configuração do Vite e do build do frontend
├── vitest.config.ts           # Configuração dos testes automatizados
├── drizzle.config.ts          # Conexão e localização das migrações Drizzle
├── todo.md                    # Histórico verificável das tarefas executadas
└── *.md                       # Guias operacionais, implantação e documentação
```

As pastas `node_modules/`, `dist/`, `.git/` e `.manus-logs/` são geradas pelo ambiente ou pelas ferramentas. Elas não devem ser usadas para implementar regra de negócio.

## 2. Arquivos da raiz

| Arquivo ou diretório                 | Responsabilidade                                                | Funcionalidade relacionada                                                                                                |
| ------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                       | Define scripts e dependências.                                  | `pnpm dev` inicia o ambiente, `pnpm check` verifica tipos, `pnpm test` executa regressões e `pnpm build` gera a produção. |
| `pnpm-lock.yaml`                     | Fixa versões transitivas das bibliotecas.                       | Garante que desenvolvimento, homologação e VPS instalem as mesmas versões.                                                |
| `tsconfig.json`                      | Configura TypeScript e aliases como `@/`.                       | Tipagem estrita no cliente e servidor.                                                                                    |
| `vite.config.ts`                     | Configura Vite, alias e integração da aplicação.                | Empacotamento e atualização em desenvolvimento.                                                                           |
| `vitest.config.ts`                   | Configura Vitest.                                               | Regressões de componentes, regras de negócio, autenticação e integração.                                                  |
| `drizzle.config.ts`                  | Aponta Drizzle para o schema e para `DATABASE_URL`.             | Execução de migrações no MySQL.                                                                                           |
| `.gitignore`                         | Impede versionamento de artefatos locais e segredos.            | Proteção do repositório.                                                                                                  |
| `todo.md`                            | Lista histórica de requisitos e validações concluídas.          | Controle de escopo e auditoria do desenvolvimento.                                                                        |
| `guia-exportacao-vps-cloudflared.md` | Procedimento completo de exportação e instalação em VPS.        | MySQL, systemd, Cloudflare Tunnel, backups, uploads e PDFs privados.                                                      |
| `guia-implantacao-vps-ubuntu.md`     | Guia complementar de implantação Ubuntu.                        | Referência operacional de servidor.                                                                                       |
| `GUIA-ATUALIZACAO-PRODUCAO.md`       | Procedimento de atualização controlada de uma VPS já instalada. | Backup, Git, migrações, build, reinício e rollback.                                                                       |
| `ESTRUTURA-TECNICA-DA-APLICACAO.md`  | Este mapa técnico.                                              | Onboarding, manutenção e localização de funcionalidades.                                                                  |

## 3. Frontend: `client/`

O diretório `client/` contém toda a experiência visual. A interface é uma SPA em React 19, com Tailwind CSS e componentes de interface reutilizáveis.

### 3.1 Arquivos de inicialização

| Arquivo                | Para que serve                                             | Funcionalidade                                                                           |
| ---------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `client/index.html`    | Documento HTML inicial do Vite.                            | Carrega a aplicação React e metadados da página.                                         |
| `client/src/main.tsx`  | Ponto de entrada React.                                    | Cria a aplicação, configura Query Client e provedor tRPC.                                |
| `client/src/App.tsx`   | Define o roteamento e o gate de acesso.                    | Verifica sessão, mostra login/setup sem sessão e carrega as rotas protegidas com sessão. |
| `client/src/index.css` | Tokens globais, Tailwind, impressão e estilos responsivos. | Tema claro/escuro, tipografia, foco, layout de impressão A4 e padrões visuais.           |
| `client/src/const.ts`  | Constantes de uso do cliente.                              | Configurações e URLs auxiliares do frontend.                                             |

### 3.2 Páginas: `client/src/pages/`

Cada página representa uma rota funcional visível no menu ou uma tela de apoio.

| Arquivo                 | Rota principal                         | Responsabilidade e recursos                                                                                                                                                                          |
| ----------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DashboardPage.tsx`     | `/`                                    | Painel executivo com total aprovado, total orçado, abertos, ticket médio, distribuição por status, ranking de itens e alertas de validade.                                                           |
| `QuotesPage.tsx`        | `/orcamentos`                          | Lista de propostas; busca, filtros de status/validade, duplicação e criação de novo orçamento. Exibe estados de carregamento, vazio e falha recuperável.                                             |
| `QuoteEditorPage.tsx`   | `/orcamentos/novo` e `/orcamentos/:id` | Editor completo: cliente, ambientes, itens, reordenação, cálculo de totais, desconto, frete, PIX, parcelas, status, impressão, PDF, WhatsApp, separação de estoque e foco preservado durante edição. |
| `PdfHistoryPage.tsx`    | `/historico-pdfs`                      | Pesquisa e download autenticado de PDFs históricos de todos os orçamentos.                                                                                                                           |
| `FinancePage.tsx`       | `/financeiro`                          | Contas a receber, filtros, indicadores, cobranças avulsas, recebimentos parciais, estornos e cancelamentos.                                                                                          |
| `ProductsPage.tsx`      | `/catalogo`                            | Cadastro, busca, edição, arquivamento e upload de imagem de produtos; preço, código, unidade, fornecedor e ponto de reposição.                                                                       |
| `InventoryPage.tsx`     | `/estoque`                             | Saldos físico/reservado/disponível, filtros por fornecedor/estoque baixo, entradas, ajustes, devoluções, histórico e entregas parciais.                                                              |
| `OperationsPage.tsx`    | `/operacao`                            | Centro operacional com versionamento, leitor de código de barras, comentários internos, plantas/anexos autenticados e modelos por evento.                                                             |
| `CustomersPage.tsx`     | `/clientes`                            | Cadastro simplificado, pesquisa e histórico de orçamentos do cliente.                                                                                                                                |
| `SettingsPage.tsx`      | `/configuracoes`                       | Dados da empresa, logo local, PIX, desconto à vista, parcelamento, validade, condições comerciais e backup/importação JSON.                                                                          |
| `AdminPage.tsx`         | `/administracao`                       | Administração de usuários locais, papéis, ativação, redefinição de senha e diagnóstico do sistema. Exibida apenas a administradores.                                                                 |
| `AuthPage.tsx`          | Exibida pelo gate sem sessão           | Criação única do primeiro administrador e login local com validação de credenciais, feedback e rate limit.                                                                                           |
| `NotFound.tsx`          | Rotas inexistentes                     | Mensagem de página não encontrada e retorno seguro à navegação.                                                                                                                                      |
| `Home.tsx`              | Página demonstrativa do template       | Arquivo herdado do template; não concentra o fluxo operacional atual.                                                                                                                                |
| `ComponentShowcase.tsx` | Página demonstrativa                   | Catálogo interno de componentes; não é módulo de negócio.                                                                                                                                            |

Para cada página operacional que possui arquivo `*.test.tsx`, o teste correspondente cobre comportamentos críticos da interface. Exemplos: `QuoteEditorPage.test.tsx`, `FinancePage.test.tsx`, `ProductsPage.test.tsx`, `InventoryPage.test.tsx`, `CustomersPage.test.tsx`, `SettingsPage.test.tsx`, `QuotesPage.test.tsx` e `PdfHistoryPage.test.tsx`.

### 3.3 Componentes próprios: `client/src/components/`

| Arquivo                       | Responsabilidade                            | Funcionalidade                                                                |
| ----------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| `DashboardLayout.tsx`         | Casca protegida da aplicação.               | Menu lateral, cabeçalho, navegação, troca de tema, dados do usuário, logout e acesso ao centro operacional. |
| `DashboardLayoutSkeleton.tsx` | Esqueleto visual do layout.                 | Evita salto de tela enquanto dados de acesso carregam.                        |
| `ErrorBoundary.tsx`           | Captura erros de renderização React.        | Evita página em branco e oferece recuperação visual.                          |
| `QuoteFinancePanel.tsx`       | Painel reutilizável de contas do orçamento. | Exibe parcelas e ações financeiras dentro do editor.                          |
| `AIChatBox.tsx`               | Componente herdado do template.             | Não é parte do fluxo operacional principal atual.                             |
| `Map.tsx`                     | Componente herdado de mapas.                | Não é parte do fluxo operacional principal atual.                             |
| `ManusDialog.tsx`             | Adaptador de diálogo do template.           | Base de interação modal onde aplicável.                                       |

#### Componentes de interface: `client/src/components/ui/`

Esta pasta contém os componentes visuais reutilizáveis inspirados no ecossistema shadcn/Radix. Eles não implementam regras de orçamento, estoque ou pagamento; fornecem comportamento e acessibilidade consistentes para botões, campos, diálogos, menus e tabelas.

| Grupo de arquivos         | Exemplos                                                                                                                            | Para que serve                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Ações e formulários       | `button.tsx`, `input.tsx`, `textarea.tsx`, `label.tsx`, `checkbox.tsx`, `switch.tsx`, `select.tsx`, `radio-group.tsx`, `slider.tsx` | Entradas de dados, botões e seleção acessíveis.             |
| Estrutura e apresentação  | `card.tsx`, `table.tsx`, `tabs.tsx`, `accordion.tsx`, `separator.tsx`, `badge.tsx`, `avatar.tsx`, `skeleton.tsx`                    | Organização visual, tabelas e estados de carregamento.      |
| Sobreposições e feedback  | `dialog.tsx`, `alert-dialog.tsx`, `drawer.tsx`, `popover.tsx`, `tooltip.tsx`, `sonner.tsx`, `spinner.tsx`                           | Modais, confirmações, mensagens e indicadores de progresso. |
| Navegação e comandos      | `sidebar.tsx`, `dropdown-menu.tsx`, `navigation-menu.tsx`, `command.tsx`, `breadcrumb.tsx`, `pagination.tsx`                        | Menu lateral, navegação e comandos contextuais.             |
| Controles especializados  | `calendar.tsx`, `carousel.tsx`, `chart.tsx`, `input-otp.tsx`, `input-group.tsx`, `scroll-area.tsx`, `resizable.tsx`                 | Datas, gráficos, agrupamentos e áreas roláveis.             |
| Utilitários de composição | `form.tsx`, `field.tsx`, `item.tsx`, `toggle.tsx`, `toggle-group.tsx`, `button-group.tsx`, `collapsible.tsx`                        | Padronização de formulários e interações compostas.         |
| Testes de UI              | `formAccessibility.test.tsx`                                                                                                        | Regressão dos componentes de campo e nomes acessíveis.      |

### 3.4 Bibliotecas, contexto, hooks e testes de cliente

| Caminho                                | Responsabilidade                                | Funcionalidade                                                          |
| -------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| `client/src/lib/trpc.ts`               | Cliente tRPC tipado.                            | Conecta cada página aos procedimentos do backend.                       |
| `client/src/lib/format.ts`             | Formatação visual de números, moedas e datas.   | Exibição consistente em painéis, listas e documentos.                   |
| `client/src/lib/quotePdf.ts`           | Preparação/geração do PDF no navegador.         | Exportação de orçamento e integração com histórico.                     |
| `client/src/lib/printPreparation.ts`   | Preparação da impressão.                        | Aguarda renderização/imagens, mostra feedback e evita ações duplicadas. |
| `client/src/lib/utils.ts`              | Utilitários gerais, como composição de classes. | Base para componentes visuais.                                          |
| `client/src/contexts/ThemeContext.tsx` | Estado de tema claro/escuro.                    | Alternância persistida de aparência.                                    |
| `client/src/hooks/useMobile.tsx`       | Detecta breakpoint móvel.                       | Ajustes de layout e interação responsiva.                               |
| `client/src/hooks/useComposition.ts`   | Trata composição de texto.                      | Digitação confiável em campos e idiomas que usam IME.                   |
| `client/src/hooks/usePersistFn.ts`     | Mantém referências estáveis de callbacks.       | Previne renderizações e efeitos indesejados.                            |
| `client/src/test/formAccessibility.ts` | Helper reutilizável de teste.                   | Detecta inputs, textareas e selects sem nome acessível.                 |
| `client/src/lib/*.test.ts`             | Testes de PDF e impressão.                      | Impedem regressões no preparo de documento e geração.                   |

## 4. Backend: `server/`

O backend recebe chamadas tRPC do cliente, valida os dados com Zod, aplica regras de autorização e grava dados no MySQL. Também gerencia arquivos locais e a rota autenticada de PDF.

### 4.1 Inicialização e infraestrutura: `server/_core/`

| Arquivo                                                                                                                                     | Responsabilidade                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `index.ts`                                                                                                                                  | Inicializa Express, tRPC, Vite/arquivos estáticos, diretórios de uploads e PDFs, rota autenticada de download e servidor HTTP. |
| `trpc.ts`                                                                                                                                   | Cria procedimentos públicos, protegidos e administrativos.                                                                     |
| `context.ts`                                                                                                                                | Monta o contexto de cada requisição, incluindo usuário autenticado.                                                            |
| `cookies.ts`                                                                                                                                | Centraliza atributos seguros de cookies de sessão.                                                                             |
| `env.ts`                                                                                                                                    | Lê e normaliza configurações de ambiente fornecidas pela plataforma.                                                           |
| `vite.ts`                                                                                                                                   | Configura a entrega do Vite em desenvolvimento e dos arquivos compilados em produção.                                          |
| `systemRouter.ts`                                                                                                                           | Procedimentos base da infraestrutura.                                                                                          |
| `oauth.ts`, `sdk.ts`, `dataApi.ts`, `storageProxy.ts`, `llm.ts`, `map.ts`, `notification.ts`, `voiceTranscription.ts`, `imageGeneration.ts` | Adaptadores herdados do template para integrações da plataforma; não são o caminho principal do Luminno local.                 |
| `heartbeat.ts`                                                                                                                              | Base para agendamentos da plataforma, se forem adotados no futuro.                                                             |
| `types/`                                                                                                                                    | Declarações de tipos usadas pela infraestrutura.                                                                               |

Esses arquivos são infraestrutura de baixo nível. Em geral, novas regras de negócio devem ser escritas em `server/routers/`, `server/*Db.ts` e `shared/`, sem alterar `_core/`.

### 4.2 Roteadores de API: `server/routers/`

| Arquivo                | Responsabilidade                   | Procedimentos e módulos                                                                                                                            |
| ---------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routers.ts`           | Ponto de composição da API.        | Publica `auth`, `admin` e todos os grupos do roteador comercial.                                                                                   |
| `routers/localAuth.ts` | Autenticação local.                | Status de configuração, criação do primeiro administrador, login, usuário atual, logout e troca de senha própria.                                  |
| `routers/admin.ts`     | Administração protegida por papel. | Saúde do sistema, lista/criação/edição de usuários e redefinição de senha.                                                                         |
| `routers/business.ts`  | Contratos dos módulos comerciais.  | Dashboard, clientes, catálogo, orçamentos, PDF, financeiro, estoque, configurações e backup. Valida cada entrada com Zod antes de acionar o banco. |

Os principais grupos expostos em `business.ts` são `customers`, `product`, `quote`, `finance`, `inventory`, `settings` e `backup`. As páginas React chamam esses nomes pelo cliente tRPC.

### 4.3 Persistência e regras de negócio do servidor

| Arquivo             | Responsabilidade                                            | Funcionalidade                                                                                                                           |
| ------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `quoteDb.ts`        | Núcleo comercial e persistência principal.                  | Clientes, produtos, orçamentos completos, duplicação, ambientes, itens, reservas, PDF histórico, dashboard, alertas e backup/importação. |
| `stockDb.ts`        | Regras transacionais de estoque.                            | Saldos, movimentos, estoque disponível, reservas automáticas, entregas parciais e pendências.                                            |
| `financeDb.ts`      | Contas a receber e movimentações financeiras.               | Criação de parcelas, cobranças avulsas, recebimentos, estornos, cancelamentos, filtros e indicadores.                                    |
| `localUserDb.ts`    | Persistência de usuários locais.                            | Criação, busca, edição, ativação, papéis e redefinição de senha.                                                                         |
| `localAuth.ts`      | Criptografia e ciclo de sessão.                             | Hash de senha com scrypt, validação, criação/verificação de JWT, expiração de 12 horas e usuário seguro para o cliente.                  |
| `loginRateLimit.ts` | Proteção contra tentativas repetidas.                       | Limite por usuário/IP, janela de 15 minutos, bloqueio temporário e chave derivada de segredo.                                            |
| `localStorage.ts`   | Armazenamento de arquivos locais.                           | Upload seguro de imagens, PDFs e anexos, validação de tamanho, escrita atômica e resolução protegida de caminhos.                        |
| `db.ts`              | Inicialização e helpers genéricos de conexão Drizzle/MySQL. | Acesso à conexão do banco e funções base.                                                                                                |
| `advancedDb.ts`      | Persistência dos recursos operacionais.                    | Versões, comentários, anexos, modelos por evento, consulta e cadastro de códigos de barras.                                               |
| `storage.ts`        | Adaptador de armazenamento herdado do template.             | Referência de integração de arquivos quando necessária; o fluxo local usa `localStorage.ts`.                                             |

### 4.4 Testes do servidor

| Arquivo de teste                    | Regressão coberta                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `auth.logout.test.ts`               | Limpeza correta do cookie de sessão.                                                                     |
| `auth.rateLimit.test.ts`            | Chave de rate limit válida, ausente ou curta, janela e bloqueio.                                         |
| `localAuth.login.test.ts`           | Login tRPC real, cookie HTTP-only e erro de segredo inválido.                                            |
| `localAuth.test.ts`                 | Hash, validação e sessão local.                                                                          |
| `localAuthorization.test.ts`        | Proteção de rotas e papéis administrativos.                                                              |
| `localStorage.pdf.test.ts`          | Validação e persistência do PDF privado.                                                                 |
| `localStorage.attachment.test.ts`   | Limites, persistência e proteção de caminhos dos anexos.                                                    |
| `OperationsPage.test.tsx`           | Recursos operacionais, nomes acessíveis e consulta pelo leitor USB.                                          |
| `quoteApproval.integration.test.ts` | Fluxo integrado: produto, entrada, aprovação, reserva, entrega parcial, parcelas, recebimento e estorno. |

## 5. Banco de dados e migrações: `drizzle/`

O schema é a fonte de verdade do modelo de dados. As migrações numeradas são o histórico versionado que cria e evolui as tabelas MySQL de forma previsível.

| Arquivo ou grupo            | Responsabilidade                   | Dados ou funcionalidade                                                                                                                                     |
| --------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.ts`                 | Declara tabelas e tipos Drizzle.   | Usuários, clientes, produtos, orçamentos, ambientes, itens, histórico de PDF, contas a receber, pagamentos, reservas, movimentos, entregas e configurações. |
| `0000_*.sql` a `0007_*.sql` | Migrações incrementais.            | Criação e evolução do schema, incluindo autenticação local, estoque, histórico de PDF e financeiro.                                                         |
| `0008_gifted_junta.sql`      | Migração dos recursos operacionais. | Código de barras, versões, comentários, anexos e modelos por evento.                                                                                       |
| `meta/_journal.json`        | Ordem de aplicação das migrações.  | Controle interno do Drizzle.                                                                                                                                |
| `meta/*_snapshot.json`      | Estado do schema em cada migração. | Referência técnica para gerar novas migrações.                                                                                                              |
| `relations.ts`              | Relações auxiliares do Drizzle.    | Navegação tipada entre entidades quando utilizada.                                                                                                          |
| `migrations/.gitkeep`       | Mantém diretório auxiliar no Git.  | Estrutura de projeto.                                                                                                                                       |

As entidades têm a seguinte relação operacional:

```text
Cliente ──< Orçamento ──< Ambiente ──< Item de orçamento >── Produto
                  │                        │
                  │                        ├── Reserva de estoque
                  │                        └── Entrega parcial
                  ├── Histórico de PDF
                  └── Parcelas financeiras ──< Recebimentos / Estornos

Produto ──< Movimentação de estoque
```

## 6. Regras compartilhadas: `shared/`

Os arquivos deste diretório não fazem chamadas HTTP ou SQL. Eles concentram funções puras, tipos e validações usadas pelos dois lados da aplicação, o que reduz divergências de cálculo e comportamento.

| Arquivo                         | Responsabilidade                    | Funcionalidade                                                                  |
| ------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| `types.ts`                      | Tipos de domínio compartilhados.    | Contratos de clientes, produtos, orçamentos e itens.                            |
| `const.ts`                      | Constantes compartilhadas.          | Valores de sessão e configuração comum.                                         |
| `quote.ts`                      | Cálculos de orçamento.              | Subtotais, descontos, frete, PIX, total e parcelas.                             |
| `quoteDraft.ts`                 | Estrutura e edição do rascunho.     | Criação/manipulação de ambientes e itens antes de salvar.                       |
| `quoteStatus.ts`                | Regras de status.                   | Filtros e interpretação de rascunho, aberto, aprovado e rejeitado.              |
| `quoteAlerts.ts`                | Regras de vencimento.               | Identifica propostas pendentes próximas da validade, vencendo hoje ou vencidas. |
| `dashboardMetrics.ts`           | Cálculos de indicadores.            | Métricas por status, ticket médio e ranking.                                    |
| `stock.ts`                      | Regras aritméticas de estoque.      | Saldo físico, reservado, disponível e pendências.                               |
| `stockFilters.ts`               | Filtros de estoque.                 | Fornecedor e quantidade abaixo do limite.                                       |
| `finance.ts`                    | Regras financeiras.                 | Parcelas, status, valores recebidos e saldo aberto.                             |
| `picking.ts`                    | Consolidação de separação.          | Agrupa itens por produto, quantidade e ambiente.                                |
| `pickingPrint.ts`               | Documento operacional de separação. | Monta saída imprimível com descrição completa.                                  |
| `whatsapp.ts`                   | Texto comercial.                    | Gera proposta formatada para copiar e enviar pelo WhatsApp.                     |
| `formValidation.ts`             | Validação de formulários.           | Regras de login, números e mensagens amigáveis.                                 |
| `publicBranding.test.ts`        | Regressão de identidade.            | Evita reintroduzir créditos ou marca de terceiros.                              |
| `localUiResponsiveness.test.ts` | Regressão de UX responsiva.         | Contratos básicos do layout local.                                              |
| `*_test.ts`                     | Testes unitários das regras acima.  | Preservam cálculos, filtros, alertas, status e formatações.                     |
| `_core/errors.ts`               | Tipos de erro compartilhados.       | Padronização interna de falhas.                                                 |

## 7. Armazenamento de arquivos e dados locais

| Local                 | Conteúdo                                                             | Regra de segurança                                                                         |
| --------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `uploads/`            | Imagens de produto e logo em desenvolvimento/local.                  | Servido em `/uploads`; em VPS deve apontar para diretório persistente externo ao checkout. |
| `pdf-history/` na VPS | PDFs já gerados.                                                     | Diretório privado, não servido estaticamente; download apenas pelo endpoint autenticado.   |
| `dist/`               | Aplicação compilada.                                                 | É recriado pelo build; nunca guardar dados de negócio aqui.                                |
| MySQL                 | Dados comerciais, financeiros, estoque, usuários e metadados de PDF. | Backup por dump consistente e credenciais fora do repositório.                             |

## 8. Fluxos técnicos das funcionalidades principais

| Funcionalidade            | Caminho técnico resumido                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Login e logout            | `AuthPage` → `auth.login/logout` → `routers/localAuth.ts` → `localAuth.ts`, `localUserDb.ts` e cookie HTTP-only.            |
| Orçamento                 | `QuotesPage`/`QuoteEditorPage` → `quote.*` → `business.ts` → `quoteDb.ts` → tabelas de orçamento, ambientes e itens.        |
| Aprovação e reserva       | Editor salva status aprovado → `quoteDb.ts` valida saldo → cria reservas → `stockDb.ts` calcula disponibilidade.            |
| Estoque e entrega parcial | `InventoryPage` → `inventory.move/deliver` → `stockDb.ts` → movimentos, entregas e atualização de saldo.                    |
| Financeiro                | `FinancePage` ou painel do orçamento → `finance.*` → `financeDb.ts` → parcelas, recebimentos e estornos.                    |
| PDF                       | Editor → `quotePdf.ts` e `printPreparation.ts` → `quote.savePdf` → `localStorage.ts` → arquivo privado + `quotePdfHistory`. |
| Imagens e logo            | Catálogo/Configurações → upload tRPC → `localStorage.ts` → arquivo validado em `/uploads`.                                  |
| Backup                    | `SettingsPage` → `backup.export/import` → `quoteDb.ts` → JSON dos dados comerciais.                                         |
| Administração             | `AdminPage` → `admin.*` → `routers/admin.ts` e `localUserDb.ts`, protegido por `adminProcedure`.                            |

## 9. Onde alterar cada tipo de necessidade

| Necessidade de manutenção        | Arquivos que normalmente devem ser avaliados                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Nova tela ou ajuste de navegação | `client/src/pages/`, `client/src/App.tsx`, `DashboardLayout.tsx`.                                                          |
| Novo campo em formulário         | Página correspondente, componente UI, validação Zod em `business.ts`, `shared/formValidation.ts` quando aplicável e teste. |
| Nova regra de orçamento          | `shared/quote*.ts`, `quoteDb.ts`, `routers/business.ts`, editor e testes.                                                  |
| Nova regra de estoque            | `shared/stock*.ts`, `stockDb.ts`, `InventoryPage.tsx` e testes.                                                            |
| Novo recurso financeiro          | `shared/finance.ts`, `financeDb.ts`, `FinancePage.tsx`, `QuoteFinancePanel.tsx` e testes.                                  |
| Novo dado persistente            | `drizzle/schema.ts`, nova migração SQL, camada `*Db.ts`, roteador, página e teste.                                         |
| Alteração de segurança           | `localAuth.ts`, `loginRateLimit.ts`, `routers/localAuth.ts`, `_core/cookies.ts` e testes de autenticação.                  |
| Alteração de PDF/arquivos        | `quotePdf.ts`, `printPreparation.ts`, `localStorage.ts`, `quoteDb.ts` e guia de VPS.                                       |
| Alteração de VPS                 | Guias Markdown, serviço `systemd`, variáveis de ambiente, backups e migrations.                                            |

## 10. Convenções importantes para manutenção

O frontend não deve acessar o MySQL diretamente. Qualquer operação de negócio deve passar por um procedimento tRPC protegido e validado. Mudanças no banco devem nascer em `drizzle/schema.ts`, gerar migração SQL versionada e ser aplicadas por `pnpm drizzle-kit migrate` em ambientes controlados.

Segredos, senhas, cookies, `DATABASE_URL`, `JWT_SECRET` e `AUTH_RATE_LIMIT_SECRET` não devem aparecer em código, Git, testes, guias preenchidos ou registros. Em VPS, imagens e PDFs devem ficar fora do checkout de código, nos diretórios persistentes configurados por ambiente.

Antes de disponibilizar mudanças, execute `pnpm check`, `pnpm test`, `pnpm build`, `pnpm audit --audit-level=low` e `git diff --check`. Para mudanças funcionais, inclua ou atualize uma regressão automatizada correspondente.
