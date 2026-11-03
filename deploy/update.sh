#!/usr/bin/env bash
# Atualiza uma instalação existente do Luminno para a main do GitHub.
# Instalado pelo install-ubuntu.sh como /usr/local/sbin/luminno-update.
# Uso (como root):  bash luminno-update.sh inspect   -> só mostra o que encontrou
#                   bash luminno-update.sh confirm   -> mostra e pede confirmação antes de atualizar
#                   bash luminno-update.sh update    -> backup + atualização
set -Eeuo pipefail

MODE="${1:-inspect}"
REPO_URL="https://github.com/RogerioRwZ/luminnoBudget"
STAMP="$(date +%F_%H-%M-%S)"
STEP="início"
trap 'echo; echo "### FALHOU na etapa: $STEP (linha $LINENO). A versão anterior continua rodando se o reinício ainda não aconteceu."; exit 1' ERR

LOG="/tmp/luminno-update.log"; : > "$LOG"; chmod 644 "$LOG"; exec > >(tee -a "$LOG") 2>&1
say() { echo; echo "### $*"; }
[ "$(id -u)" -eq 0 ] || { echo "Rode como root (sudo)."; exit 1; }

STEP="detectar serviço"
SERVICE="$(systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -i luminno | head -1 || true)"
[ -n "$SERVICE" ] || { echo "Nenhum serviço systemd com 'luminno' no nome foi encontrado."; exit 1; }
APP="$(systemctl show -p WorkingDirectory --value "$SERVICE")"
ENVF="$(systemctl show -p EnvironmentFiles --value "$SERVICE" | awk '{print $1}')"
OWNER="$(systemctl show -p User --value "$SERVICE")"
[ -n "$OWNER" ] || OWNER="$(stat -c %U "$APP")"
[ -d "$APP" ] && [ -f "$APP/package.json" ] || { echo "WorkingDirectory '$APP' não contém package.json."; exit 1; }
[ -n "$ENVF" ] && [ -f "$ENVF" ] || { echo "EnvironmentFile do serviço não encontrado ('$ENVF')."; exit 1; }

envval() { (set -a; . "$ENVF"; set +a; eval "printf '%s' \"\${$1:-}\""); }
PORT="$(envval PORT)"; PORT="${PORT:-3000}"
UPLOAD_DIR="$(envval UPLOAD_DIR)"
PDF_DIR="$(envval PDF_HISTORY_DIR)"
# PDF_HISTORY_DIR não definido: a aplicação usa "pdf-history" ao lado da pasta de uploads.
[ -n "$PDF_DIR" ] || PDF_DIR="$(dirname "$UPLOAD_DIR")/pdf-history"
if [ -d "$APP/.git" ]; then KIND=git; else KIND=zip; fi
# git como o dono do repositório (como root ele recusa: "dubious ownership").
g() { sudo -u "$OWNER" git -C "$APP" "$@"; }
NODE_VER="$(node --version 2>/dev/null || echo ausente)"

say "Instalação encontrada"
echo "Serviço:          $SERVICE ($(systemctl is-active "$SERVICE" || true))"
echo "Código:           $APP  (via $KIND, dono $OWNER)"
echo "Configuração:     $ENVF"
echo "Porta:            $PORT"
echo "UPLOAD_DIR:       ${UPLOAD_DIR:-<não definido: $APP/uploads>}"
echo "PDF_HISTORY_DIR:  $PDF_DIR"
for v in DATABASE_URL JWT_SECRET NODE_ENV; do printf '%-17s %s\n' "$v:" "$( [ -n "$(envval $v)" ] && echo definido || echo AUSENTE)"; done
echo "Node:             $NODE_VER"
echo "corepack:         $(command -v corepack || echo ausente)"
echo "Disco livre:      $(df -h --output=avail "$APP" | tail -1 | tr -d ' ')"
if [ "$KIND" = git ]; then
  echo "Remoto:           $(g remote get-url origin 2>/dev/null || echo '?')"
  echo "Branch / commit:  $(g rev-parse --abbrev-ref HEAD) / $(g log -1 --format='%h %ad %s' --date=short)"
  CHANGES="$(g status --porcelain --untracked-files=no)"
  echo "Alterações locais: ${CHANGES:-nenhuma}"
fi
health() { local body; body="$(curl -s -m 5 "http://127.0.0.1:$PORT/api/health" || true)"; case "$body" in '{'*) echo "$body";; '') echo "sem resposta";; *) echo "sem /api/health (versão antiga); HTTP $(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/")";; esac; }
echo "Saúde atual:      $(health)"
if [ -f /etc/caddy/Caddyfile ]; then
  grep -vE '^[[:space:]]*#' /etc/caddy/Caddyfile | grep -qE 'file_server' && echo "Caddy:            ATENÇÃO - usa file_server (pode expor /uploads/attachments)" || echo "Caddy:            ok (sem file_server)"
fi
systemctl list-unit-files 2>/dev/null | grep -q '^cloudflared' && echo "cloudflared:      instalado"

case "$MODE" in
  update) ;;
  confirm)
    say "Inspeção concluída. Nada foi alterado até aqui."
    read -r -p "Digite ATUALIZAR e Enter para continuar (qualquer outra coisa cancela): " ANSWER < /dev/tty
    [ "$(echo "$ANSWER" | tr "[:lower:]" "[:upper:]" | tr -d " ")" = ATUALIZAR ] || { echo "Cancelado. Nada foi alterado."; exit 0; } ;;
  *) say "Modo inspeção: nada foi alterado."; exit 0 ;;
esac

STEP="pré-requisitos"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || { echo "Node $NODE_VER é antigo demais; é preciso Node 22 ou 24."; exit 1; }
command -v corepack >/dev/null || { echo "corepack não encontrado."; exit 1; }
if [ -z "$UPLOAD_DIR" ]; then echo "UPLOAD_DIR não está definido: as imagens estão dentro do código. Mova-as antes (passo 1 do guia)."; exit 1; fi
if [ "$KIND" = git ] && [ -n "${CHANGES:-}" ]; then echo "Alterações locais serão salvas no backup (alteracoes-locais.diff) e descartadas."; fi

STEP="backup"
BK="/var/backups/luminno-atualizacao-$STAMP"; mkdir -p "$BK"; chmod 700 "$BK"
DB_URL="$(envval DATABASE_URL)"
read -r DB_USER DB_PASS DB_HOST DB_PORT DB_NAME < <(DB_URL="$DB_URL" node -e '
  const u = new URL(process.env.DB_URL);
  console.log([decodeURIComponent(u.username), decodeURIComponent(u.password) || "-", u.hostname, u.port || "3306", u.pathname.slice(1)].join(" "));')
[ "$DB_PASS" = "-" ] && DB_PASS=""
MYSQL_PWD="$DB_PASS" mysqldump -u "$DB_USER" -h "$DB_HOST" -P "$DB_PORT" --single-transaction --no-tablespaces --routines --triggers "$DB_NAME" | gzip > "$BK/banco.sql.gz"
[ "$(stat -c %s "$BK/banco.sql.gz")" -gt 1000 ] || { echo "Dump do banco ficou vazio."; exit 1; }
DATA_PARENT="$(dirname "$UPLOAD_DIR")"
tar -czf "$BK/arquivos.tar.gz" -C "$DATA_PARENT" "$(basename "$UPLOAD_DIR")" $( [ -d "$PDF_DIR" ] && [ "$(dirname "$PDF_DIR")" = "$DATA_PARENT" ] && basename "$PDF_DIR" || true )
[ "$KIND" = git ] && g diff > "$BK/alteracoes-locais.diff"
PREV="$APP.anterior-$STAMP"
cp -a "$APP" "$PREV"
echo "Backup em $BK:"; ls -lh "$BK"; echo "Cópia do código: $PREV"

STEP="baixar código"
if [ "$KIND" = git ]; then
  g fetch --quiet "$REPO_URL" main
  g checkout --quiet --force -B main FETCH_HEAD
else
  TMP="$(mktemp -d)"
  curl -fsSL "$REPO_URL/archive/refs/heads/main.tar.gz" | tar -xz -C "$TMP"
  rsync -a --delete --exclude node_modules --exclude dist --exclude uploads --exclude pdf-history --exclude .env --exclude .corepack "$TMP"/luminnoBudget-main/ "$APP/"
  chown -R "$OWNER:$OWNER" "$APP"; rm -rf "$TMP"
fi
echo "Agora em: $( [ "$KIND" = git ] && g log -1 --format='%h %s' || echo 'main (zip)')"

STEP="instalar dependências"
CPH="/var/cache/luminno-corepack"; install -d -o "$OWNER" -g "$OWNER" "$CPH"
asowner() { sudo -u "$OWNER" -H env COREPACK_HOME="$CPH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 bash -c "cd '$APP' && $*"; }
asowner "corepack pnpm --version"
asowner "corepack pnpm install --frozen-lockfile"

STEP="verificar tipos"; asowner "corepack pnpm check"
STEP="compilar front-end"; asowner "corepack pnpm exec vite build"
STEP="compilar servidor"; asowner "corepack pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist"

STEP="migrações do banco"
sudo -u "$OWNER" -H env COREPACK_HOME="$CPH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 bash -c "set -a; . '$ENVF'; set +a; cd '$APP' && corepack pnpm exec drizzle-kit migrate"

STEP="retenção dos backups"
# Instalações antigas guardavam 30 backups diários; passam a guardar os 7
# últimos dias e, das semanas anteriores, só os de domingo (até 35 dias).
BK_SCRIPT=/usr/local/sbin/luminno-backup
if [ -f "$BK_SCRIPT" ] && grep -q -- "-mtime +30 -delete" "$BK_SCRIPT"; then
  BK_DIR="$(sed -nE 's/^find "([^"]+)" .*-mtime \+30 -delete$/\1/p' "$BK_SCRIPT" | head -1)"
  if [ -n "$BK_DIR" ]; then
    BLOCK="$(mktemp)"
    cat > "$BLOCK" <<'RETENCAO'
TODAY=$(date -d "$(date +%F)" +%s)
for FILE in "__DIR__"/luminno-*; do
  [ -f "$FILE" ] || continue
  DAY=$(basename "$FILE" | sed -nE 's/^luminno-[a-z]+_([0-9]{4}-[0-9]{2}-[0-9]{2})_.*/\1/p')
  [ -n "$DAY" ] || continue
  AGE=$(( (TODAY - $(date -d "$DAY" +%s)) / 86400 ))
  [ "$AGE" -lt 7 ] && continue
  [ "$AGE" -le 35 ] && [ "$(date -d "$DAY" +%u)" = 7 ] && continue
  rm -f "$FILE"
done
RETENCAO
    sed -i "s|__DIR__|$BK_DIR|" "$BLOCK"
    cp -p "$BK_SCRIPT" "$BK_SCRIPT.antes-$STAMP"
    awk -v block="$BLOCK" '/-mtime \+30 -delete$/ { while ((getline line < block) > 0) print line; next } { print }' "$BK_SCRIPT.antes-$STAMP" > "$BK_SCRIPT"
    sed -i 's/Guarda 30 dias\./Guarda 7 dias + os domingos das semanas anteriores./' "$BK_SCRIPT"
    bash -n "$BK_SCRIPT"
    rm -f "$BLOCK"
    echo "Backups: agora guarda 7 dias + os domingos das 4 semanas anteriores (cópia anterior do script: $BK_SCRIPT.antes-$STAMP)."
  fi
fi

STEP="reiniciar"
systemctl restart "$SERVICE"
for i in $(seq 1 30); do curl -sf -m 3 "http://127.0.0.1:$PORT/api/health" >/dev/null && break; sleep 1; done
say "Resultado"
echo "Serviço: $(systemctl is-active "$SERVICE")"
echo "Saúde:   $(health)"
echo "Anexos públicos: HTTP $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/uploads/attachments/teste.pdf") (esperado 404)"
journalctl -u "$SERVICE" -n 8 --no-pager
cat <<EOF

### Atualização concluída.
Para voltar atrás:
  systemctl stop $SERVICE && mv "$APP" "$APP.falhou-$STAMP" && mv "$PREV" "$APP" && systemctl start $SERVICE
Backup do banco: $BK/banco.sql.gz
EOF
