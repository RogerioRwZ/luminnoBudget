# Luminno Orçamentos

Sistema web de gestão comercial para lojas de iluminação. Cobre o ciclo da venda inteiro: monta o orçamento por ambiente, gera o PDF, acompanha a aprovação, reserva e entrega o estoque e controla o que falta receber.

Roda em um único servidor (Node.js + MySQL), com login próprio e arquivos guardados no próprio servidor, sem depender de serviços externos.

## Funcionalidades

| Módulo | O que faz |
|---|---|
| **Visão geral** | Propostas e valores por status, evolução mensal (orçado, aprovado e recebido), taxa de conversão, ticket médio, produtos mais cotados e alertas de validade com lembrete por WhatsApp. |
| **Orçamentos** | Itens organizados por ambiente, desconto, frete, preço no PIX e parcelamento. Também tem duplicação de orçamentos, busca, filtros por status e validade, paginação e exportação CSV. |
| **PDF e impressão** | PDF da proposta com logotipo e fotos dos produtos, histórico de PDFs gerados, impressão A4 e lista de separação. |
| **Catálogo** | Produtos com foto, código automático, fornecedor, ponto de reposição e código de barras. |
| **Estoque** | Entradas, ajustes e devoluções. Ao aprovar um orçamento, o estoque fica reservado automaticamente, e as entregas podem ser parciais. Há alerta de estoque baixo e exportação CSV. |
| **Financeiro** | Contas a receber geradas na aprovação do orçamento ou lançadas avulsas, com parcelas, recebimentos parciais, estornos, cobranças em atraso e exportação CSV. |
| **Clientes** | Cadastro de clientes e ficha de cada um, com orçamentos, valores aprovados, recebidos e a receber, taxa de conversão e atalho para o WhatsApp. |
| **Operação** | Para cada orçamento: versões com comparação financeira e restauração justificada, comentários internos e anexos (plantas, PDFs e imagens). Também tem o leitor de código de barras, por leitor USB ou pela câmera do celular, e os modelos de mensagem por evento (proposta enviada, aprovada, vencendo, cobrança etc.). |
| **Configurações** | Dados da loja, logotipo, chave PIX, condições padrão, dias de alerta e backup/restauração em JSON. |
| **Administração** | Usuários e perfis (usuário/administrador) e status do sistema (banco, disco, tempo no ar). |

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
| [GUIA-INSTALACAO-COMPLETA.md](GUIA-INSTALACAO-COMPLETA.md) | Instalação e atualização em produção (**use este**) |
| [guia-exportacao-vps-cloudflared.md](guia-exportacao-vps-cloudflared.md) | Publicação via Cloudflare Tunnel, alternativa ao Caddy |
| [ESTRUTURA-TECNICA-DA-APLICACAO.md](ESTRUTURA-TECNICA-DA-APLICACAO.md) | Arquitetura e responsabilidades de cada parte |
| [SECURITY_AUDIT.md](SECURITY_AUDIT.md) | Auditoria de segurança anterior |
| [todo.md](todo.md) | Histórico das tarefas executadas |

## Licença

MIT, conforme declarado no `package.json`.
