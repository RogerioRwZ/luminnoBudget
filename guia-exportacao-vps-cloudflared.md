# Luminno Orçamentos em VPS Ubuntu com Cloudflare Tunnel

Este guia descreve uma instalação **autônoma e segura** do Luminno Orçamentos em VPS Ubuntu Server. A arquitetura usa MySQL local, armazenamento persistente de imagens e PDFs privados, `systemd` para executar a aplicação e **Cloudflare Tunnel** para publicar o domínio sem abrir as portas da aplicação ou do banco para a Internet.

> **Arquitetura final:** o navegador acessa `https://orcamentos.seudominio.com.br`; a Cloudflare encaminha a requisição pelo Tunnel iniciado pela VPS; e o `cloudflared` entrega o tráfego somente para `http://127.0.0.1:3000`. As portas `3000` e `3306` permanecem privadas. [1]

## 1. Pré-requisitos e decisões importantes

| Item         | Recomendação                                                                           | Motivo                                                                                             |
| ------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| VPS          | Ubuntu Server 22.04 ou 24.04 LTS, ao menos 2 GB RAM e 2 vCPU                           | Suporta build, MySQL, cópias de segurança e operação da aplicação.                                 |
| Domínio      | Domínio já ativo na Cloudflare                                                         | É necessário para publicar um hostname por Tunnel. [1]                                             |
| Acesso       | Usuário SSH com `sudo` e chave SSH                                                     | Evita operação cotidiana como `root`.                                                              |
| Node.js      | Node.js 24 LTS                                                                         | A linha 24 é LTS na data de revisão deste guia. [2]                                                |
| Banco        | MySQL local, escutando apenas em loopback                                              | Mantém os dados fora do checkout e inacessíveis publicamente.                                      |
| Persistência | `/var/lib/luminno/uploads` e `/var/lib/luminno/pdf-history`                            | Imagens são públicas sob `/uploads`; PDFs históricos são privados e baixados por rota autenticada. |
| Segredos     | Valores novos, longos e exclusivos para MySQL, `JWT_SECRET` e `AUTH_RATE_LIMIT_SECRET` | Não reutilize valores do ambiente de desenvolvimento nem publique segredos.                        |

O Tunnel exige que a VPS consiga abrir conexões de saída para a Cloudflare na porta **7844**, por **TCP e UDP**. Em um firewall de saída restritivo, libere esses protocolos e também HTTPS/443 para instalação e atualizações. [3]

## 2. Exportar código, dados e arquivos

Antes da migração, crie um checkpoint atual do projeto. Na interface do projeto, abra **Code** e use **Download all files** para obter o ZIP do código. Em seguida, dentro da aplicação, use **Configurações → Backup e restauração manual → Exportar JSON** para obter uma cópia dos dados comerciais.

O backup JSON não substitui uma cópia dos arquivos enviados. Se estiver migrando uma instalação já existente, copie **uploads e histórico de PDFs**. A conta local de administrador deve ser criada novamente na nova VPS por segurança.

| Artefato                   | Exemplo                          | Destino temporário na VPS   |
| -------------------------- | -------------------------------- | --------------------------- |
| Código-fonte               | `luminno-orcamentos.zip`         | `/tmp/`                     |
| Backup comercial           | `luminno-backup-AAAA-MM-DD.json` | `/tmp/`                     |
| Uploads, se houver         | `uploads/`                       | `/tmp/luminno-uploads/`     |
| PDFs históricos, se houver | `pdf-history/`                   | `/tmp/luminno-pdf-history/` |

No computador local, envie os arquivos. Substitua `USUARIO`, `IP_DA_VPS` e os nomes de exemplo pelos valores reais.

```bash
scp luminno-orcamentos.zip USUARIO@IP_DA_VPS:/tmp/
scp luminno-backup-AAAA-MM-DD.json USUARIO@IP_DA_VPS:/tmp/
rsync -avP ./uploads/ USUARIO@IP_DA_VPS:/tmp/luminno-uploads/
rsync -avP ./pdf-history/ USUARIO@IP_DA_VPS:/tmp/luminno-pdf-history/
```

Se esta for a primeira instalação, os dois últimos comandos não se aplicam. Antes de continuar, confirme que o ZIP e o JSON chegaram corretamente.

## 3. Preparar o Ubuntu e proteger SSH

Entre na VPS. Ao modificar chaves ou firewall, mantenha uma segunda sessão SSH aberta até confirmar que o acesso continua funcionando.

```bash
ssh USUARIO@IP_DA_VPS
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl unzip rsync git ufw fail2ban mysql-client
```

Depois de confirmar o uso de chave SSH, aplique um firewall mínimo. O Tunnel não exige portas de entrada 80, 443, 3000 ou 3306 abertas.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status verbose
```

Caso sua política de saída seja restritiva, libere explicitamente a conectividade do Tunnel:

```bash
sudo ufw allow out 7844/tcp
sudo ufw allow out 7844/udp
```

> Quando o IP de administração for estável, restrinja SSH: `sudo ufw allow from SEU_IP to any port 22 proto tcp`.

## 4. Criar usuário de serviço e diretórios persistentes

O processo não deve executar como `root`. Crie o usuário de serviço, o checkout de código, os dois diretórios de dados persistentes e a área de configuração.

```bash
sudo adduser --system --group --home /opt/luminno --shell /usr/sbin/nologin luminno
sudo install -d -o luminno -g luminno -m 0750 /opt/luminno-orcamentos
sudo install -d -o luminno -g luminno -m 0750 /var/lib/luminno/uploads
sudo install -d -o luminno -g luminno -m 0750 /var/lib/luminno/pdf-history
sudo install -d -o root -g luminno -m 0750 /etc/luminno
```

Descompacte o código. Se o ZIP gerar uma pasta interna adicional, ajuste o destino para que `package.json` permaneça diretamente em `/opt/luminno-orcamentos`.

```bash
sudo unzip /tmp/luminno-orcamentos.zip -d /opt/luminno-orcamentos
sudo chown -R luminno:luminno /opt/luminno-orcamentos
sudo find /opt/luminno-orcamentos -type d -exec chmod 0750 {} \;
sudo find /opt/luminno-orcamentos -type f -exec chmod 0640 {} \;
sudo -u luminno test -f /opt/luminno-orcamentos/package.json && echo "Código no local correto"
```

## 5. Instalar Node.js e dependências

Use uma versão LTS de Node.js instalada para todo o sistema, para que o `systemd` localize o binário sem depender do perfil de shell. O exemplo usa o repositório NodeSource para Node.js 24. Consulte o fornecedor se sua arquitetura não for `amd64`. [4]

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node --version

# Habilite pnpm pelo Corepack. Se o binário não estiver disponível,
# instale o Corepack globalmente antes de executar a próxima linha.
corepack enable || sudo npm install -g corepack
corepack enable
pnpm --version
```

Instale o lockfile e valide o projeto como usuário de serviço. O `pnpm build` já executa verificação de tipos e testes, mas os comandos são mantidos explícitos para diagnóstico.

```bash
sudo -u luminno -H bash -lc '
  cd /opt/luminno-orcamentos
  pnpm install --frozen-lockfile
  pnpm check
  pnpm test
  pnpm build
'
```

O build deve criar `dist/index.js` e `dist/public/`. Um aviso de chunk grande não deve ser confundido com falha; já erros de tipos ou testes devem interromper a instalação.

## 6. Instalar e restringir o MySQL local

Instale o MySQL e execute o endurecimento inicial. No assistente interativo, remova usuários anônimos, desabilite login remoto de `root`, remova o banco de teste e recarregue privilégios.

```bash
sudo apt install -y mysql-server
sudo mysql_secure_installation
```

Crie uma base e uma conta exclusiva da aplicação. Troque `SENHA_MYSQL_FORTE` por uma senha longa e aleatória; não a coloque no Git, em capturas de tela ou em mensagens.

```bash
sudo mysql <<'SQL'
CREATE DATABASE luminno CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'luminno_app'@'localhost' IDENTIFIED BY 'SENHA_MYSQL_FORTE';
GRANT ALL PRIVILEGES ON luminno.* TO 'luminno_app'@'localhost';
FLUSH PRIVILEGES;
SQL
```

Crie credenciais separadas, somente para cópias de segurança, e mantenha-as legíveis apenas por `root`.

```bash
sudo install -d -m 0700 /etc/mysql
sudo tee /etc/mysql/luminno-backup.cnf >/dev/null <<'EOF'
[client]
user=luminno_app
password=SENHA_MYSQL_FORTE
host=127.0.0.1
EOF
sudo chmod 0600 /etc/mysql/luminno-backup.cnf
```

O banco deve escutar localmente. Confirme antes de seguir:

```bash
sudo ss -lntp | grep 3306
```

## 7. Criar o ambiente da aplicação

Gere dois segredos distintos. Ambos devem ter no mínimo 32 caracteres; 64 bytes hexadecimais oferecem margem de segurança.

```bash
openssl rand -hex 64  # JWT_SECRET
openssl rand -hex 64  # AUTH_RATE_LIMIT_SECRET
```

Crie `/etc/luminno/luminno.env`. Se a senha do MySQL incluir caracteres reservados por URL, como `@`, `:`, `/` ou `#`, codifique-a antes de preencher `DATABASE_URL`.

```bash
sudo tee /etc/luminno/luminno.env >/dev/null <<'EOF'
NODE_ENV=production
PORT=3000
DATABASE_URL=mysql://luminno_app:SENHA_MYSQL_FORTE@127.0.0.1:3306/luminno
JWT_SECRET=COLE_O_PRIMEIRO_SEGREDO
AUTH_RATE_LIMIT_SECRET=COLE_O_SEGUNDO_SEGREDO
UPLOAD_DIR=/var/lib/luminno/uploads
PDF_HISTORY_DIR=/var/lib/luminno/pdf-history
EOF

sudo chown root:luminno /etc/luminno/luminno.env
sudo chmod 0640 /etc/luminno/luminno.env
```

`JWT_SECRET` assina as sessões HTTP-only. `AUTH_RATE_LIMIT_SECRET` protege a chave usada pelo limitador de tentativas de login e deve ser diferente do segredo de sessão. O serviço lê o arquivo por meio do `systemd`; não é necessário conceder leitura direta ao usuário `luminno`.

## 8. Aplicar as migrações versionadas

O projeto contém migrações Drizzle versionadas. Use-as tanto para a primeira instalação quanto para futuras atualizações; **não use** `drizzle-kit push` como atalho em produção.

```bash
sudo -u luminno -H bash -lc '
  set -a
  . /etc/luminno/luminno.env
  set +a
  cd /opt/luminno-orcamentos
  pnpm drizzle-kit migrate
'
```

Em uma base nova, esse comando aplica todas as migrações incluídas no código. Se uma migração falhar, não inicie o serviço: preserve o log, valide `DATABASE_URL` e corrija a causa antes de prosseguir.

```bash
mysql --defaults-extra-file=/etc/mysql/luminno-backup.cnf luminno -e 'SHOW TABLES;'
```

## 9. Criar o serviço systemd

Esta unidade inicia a aplicação sem privilégios de `root`, reinicia quando necessário e permite escrita somente nos diretórios persistentes de uploads e PDFs privados.

```bash
sudo tee /etc/systemd/system/luminno.service >/dev/null <<'EOF'
[Unit]
Description=Luminno Orçamentos
After=network-online.target mysql.service
Wants=network-online.target

[Service]
Type=simple
User=luminno
Group=luminno
WorkingDirectory=/opt/luminno-orcamentos
EnvironmentFile=/etc/luminno/luminno.env
ExecStart=/usr/bin/node /opt/luminno-orcamentos/dist/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/luminno/uploads /var/lib/luminno/pdf-history

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now luminno
sudo systemctl status luminno --no-pager
```

Valide primeiro o serviço local. A porta 3000 deve estar livre; se outro processo a ocupar, corrija o conflito em vez de deixar o servidor escolher outra porta, pois o Tunnel será configurado para 3000.

```bash
sudo ss -lntp | grep ':3000' || true
curl --fail --silent --show-error http://127.0.0.1:3000/ >/dev/null && echo "HTTP local OK"
sudo journalctl -u luminno -n 100 --no-pager
```

## 10. Instalar cloudflared

O método recomendado pela Cloudflare para Debian e Ubuntu é o repositório APT estável, que recebe atualizações. O pacote `.deb` direto continua possível como alternativa oficial, mas exige acompanhamento manual de versões. [5] [6]

```bash
sudo install -d -m 0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | \
  sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | \
  sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update
sudo apt install -y cloudflared
cloudflared --version
```

## 11. Criar e publicar o Cloudflare Tunnel

No painel Cloudflare, abra **Networking → Tunnels → Create Tunnel**. Dê um nome claro, por exemplo `luminno-producao`; escolha Linux e a arquitetura correta; e copie o comando de instalação mostrado em **Install and Run**. O token do Tunnel é uma credencial e deve ser guardado como segredo. [1]

Para um Tunnel gerenciado pelo painel, o comando tem este formato:

```bash
sudo cloudflared service install SEU_TUNNEL_TOKEN
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared --no-pager
```

Quando o estado aparecer como **Healthy**, abra o Tunnel no painel e adicione uma rota em **Routes → Add route → Published application**.

| Campo Cloudflare | Valor do Luminno               |
| ---------------- | ------------------------------ |
| Hostname         | `orcamentos.seudominio.com.br` |
| Service type     | `HTTP`                         |
| Service URL      | `http://127.0.0.1:3000`        |

Ao salvar, a Cloudflare cria ou orienta a criação do registro DNS associado ao subdomínio do Tunnel. O fluxo de Tunnel gerenciado remotamente e o serviço por token permanecem suportados pela documentação atual. [1]

> Não utilize Quick Tunnels (`trycloudflare.com`) em produção. Eles servem apenas para testes e têm limitações operacionais. [1]

Valide a conectividade e consulte os logs:

```bash
sudo systemctl is-active --quiet cloudflared && echo "Tunnel ativo"
sudo journalctl -u cloudflared -n 100 --no-pager
```

## 12. Primeiro acesso e restauração

Abra `https://orcamentos.seudominio.com.br`. A primeira tela deve solicitar a criação do administrador local. Use uma senha de 12 ou mais caracteres, guarde-a em gerenciador de senhas e não reutilize a senha do MySQL.

Depois de entrar, acesse **Configurações → Backup e restauração manual → Importar JSON**, selecione o arquivo de backup e confirme a substituição de dados. Faça isso somente depois de confirmar que a base vazia e o primeiro login estão funcionando.

Se você migrou uma instalação anterior, restaure os arquivos persistentes com propriedade e permissões adequadas:

```bash
sudo rsync -av /tmp/luminno-uploads/ /var/lib/luminno/uploads/
sudo rsync -av /tmp/luminno-pdf-history/ /var/lib/luminno/pdf-history/
sudo chown -R luminno:luminno /var/lib/luminno/uploads /var/lib/luminno/pdf-history
sudo find /var/lib/luminno/uploads /var/lib/luminno/pdf-history -type d -exec chmod 0750 {} \;
sudo find /var/lib/luminno/uploads /var/lib/luminno/pdf-history -type f -exec chmod 0640 {} \;
```

No painel **Administração**, confirme o estado da aplicação, banco e armazenamento. Teste upload de logo, imagem de produto, criação de orçamento, geração de PDF e download do PDF no histórico autenticado.

## 13. Checklist de aceitação

| Verificação    | Como confirmar                                        | Resultado esperado                                |
| -------------- | ----------------------------------------------------- | ------------------------------------------------- |
| Serviço Node   | `systemctl is-active luminno`                         | `active`                                          |
| Resposta local | `curl --fail http://127.0.0.1:3000/`                  | Resposta HTTP válida                              |
| Banco          | Administração e `SHOW TABLES`                         | Banco conectado e tabelas existentes              |
| Tunnel         | Painel Cloudflare e `systemctl is-active cloudflared` | `Healthy` e `active`                              |
| Domínio        | Janela anônima no hostname HTTPS                      | Tela de login local do Luminno                    |
| Segurança      | `sudo ufw status`                                     | SSH controlado; 3000 e 3306 não públicos          |
| Upload         | Enviar logo e imagem de catálogo                      | Arquivos respondem em `/uploads/...`              |
| PDF privado    | Gerar e baixar pelo histórico autenticado             | PDF salvo em `pdf-history`, sem diretório público |
| Dados          | Conferir clientes, produtos e orçamentos              | Dados do JSON restaurados corretamente            |
| Backup         | Executar a rotina e testar arquivo                    | Dump, uploads e PDFs disponíveis                  |

## 14. Backups automáticos recomendados

O backup JSON manual ajuda na portabilidade, mas o backup operacional deve incluir MySQL, uploads, PDFs privados, arquivo de ambiente e uma cópia externa criptografada.

```bash
sudo install -d -o root -g root -m 0700 /var/backups/luminno
sudo tee /usr/local/sbin/luminno-backup.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

STAMP=$(date +%F-%H%M%S)
TARGET=/var/backups/luminno/$STAMP
mkdir -p "$TARGET"

# As credenciais estão em /etc/mysql/luminno-backup.cnf, com modo 0600.
mysqldump --defaults-extra-file=/etc/mysql/luminno-backup.cnf \
  --single-transaction --routines --triggers --events luminno | gzip > "$TARGET/mysql.sql.gz"
tar -C /var/lib/luminno -czf "$TARGET/arquivos.tar.gz" uploads pdf-history
cp /etc/luminno/luminno.env "$TARGET/luminno.env.backup"
sha256sum "$TARGET"/* > "$TARGET/SHA256SUMS"
chmod 0600 "$TARGET"/*

# Retém 14 dias localmente. Mantenha cópias externas separadas.
find /var/backups/luminno -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
EOF
sudo chmod 0700 /usr/local/sbin/luminno-backup.sh
```

Programe a execução diária no `cron` de `root`:

```bash
sudo crontab -e
# Inclua:
15 2 * * * /usr/local/sbin/luminno-backup.sh >> /var/log/luminno-backup.log 2>&1
```

Copie periodicamente `/var/backups/luminno/` para armazenamento externo criptografado. Teste uma restauração em banco de homologação: um backup nunca restaurado ainda não está comprovado.

## 15. Atualizações futuras sem perder dados

Antes de atualizar, crie um backup, pare o serviço e preserve os diretórios em `/var/lib/luminno/` e o arquivo `/etc/luminno/luminno.env`. Não copie `.env`, segredos, uploads ou PDFs pelo Git.

```bash
sudo /usr/local/sbin/luminno-backup.sh
sudo systemctl stop luminno

sudo find /opt/luminno-orcamentos -mindepth 1 -maxdepth 1 -exec rm -rf {} +
sudo unzip /tmp/luminno-orcamentos-novo.zip -d /opt/luminno-orcamentos
sudo chown -R luminno:luminno /opt/luminno-orcamentos

sudo -u luminno -H bash -lc '
  set -a
  . /etc/luminno/luminno.env
  set +a
  cd /opt/luminno-orcamentos
  pnpm install --frozen-lockfile
  pnpm drizzle-kit migrate
  pnpm check
  pnpm test
  pnpm build
'

sudo systemctl start luminno
sudo systemctl status luminno --no-pager
```

Depois, valide o domínio e os fluxos de login, orçamento, PDF, separação, upload, estoque e financeiro. A atualização do código não exige alteração no Tunnel enquanto a origem permanecer `http://127.0.0.1:3000`.

## 16. Diagnóstico rápido

| Sintoma                              | Verificação                                                     | Ação inicial                                                    |
| ------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------- |
| Domínio retorna 502                  | `systemctl status luminno` e `curl http://127.0.0.1:3000/`      | Corrija o serviço local antes de alterar DNS ou Tunnel.         |
| Tunnel desconectado                  | `journalctl -u cloudflared -f`                                  | Confirme token e saída TCP/UDP 7844.                            |
| Login não mantém sessão              | Confirme `NODE_ENV=production`, `JWT_SECRET` e hostname público | Use o hostname exato configurado no Tunnel.                     |
| Rate limit gera erro de configuração | `sudo systemctl status luminno`                                 | Confirme `AUTH_RATE_LIMIT_SECRET` com pelo menos 32 caracteres. |
| Upload falha                         | `ls -ld /var/lib/luminno/uploads`                               | Corrija proprietário para `luminno:luminno` e modo `0750`.      |
| Histórico PDF falha                  | `ls -ld /var/lib/luminno/pdf-history` e `systemctl cat luminno` | Confirme `PDF_HISTORY_DIR`, permissão e `ReadWritePaths`.       |
| Banco indisponível                   | `sudo systemctl status mysql`                                   | Confirme `DATABASE_URL`, usuário e existência da base.          |
| Serviço reinicia continuamente       | `journalctl -u luminno -n 200 --no-pager`                       | Corrija a primeira exceção e só então reinicie.                 |

## Referências

[1] [Cloudflare — Setup de Tunnel e aplicação publicada](https://developers.cloudflare.com/tunnel/setup/)

[2] [Node.js — Linhas de lançamento e suporte](https://nodejs.org/en/about/previous-releases)

[3] [Cloudflare — Requisitos de firewall do Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/)

[4] [NodeSource — Distribuições Node.js para Ubuntu](https://deb.nodesource.com/)

[5] [Cloudflare Package Repository](https://pkg.cloudflare.com/index.html)

[6] [Cloudflare — Downloads oficiais de cloudflared](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)
