# Luminno Orçamentos em VPS Ubuntu com Cloudflare Tunnel

Este guia descreve a implantação **autônoma** do Luminno Orçamentos em uma VPS Ubuntu Server usando MySQL local, armazenamento de imagens no próprio servidor, `systemd` para manter a aplicação ativa e **Cloudflare Tunnel** para publicar o domínio sem expor a porta da aplicação à Internet. A versão atual do projeto já possui autenticação própria, criação do primeiro administrador, uploads em `/uploads` e painel administrativo.

> **Objetivo final:** o navegador acessa `https://orcamentos.seudominio.com.br`; a Cloudflare encaminha a solicitação pelo túnel de saída da VPS; o `cloudflared` entrega a requisição apenas a `http://127.0.0.1:3000`. Assim, as portas `3000` e `3306` continuam privadas.

## 1. Antes de começar

| Item | Recomendação | Motivo |
|---|---|---|
| VPS | Ubuntu Server 22.04 ou 24.04 LTS, 2 GB RAM e 2 vCPU | Suporta Node.js, MySQL, build e backup com folga para a aplicação. |
| Domínio | Domínio já adicionado à Cloudflare, com DNS ativo | Um domínio na Cloudflare é requisito para publicar hostname por Tunnel. [1] |
| Acesso | Usuário SSH com `sudo` e chave SSH configurada | Evita operação contínua como `root`. |
| Banco | MySQL local na VPS | Mantém os dados fora da aplicação e permite backup consistente. |
| Exportação | ZIP do código e backup JSON do sistema atual | Separa código de dados de negócio. |
| Segredos | Nova senha MySQL e novo `JWT_SECRET` | Nunca reutilize ou publique segredos do ambiente atual. |

O Cloudflare Tunnel requer que a VPS consiga iniciar conexões de saída para a Cloudflare. Caso exista firewall de saída restritivo, libere a porta **7844**. [1]

## 2. Exportar o projeto e os dados daqui

Primeiro, salve o checkpoint mais recente do projeto. Em seguida, abra o painel **Code** na interface do projeto e use **Download all files** para baixar o ZIP do código-fonte. Guarde esse arquivo em seu computador, por exemplo como `luminno-orcamentos.zip`.

Depois, dentro da aplicação atual, acesse **Configurações → Backup e restauração manual → Exportar JSON**. Salve o arquivo com um nome datado, como `luminno-backup-2026-08-21.json`. Esse backup leva os dados comerciais; a conta local de administrador deve ser criada novamente na VPS por segurança. Caso já existam arquivos no diretório local de uploads de uma instalação anterior, copie também esse diretório. Imagens legadas hospedadas em URLs externas não são transferidas automaticamente: reenvie-as pelo catálogo ou pelas configurações após a migração.

No computador local, confira se você possui os dois artefatos antes de prosseguir.

| Arquivo | Exemplo | Destino na VPS |
|---|---|---|
| Código-fonte | `luminno-orcamentos.zip` | `/tmp/` e depois `/opt/luminno-orcamentos/` |
| Backup comercial | `luminno-backup-AAAA-MM-DD.json` | Diretório seguro temporário, para importar após o primeiro login |
| Uploads existentes, se houver | `uploads/` | `/var/lib/luminno/uploads/` |

Envie os dois primeiros arquivos pelo seu computador. Substitua `USUARIO`, `IP_DA_VPS` e os nomes reais dos arquivos.

```bash
scp luminno-orcamentos.zip USUARIO@IP_DA_VPS:/tmp/
scp luminno-backup-AAAA-MM-DD.json USUARIO@IP_DA_VPS:/tmp/
```

Se tiver uma pasta de uploads já existente, envie-a com `rsync`, que preserva a estrutura e permite retomar uma cópia interrompida:

```bash
rsync -avP ./uploads/ USUARIO@IP_DA_VPS:/tmp/luminno-uploads/
```

## 3. Preparar o Ubuntu e proteger o acesso SSH

Entre na VPS e atualize o sistema. Faça isso em uma sessão SSH separada da sua sessão atual, especialmente se estiver ajustando chaves ou firewall.

```bash
ssh USUARIO@IP_DA_VPS
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl unzip rsync git ufw fail2ban
```

Confirme que o acesso por **chave SSH** funciona antes de mudar a política de senha. Somente depois disso, configure um firewall mínimo. Como o site será publicado pelo Tunnel, não abra as portas 80, 443, 3000 ou 3306 ao público.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status verbose
```

> Mantenha a porta SSH aberta apenas pelo tempo necessário. Quando a origem do seu IP for estável, a regra pode ser restrita a `sudo ufw allow from SEU_IP to any port 22 proto tcp`.

## 4. Criar usuário de serviço e diretórios persistentes

O processo da aplicação não deve executar como `root`. Crie um usuário de sistema sem shell de login e os diretórios permanentes de código, uploads e configurações.

```bash
sudo adduser --system --group --home /opt/luminno --shell /usr/sbin/nologin luminno
sudo install -d -o luminno -g luminno -m 0750 /opt/luminno-orcamentos
sudo install -d -o luminno -g luminno -m 0750 /var/lib/luminno/uploads
sudo install -d -o root -g luminno -m 0750 /etc/luminno
```

Descompacte o código e dê a posse do diretório à conta de serviço.

```bash
sudo unzip /tmp/luminno-orcamentos.zip -d /opt/luminno-orcamentos
sudo chown -R luminno:luminno /opt/luminno-orcamentos
sudo find /opt/luminno-orcamentos -type d -exec chmod 0750 {} \;
sudo find /opt/luminno-orcamentos -type f -exec chmod 0640 {} \;
```

Se o ZIP criou uma pasta interna extra, ajuste o comando para que `package.json` fique diretamente em `/opt/luminno-orcamentos`. Valide com:

```bash
sudo -u luminno test -f /opt/luminno-orcamentos/package.json && echo "Código no local correto"
```

## 5. Instalar Node.js e dependências do projeto

Use uma versão Node.js LTS. A versão deve ser instalada em nível de sistema para que o `systemd` encontre o binário sem depender do perfil de shell de um usuário. O método abaixo usa o repositório NodeSource para Ubuntu; consulte a página do fornecedor caso sua arquitetura não seja `amd64`. [2]

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node --version
corepack enable
```

Instale as dependências e gere a versão de produção como o usuário de serviço. Não use `--prod` nesta etapa, porque o build e o comando do Drizzle usam dependências de desenvolvimento.

```bash
sudo -u luminno -H bash -lc '
  cd /opt/luminno-orcamentos
  pnpm install --frozen-lockfile
  pnpm build
'
```

O build deve produzir `dist/index.js` e `dist/public/`.

## 6. Instalar e configurar o MySQL local

Instale o servidor MySQL e execute o endurecimento inicial. Ao receber perguntas interativas do `mysql_secure_installation`, prefira remover usuários anônimos, impedir login remoto de `root`, remover banco de teste e recarregar privilégios.

```bash
sudo apt install -y mysql-server
sudo mysql_secure_installation
```

Crie uma base e uma conta exclusiva para o Luminno. Troque `SENHA_MYSQL_FORTE` por uma senha longa e aleatória. Guarde-a no seu gerenciador de senhas e não a envie em mensagens.

```bash
sudo mysql <<'SQL'
CREATE DATABASE luminno CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'luminno_app'@'localhost' IDENTIFIED BY 'SENHA_MYSQL_FORTE';
GRANT ALL PRIVILEGES ON luminno.* TO 'luminno_app'@'localhost';
FLUSH PRIVILEGES;
SQL
```

Crie em seguida um arquivo de credenciais **somente para o backup**, protegido para o usuário `root`. Isso evita deixar a senha visível em comandos ou no histórico do shell.

```bash
sudo tee /root/.my.cnf >/dev/null <<'EOF'
[client]
user=luminno_app
password=SENHA_MYSQL_FORTE
host=127.0.0.1
EOF
sudo chmod 0600 /root/.my.cnf
```

O banco deve continuar acessível apenas localmente. Confirme a escuta com:

```bash
sudo ss -lntp | grep 3306
```

## 7. Criar o arquivo de ambiente da aplicação

Gere um segredo de sessão novo. O Luminno exige, em produção, pelo menos 32 caracteres em `JWT_SECRET`; use 64 bytes hexadecimais para margem de segurança.

```bash
openssl rand -hex 64
```

Crie `/etc/luminno/luminno.env` e preencha a senha e o segredo reais. Se a senha MySQL tiver caracteres reservados de URL como `@`, `:`, `/` ou `#`, codifique-a em URL antes de colocá-la em `DATABASE_URL`.

```bash
sudo tee /etc/luminno/luminno.env >/dev/null <<'EOF'
NODE_ENV=production
PORT=3000
DATABASE_URL=mysql://luminno_app:SENHA_MYSQL_FORTE@127.0.0.1:3306/luminno
JWT_SECRET=COLE_AQUI_O_RESULTADO_DE_OPENSSL_RAND_HEX_64
UPLOAD_DIR=/var/lib/luminno/uploads
EOF

sudo chown root:luminno /etc/luminno/luminno.env
sudo chmod 0640 /etc/luminno/luminno.env
```

## 8. Criar as tabelas em uma base nova

Em uma **base MySQL vazia**, aplique o esquema a partir de `drizzle/schema.ts`. O comando abaixo é apropriado para a primeira instalação; ele compara o esquema do projeto com a base configurada e cria as tabelas necessárias. Não o use às cegas em um banco existente que contenha outra aplicação.

```bash
sudo -u luminno -H bash -lc '
  set -a
  . /etc/luminno/luminno.env
  set +a
  cd /opt/luminno-orcamentos
  pnpm drizzle-kit push
'
```

Após a aplicação do esquema, confira as tabelas:

```bash
mysql -u luminno_app -p -h 127.0.0.1 luminno -e 'SHOW TABLES;'
```

## 9. Criar o serviço `systemd` do Luminno

Crie a unidade abaixo. Ela executa a aplicação sem privilégios de `root`, reinicia em caso de falha e limita os caminhos graváveis ao diretório de uploads.

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
ReadWritePaths=/var/lib/luminno/uploads

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now luminno
sudo systemctl status luminno --no-pager
```

Em seguida, valide o serviço localmente, antes de configurar DNS ou o Tunnel.

```bash
curl -I http://127.0.0.1:3000/
sudo journalctl -u luminno -n 100 --no-pager
```

Se a porta 3000 não estiver respondendo, pare aqui e corrija o serviço. Os dois comandos de diagnóstico mais úteis são:

```bash
sudo systemctl restart luminno
sudo journalctl -u luminno -f
```

## 10. Instalar o `cloudflared`

O método recomendado é criar o Tunnel no painel da Cloudflare e copiar o comando de instalação exibido para a arquitetura da sua VPS. A documentação oficial também disponibiliza pacotes `.deb` para `amd64` e `arm64`. [3]

Para Ubuntu `amd64`, o método direto é:

```bash
cd /tmp
curl -fL -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb || sudo apt -f install -y
cloudflared --version
```

Para ARM64, troque o final da URL por `cloudflared-linux-arm64.deb`. Nunca baixe binários de fontes não oficiais.

## 11. Criar e publicar o Cloudflare Tunnel

No painel da Cloudflare, abra **Networking → Tunnels → Create Tunnel**. Dê um nome claro, por exemplo `luminno-producao`, escolha Linux e a arquitetura correta. A Cloudflare mostra um token e o comando de serviço correspondente; o token equivale a uma credencial e deve ser tratado como segredo. [1]

Depois de instalar o binário, execute o comando exibido pelo painel, no seguinte formato:

```bash
sudo cloudflared service install SEU_TUNNEL_TOKEN
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared --no-pager
```

Quando o túnel aparecer como **Healthy**, abra o Tunnel no painel, entre em **Routes → Add route → Published application** e informe os valores abaixo.

| Campo Cloudflare | Valor para o Luminno |
|---|---|
| Hostname | `orcamentos.seudominio.com.br` |
| Service type | `HTTP` |
| Service URL | `http://127.0.0.1:3000` |

Ao salvar a rota, a Cloudflare cria ou orienta a criação de um CNAME apontando para o hostname do Tunnel. Uma rota publicada associa hostname público a um serviço local; a documentação usa `http://localhost:80` como exemplo do mesmo padrão. [1]

> Para uma aplicação única, o Tunnel gerenciado pelo painel com token é mais simples que um arquivo YAML local. Se preferir um Tunnel localmente gerenciado, a configuração deve conter `tunnel`, `credentials-file`, uma regra `ingress` para o hostname e uma regra final de captura, como `http_status:404`; essa regra final é obrigatória. [4]

Teste o estado e os logs do túnel:

```bash
sudo systemctl status cloudflared --no-pager
sudo journalctl -u cloudflared -n 100 --no-pager
```

> A documentação oficial confirma que `cloudflared` pode ser executado como serviço Linux e que alterações de configuração requerem reinício do serviço. [5]

## 12. Primeiro acesso e restauração dos dados

Abra `https://orcamentos.seudominio.com.br`. A primeira tela solicitará a criação do administrador local. Crie essa conta com uma senha de pelo menos 12 caracteres, guarde-a no seu gerenciador de senhas e não reutilize a senha do MySQL.

Após entrar, abra **Configurações → Backup e restauração manual → Importar JSON**, selecione o arquivo `luminno-backup-AAAA-MM-DD.json` e confirme a substituição de dados. A importação deve ser feita somente após verificar que a base vazia está respondendo e o primeiro administrador já consegue entrar.

Se houver uploads locais previamente copiados, mova-os agora para o diretório persistente, preservando o proprietário:

```bash
sudo rsync -av /tmp/luminno-uploads/ /var/lib/luminno/uploads/
sudo chown -R luminno:luminno /var/lib/luminno/uploads
sudo find /var/lib/luminno/uploads -type d -exec chmod 0750 {} \;
sudo find /var/lib/luminno/uploads -type f -exec chmod 0640 {} \;
```

Em **Administração**, confirme que o painel mostra aplicação online, banco conectado e espaço disponível para uploads. Faça um teste real de upload de logotipo e de uma imagem de produto.

## 13. Checklist de aceitação

| Verificação | Como confirmar | Resultado esperado |
|---|---|---|
| Serviço Node | `systemctl is-active luminno` | `active` |
| Resposta local | `curl -I http://127.0.0.1:3000/` | HTTP 200 ou redirecionamento válido da aplicação |
| Banco | Painel Administração | “Banco de dados: Conectado” |
| Tunnel | Painel Cloudflare e `systemctl is-active cloudflared` | “Healthy” e `active` |
| Domínio | Abrir URL HTTPS em janela anônima | Tela de criação/login local do Luminno |
| Segurança | `sudo ufw status` | Apenas SSH de entrada, sem 3000/3306 públicos |
| Upload | Enviar logo e imagem no catálogo | Arquivos respondem em `/uploads/...` |
| Dados | Conferir clientes, produtos e orçamentos | Dados do JSON restaurados corretamente |
| Backup | Executar backup manual e baixar JSON | Arquivo é gerado e legível |

## 14. Backups automáticos recomendados

O backup JSON manual é útil para portabilidade, mas o backup operacional deve incluir **MySQL**, **uploads** e uma cópia externa. Crie um diretório de backups com permissões restritas:

```bash
sudo install -d -o root -g root -m 0700 /var/backups/luminno
```

Crie `/usr/local/sbin/luminno-backup.sh`:

```bash
sudo tee /usr/local/sbin/luminno-backup.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%F-%H%M%S)
TARGET=/var/backups/luminno/$STAMP
mkdir -p "$TARGET"

# As credenciais são lidas de /root/.my.cnf, protegido com permissão 0600.
mysqldump --single-transaction --routines --events luminno | gzip > "$TARGET/mysql.sql.gz"
tar -C /var/lib/luminno -czf "$TARGET/uploads.tar.gz" uploads
cp /etc/luminno/luminno.env "$TARGET/luminno.env.backup"
chmod 0600 "$TARGET"/*

# Retém 14 dias localmente. Mantenha outra cópia fora da VPS.
find /var/backups/luminno -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
EOF
sudo chmod 0700 /usr/local/sbin/luminno-backup.sh
```

Programe a execução diária pelo `cron` de root:

```bash
sudo crontab -e
# Inclua a linha abaixo:
15 2 * * * /usr/local/sbin/luminno-backup.sh >> /var/log/luminno-backup.log 2>&1
```

Copie o conteúdo de `/var/backups/luminno/` para armazenamento externo criptografado. Um backup que nunca foi restaurado é apenas uma hipótese; teste a restauração em uma base MySQL de homologação antes de depender dela.

## 15. Atualizações futuras sem perder dados

Antes de atualizar, faça backup do banco e de uploads. Envie o novo ZIP para `/tmp/`, pare o serviço, substitua somente o código, reinstale dependências, gere o build e reinicie. Não remova `/var/lib/luminno/uploads` nem o arquivo `/etc/luminno/luminno.env`.

```bash
sudo /usr/local/sbin/luminno-backup.sh
sudo systemctl stop luminno
sudo rm -rf /opt/luminno-orcamentos/*
sudo unzip /tmp/luminno-orcamentos-novo.zip -d /opt/luminno-orcamentos
sudo chown -R luminno:luminno /opt/luminno-orcamentos

sudo -u luminno -H bash -lc '
  cd /opt/luminno-orcamentos
  pnpm install --frozen-lockfile
  pnpm build
'

sudo systemctl start luminno
sudo systemctl status luminno --no-pager
```

Se a atualização alterar o esquema, faça uma cópia do banco antes e rode `pnpm drizzle-kit push` apenas após revisar a alteração proposta. Por fim, teste o domínio e consulte os logs de `luminno` e `cloudflared`.

## 16. Diagnóstico rápido

| Sintoma | Verificação | Ação inicial |
|---|---|---|
| Domínio mostra erro 502 | `systemctl status luminno` | Confirme que `luminno` está ativo e que `curl 127.0.0.1:3000` responde. |
| Tunnel desconectado | `journalctl -u cloudflared -f` | Confirme token e saída da VPS para a porta 7844. |
| Login não mantém sessão | Verifique `NODE_ENV=production` e `JWT_SECRET` | Confirme também que o domínio acessado é exatamente o hostname do Tunnel. |
| Upload falha | `ls -ld /var/lib/luminno/uploads` | Corrija proprietário para `luminno:luminno` e permissões para `0750`. |
| Banco indisponível | `sudo systemctl status mysql` | Confirme `DATABASE_URL`, usuário MySQL e se a base `luminno` existe. |
| Serviço reinicia sem parar | `journalctl -u luminno -n 200` | Corrija a primeira exceção e reinicie com `systemctl restart luminno`. |

## Referências

[1] [Cloudflare — Setup do Tunnel e publicação de aplicação](https://developers.cloudflare.com/tunnel/setup/)

[2] [NodeSource — Distribuições Node.js para Ubuntu](https://deb.nodesource.com/)

[3] [Cloudflare — Downloads oficiais do cloudflared](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)

[4] [Cloudflare — Arquivo de configuração e regras de ingress](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/)

[5] [Cloudflare — Executar cloudflared como serviço no Linux](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/linux/)
