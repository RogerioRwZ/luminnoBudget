#!/usr/bin/env bash
# Instala e configura o Luminno Orçamentos num Ubuntu Server 22.04 ou 24.04.
#
# Faz tudo o que o GUIA-INSTALACAO-COMPLETA.md descreve: Node.js 24, pnpm,
# MySQL com usuários próprios e senhas aleatórias, usuário de serviço, build,
# migrações, serviço systemd, HTTPS (Caddy ou Cloudflare Tunnel), firewall,
# backup diário e o comando de atualização "luminno-update".
#
# Pode ser executado de novo com segurança: o que já existe é mantido (senhas,
# banco, configuração) e o resto é completado.
#
# Uso (como root):
#   bash install-ubuntu.sh --domain orcamentos.minhaloja.com.br --email eu@minhaloja.com.br
#   bash install-ubuntu.sh --http                 # só HTTP pelo IP (rede interna)
#   bash install-ubuntu.sh --cloudflare-tunnel    # pede o token do Tunnel
#   bash install-ubuntu.sh --help
set -Eeuo pipefail

REPO_URL="https://github.com/RogerioRwZ/luminnoBudget.git"
BRANCH="main"
DOMAIN=""
EMAIL=""
PROXY=""            # caddy-https | caddy-http | cloudflare
PORT=3000
TIMEZONE="America/Sao_Paulo"
FIREWALL=1
SWAP=1
ASSUME_YES=0

APP_USER="luminno"
APP_HOME="/opt/luminno"
APP_DIR="$APP_HOME/app"
DATA_DIR="/var/lib/luminno"
ETC_DIR="/etc/luminno"
ENV_FILE="$ETC_DIR/luminno.env"
BACKUP_DIR="/var/backups/luminno"
BACKUP_CNF="/root/.my-luminno-backup.cnf"
COREPACK_DIR="/var/cache/luminno-corepack"
DB_NAME="luminno"
DB_APP_USER="luminno_app"
DB_BACKUP_USER="luminno_backup"
SERVICE="luminno"
LOG="/var/log/luminno-install.log"
DETAIL_LOG="/var/log/luminno-install-detalhes.log"
STAMP="$(date +%F_%H-%M-%S)"

usage() {
  cat <<'EOF'
Instalação do Luminno Orçamentos no Ubuntu Server.

Como o sistema será acessado (escolha um; sem nenhum, o script pergunta):
  --domain NOME          Domínio próprio com HTTPS automático (Caddy). O DNS
                         do domínio já deve apontar para este servidor.
  --email EMAIL          E-mail para avisos do certificado (opcional, com --domain).
  --http                 Só HTTP pelo IP do servidor, sem certificado. Para rede
                         interna ou testes; não use na internet.
  --cloudflare-tunnel    Publica pelo Cloudflare Tunnel, sem abrir portas. O
                         token é pedido na tela (ou lido de CLOUDFLARE_TUNNEL_TOKEN).

Outras opções:
  --branch NOME          Branch do repositório (padrão: main).
  --repo URL             Endereço do repositório (padrão: GitHub oficial).
  --port N               Porta interna da aplicação (padrão: 3000).
  --timezone ZONA        Fuso do servidor (padrão: America/Sao_Paulo).
  --no-firewall          Não mexe no firewall (ufw).
  --no-swap              Não cria swap em servidores com pouca memória.
  -y, --yes              Não pede confirmação.
  -h, --help             Mostra esta ajuda.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; PROXY="caddy-https"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --http) PROXY="caddy-http"; shift ;;
    --cloudflare-tunnel) PROXY="cloudflare"; shift ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --repo) REPO_URL="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --timezone) TIMEZONE="${2:-}"; shift 2 ;;
    --no-firewall) FIREWALL=0; shift ;;
    --no-swap) SWAP=0; shift ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Opção desconhecida: $1"; echo; usage; exit 1 ;;
  esac
done

STEP="início"
fail() { echo; echo "### ERRO: $*"; exit 1; }
trap 'echo; echo "### A instalação parou na etapa: $STEP (linha $LINENO)."; echo "### Corrija o problema e rode o script de novo: ele continua de onde parou."; echo "### Registro completo: $LOG"' ERR
step() { STEP="$*"; echo; echo "==> $*"; }
info() { echo "    $*"; }
warn() { echo "    ATENÇÃO: $*"; }
# Saídas longas (apt, pnpm) vão para um registro à parte; na falha, mostra o final dele.
quiet() { "$@" >>"$DETAIL_LOG" 2>&1 || { tail -30 "$DETAIL_LOG"; return 1; }; }
apt_quiet() { quiet apt-get -q -o Dpkg::Use-Pty=0 "$@"; }

[ "$(id -u)" -eq 0 ] || fail "Rode como root: sudo bash $0 ${*:-}"
touch "$LOG"; chmod 600 "$LOG"
exec > >(tee -a "$LOG") 2>&1
echo "##### Instalação do Luminno — $STAMP"

# ------------------------------------------------------------ verificações
step "Verificando o servidor"
. /etc/os-release
[ "${ID:-}" = ubuntu ] || fail "Este script é para Ubuntu (encontrado: ${PRETTY_NAME:-desconhecido})."
case "${VERSION_ID:-}" in
  22.04|24.04) info "Sistema: $PRETTY_NAME" ;;
  *) warn "testado no Ubuntu 22.04 e 24.04; este é o $PRETTY_NAME." ;;
esac
command -v systemctl >/dev/null && [ -d /run/systemd/system ] || fail "O systemd não está ativo neste sistema."
[[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || fail "Porta inválida: $PORT"
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "Nome de branch inválido: $BRANCH"
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
FREE_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
info "Memória: ${MEM_MB} MB · disco livre: ${FREE_GB} GB"
[ "$FREE_GB" -ge 5 ] || fail "É preciso pelo menos 5 GB livres no disco."
curl -fsS -m 15 -o /dev/null https://github.com || fail "Sem acesso à internet (github.com)."

if [ -z "$PROXY" ]; then
  if [ "$ASSUME_YES" -eq 1 ] || [ ! -t 0 ]; then
    fail "Informe como o sistema será acessado: --domain, --http ou --cloudflare-tunnel."
  fi
  echo
  echo "Como o sistema será acessado?"
  echo "  1) Domínio próprio com HTTPS (recomendado na internet)"
  echo "  2) Só pelo IP, sem HTTPS (rede interna)"
  echo "  3) Cloudflare Tunnel"
  read -r -p "Escolha [1-3]: " choice
  case "$choice" in
    1) PROXY="caddy-https"; read -r -p "Domínio (ex.: orcamentos.minhaloja.com.br): " DOMAIN; read -r -p "E-mail para avisos do certificado (opcional): " EMAIL ;;
    2) PROXY="caddy-http" ;;
    3) PROXY="cloudflare" ;;
    *) fail "Opção inválida." ;;
  esac
fi
if [ "$PROXY" = caddy-https ]; then
  DOMAIN="$(echo "$DOMAIN" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/.*$##')"
  [[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || fail "Domínio inválido: '$DOMAIN'"
  [ -z "$EMAIL" ] || [[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || fail "E-mail inválido: $EMAIL"
  RESOLVED="$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u | tr '\n' ' ')"
  if [ -z "$RESOLVED" ]; then
    warn "o domínio $DOMAIN ainda não aponta para nenhum IP. O certificado só sai depois que o DNS estiver certo."
  else
    info "O domínio aponta para: $RESOLVED (IPs deste servidor: $(hostname -I | tr -s ' '))"
  fi
fi
if [ "$PROXY" = cloudflare ]; then
  CF_TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-}"
  if [ -z "$CF_TOKEN" ] && [ ! -f /etc/systemd/system/cloudflared.service ]; then
    [ -t 0 ] || fail "Defina CLOUDFLARE_TUNNEL_TOKEN ou rode o script num terminal."
    echo "No painel da Cloudflare: Zero Trust → Networks → Tunnels → Create a tunnel."
    echo "Copie o token (o texto longo depois de 'cloudflared service install')."
    read -r -s -p "Token do Tunnel: " CF_TOKEN; echo
    [ -n "$CF_TOKEN" ] || fail "Token vazio."
  fi
fi

echo
echo "Resumo:"
echo "  Acesso:       $( case "$PROXY" in caddy-https) echo "https://$DOMAIN";; caddy-http) echo "http://$(hostname -I | awk '{print $1}') (sem HTTPS)";; cloudflare) echo "Cloudflare Tunnel";; esac )"
echo "  Código:       $REPO_URL ($BRANCH) em $APP_DIR"
echo "  Dados:        $DATA_DIR · banco MySQL '$DB_NAME'"
echo "  Fuso horário: $TIMEZONE · firewall: $([ $FIREWALL -eq 1 ] && echo sim || echo não)"
if [ "$ASSUME_YES" -ne 1 ] && [ -t 0 ]; then
  read -r -p "Continuar? [s/N] " answer
  [[ "$answer" =~ ^[sSyY] ]] || { echo "Cancelado."; exit 0; }
fi

# --------------------------------------------------------- sistema e pacotes
step "Atualizando a lista de pacotes e instalando dependências"
export DEBIAN_FRONTEND=noninteractive
info "Detalhes em $DETAIL_LOG"
apt_quiet update
apt_quiet install -y curl ca-certificates gnupg git rsync openssl cron ufw sudo iproute2 tzdata mysql-server

step "Ajustando fuso horário"
# O "hoje" do resumo diário, das parcelas e da agenda segue o fuso do servidor.
if [ "$(timedatectl show -p Timezone --value 2>/dev/null)" != "$TIMEZONE" ]; then
  timedatectl set-timezone "$TIMEZONE" || warn "não foi possível ajustar o fuso para $TIMEZONE."
fi
info "Fuso: $(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone)"
STAMP="$(date +%F_%H-%M-%S)"

if [ "$SWAP" -eq 1 ] && [ "$MEM_MB" -lt 3000 ] && [ -z "$(swapon --show --noheadings)" ]; then
  step "Criando 2 GB de swap (pouca memória para compilar)"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "Instalando Node.js 24"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 22 ] || [ "$NODE_MAJOR" -ge 25 ]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt_quiet update
  apt_quiet install -y nodejs
fi
NODE_BIN="$(command -v node)"
info "Node $(node --version) em $NODE_BIN"
command -v corepack >/dev/null || npm install -g corepack >/dev/null
info "corepack $(corepack --version)"

# ---------------------------------------------------- usuário e pastas
step "Criando o usuário de serviço e as pastas"
id "$APP_USER" >/dev/null 2>&1 || quiet adduser --system --group --home "$APP_HOME" --shell /usr/sbin/nologin "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_HOME" "$APP_DIR" "$DATA_DIR" "$DATA_DIR/uploads" "$DATA_DIR/pdf-history"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$COREPACK_DIR"
install -d -o root -g root -m 0700 "$BACKUP_DIR"
install -d -o root -g "$APP_USER" -m 0750 "$ETC_DIR"

# ----------------------------------------------------------------- MySQL
step "Configurando o MySQL"
systemctl enable --now mysql >/dev/null 2>&1
# Senhas: reaproveita as da instalação anterior para não quebrar nada.
existing_db_password() { [ -f "$ENV_FILE" ] && sed -nE 's#^DATABASE_URL=mysql://[^:]+:([^@]+)@.*#\1#p' "$ENV_FILE" | head -1; }
APP_DB_PASS="$(existing_db_password || true)"
[ -n "$APP_DB_PASS" ] || APP_DB_PASS="$(openssl rand -hex 24)"
BACKUP_DB_PASS="$( [ -f "$BACKUP_CNF" ] && sed -n 's/^password=//p' "$BACKUP_CNF" | head -1 || true)"
[ -n "$BACKUP_DB_PASS" ] || BACKUP_DB_PASS="$(openssl rand -hex 24)"
[[ "$APP_DB_PASS" =~ ^[A-Za-z0-9]+$ ]] || fail "A senha do banco em $ENV_FILE tem caracteres especiais; ajuste-a manualmente."
mysql --protocol=socket -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS '$DB_APP_USER'@'localhost' IDENTIFIED BY '$APP_DB_PASS';
ALTER USER '$DB_APP_USER'@'localhost' IDENTIFIED BY '$APP_DB_PASS';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_APP_USER'@'localhost';
CREATE USER IF NOT EXISTS '$DB_BACKUP_USER'@'localhost' IDENTIFIED BY '$BACKUP_DB_PASS';
ALTER USER '$DB_BACKUP_USER'@'localhost' IDENTIFIED BY '$BACKUP_DB_PASS';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES, PROCESS ON *.* TO '$DB_BACKUP_USER'@'localhost';
DELETE FROM mysql.user WHERE User = '';
DROP DATABASE IF EXISTS test;
FLUSH PRIVILEGES;
SQL
BIND="$(mysqld --verbose --help 2>/dev/null | awk '$1 == "bind-address" {print $2}')"
case "$BIND" in 127.0.0.1|localhost|::1) info "MySQL só aceita conexões locais ($BIND)." ;; *) warn "o MySQL escuta em '$BIND'; o firewall mantém a porta 3306 fechada." ;; esac
umask 077
cat > "$BACKUP_CNF" <<EOF
[client]
user=$DB_BACKUP_USER
password=$BACKUP_DB_PASS
host=127.0.0.1
EOF
umask 022

# ----------------------------------------------------------- configuração
step "Criando o arquivo de configuração"
if [ -f "$ENV_FILE" ]; then
  info "$ENV_FILE já existe e foi mantido."
  grep -q '^PORT=' "$ENV_FILE" && PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" | head -1)"
else
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=$PORT
DATABASE_URL=mysql://$DB_APP_USER:$APP_DB_PASS@127.0.0.1:3306/$DB_NAME
JWT_SECRET=$(openssl rand -hex 64)
UPLOAD_DIR=$DATA_DIR/uploads
PDF_HISTORY_DIR=$DATA_DIR/pdf-history
EOF
  info "Senhas e segredo gerados em $ENV_FILE."
fi
chown root:"$APP_USER" "$ENV_FILE"
chmod 0640 "$ENV_FILE"

# --------------------------------------------------------- código e build
step "Baixando o código ($BRANCH)"
asapp() { sudo -u "$APP_USER" -H env COREPACK_HOME="$COREPACK_DIR" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 bash -c "cd '$APP_DIR' && $*"; }
if [ -d "$APP_DIR/.git" ]; then
  sudo -u "$APP_USER" -H git -C "$APP_DIR" fetch --quiet "$REPO_URL" "$BRANCH"
  sudo -u "$APP_USER" -H git -C "$APP_DIR" checkout --quiet --force -B "$BRANCH" FETCH_HEAD
elif [ -z "$(ls -A "$APP_DIR")" ]; then
  sudo -u "$APP_USER" -H git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  fail "$APP_DIR já tem arquivos e não é um repositório git. Mova-os e rode de novo."
fi
info "Versão: $(sudo -u "$APP_USER" -H git -C "$APP_DIR" log -1 --format='%h %s')"

step "Instalando dependências (pode levar alguns minutos)"
asapp "corepack pnpm --version" | sed 's/^/    pnpm /'
quiet asapp "corepack pnpm install --frozen-lockfile"

step "Compilando a aplicação"
# Não use "pnpm build" no servidor: ele roda os testes contra o banco.
info "Verificando tipos…"
quiet asapp "corepack pnpm check"
info "Compilando o front-end…"
quiet asapp "corepack pnpm exec vite build"
info "Compilando o servidor…"
quiet asapp "corepack pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist"
[ -f "$APP_DIR/dist/index.js" ] && [ -f "$APP_DIR/dist/public/index.html" ] || fail "O build não gerou dist/index.js e dist/public/index.html."

step "Criando e atualizando as tabelas do banco"
MIGRATE_OUT="$(sudo -u "$APP_USER" -H env COREPACK_HOME="$COREPACK_DIR" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 bash -c "set -a; . '$ENV_FILE'; set +a; cd '$APP_DIR' && corepack pnpm exec drizzle-kit migrate" 2>&1)" || { echo "$MIGRATE_OUT" | tr '\r' '\n' | tail -20; fail "As migrações do banco falharam."; }
echo "$MIGRATE_OUT" | grep -q "migrations applied successfully" && info "Migrações aplicadas." || { echo "$MIGRATE_OUT" | tail -5; fail "Não foi possível confirmar as migrações."; }

# ------------------------------------------------------------------ serviço
step "Configurando o serviço $SERVICE"
# Porta ocupada por outro programa (o próprio Luminno, numa nova execução, não conta).
OWN_PID="$(systemctl show -p MainPID --value "$SERVICE" 2>/dev/null || echo 0)"
BUSY="$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -v "pid=${OWN_PID:-0}," || true)"
[ "${OWN_PID:-0}" != 0 ] || BUSY="$(ss -ltnpH "sport = :$PORT" 2>/dev/null || true)"
[ -z "$BUSY" ] || fail "A porta $PORT já está em uso por outro programa: $BUSY. Use --port com outra porta."
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=Luminno Orçamentos
After=network.target mysql.service
Wants=mysql.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $APP_DIR/dist/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"
HEALTH=""
for _ in $(seq 1 40); do
  HEALTH="$(curl -s -m 3 "http://127.0.0.1:$PORT/api/health" || true)"
  case "$HEALTH" in *'"database":"online"'*) break ;; esac
  sleep 1
done
case "$HEALTH" in
  *'"database":"online"'*) info "Aplicação no ar: $HEALTH" ;;
  *) journalctl -u "$SERVICE" -n 30 --no-pager; fail "A aplicação não respondeu em http://127.0.0.1:$PORT/api/health." ;;
esac

# ----------------------------------------------------------- acesso externo
caddy_install() {
  if ! command -v caddy >/dev/null; then
    apt_quiet install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
    apt_quiet update
    apt_quiet install -y caddy
  fi
  install -d -o caddy -g caddy -m 0750 /var/log/caddy
}

caddy_site() {
  local address="$1"
  local global=""
  [ -n "$EMAIL" ] && global=$'{\n\temail '"$EMAIL"$'\n}\n\n'
  if [ -f /etc/caddy/Caddyfile ] && ! grep -q '# Luminno (gerado por install-ubuntu.sh)' /etc/caddy/Caddyfile; then
    cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.antes-luminno-$STAMP"
    info "Caddyfile anterior salvo em /etc/caddy/Caddyfile.antes-luminno-$STAMP"
  fi
  cat > /etc/caddy/Caddyfile <<EOF
# Luminno (gerado por install-ubuntu.sh)
${global}$address {
	encode zstd gzip

	# Anexos e PDFs chegam a ~20 MB codificados.
	request_body {
		max_size 30MB
	}

	# Não sirva /uploads direto com file_server: a aplicação protege os
	# anexos de orçamentos (/uploads/attachments) e exige login.
	reverse_proxy 127.0.0.1:$PORT

	log {
		output file /var/log/caddy/luminno-access.log {
			roll_size 20MiB
			roll_keep 5
		}
		format json
	}
}
EOF
  # Valida como o usuário caddy: como root, a validação criaria o arquivo de
  # log com dono root e o Caddy não conseguiria abri-lo depois.
  touch /var/log/caddy/luminno-access.log && chown caddy:caddy /var/log/caddy/luminno-access.log
  local check; check="$(sudo -u caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1)" || { echo "$check" | tail -5; fail "O Caddyfile gerado é inválido."; }
  systemctl enable caddy >/dev/null 2>&1
  systemctl restart caddy
}

case "$PROXY" in
  caddy-https)
    step "Publicando com HTTPS em $DOMAIN (Caddy)"
    caddy_install
    caddy_site "$DOMAIN"
    PUBLIC_URL="https://$DOMAIN"
    ;;
  caddy-http)
    step "Publicando por HTTP na porta 80 (Caddy)"
    caddy_install
    caddy_site ":80"
    PUBLIC_URL="http://$(hostname -I | awk '{print $1}')"
    ;;
  cloudflare)
    step "Configurando o Cloudflare Tunnel"
    if ! command -v cloudflared >/dev/null; then
      install -d -m 0755 /usr/share/keyrings
      curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
      echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
      apt_quiet update
      apt_quiet install -y cloudflared
    fi
    if [ -n "${CF_TOKEN:-}" ] && [ ! -f /etc/systemd/system/cloudflared.service ]; then
      cloudflared service install "$CF_TOKEN" >/dev/null
    fi
    systemctl enable --now cloudflared >/dev/null 2>&1 || true
    info "cloudflared: $(systemctl is-active cloudflared || true)"
    PUBLIC_URL="(o endereço público configurado no Tunnel)"
    ;;
esac

# ---------------------------------------------------------------- firewall
if [ "$FIREWALL" -eq 1 ]; then
  step "Configurando o firewall (ufw)"
  SSH_PORTS="$(sshd -T 2>/dev/null | awk '$1 == "port" {print $2}' | sort -u)"
  for p in ${SSH_PORTS:-22}; do ufw allow "$p/tcp" comment 'SSH' >/dev/null; done
  case "$PROXY" in
    caddy-https) ufw allow 80/tcp comment 'HTTP (certificado)' >/dev/null; ufw allow 443/tcp comment 'HTTPS' >/dev/null ;;
    caddy-http) ufw allow 80/tcp comment 'HTTP' >/dev/null ;;
  esac
  ufw --force enable >/dev/null
  info "Liberado: SSH (${SSH_PORTS:-22})$( [ "$PROXY" = caddy-https ] && echo ', 80 e 443' )$( [ "$PROXY" = caddy-http ] && echo ' e 80' ). Portas $PORT e 3306 ficam fechadas."
fi

# ------------------------------------------------------------------ backup
step "Configurando o backup diário"
cat > /usr/local/sbin/luminno-backup <<EOF
#!/usr/bin/env bash
# Backup diário do Luminno: banco + imagens, anexos e PDFs. Guarda 30 dias.
set -euo pipefail
STAMP=\$(date +%F_%H-%M-%S)
mkdir -p "$BACKUP_DIR"
mysqldump --defaults-extra-file=$BACKUP_CNF --single-transaction --routines --triggers --no-tablespaces $DB_NAME \\
  | gzip > "$BACKUP_DIR/luminno-db_\${STAMP}.sql.gz"
tar -C "$DATA_DIR" -czf "$BACKUP_DIR/luminno-arquivos_\${STAMP}.tar.gz" uploads pdf-history
find "$BACKUP_DIR" -type f -name 'luminno-*' -mtime +30 -delete
echo "\$(date '+%F %T') backup ok: $BACKUP_DIR/luminno-db_\${STAMP}.sql.gz"
EOF
chmod 0700 /usr/local/sbin/luminno-backup
echo "15 2 * * * root /usr/local/sbin/luminno-backup >> /var/log/luminno-backup.log 2>&1" > /etc/cron.d/luminno-backup
chmod 0644 /etc/cron.d/luminno-backup
/usr/local/sbin/luminno-backup | sed 's/^/    /'

step "Instalando o comando de atualização"
if [ -f "$APP_DIR/deploy/update.sh" ]; then
  install -m 0700 "$APP_DIR/deploy/update.sh" /usr/local/sbin/luminno-update
  info "Para atualizar no futuro: sudo luminno-update confirm"
fi

# ------------------------------------------------------------------- final
step "Conferindo"
DOWN=""
for unit in mysql "$SERVICE" $( [ "${PROXY#caddy}" != "$PROXY" ] && echo caddy ) $( [ "$PROXY" = cloudflare ] && echo cloudflared ); do
  state="$(systemctl is-active "$unit" || true)"
  printf '    %-12s %s\n' "$unit" "$state"
  [ "$state" = active ] || DOWN="$DOWN $unit"
done
if [ -n "$DOWN" ]; then
  for unit in $DOWN; do journalctl -u "$unit" -n 15 --no-pager; done
  fail "Serviço(s) parado(s):$DOWN. Veja o registro acima."
fi
if [ "$PROXY" = caddy-http ]; then
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1/api/health || true)"
  [ "$CODE" = 200 ] && info "Caddy na porta 80: ok" || fail "O Caddy não respondeu na porta 80 (HTTP $CODE)."
fi
ATTACH="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/uploads/attachments/teste.pdf")"
info "Anexos sem login: HTTP $ATTACH (esperado 404)"
if [ "$PROXY" = caddy-https ]; then
  CODE=""
  for _ in $(seq 1 20); do
    CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 5 "https://$DOMAIN/api/health" || true)"
    [ "$CODE" = 200 ] && break
    sleep 3
  done
  [ "$CODE" = 200 ] && info "HTTPS ok em https://$DOMAIN" || warn "o HTTPS ainda não respondeu. Confira o DNS e veja: journalctl -u caddy -n 30"
fi

SUMMARY=/root/luminno-instalacao.txt
cat > "$SUMMARY" <<EOF
Luminno Orçamentos — instalado em $STAMP
Endereço:        $PUBLIC_URL
Código:          $APP_DIR ($BRANCH, $(sudo -u "$APP_USER" -H git -C "$APP_DIR" log -1 --format='%h'))
Configuração:    $ENV_FILE  (senha do banco e JWT_SECRET; não compartilhe)
Dados:           $DATA_DIR/uploads e $DATA_DIR/pdf-history
Backups:         $BACKUP_DIR (todo dia às 02:15, guarda 30 dias)
Logs:            journalctl -u $SERVICE -f
Atualizar:       sudo luminno-update confirm
Backup manual:   sudo luminno-backup
Reiniciar:       sudo systemctl restart $SERVICE
EOF
chmod 600 "$SUMMARY"

cat <<EOF

##########################################################################
  Luminno instalado.

  Abra agora: $PUBLIC_URL

  1. Crie o administrador na tela de configuração inicial. FAÇA ISSO JÁ:
     até ele existir, qualquer pessoa que abrir o endereço pode criá-lo.
  2. Em Configurações, preencha os dados da loja, PIX, limites de desconto
     e margem e a comissão padrão.
  3. Copie os backups de $BACKUP_DIR para fora deste servidor.
$( [ "$PROXY" = cloudflare ] && printf '%s\n' "  4. No painel do Tunnel, aponte o endereço público para http://127.0.0.1:$PORT" )
$( [ "$PROXY" = caddy-http ] && printf '%s\n' "  Sem HTTPS: use só em rede interna. Para a internet, rode de novo com --domain." )
  Resumo salvo em $SUMMARY · registro em $LOG
##########################################################################
EOF
