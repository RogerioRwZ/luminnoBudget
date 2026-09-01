# Auditoria final — evidências

Data: 01/09/2026

## Validação automatizada

- `pnpm check`: aprovado.
- `pnpm test`: 40 arquivos e 92 testes aprovados.
- `pnpm build`: build de produção aprovado; apenas aviso de chunk grande do bundle do cliente.
- `pnpm audit --audit-level=low`: nenhum vulnerability conhecida.
- `git diff --check`: aprovado.

## Validação autenticada no navegador

- Gate de autenticação exibido corretamente em sessão não autenticada.
- Login autenticado confirmado pelo painel Luminno e menu completo.
- Lista de orçamentos carregou com filtros Todos/Pendentes/Aprovados/Rejeitados e filtros de validade.
- Ação Novo orçamento abriu o editor em `/orcamentos/1350001` e exibiu campos de cliente, ambiente, itens, resumo financeiro, pagamento, histórico e PDF.
- Rota de Administração carregou status do sistema, banco conectado, usuários locais e controles administrativos.
- Rota de Operação carregou seleção de orçamento, leitor USB/câmera, registro de versão, comentários, anexos e modelos por evento.
- Histórico de PDFs mostrou documento existente com ações Baixar PDF e Abrir orçamento.

## Observação de ambiente

A captura automatizada das rotas pelo preview separado não reutilizou a sessão autenticada do navegador e exibiu a tela de login; isso não indica falha da aplicação, pois a sessão autenticada foi confirmada no navegador interativo. A validação visual autenticada foi feita diretamente nesse navegador.

## Pendência de revisão

- Inspecionar as rotas restantes (Financeiro, Estoque, Catálogo, Clientes e Configurações) no navegador autenticado.
- Fazer uma inspeção responsiva específica em viewport móvel, se o ambiente de navegador permitir.
- Atualizar todo.md antes do checkpoint final.

## Segunda rodada autenticada

O módulo Financeiro carregou os cards A receber, Recebido no mês, Em atraso e Previsto em carteira, além de busca, filtro por status e ação Nova cobrança. O estado vazio foi tratado com orientação operacional.

O módulo Estoque carregou movimentação, filtros por fornecedor, saldo físico máximo e situação, além de reserva, disponibilidade, entregas parciais e histórico de movimentações. O estado vazio também apresentou orientação para aprovação de propostas com produtos.

O Catálogo carregou produto existente com código `#1`, preço, status e saldo de estoque, com busca, edição e Novo produto.

Configurações carregou dados comerciais, logo armazenada localmente no servidor, chave PIX, favorecido, desconto PIX, parcelas sem juros, antecedência do alerta, observações, salvar configurações e exportação/importação JSON.
