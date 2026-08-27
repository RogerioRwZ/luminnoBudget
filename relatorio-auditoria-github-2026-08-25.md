# Relatório de auditoria técnica — Luminno Orçamentos

## Escopo e método

Foi auditado o repositório **[`RogerioRwZ/luminnoBudget`](https://github.com/RogerioRwZ/luminnoBudget)** no commit `b2bda01` (“Merge pull request #1 from RogerioRwZ/fix/settings-and-pdf-bugs”). A análise incluiu leitura dos fluxos de autenticação, orçamentos, configurações, backup, separação de estoque e estilos de impressão. Também foram executados `pnpm check`, `pnpm test`, `pnpm build` e auditoria de dependências de produção.

> **Resultado geral:** o build de produção conclui, mas o repositório não está em condição de aceite técnico. A checagem de tipos falha com quatro erros e a suíte de testes falha no fluxo de separação. Há, portanto, uma inconsistência importante entre “build verde” e funcionamento verificável.

## Resumo executivo

| Prioridade | Achados | Impacto principal |
|---|---:|---|
| **P0 — Bloqueador** | 2 | A exportação de separação pode quebrar em execução; o pipeline de tipos está vermelho. |
| **P1 — Alto** | 3 | Um build pode ser publicado sem type-check; login é vulnerável a força bruta; dependências têm vulnerabilidades relevantes. |
| **P2 — Médio** | 4 | Formulários aceitam estados numéricos inválidos; impressão A4 pode paginar mal; sessões não são revogadas após troca de senha; backup destrutivo tem confirmação frágil. |
| **P3 — Baixo** | 2 | Código legado e arquivos órfãos aumentam custo de manutenção. |

## Achados bloqueadores

| ID | Evidência | Consequência | Correção recomendada |
|---|---|---|---|
| **P0-01** | `pnpm check` falha em `shared/pickingPrint.ts:8`, `server/quoteDb.ts:276` e `server/localAuth.ts:71,80`. | A base não passa em TypeScript estrito. Isso impede uma validação confiável antes do deploy. | Corrigir os contratos compartilhados de picking e a assinatura tipada de `scrypt`; tornar `pnpm check` obrigatório no CI. |
| **P0-02** | `pnpm test` falha em `shared/picking.test.ts`: o retorno contém `productId` e `roomName`, enquanto o teste e o renderer esperam `key` e `rooms`. `pickingPrint.ts:8` chama `item.rooms.join(", ")`. | O botão **Separação** pode lançar `TypeError` ao renderizar o documento, pois `rooms` não existe; além disso, itens repetidos não preservam corretamente todos os ambientes. | Definir um único tipo de saída agrupada, por exemplo `{ key, code, shortDescription, fullDescription, unit, quantity, rooms }`; fazer `buildPickingList`, `getPickingList`, `pickingPrint` e os testes usarem esse contrato. |

### Detalhamento do P0-02

O agrupador atual em `shared/picking.ts` usa a chave `code|unit` e mantém o primeiro objeto recebido. Quando o mesmo produto está em ambientes diferentes, ele soma a quantidade, mas mantém apenas `roomName` do primeiro ambiente. Ao mesmo tempo, o documento imprimível exige uma lista `rooms`. Esse desalinhamento explica tanto a falha de teste quanto a falha potencial em produção.

**Teste de regressão mínimo exigido após a correção:** criar uma proposta com o mesmo produto em dois ambientes, gerar a lista de separação e verificar quantidade consolidada, descrição completa e os dois nomes de ambientes no HTML final.

## Achados de alta prioridade

| ID | Evidência | Consequência | Correção recomendada |
|---|---|---|---|
| **P1-01** | O script `build` executa Vite e esbuild, mas não executa `pnpm check`. O comando `pnpm build` passou mesmo com quatro erros de TypeScript. | É possível publicar uma versão que “compila” para bundle, mas contém contratos quebrados e falhas de tipagem. | Alterar o script para `pnpm check && vite build && esbuild ...`; exigir `pnpm test` e `pnpm check` no CI antes de merge/deploy. |
| **P1-02** | `server/routers/localAuth.ts:51-59` não limita tentativas de login por IP ou usuário. | Um endpoint público pode sofrer tentativa automatizada de senhas. O uso de Tunnel não elimina a necessidade de proteção na aplicação. | Implementar limite de tentativas com janela deslizante, atraso progressivo e logs de segurança. Complementar com regra de Rate Limiting no Cloudflare. |
| **P1-03** | `pnpm audit --prod --audit-level=high` reportou **81 vulnerabilidades**: 1 crítica, 21 altas, 49 moderadas e 10 baixas. A cadeia `@aws-sdk/* → fast-xml-parser` aparece entre as vulnerabilidades altas. | Dependências desatualizadas ampliam a superfície de risco, inclusive pacotes de armazenamento que já não fazem parte do fluxo local principal. | Atualizar dependências em branch própria, executar testes/build e remover bibliotecas AWS legadas se não forem mais utilizadas. |

## Formulários e dados

| ID | Evidência | Impacto | Correção recomendada |
|---|---|---|---|
| **P2-01** | `QuoteEditorPage.tsx:85,87`, `SettingsPage.tsx:318,339,348` usam `Number(e.target.value)` diretamente. Ao limpar um campo, o valor vira `0`; em entradas inválidas, pode tornar-se `NaN`. | Quantidade pode passar momentaneamente para zero; parcelas e dias de alerta são rejeitados apenas no servidor; o usuário recebe erro tardio e o formulário fica em estado inconsistente. | Usar parser seguro (`value === "" ? undefined : Number(value)`), manter texto durante edição ou normalizar no `onBlur`; apresentar erro junto ao campo antes do envio. |
| **P2-02** | Em `QuoteEditorPage.tsx:83`, limpar “Emissão” cria `new Date("T12:00:00")`, uma data inválida. | O salvamento falha no Zod, sem recuperação intuitiva do campo. | Não construir `Date` quando a entrada estiver vazia; tornar a emissão obrigatória visualmente ou restaurar a data atual. |
| **P2-03** | Importação de backup usa `window.confirm` e chama `importBackup.mutate({ data: parsed })`; o backend assume `replace: true` por padrão. | Uma confirmação simples é frágil para operação destrutiva que apaga tabelas de negócio antes de restaurar. | Exigir modal explícito com resumo do arquivo e confirmação digitada, como `RESTAURAR`; enviar `replace: true` explicitamente. |
| **P2-04** | O upload de logo é salvo no servidor antes de o usuário clicar em “Salvar configurações”. | Se o usuário cancelar a edição, o arquivo permanece órfão no disco. | Criar limpeza de uploads não referenciados ou upload temporário com confirmação no salvamento. |

## Impressão A4 e PDF

Os pontos abaixo são **riscos observados no código e CSS**; não foi possível comparar uma proposta longa real no navegador autenticado desta auditoria. Devem ser validados com orçamentos de 1, 2 e 3+ páginas antes de liberar a versão.

| ID | Evidência | Impacto provável | Correção recomendada |
|---|---|---|---|
| **P2-05** | `client/src/index.css:199` aplica `break-inside: avoid` e `page-break-inside: avoid` ao ambiente inteiro. | Um ambiente com muitos itens pode não quebrar entre páginas, gerando espaço em branco excessivo, corte ou comportamento inconsistente entre Chrome e PDF. | Permitir quebra entre itens; manter apenas o título do ambiente junto ao primeiro item, com `break-after: avoid` no cabeçalho. |
| **P2-06** | O rodapé é `position: fixed` em `index.css:217`, mas não existe espaço inferior reservado no conteúdo imprimível. | Em páginas longas, totais/termos podem colidir visualmente com o rodapé. | Reservar `padding-bottom` no documento para a altura do rodapé e validar exportação em múltiplas páginas. |
| **P2-07** | O botão chama `window.print()` diretamente em `QuoteEditorPage.tsx:82`, sem esperar carregamento de logo e imagens de produto. | Um PDF pode sair sem imagens quando a rede/disco estiver lento. | Antes de imprimir, aguardar `document.images` do documento de impressão carregarem ou usar uma janela de impressão dedicada com evento `load`. |
| **P2-08** | A aplicação usa impressão do navegador; não existe geração de PDF no servidor. | O resultado pode variar entre navegador, driver e configurações locais; não há arquivo PDF determinístico para arquivamento. | Se a exigência for PDF fiel e repetível, implementar geração no servidor ou procedimento controlado de exportação com Chromium/headless. |

## Segurança e sessões

| ID | Evidência | Impacto | Correção recomendada |
|---|---|---|---|
| **P2-09** | A senha pode ser redefinida em `admin.resetPassword`, porém o JWT ativo não possui versão de sessão nem é revogado. | Uma sessão roubada pode continuar válida até expirar, mesmo após troca de senha. | Adicionar `sessionVersion` ou `passwordChangedAt` ao usuário e validar esse valor a cada sessão; incrementar/revogar ao trocar senha. |
| **P3-01** | A criação inicial verifica `countLocalUsers() === 0` antes de inserir o administrador, sem trava transacional específica. | Duas requisições concorrentes no primeiro acesso podem, em cenário raro, criar mais de um administrador. | Implementar transação com lock ou tabela/configuração de bootstrap com restrição única. |

## Manutenção e código legado

| ID | Evidência | Impacto | Correção recomendada |
|---|---|---|---|
| **P3-02** | Ainda existem `server/storage.ts`, `server/_core/oauth.ts` e `server/_core/storageProxy.ts`, embora a aplicação autônoma use `localStorage.ts` e autenticação local. | Dependências AWS e código de plataforma permanecem no repositório, dificultando atualização e aumentando a superfície auditada. | Remover módulos não importados e dependências associadas após uma busca de referências e execução completa da suíte. |
| **P3-03** | O bundle cliente final tem aproximadamente 1,46 MB (cerca de 369 KB gzip), com alerta de chunk acima de 500 KB. | Carregamento inicial pior em conexões móveis e maior tempo até interação. | Aplicar `lazy()` para páginas administrativas, gráficos e editor; configurar chunks manuais para bibliotecas pesadas. |

## Ordem de correção recomendada

1. Corrigir o contrato da lista de separação e adicionar teste de integração que acione o botão do editor.
2. Corrigir `scrypt` tipado e fazer `check` + `test` bloquearem o build e o deploy.
3. Tratar campos numéricos e datas no cliente, com mensagens de validação por campo.
4. Adicionar rate limit no login e revogação de sessão após troca de senha.
5. Validar paginação da impressão com propostas reais longas e corrigir quebra/rodapé.
6. Atualizar/remover dependências vulneráveis e módulos legados.

## Evidências de execução

| Verificação | Resultado |
|---|---|
| `pnpm check` | **Falhou**: 4 erros em 3 arquivos. |
| `pnpm test` | **Falhou**: 1 teste de picking; 32 demais testes passaram. |
| `pnpm build` | **Passou**, apesar do type-check falhar. |
| `pnpm audit --prod --audit-level=high` | **Falhou**: 81 vulnerabilidades reportadas, incluindo 1 crítica e 21 altas. |

## Referências

[1] [Repositório auditado — RogerioRwZ/luminnoBudget](https://github.com/RogerioRwZ/luminnoBudget)

[2] [Commit auditado — b2bda01](https://github.com/RogerioRwZ/luminnoBudget/commit/b2bda01)
