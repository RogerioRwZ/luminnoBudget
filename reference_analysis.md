# Referência visual — Orçamentos Luminno

Foram analisados os modelos de orçamento 658 e 711. Ambos seguem uma composição A4 minimalista, predominantemente preta e branca, com a marca em um bloco amarelo no canto superior esquerdo. O documento mantém ampla área em branco, tipografia sans-serif compacta e linhas horizontais pretas finas para separar as seções.

| Elemento | Característica observada | Aplicação no sistema |
| --- | --- | --- |
| Cabeçalho | Logotipo amarelo à esquerda, marca em caixa alta e dados cadastrais ao lado | Dados configuráveis da loja e marca opcional na impressão |
| Identificação | Título centralizado, linha divisória, número, data/hora e validade | Faixa de metadados do orçamento |
| Cliente | Rótulo em destaque e linhas para nome, CNPJ/CPF, inscrição, telefone e endereço | Dados de cliente simplificados, com campos complementares opcionais |
| Tabela | Cabeçalho discreto, imagem do produto, código, descrição, unidade, quantidade, unitário e total | Tabela A4 com imagem compacta e descrições curtas |
| Ambientes | Barra cinza-clara centralizada em caixa alta antes de cada grupo | Separador de ambiente com subtotal no encerramento do grupo |
| Rodapé | Data/hora de emissão e paginação, delimitados por linha horizontal | Rodapé repetido em impressão |

Os modelos confirmam que a impressão deve preservar os ambientes em sequência, com cabeçalhos de grupo e subtotais claramente visíveis. A interface da aplicação poderá usar uma linguagem visual contemporânea em tela, mantendo o documento impresso propositalmente sóbrio e próximo à referência.

As páginas finais analisadas acrescentam um resumo financeiro compacto, alinhado à direita, composto por total de produtos e serviços, desconto, frete e o total do orçamento com maior ênfase. Abaixo, o modelo apresenta as condições comerciais como linhas em negrito com marcador, incluindo a alternativa parcelada, o valor à vista com desconto PIX e a chave PIX/CNPJ. A versão impressa implementará esses blocos apenas no encerramento do documento, com divisórias horizontais pretas e paginação no rodapé.

## Validação de interface

As telas de visão geral e configurações foram verificadas em desktop após o carregamento completo dos estilos. A aplicação apresenta navegação lateral, hierarquia tipográfica, cartões de métricas, superfícies consistentes, ações destacadas em amarelo quente e formulário de configuração organizado em blocos. A visualização confirmou a legibilidade dos controles, o contraste em superfícies claras e a coerência da identidade administrativa da Luminno.

Em resolução móvel, as telas de visão geral, orçamentos, clientes e configurações foram verificadas com reorganização vertical dos cartões e formulários, preservando os controles, o texto legível e as ações primárias. A compilação de produção foi concluída e a suíte de testes executou quatro cenários com sucesso, cobrindo autenticação, cálculos comerciais e o texto de WhatsApp.

## Melhoria de emissão

Foi identificada a causa da falha na abertura de um novo orçamento: a inicialização das configurações da loja tentava atualizar um registro sem campos definidos quando ainda não existia configuração. A inicialização foi corrigida e a rota de novo orçamento agora cria o rascunho inicial e abre o editor automaticamente. A validação visual exibiu o orçamento criado, o ambiente padrão, os controles financeiros e as ações de impressão, pré-visualização e salvamento.

As melhorias posteriores foram validadas por inspeção visual e testes automatizados. A lista passou a apresentar filtros por propostas pendentes, aprovadas e rejeitadas; as configurações passaram a aceitar logotipo por arquivo ou URL; e as regras de movimentação por arrastar e soltar foram isoladas e testadas para preservar a ordem dos produtos dentro de cada ambiente. A rota de novo orçamento retornou uma resposta bem-sucedida e abriu a proposta recém-criada no editor.

A duplicação integral foi verificada pela API da aplicação usando um orçamento existente; a cópia temporária foi removida ao fim da verificação. O upload de logotipo também foi validado com uma imagem PNG mínima, confirmando o processamento, a gravação em armazenamento de arquivos e o retorno de uma URL segura, sem alterar as configurações persistidas da loja.

Na validação final, foi comparada uma proposta temporária com sua cópia contendo cliente, dados cadastrais, dois ambientes, itens, descontos, frete, PIX, parcelamento e observações. O conteúdo foi preservado, enquanto a cópia foi corretamente aberta como rascunho. O logotipo enviado foi salvo nas configurações, relido com sucesso e, em seguida, a configuração anterior foi restaurada. As propostas temporárias também foram excluídas ao término da verificação.

## Dashboard por status

O Dashboard foi validado em desktop e mobile com dados reais da base. Os cards exibem separadamente a quantidade e o valor de propostas aprovadas, pendentes e rejeitadas. O gráfico circular mostra a distribuição da carteira, enquanto o gráfico de barras compara o valor financeiro dos mesmos status. Em telas estreitas, os indicadores e gráficos são organizados verticalmente, mantendo leitura e controles legíveis.

## Alertas de validade

O painel de alertas foi validado em desktop e mobile com propostas pendentes reais. Ele apresenta, de forma destacada, o número do orçamento, o cliente, a data de validade, o valor e os dias restantes. A regra considera rascunhos e orçamentos em aberto vencidos ou com validade em até sete dias, organizando os casos mais urgentes primeiro. Cada alerta abre diretamente o respectivo orçamento.

## Controles de vencimento

As novas interfaces foram verificadas em desktop e mobile. A configuração de antecedência foi incluída ao lado das condições de pagamento e atualiza a mensagem do painel de alertas com o prazo escolhido. Cada alerta oferece a ação de lembrete pelo WhatsApp. A lista de orçamentos passou a apresentar filtros rápidos para propostas que vencem hoje e para propostas já vencidas, preservando os filtros comerciais existentes.

## Estoque e entregas

O novo módulo de estoque foi verificado em desktop e mobile. A navegação passou a incluir a área de Estoque, com cards de saldo, valor de inventário, itens abaixo do ponto de reposição e pendências de entrega. O painel apresenta blocos distintos para saldos por produto, reposição, entregas parciais de propostas aprovadas e histórico de movimentações. O catálogo exibe o saldo atual de cada item e orienta que alterações de quantidade sejam feitas somente pelo histórico de estoque.

A operação foi validada ponta a ponta com registros temporários posteriormente removidos: uma entrada de sete unidades foi lançada para um item de orçamento aprovado de dez unidades; em seguida, as sete unidades foram entregues. O sistema registrou a saída, reduziu o saldo a zero, preservou três unidades pendentes no orçamento e gravou a referência do orçamento e do cliente no histórico de movimentações.

## Reservas e fornecedores

As reservas automáticas, fornecedores e filtros foram validados em desktop e mobile. Ao aprovar um orçamento, o produto passa a exibir separadamente o saldo físico, a quantidade reservada e o saldo disponível para novas vendas. O painel permite filtrar por fornecedor, por saldo físico abaixo do limite inserido e pela situação de reserva ou reposição. A lista de entregas mostra a reserva remanescente, o saldo físico e a disponibilidade global, e o catálogo registra e apresenta o fornecedor informado para cada produto.

A regra de reserva foi reforçada para impedir a aprovação acima do saldo disponível. A verificação foi executada em transação com bloqueio dos produtos envolvidos, evitando o comprometimento simultâneo do mesmo saldo. Também foram validados o bloqueio de quantidade excedente, a liberação ao mudar uma proposta de aprovada para pendente e a liberação ao excluir uma proposta sem entregas. Os filtros de fornecedor, saldo físico máximo, itens reservados e itens abaixo da reposição foram extraídos para regra compartilhada e cobertos por testes automatizados.

## Códigos e separação

O catálogo passou a comunicar que os códigos numéricos são automáticos e apresenta a identificação com o prefixo visual de número. No editor de orçamento, a nova ação de Separação fica junto a impressão e WhatsApp, inclusive em telas móveis. A lista operacional agrupa um mesmo produto presente em ambientes diferentes, totaliza a quantidade, conserva os ambientes de origem e usa a descrição completa do catálogo para a conferência da equipe de estoque.

O documento de separação foi validado por teste automatizado de sua estrutura de impressão. O conteúdo confirma o número do orçamento, cliente, quantidade consolidada, unidade, ambientes e descrição completa com escape seguro de caracteres especiais, preservando o formato necessário para separação e conferência manual.

A prévia do documento gerado pela mesma função usada na ação de Separação foi aberta em navegador com o título “Separação — Orçamento #91”. A amostra reuniu itens consolidados, descrição completa, ambientes e quantidade de conferência. Embora a captura visual do ambiente tenha sido indisponível, a abertura do documento e o conteúdo crítico também foram verificados pelo teste automatizado da função compartilhada.

A ação Separação foi acionada diretamente no editor de uma proposta temporária que continha o mesmo produto em dois ambientes. O botão estava disponível, a consulta retornou os itens consolidados e a ação abriu a saída de impressão por meio da função compartilhada testada. A validação funcional simula também a janela de saída, o `document.write` e o fechamento do documento, verificando a presença de quantidade, ambientes e descrição completa.

A inspeção direta da saída escrita pela própria ação do editor confirmou o fechamento do documento, o título “Separação — Orçamento #1”, a quantidade consolidada de 5 unidades, os ambientes “SALA, COZINHA” e a descrição completa do produto. Essa verificação usou o mesmo caminho de execução do botão e confirmou o HTML final produzido para a janela de impressão.
