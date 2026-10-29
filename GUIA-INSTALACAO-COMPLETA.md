# Guia completo de instalação do Luminno Orçamentos

Este guia leva uma VPS **Ubuntu Server 24.04 LTS** recém-criada até o Luminno funcionando em produção, com domínio próprio, HTTPS, banco MySQL, serviço supervisionado e backup automático. Ele foi conferido contra o código atual (branch `main`, após o PR #8) e substitui o `guia-implantacao-vps-ubuntu.md`.

> **Convenções:**
> - Comandos com `sudo` são executados pelo seu usuário administrativo.
> - Troque sempre `orcamentos.seudominio.com.br` pelo seu domínio real.
> - Troque também todo valor em MAIÚSCULAS (`SENHA_...`, `IP_DA_VPS` etc.) pelos seus valores.

---

## Visão geral

```
Navegador ──HTTPS──▶ Caddy (portas 80/443) ──▶ Node.js 127.0.0.1:3000 ──▶ MySQL 127.0.0.1:3306
                                                    │
                                                    └─▶ /var/lib/luminno/uploads      (imagens e anexos)
                                                    └─▶ /var/lib/luminno/pdf-history  (PDFs gerados)
```

| Camada | Componente | Função |
|---|---|---|
| Sistema | Ubuntu Server 24.04 LTS | Base da VPS |
| Aplicação | Node.js 24 LTS + pnpm 11.24.0 | Compila e executa o Luminno |
| Banco | MySQL 8 | Clientes, produtos, orçamentos, estoque, financeiro, usuários |
| Processo | `systemd` | Inicia com o servidor, reinicia em falhas, guarda logs |
| HTTPS | Caddy | Certificado automático e proxy reverso |
| Backup | `mysqldump` + `tar` + cron | Cópia diária do banco e dos arquivos |

**Requisitos mínimos:**
- VPS com 2 vCPU, 4 GB de RAM e 40 GB de SSD. Com 2 GB de RAM a compilação do front-end pode falhar; nesse caso, crie swap (passo 2.5).
- Acesso `root` ou um usuário com `sudo`.
- Um domínio ou subdomínio com acesso ao painel de DNS.

**Tempo estimado:** de 60 a 90 minutos.

---

## 1. Apontar o domínio para a VPS

No painel de DNS do seu domínio, crie um registro **A**:

| Tipo | Nome | Valor |
|---|---|---|
| A | `orcamentos` | `IP_DA_VPS` |

> Se o domínio estiver na **Cloudflare**, deixe a nuvem **cinza** ("DNS only"). Com a nuvem laranja, o Caddy não emite o certificado sozinho, e a aplicação passa a ver o IP da Cloudflare em vez do IP real dos usuários, o que atrapalha o limite de tentativas de login. Se preferir usar a Cloudflare, siga o `guia-exportacao-vps-cloudflared.md` (Cloudflare Tunnel) no lugar do passo 8.

Depois de alguns minutos, confira de qualquer computador. O comando abaixo deve devolver o IP da VPS:

```bash
dig +short orcamentos.seudominio.com.br A
```

---

## 2. Preparar e proteger o servidor

### 2.1 Atualizar o sistema

```bash
ssh root@IP_DA_VPS
apt update && apt -y full-upgrade
apt install -y curl ca-certificates gnupg git ufw unzip rsync
reboot
```

### 2.2 Criar seu usuário administrativo

Reconecte como `root` e crie um usuário pessoal com `sudo`:

```bash
ssh root@IP_DA_VPS
adduser administrador
usermod -aG sudo administrador
```

Copie sua chave SSH para ele, rodando este comando **no seu computador**:

```bash
ssh-copy-id administrador@IP_DA_VPS
```

**Abra um novo terminal** e confirme que entra sem senha: `ssh administrador@IP_DA_VPS`. Só continue se isso funcionar.

### 2.3 Bloquear login por senha e login como root

```bash
sudo tee /etc/ssh/sshd_config.d/99-luminno.conf > /dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
EOF
sudo sshd -t && sudo systemctl reload ssh
```

### 2.4 Ativar o firewall

Libere o SSH **antes** de ativar o firewall, senão você perde o acesso à VPS:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

As portas **3000** (aplicação) e **3306** (MySQL) devem continuar fechadas. A aplicação escuta em todas as interfaces, e é o firewall que impede o acesso direto a ela.

### 2.5 (Somente com 2 GB de RAM) criar swap

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 2.6 Criar o usuário de serviço e as pastas

```bash
sudo adduser --system --group --home /opt/luminno --shell /usr/sbin/nologin luminno
sudo install -d -o luminno -g luminno -m 0750 /opt/luminno/app
sudo install -d -o luminno -g luminno -m 0750 /var/lib/luminno
sudo install -d -o luminno -g luminno -m 0750 /var/lib/luminno/uploads
sudo install -d -o luminno -g luminno -m 0750 /var/lib/luminno/pdf-history
sudo install -d -o root -g root -m 0750 /var/backups/luminno
sudo install -d -o root -g luminno -m 0750 /etc/luminno
```

| Pasta | Conteúdo |
|---|---|
| `/opt/luminno/app` | Código-fonte e build |
| `/var/lib/luminno/uploads` | Fotos de produtos, logotipo e **anexos de orçamentos** |
| `/var/lib/luminno/pdf-history` | PDFs de orçamentos gerados |
| `/etc/luminno` | Arquivo de configuração com as senhas |
| `/var/backups/luminno` | Backups diários |

---

## 3. Instalar Node.js 24 LTS e pnpm

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt install -y nodejs
node --version
```

O resultado deve começar por `v24.`.

Ative o pnpm na versão que o projeto exige:

```bash
sudo corepack enable
sudo corepack prepare pnpm@11.24.0 --activate
pnpm --version
```

O resultado deve ser `11.24.0`.

> **Importante:** use exatamente o pnpm 11.24.0. O pnpm 10 recusa o `pnpm-lock.yaml` deste projeto com o erro `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. Não use `npm install` nem `yarn`.

---

## 4. Instalar e configurar o MySQL

### 4.1 Instalar

```bash
sudo apt install -y mysql-server
sudo systemctl enable --now mysql
sudo mysql_secure_installation
```

No assistente, responda **sim** para remover usuários anônimos, bloquear login remoto do root e remover o banco de testes.

### 4.2 Gerar as senhas

Gere três valores aleatórios e guarde-os num gerenciador de senhas:

```bash
openssl rand -hex 24   # senha do usuário luminno_app
openssl rand -hex 24   # senha do usuário luminno_backup
openssl rand -hex 64   # JWT_SECRET
```

> Use a saída em hexadecimal: ela não tem caracteres que precisariam de escape na URL de conexão.

### 4.3 Criar o banco e os usuários

```bash
sudo mysql
```

```sql
CREATE DATABASE luminno CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER 'luminno_app'@'localhost' IDENTIFIED BY 'SENHA_APP';
GRANT ALL PRIVILEGES ON luminno.* TO 'luminno_app'@'localhost';

CREATE USER 'luminno_backup'@'localhost' IDENTIFIED BY 'SENHA_BACKUP';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES, PROCESS ON *.* TO 'luminno_backup'@'localhost';

FLUSH PRIVILEGES;
EXIT;
```

Teste o acesso da aplicação. Deve abrir o console do MySQL sem erro:

```bash
mysql -u luminno_app -p -h 127.0.0.1 luminno -e "SELECT 1;"
```

---

## 5. Criar o arquivo de configuração

```bash
sudo nano /etc/luminno/luminno.env
```

Cole o conteúdo abaixo, trocando os valores:

```dotenv
NODE_ENV=production
PORT=3000
DATABASE_URL=mysql://luminno_app:SENHA_APP@127.0.0.1:3306/luminno
JWT_SECRET=VALOR_DE_64_BYTES_GERADO_NO_PASSO_4_2
UPLOAD_DIR=/var/lib/luminno/uploads
PDF_HISTORY_DIR=/var/lib/luminno/pdf-history
```

Proteja o arquivo:

```bash
sudo chown root:luminno /etc/luminno/luminno.env
sudo chmod 0640 /etc/luminno/luminno.env
```

| Variável | Obrigatória | Descrição |
|---|---|---|
| `NODE_ENV` | Sim | Deve ser `production` |
| `PORT` | Não (padrão 3000) | Porta interna da aplicação |
| `DATABASE_URL` | Sim | Conexão com o MySQL |
| `JWT_SECRET` | Sim | Assina as sessões de login. **Mínimo de 32 caracteres**, senão o login não funciona. Trocar esse valor desconecta todos os usuários. |
| `UPLOAD_DIR` | Recomendada | Pasta de imagens e anexos. O padrão é `./uploads` dentro do código, que se perde em reinstalações. |
| `PDF_HISTORY_DIR` | Recomendada | Pasta dos PDFs gerados. O padrão é `pdf-history`, ao lado da pasta de uploads. |
| `AUTH_RATE_LIMIT_SECRET` | Não | Chave do limitador de tentativas de login. Se não for definida, usa o `JWT_SECRET`. |

> As variáveis `OAUTH_SERVER_URL`, `VITE_APP_ID`, `BUILT_IN_FORGE_API_*` e `VITE_FRONTEND_FORGE_*` vêm do ambiente antigo e **não** são usadas nesta instalação. Não as defina.

---

## 6. Baixar, compilar e preparar o banco

### 6.1 Baixar o código

```bash
sudo -u luminno -H git clone https://github.com/RogerioRwZ/luminnoBudget.git /opt/luminno/app
cd /opt/luminno/app
sudo -u luminno -H git checkout main
```

> Se o repositório for privado, o comando pede usuário e token. Para não salvar o token no servidor, prefira uma *deploy key* (chave SSH só de leitura, cadastrada em GitHub → Settings do repositório → Deploy keys) e clone por `git@github.com:RogerioRwZ/luminnoBudget.git`.

### 6.2 Instalar as dependências

```bash
sudo -u luminno -H pnpm install --frozen-lockfile
```

### 6.3 Compilar

> **Não use `pnpm build` no servidor.** Esse script também roda a suíte de testes, e ela precisa de um banco de dados:
> - Sem a variável `DATABASE_URL`, os testes de integração falham e o build é interrompido.
> - Com ela, os testes criam e apagam registros de teste **no banco de produção**.
>
> Os testes já rodam no GitHub (CI) a cada pull request. No servidor, compile direto:

```bash
cd /opt/luminno/app
sudo -u luminno -H pnpm check
sudo -u luminno -H pnpm exec vite build
sudo -u luminno -H pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
```

Confira se os dois arquivos foram gerados:

```bash
ls -lh dist/index.js dist/public/index.html
```

### 6.4 Criar as tabelas

Aplique as migrações versionadas, que ficam na pasta `drizzle/`:

```bash
cd /opt/luminno/app
sudo -u luminno -H bash -c 'set -a; . /etc/luminno/luminno.env; set +a; pnpm exec drizzle-kit migrate'
```

A saída deve terminar com `migrations applied successfully!`.

> **Não use `pnpm db:push` em produção.** Ele roda `drizzle-kit generate` antes e pode criar migrações novas a partir de diferenças locais.

---

## 7. Rodar a aplicação como serviço

### 7.1 Criar o serviço

```bash
sudo nano /etc/systemd/system/luminno.service
```

```ini
[Unit]
Description=Luminno Orçamentos
After=network.target mysql.service
Wants=mysql.service

[Service]
Type=simple
User=luminno
Group=luminno
WorkingDirectory=/opt/luminno/app
EnvironmentFile=/etc/luminno/luminno.env
ExecStart=/usr/bin/node /opt/luminno/app/dist/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=/var/lib/luminno

[Install]
WantedBy=multi-user.target
```

> Confira o caminho do Node com `command -v node`. Se for diferente de `/usr/bin/node`, ajuste o `ExecStart`.

### 7.2 Iniciar

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now luminno
sudo systemctl status luminno --no-pager
```

### 7.3 Conferir

```bash
sudo journalctl -u luminno -n 20 --no-pager
curl -s http://127.0.0.1:3000/api/health
```

**Log esperado:** `Server running on http://localhost:3000/`.

**Resposta esperada:** `{"status":"ok","database":"online",...}`

> **Atenção à porta.** Se a porta 3000 estiver ocupada, a aplicação sobe sozinha em outra (3001, 3002…) e avisa no log com `Port 3000 is busy`. Nesse caso o Caddy não vai encontrá-la. Libere a porta, ou ajuste `PORT` e o Caddyfile.
>
> Se `/api/health` responder `"database":"offline"` (HTTP 503), revise a `DATABASE_URL` e o passo 4.

---

## 8. Publicar com HTTPS (Caddy)

### 8.1 Instalar o Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

### 8.2 Configurar o site

```bash
sudo nano /etc/caddy/Caddyfile
```

Apague o conteúdo existente e cole:

```caddyfile
orcamentos.seudominio.com.br {
    encode zstd gzip

    # Anexos e PDFs enviados podem chegar a ~20 MB codificados.
    request_body {
        max_size 30MB
    }

    reverse_proxy 127.0.0.1:3000

    log {
        output file /var/log/caddy/luminno-access.log
        format json
    }
}
```

> **Não sirva a pasta `/uploads` diretamente pelo Caddy** com `file_server`, como sugeria o guia antigo. Os anexos de orçamentos ficam em `/uploads/attachments`, e é a aplicação que bloqueia o acesso público a eles e exige login para baixá-los. Se o Caddy servir a pasta direto, os anexos ficam acessíveis sem login. A própria aplicação já serve as imagens com cache de 7 dias.

### 8.3 Ativar

```bash
sudo install -d -o caddy -g caddy -m 0750 /var/log/caddy
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl enable caddy
sudo systemctl reload caddy
```

Em até um minuto, o Caddy emite o certificado. Confira:

```bash
curl -sI https://orcamentos.seudominio.com.br/api/health | head -1
```

Deve aparecer `HTTP/2 200`.

---

## 9. Primeiro acesso

1. Abra `https://orcamentos.seudominio.com.br` no navegador.
2. Como ainda não existe nenhum usuário, aparece a tela de **configuração inicial**. Crie o administrador: nome, usuário (3 a 80 caracteres) e uma senha com **pelo menos 12 caracteres**.

   > Faça isso **logo depois de publicar**: até o primeiro administrador ser criado, qualquer pessoa que abrir o endereço pode criá-lo.
3. Em **Configurações**, preencha os dados da loja, o logotipo, a chave PIX e as condições padrão.
4. Em **Administração**, cadastre os demais usuários (perfil *usuário* ou *administrador*).
5. Faça um teste completo:
   1. Cadastre um produto com foto.
   2. Crie um orçamento, gere o PDF e anexe um arquivo.
   3. Aprove o orçamento e confira o estoque e o financeiro.

### Migrando de uma instalação antiga

| O que copiar | Como restaurar |
|---|---|
| Dados (backup JSON) | Na instalação antiga, use **Configurações → Exportar backup**. Na nova, **Configurações → Restaurar backup**. |
| Imagens e anexos | `sudo rsync -a ANTIGO/uploads/ /var/lib/luminno/uploads/` |
| PDFs gerados | `sudo rsync -a ANTIGO/pdf-history/ /var/lib/luminno/pdf-history/` |

Depois de copiar os arquivos, corrija o dono:

```bash
sudo chown -R luminno:luminno /var/lib/luminno
```

> O backup JSON **não** inclui usuários, versões, comentários, anexos nem modelos de mensagem. Os usuários precisam ser recriados no painel de Administração. Para levar **tudo**, prefira copiar o banco inteiro com `mysqldump` (veja o passo 10.4).

---

## 10. Backup automático

### 10.1 Credenciais do backup

```bash
sudo tee /root/.my-luminno-backup.cnf > /dev/null <<'EOF'
[client]
user=luminno_backup
password=SENHA_BACKUP
host=127.0.0.1
EOF
sudo chmod 0600 /root/.my-luminno-backup.cnf
```

### 10.2 Script de backup

```bash
sudo tee /usr/local/sbin/luminno-backup > /dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
BACKUP_DIR=/var/backups/luminno
STAMP=$(date +%F_%H-%M-%S)
mkdir -p "$BACKUP_DIR"

mysqldump --defaults-extra-file=/root/.my-luminno-backup.cnf \
  --single-transaction --routines --triggers --no-tablespaces luminno \
  | gzip > "$BACKUP_DIR/luminno-db_${STAMP}.sql.gz"

# Imagens, anexos (uploads/attachments) e PDFs gerados
tar -C /var/lib/luminno -czf "$BACKUP_DIR/luminno-arquivos_${STAMP}.tar.gz" uploads pdf-history

find "$BACKUP_DIR" -type f -mtime +30 -delete
EOF
sudo chmod 0700 /usr/local/sbin/luminno-backup
```

### 10.3 Agendar e testar

O backup roda todo dia às 02:15:

```bash
echo '15 2 * * * root /usr/local/sbin/luminno-backup >> /var/log/luminno-backup.log 2>&1' | sudo tee /etc/cron.d/luminno-backup
sudo /usr/local/sbin/luminno-backup
sudo ls -lh /var/backups/luminno
```

> **Copie os backups para fora da VPS** (outro servidor, bucket S3/R2/B2 ou o backup do próprio provedor). Um backup guardado só na VPS não protege contra a perda da VPS.

### 10.4 Restaurar

Para conferir se o backup funciona, restaure-o num banco de teste:

```bash
sudo mysql -e "CREATE DATABASE luminno_restauracao"
zcat /var/backups/luminno/luminno-db_DATA.sql.gz | sudo mysql luminno_restauracao
sudo mysql -e "SELECT COUNT(*) FROM luminno_restauracao.quotes"
sudo mysql -e "DROP DATABASE luminno_restauracao"
```

Para uma restauração real:
1. Pare a aplicação com `sudo systemctl stop luminno`.
2. Importe o dump no banco `luminno`.
3. Extraia o `.tar.gz` em `/var/lib/luminno`.
4. Corrija o dono com `chown -R luminno:luminno /var/lib/luminno`.
5. Inicie a aplicação com `sudo systemctl start luminno`.

---

## 11. Atualizar para uma nova versão

```bash
sudo /usr/local/sbin/luminno-backup
cd /opt/luminno/app
sudo -u luminno -H git rev-parse --short HEAD > /tmp/luminno-versao-anterior
sudo -u luminno -H git pull --ff-only origin main
sudo -u luminno -H pnpm install --frozen-lockfile
sudo -u luminno -H pnpm check
sudo -u luminno -H pnpm exec vite build
sudo -u luminno -H pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
sudo -u luminno -H bash -c 'set -a; . /etc/luminno/luminno.env; set +a; pnpm exec drizzle-kit migrate'
sudo systemctl restart luminno
sleep 3 && curl -s http://127.0.0.1:3000/api/health
```

> A atualização que inclui o PR #8 (auditoria de segurança) **desconecta todos os usuários uma vez**: será preciso fazer login de novo. Ela não tem migração de banco.

**Voltar à versão anterior** se algo der errado:

```bash
cd /opt/luminno/app
sudo -u luminno -H git checkout $(cat /tmp/luminno-versao-anterior)
sudo -u luminno -H pnpm install --frozen-lockfile
sudo -u luminno -H pnpm exec vite build
sudo -u luminno -H pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
sudo systemctl restart luminno
```

> Voltar o código **não desfaz migrações de banco**. Se a versão nova tiver alterado tabelas, restaure o backup feito no início (passo 10.4).

---

## 12. Monitoramento e diagnóstico

| Para… | Comando |
|---|---|
| Ver se está no ar | `curl -s https://orcamentos.seudominio.com.br/api/health` |
| Logs da aplicação | `sudo journalctl -u luminno -f` |
| Logs de acesso | `sudo tail -f /var/log/caddy/luminno-access.log` |
| Reiniciar | `sudo systemctl restart luminno` |
| Espaço em disco | `df -h /var/lib/luminno` (também aparece em **Administração → Status do sistema**) |

O endereço `/api/health` responde **200** quando está tudo certo e **503** quando o banco está fora do ar. Dá para cadastrá-lo num monitor gratuito, como UptimeRobot ou Better Stack, para receber um alerta quando o sistema cair.

### Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` | pnpm na versão errada | Volte ao passo 3 e use o pnpm 11.24.0 |
| A compilação termina em `Killed` | Falta de memória | Crie swap (passo 2.5) |
| Erro "JWT_SECRET deve possuir ao menos 32 caracteres" | Segredo curto | Gere um novo com `openssl rand -hex 64` |
| `/api/health` responde `database: offline` | `DATABASE_URL` errada ou MySQL parado | `sudo systemctl status mysql` e revise o passo 5 |
| `502 Bad Gateway` no navegador | Aplicação parada ou em outra porta | `sudo journalctl -u luminno -n 50` |
| O certificado HTTPS não é emitido | DNS errado, portas 80/443 fechadas ou Cloudflare com nuvem laranja | Revise os passos 1 e 2.4 |
| Erro ao enviar arquivo grande | Limite do Caddy | Confira o `request_body` no Caddyfile |
| "Muitas tentativas" para todos os usuários ao mesmo tempo | Proxy extra na frente do Caddy (ex.: Cloudflare laranja), e todos aparecem com o mesmo IP | Deixe o DNS sem proxy, ou use o Cloudflare Tunnel |
| Imagens somem após reinstalar | Faltou `UPLOAD_DIR` no `.env` | Defina-o, mova os arquivos para `/var/lib/luminno/uploads` e reinicie |

---

## 13. Checklist final

- [ ] `dig` devolve o IP da VPS.
- [ ] `https://` abre sem aviso de certificado.
- [ ] `sudo ufw status` mostra apenas OpenSSH, 80 e 443.
- [ ] `curl http://IP_DA_VPS:3000` **não** responde quando executado de fora da VPS.
- [ ] `systemctl is-active luminno caddy mysql` mostra três vezes `active`.
- [ ] `/api/health` responde `ok`.
- [ ] Administrador criado e senha guardada.
- [ ] `https://orcamentos.seudominio.com.br/uploads/attachments/qualquer.pdf` responde **404**.
- [ ] Produto com foto, orçamento, PDF, anexo e aprovação testados.
- [ ] Backup manual executado e restaurado num banco de teste.
- [ ] Backups copiados para fora da VPS.
