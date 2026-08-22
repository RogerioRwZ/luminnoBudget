# Guia de implantação do Luminno Orçamentos em VPS Ubuntu

> **Objetivo:** hospedar o Luminno Orçamentos em uma VPS com Ubuntu Server, banco MySQL, domínio próprio, HTTPS automático, execução supervisionada, backups e rotina de atualização.

## 1. Decisão técnica e condição importante

A arquitetura recomendada é **Ubuntu Server 24.04 LTS + Node.js LTS + pnpm + MySQL 8 + systemd + Caddy**. O Node executa a aplicação, o MySQL mantém os dados, o `systemd` reinicia o processo se necessário e o Caddy expõe o sistema no domínio com HTTPS. O Caddy gerencia certificado e renovação automaticamente quando o DNS aponta para a VPS e as portas 80 e 443 estão acessíveis. [1] [2]

| Camada | Componente recomendado | Função |
|---|---|---|
| Sistema operacional | Ubuntu Server 24.04 LTS | Base estável e atualizada da VPS. |
| Aplicação | Node.js LTS e pnpm | Compilação e execução do Luminno. |
| Banco | MySQL 8 | Dados de clientes, produtos, orçamentos, estoque e configurações. |
| Processos | `systemd` | Inicialização automática, reinício e logs. |
| Web/HTTPS | Caddy | Proxy reverso, TLS e compressão. |
| Dados de imagem | Diretório local ou S3 compatível | Logos e fotos dos produtos. |
| Backup | `mysqldump` + cópia externa | Recuperação de banco e imagens. |

**Não copie a versão atual diretamente para a VPS ainda.** Ela usa serviços gerenciados para autenticação e armazenamento de imagens: `OAUTH_SERVER_URL`, `VITE_APP_ID`, `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY` e URLs `/manus-storage/`. Além disso, as rotas de negócio atuais estão públicas. Em uma VPS, isso deve ser substituído por **login próprio**, proteção de rotas e armazenamento independente antes de qualquer exposição à internet.

> A versão hospedada na VPS deve ser tratada como uma variante independente, sem chaves de serviços gerenciados e sem dependência de URLs `/manus-storage/`.

## 2. Pré-requisitos

Antes de começar, confirme que você possui uma VPS com acesso `root` ou usuário com `sudo`, um IP público, um domínio ou subdomínio — por exemplo, `orcamentos.seudominio.com.br` — e acesso ao painel DNS do domínio. Para operação confortável, recomendo **2 vCPU, 4 GB de RAM e 40 GB SSD**; uma instalação menor pode funcionar para poucos usuários, mas deixa menos margem para compilação, banco e backup.

Configure no DNS um registro **A** apontando `orcamentos.seudominio.com.br` para o IP público da VPS. Se usar IPv6, crie também o registro **AAAA** somente se o endereço estiver corretamente roteado e liberado. Verifique a propagação antes de configurar o HTTPS:

```bash
dig +short orcamentos.seudominio.com.br A
curl -4 ifconfig.me
```

Os valores retornados devem corresponder ao IP público da VPS. Certificados públicos exigem que o domínio aponte para a máquina e que as portas 80 e 443 estejam alcançáveis externamente. [1] [2]

## 3. Etapa obrigatória: preparar a versão independente da VPS

Antes do primeiro deploy, confirme que a versão autônoma com autenticação local, armazenamento local e painel de administração está presente no código que será enviado. Essa fase é obrigatória se o sistema ficará acessível por domínio público.

| Ajuste necessário | Situação atual | Meta para a VPS |
|---|---|---|
| Autenticação | Integração de OAuth gerenciado; rotas de negócio públicas | Login local com senha forte, sessão segura e todas as rotas de gestão protegidas. |
| Armazenamento | Upload por API gerenciada e URLs `/manus-storage/` | Diretório `/var/lib/luminno/uploads` ou bucket S3/R2/Wasabi independente. |
| Validação de URL de imagem | Aceita `/manus-storage/` | Aceitar apenas `/uploads/` e URLs HTTPS explicitamente permitidas. |
| Proxy de storage | Rota interna de plataforma | Remover e servir uploads pelo Caddy ou por bucket privado/público controlado. |
| Porta da aplicação | Pode escutar em todas as interfaces | Escutar somente em `127.0.0.1:3000`; o Caddy será o único serviço público. |
| Autorização | Procedimentos de negócio públicos | Aplicar autenticação a leitura, gravação, backup, estoque e configurações. |

Para um primeiro ambiente de produção simples, recomendo **um único usuário administrador local**. O fluxo deve incluir tela de login, senha armazenada com hash Argon2id ou bcrypt, cookie `HttpOnly`, `Secure`, `SameSite=Lax`, expiração de sessão e um comando de criação/recuperação de administrador. Não exponha o backup JSON, o estoque ou as configurações sem autenticação.

Quando a adaptação estiver concluída, exporte o código para um repositório Git privado ou faça o download do projeto em arquivo `.zip`. Mantenha o arquivo `.env` **fora** do repositório.

## 4. Preparar e proteger o Ubuntu Server

Conecte-se por SSH e atualize os pacotes. Faça isso em uma sessão adicional ou use o console web do provedor para não perder acesso durante a configuração do firewall.

```bash
ssh root@IP_DA_VPS
apt update && apt -y full-upgrade
apt install -y curl ca-certificates gnupg git ufw unzip
reboot
```

Após reconectar, crie um usuário administrativo pessoal e um usuário de serviço sem login interativo:

```bash
adduser administrador
usermod -aG sudo administrador

adduser --system --group --home /opt/luminno --shell /usr/sbin/nologin luminno
install -d -o luminno -g luminno -m 0750 /opt/luminno/app
install -d -o luminno -g luminno -m 0750 /var/lib/luminno/uploads
install -d -o root -g root -m 0750 /var/backups/luminno
install -d -o root -g luminno -m 0750 /etc/luminno
```

Configure uma chave SSH para o usuário administrativo, teste uma nova conexão e só então endureça o SSH. A documentação do Ubuntu recomenda usar o UFW para controlar as regras de tráfego. [3]

```bash
# Faça isto somente depois de testar login por chave em outro terminal.
sudoedit /etc/ssh/sshd_config.d/99-luminno-hardening.conf
```

Adicione:

```text
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

Em seguida, valide e recarregue o SSH:

```bash
sshd -t && systemctl reload ssh
```

Libere primeiro o SSH no firewall e, depois, HTTP/HTTPS. **Não habilite o UFW antes de liberar SSH.**

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status verbose
```

Mantenha a porta do MySQL bloqueada externamente. A aplicação e o banco estarão na mesma VPS e se comunicarão por `localhost`.

## 5. Instalar Node.js LTS e pnpm

Use uma versão **LTS atual** do Node.js. A página oficial indica a linha LTS vigente; no momento da elaboração deste guia, Node.js 24 é a linha LTS apresentada. [4] Para facilitar a execução pelo `systemd`, instale Node em nível de sistema pelo repositório de distribuições NodeSource para Debian/Ubuntu. [5] Após a instalação, valide o binário.

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
```

```bash
node --version
npm --version
corepack enable
corepack prepare pnpm@10.4.1 --activate
pnpm --version
```

O projeto fixa `pnpm` 10.x e requer dependências de compilação como Vite, TypeScript e esbuild. Não execute `npm install` em paralelo e não misture gerenciadores de pacote; use somente `pnpm` no diretório do projeto.

## 6. Instalar e configurar MySQL

Instale o MySQL localmente e execute o assistente de segurança do pacote:

```bash
apt install -y mysql-server
mysql_secure_installation
systemctl enable --now mysql
```

Abra o console MySQL como administrador local:

```bash
sudo mysql
```

Crie o banco e dois usuários: um para a aplicação e outro, com permissões de leitura, para backup. Gere senhas sem caracteres que exijam codificação especial na URL de conexão, por exemplo com `openssl rand -hex 32`.

```sql
CREATE DATABASE luminno CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER 'luminno_app'@'localhost' IDENTIFIED BY 'COLE_AQUI_UMA_SENHA_ALEATORIA_HEXADECIMAL';
GRANT ALL PRIVILEGES ON luminno.* TO 'luminno_app'@'localhost';

CREATE USER 'luminno_backup'@'localhost' IDENTIFIED BY 'OUTRA_SENHA_ALEATORIA_HEXADECIMAL';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES, EXECUTE ON luminno.* TO 'luminno_backup'@'localhost';

FLUSH PRIVILEGES;
EXIT;
```

Crie o arquivo de credenciais da aplicação, protegido contra leitura de outros usuários:

```bash
sudoedit /etc/luminno/luminno.env
sudo chown root:luminno /etc/luminno/luminno.env
sudo chmod 0640 /etc/luminno/luminno.env
```

Conteúdo inicial — substitua todos os exemplos:

```dotenv
NODE_ENV=production
PORT=3000
DATABASE_URL=mysql://luminno_app:SENHA_HEXADECIMAL@127.0.0.1:3306/luminno
JWT_SECRET=GERE_UMA_CHAVE_COM_OPENSSL_RAND_HEX_64
UPLOAD_DIR=/var/lib/luminno/uploads
APP_ORIGIN=https://orcamentos.seudominio.com.br
```

Gere o segredo de sessão com:

```bash
openssl rand -hex 64
```

As variáveis de autenticação, armazenamento e origem precisam corresponder à versão independente preparada na etapa 3. **Não copie** `BUILT_IN_FORGE_API_KEY`, `VITE_FRONTEND_FORGE_API_KEY`, `OAUTH_SERVER_URL` ou qualquer outro segredo de ambiente gerenciado para esta VPS.

## 7. Transferir, instalar e compilar a aplicação

Prefira um repositório privado. No exemplo abaixo, o usuário `luminno` recebe apenas a cópia de produção do código. Troque a URL pelo seu repositório.

```bash
sudo -u luminno -H git clone https://github.com/SUA-CONTA/luminno-orcamentos.git /opt/luminno/app
cd /opt/luminno/app
sudo -u luminno -H pnpm install --frozen-lockfile
sudo -u luminno -H pnpm test
sudo -u luminno -H pnpm build
```

Antes de inicializar o sistema, aplique **somente as migrações versionadas e revisadas**. Não use comandos de sincronização automática de esquema em produção. O Drizzle está configurado para MySQL e lê `DATABASE_URL`; portanto, carregue as variáveis e execute a migração controlada:

```bash
cd /opt/luminno/app
sudo -u luminno -H bash -c 'set -a; . /etc/luminno/luminno.env; set +a; pnpm exec drizzle-kit migrate --config=drizzle.config.ts'
```

Confirme antes que todas as migrações da aplicação — inclusive as estruturas de estoque, reservas, fornecedores e alerta de vencimento — estejam versionadas no repositório. Faça o primeiro teste usando uma cópia de banco vazia ou uma restauração de backup, nunca sobre a única base em produção.

## 8. Configurar a aplicação como serviço `systemd`

Crie a unidade abaixo. Ela mantém a aplicação em execução, a reinicia quando falhar e entrega os logs ao `journalctl`.

```bash
sudoedit /etc/systemd/system/luminno.service
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

> Ajuste `ExecStart` caso `command -v node` retorne outro caminho. A versão independente deve iniciar o Express ligado a `127.0.0.1` na porta 3000; não exponha diretamente essa porta para a internet.

Ative e valide o serviço:

```bash
systemctl daemon-reload
systemctl enable --now luminno
systemctl status luminno --no-pager
curl -I http://127.0.0.1:3000
journalctl -u luminno -n 100 --no-pager
```

## 9. Configurar Caddy e HTTPS

Instale o Caddy pelo método oficial da documentação do projeto e valide a versão instalada. [6]

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
chmod o+r /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
caddy version
```

Em seguida, crie o arquivo de site:

```bash
sudoedit /etc/caddy/Caddyfile
```

```caddyfile
orcamentos.seudominio.com.br {
    encode zstd gzip

    @uploads path /uploads/*
    handle @uploads {
        root * /var/lib/luminno
        file_server
    }

    reverse_proxy 127.0.0.1:3000

    log {
        output file /var/log/caddy/luminno-access.log
        format json
    }
}
```

Crie o diretório de log, teste a sintaxe e aplique a configuração:

```bash
install -d -o caddy -g caddy -m 0750 /var/log/caddy
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable --now caddy
systemctl reload caddy
systemctl status caddy --no-pager
```

O Caddy provisiona HTTPS e redireciona HTTP para HTTPS quando o domínio, DNS e portas públicas estão corretos. [1] [2] Confirme no navegador e no terminal:

```bash
curl -I https://orcamentos.seudominio.com.br
```

Se as fotos e logos forem públicas no sistema, deixe diretórios com leitura controlada para o Caddy:

```bash
chown -R luminno:caddy /var/lib/luminno/uploads
find /var/lib/luminno -type d -exec chmod 0750 {} \;
find /var/lib/luminno -type f -exec chmod 0640 {} \;
systemctl restart caddy
```

Teste um upload de imagem pelo catálogo e outro pelo campo de logotipo. A URL retornada deve começar por `/uploads/`, nunca por `/manus-storage/`.

## 10. Backup local, cópia externa e teste de restauração

O backup manual JSON dentro da aplicação é útil para portabilidade, mas **não substitui** um dump consistente do banco nem cópia dos arquivos enviados. Mantenha três camadas: dump MySQL, diretório de uploads e cópia externa criptografada. A documentação do Ubuntu também oferece orientações específicas sobre estratégias de backup. [7]

Crie um arquivo de credenciais exclusivo para a rotina de backup:

```bash
sudoedit /root/.my-luminno-backup.cnf
sudo chmod 0600 /root/.my-luminno-backup.cnf
```

```ini
[client]
user=luminno_backup
password=SENHA_DO_USUARIO_DE_BACKUP
host=localhost
```

Crie o script:

```bash
sudoedit /usr/local/sbin/luminno-backup
sudo chmod 0700 /usr/local/sbin/luminno-backup
```

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR=/var/backups/luminno
STAMP=$(date +%F_%H-%M-%S)
mkdir -p "$BACKUP_DIR"

mysqldump --defaults-extra-file=/root/.my-luminno-backup.cnf \
  --single-transaction --routines --triggers luminno \
  | gzip > "$BACKUP_DIR/luminno-db_${STAMP}.sql.gz"

tar -C /var/lib/luminno -czf "$BACKUP_DIR/luminno-uploads_${STAMP}.tar.gz" uploads

find "$BACKUP_DIR" -type f -mtime +30 -delete
```

Agende a execução diária às 02:15:

```bash
sudoedit /etc/cron.d/luminno-backup
```

```cron
15 2 * * * root /usr/local/sbin/luminno-backup >> /var/log/luminno-backup.log 2>&1
```

Execute a primeira cópia manual e verifique o resultado:

```bash
/usr/local/sbin/luminno-backup
ls -lh /var/backups/luminno
```

Depois, replique `/var/backups/luminno` para um local **fora da VPS**, como bucket S3 compatível, servidor remoto via `restic` ou backup do provedor. Um backup existente na mesma máquina não protege contra perda total da VPS. Ao menos trimestralmente, faça um teste de restauração em banco separado:

```bash
zcat /var/backups/luminno/luminno-db_DATA.sql.gz | mysql -u root luminno_teste
```

## 11. Rotina de atualização e reversão

Toda atualização deve seguir uma sequência previsível. Faça o backup antes de alterar qualquer arquivo e mantenha o commit ou release atualmente em produção identificável.

```bash
/usr/local/sbin/luminno-backup
cd /opt/luminno/app
sudo -u luminno -H git fetch --all --tags
sudo -u luminno -H git checkout TAG_OU_COMMIT_REVISADO
sudo -u luminno -H pnpm install --frozen-lockfile
sudo -u luminno -H pnpm test
sudo -u luminno -H pnpm build

sudo -u luminno -H bash -c 'set -a; . /etc/luminno/luminno.env; set +a; pnpm exec drizzle-kit migrate --config=drizzle.config.ts'

systemctl restart luminno
systemctl status luminno --no-pager
curl -fsS https://orcamentos.seudominio.com.br/ > /dev/null
```

Se houver erro após uma atualização, volte ao commit anterior, reconstrua a aplicação e reinicie o serviço. **Não reverta uma migração de banco sem um plano específico**; restaure o backup somente se a mudança de dados exigir isso.

```bash
cd /opt/luminno/app
sudo -u luminno -H git checkout COMMIT_ANTERIOR
sudo -u luminno -H pnpm install --frozen-lockfile
sudo -u luminno -H pnpm build
systemctl restart luminno
journalctl -u luminno -n 100 --no-pager
```

## 12. Checklist de entrada em produção

| Verificação | Critério de aceite |
|---|---|
| DNS | O domínio retorna o IP correto da VPS. |
| HTTPS | `https://` abre sem aviso de certificado. |
| Firewall | Apenas SSH, 80 e 443 estão públicos; 3306 e 3000 não estão. |
| Serviço | `systemctl is-active luminno` retorna `active`. |
| Banco | O MySQL aceita conexão somente local da aplicação. |
| Login | Nenhuma rota administrativa funciona sem sessão válida. |
| Upload | Logo e imagem de produto gravam em `/var/lib/luminno/uploads` e abrem por `/uploads/`. |
| Dados | Clientes, orçamento, estoque, entrega parcial, reserva e separação funcionam após migração. |
| Backup | Existe dump recente e cópia externa; uma restauração de teste foi concluída. |
| Logs | `journalctl -u luminno` e `/var/log/caddy/luminno-access.log` não apresentam falhas recorrentes. |

## 13. O que eu recomendo fazer agora

O próximo passo correto é executar este guia primeiro em um subdomínio de homologação — por exemplo, `homolog.orcamentos.seudominio.com.br` — com um banco de teste. Na primeira abertura, crie o administrador local pelo formulário seguro; depois, use o painel Administração para cadastrar os demais acessos. Somente após validar login, upload, backup e restauração, aponte o domínio de produção.

## Referências

[1] [Caddy — Reverse proxy quick-start](https://caddyserver.com/docs/quick-starts/reverse-proxy)

[2] [Caddy — Automatic HTTPS](https://caddyserver.com/docs/automatic-https)

[3] [Ubuntu Server — Firewall com UFW](https://documentation.ubuntu.com/server/how-to/security/firewalls/)

[4] [Node.js — Download e versões LTS](https://nodejs.org/en/download)

[5] [NodeSource — Distribuições Node.js para Ubuntu](https://deb.nodesource.com/)

[6] [Caddy — Instalação](https://caddyserver.com/docs/install)

[7] [Ubuntu Server — Backups e controle de versões](https://documentation.ubuntu.com/server/how-to/backups/)
