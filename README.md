# Luminno Orçamentos

Sistema web de gestão comercial para lojas de iluminação. Cobre o ciclo da venda inteiro: monta o orçamento por ambiente, gera o PDF, acompanha a aprovação, reserva e entrega o estoque e controla o que falta receber.

Roda em um único servidor (Node.js + MySQL), com login próprio e arquivos guardados no próprio servidor, sem depender de serviços externos.

## Funcionalidades

| Módulo | O que faz |
|---|---|
| **Visão geral** | Propostas e valores por status, evolução mensal (orçado, aprovado e recebido), taxa de conversão, ticket médio, produtos mais cotados e alertas de validade com lembrete por WhatsApp. |
| **Orçamentos** | Itens organizados por ambiente, desconto, frete, preço no PIX e parcelamento. Também tem duplicação de orçamentos, busca, filtros por status e validade, paginação e exportação CSV. Mostra a margem (para quem vê custo), avisa quando o desconto passa do limite e, se uma variação não tem estoque livre, sugere outra do mesmo modelo para trocar com um clique. |
| **PDF e impressão** | Proposta em PDF com a identidade da loja: dados do cliente e da proposta, destaques de valor (total, PIX e parcelado), itens por ambiente com fotos, resumo financeiro, QR Code PIX, observações e campo de aceite. Pré-visualizar, imprimir e salvar usam o mesmo documento. Histórico de PDFs gerados e lista de separação com o mesmo visual. |
| **Catálogo** | Produtos com foto, código automático, fornecedor, preço de custo e margem, ponto de reposição e código de barras. O custo nunca é enviado ao perfil Vendas. |
| **Estoque** | Entradas, ajustes e devoluções. Ao aprovar um orçamento, o estoque fica reservado automaticamente, e as entregas podem ser parciais. Há alerta de estoque baixo e exportação CSV. |
| **Financeiro** | Contas a receber geradas na aprovação do orçamento ou lançadas avulsas, com parcelas, recebimentos parciais, estornos, cobranças em atraso e exportação CSV. O botão de cobrança prepara a mensagem ao cliente com QR Code PIX do saldo da parcela. |
| **Comissões** | Comissão por profissional (arquiteto, designer), gerada conforme o cliente paga e sem o frete, no percentual fixado na aprovação. Registro de pagamentos, saldo a pagar e exportação para Excel. |
| **Relatórios** | Vendas por período por vendedor, profissional, modelo e variação, com margem bruta e exportação para Excel (resumo e itens vendidos). |
| **Resumo do dia** | Sino no topo com o que pede atenção hoje, conforme o perfil: agenda, retornos, propostas vencendo, parcelas, pedidos prontos para retirada e mercadoria aguardando compra. Abre sozinho na primeira entrada do dia e pode ser copiado ou enviado pelo WhatsApp. |
| **Clientes** | Cadastro de clientes e ficha de cada um, com orçamentos, valores aprovados, recebidos e a receber, taxa de conversão e atalho para o WhatsApp. |
| **Operação** | Para cada orçamento: versões com comparação financeira e restauração justificada, comentários internos e anexos (plantas, PDFs e imagens). Também tem o leitor de código de barras, por leitor USB ou pela câmera do celular, e os modelos de mensagem por evento (proposta enviada, aprovada, vencendo, cobrança etc.). As **mensagens do dia** listam propostas vencendo e parcelas a vencer ou em atraso, com o texto do modelo preenchido, para enviar pelo WhatsApp ou e-mail. |
| **Configurações** | Dados da loja, logotipo, chave, favorecido e cidade do PIX, condições padrão, dias de alerta, desconto máximo, margem mínima, comissão padrão e backup/restauração em JSON. |
| **Administração** | Usuários e perfis (usuário/administrador), status do sistema (banco, disco, tempo no ar) e **registro de atividades**: quem aprovou orçamentos, registrou recebimentos e estornos, ajustou estoque, mudou preços, configurações e usuários, e quando. |

## Tecnologias

- **Front-end:** React 19, Vite, Tailwind CSS 4, shadcn/ui (Radix), Recharts, jsPDF.
- **Back-end:** Node.js, Express, tRPC 11, Drizzle ORM, MySQL 8.
- **Qualidade:** TypeScript, Vitest + Testing Library e CI no GitHub Actions com MySQL real.

## Rodando localmente

**Pré-requisitos:**
- Node.js 24 (ou 22).
- pnpm **11.24.0** (`corepack enable && corepack prepare pnpm@11.24.0 --activate`).
- Um MySQL 8.

1. **Subir um MySQL.** O jeito mais rápido é com Docker:
   ```bash
   docker run -d --name luminno-mysql -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=luminno -p 127.0.0.1:3306:3306 mysql:8.4
   ```

2. **Criar o `.env`** na raiz do projeto:
   ```dotenv
   DATABASE_URL=mysql://root:root@127.0.0.1:3306/luminno
   JWT_SECRET=troque-por-um-valor-aleatorio-com-pelo-menos-32-caracteres
   ```

3. **Instalar, criar as tabelas e iniciar:**
   ```bash
   pnpm install
   pnpm exec drizzle-kit migrate
   pnpm dev
   ```

4. **Abrir o sistema.** Acesse http://localhost:3000. No primeiro acesso aparece a tela para criar o **administrador**.

## Scripts

| Comando | O que faz |
|---|---|
| `pnpm dev` | Servidor de desenvolvimento, com recarga automática |
| `pnpm check` | Verificação de tipos (TypeScript) |
| `pnpm test` | Todos os testes. Os de integração precisam de `DATABASE_URL` e `JWT_SECRET` apontando para um banco **de teste**. |
| `pnpm build` | Roda `check` e `test` e depois gera o build de produção em `dist/` |
| `pnpm start` | Inicia o build de produção (`dist/index.js`) |
| `pnpm exec drizzle-kit migrate` | Aplica as migrações versionadas da pasta `drizzle/` |

> Os testes de integração criam e apagam registros no banco. Nunca rode `pnpm test` ou `pnpm build` com a `DATABASE_URL` de produção.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | Sim | Conexão MySQL (`mysql://usuario:senha@host:3306/banco`) |
| `JWT_SECRET` | Sim | Assina as sessões. Precisa ter pelo menos 32 caracteres. |
| `NODE_ENV` | Em produção | `production` |
| `PORT` | Não | Porta HTTP. O padrão é `3000`. |
| `UPLOAD_DIR` | Recomendada em produção | Pasta de imagens e anexos. O padrão é `./uploads`. |
| `PDF_HISTORY_DIR` | Não | Pasta dos PDFs gerados. O padrão é `pdf-history`, ao lado da pasta de uploads. |
| `AUTH_RATE_LIMIT_SECRET` | Não | Chave do limitador de login. O padrão é usar o `JWT_SECRET`. |

## Produção

### Instalação automática (Ubuntu Server 22.04 ou 24.04)

Num servidor Ubuntu novo, como root:

```bash
curl -fsSLO https://raw.githubusercontent.com/RogerioRwZ/luminnoBudget/main/deploy/install-ubuntu.sh
sudo bash install-ubuntu.sh --domain orcamentos.minhaloja.com.br --email voce@minhaloja.com.br
```

O script instala e configura tudo: Node.js 24, MySQL com usuários próprios e senhas aleatórias, build, tabelas, serviço `systemd`, HTTPS com Caddy, firewall, fuso horário, backup diário às 02:15 e o comando `sudo luminno-update confirm` para atualizar depois. Ao final, abra o endereço e crie o administrador.

Outras formas de acesso:
- `--http`: só pelo IP, sem HTTPS (rede interna);
- `--cloudflare-tunnel`: Cloudflare Tunnel, sem abrir portas (o token é pedido na tela).

Veja todas as opções com `--help`. O script pode ser executado de novo com segurança: mantém senhas, banco e configuração, e completa o que faltar.

### Instalação manual

Siga o **[Guia completo de instalação](GUIA-INSTALACAO-COMPLETA.md)**. Ele leva uma VPS Ubuntu 24.04 do zero até o sistema no ar, passando por:
- MySQL, serviço `systemd` e HTTPS com Caddy;
- backup diário;
- atualização e reversão de versão;
- diagnóstico de problemas.

A rota `GET /api/health` responde `200` com o banco online e `503` com ele fora do ar. Dá para usá-la em monitores de disponibilidade.

## Segurança

- Login local com senha em scrypt, cookie `HttpOnly`/`SameSite=Lax` e sessões que expiram em 12 horas.
- Trocar ou redefinir a senha encerra as outras sessões do usuário.
- Limite de tentativas de login por usuário e por IP.
- Todas as rotas de negócio exigem login. Backup, configurações da loja e usuários exigem perfil de administrador.
- Anexos e PDFs só são baixados com login. Os uploads têm o tipo do arquivo conferido pelo conteúdo.
- Cabeçalhos de segurança (`nosniff`, `X-Frame-Options`, HSTS em produção etc.).

Para relatar uma vulnerabilidade, entre em contato diretamente com o mantenedor em vez de abrir uma issue pública.

## Estrutura do projeto

```text
client/    Front-end React (páginas em client/src/pages)
server/    API tRPC, autenticação, regras de negócio e acesso ao banco
shared/    Cálculos e validações usados pelo cliente e pelo servidor
drizzle/   Esquema do banco e migrações versionadas
```

O detalhamento de cada arquivo está em [ESTRUTURA-TECNICA-DA-APLICACAO.md](ESTRUTURA-TECNICA-DA-APLICACAO.md).

## Documentação

| Documento | Conteúdo |
|---|---|
| [deploy/install-ubuntu.sh](deploy/install-ubuntu.sh) | Instalação automática no Ubuntu Server |
| [deploy/update.sh](deploy/update.sh) | Atualização com backup (instalado como `luminno-update`) |
| [GUIA-INSTALACAO-COMPLETA.md](GUIA-INSTALACAO-COMPLETA.md) | Instalação e atualização em produção, passo a passo |
| [guia-exportacao-vps-cloudflared.md](guia-exportacao-vps-cloudflared.md) | Publicação via Cloudflare Tunnel, alternativa ao Caddy |
| [ESTRUTURA-TECNICA-DA-APLICACAO.md](ESTRUTURA-TECNICA-DA-APLICACAO.md) | Arquitetura e responsabilidades de cada parte |
| [SECURITY_AUDIT.md](SECURITY_AUDIT.md) | Auditoria de segurança anterior |
| [todo.md](todo.md) | Histórico das tarefas executadas |

## Licença

MIT, conforme declarado no `package.json`.
