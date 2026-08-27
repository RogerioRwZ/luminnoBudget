# Guia de atualização em produção — Luminno Orçamentos

Este procedimento atualiza uma instalação existente do Luminno em uma VPS Ubuntu usando uma branch do GitHub, preservando banco, uploads locais, PDFs históricos e configuração do Cloudflare Tunnel. Execute como administrador da VPS, mas rode Git, pnpm, migrações e build com o usuário de serviço `luminno` sempre que possível.

> **Importante:** nunca faça `git reset --hard`, nunca substitua o arquivo de ambiente por um arquivo do GitHub e nunca execute uma migração destrutiva sem backup verificável.

## 1. Pré-requisitos da instalação

A instalação deve possuir o repositório em `/var/www/luminno-orcamentos`, o serviço systemd `luminno-orcamentos.service`, MySQL acessível por `DATABASE_URL`, Node.js LTS, pnpm e o Cloudflare Tunnel apontando para `http://127.0.0.1:3000`. O arquivo de ambiente deve permanecer fora do repositório, por exemplo em `/etc/luminno-orcamentos.env`, com pelo menos `DATABASE_URL`, `JWT_SECRET`, `AUTH_RATE_LIMIT_SECRET`, `UPLOAD_DIR`, `PDF_HISTORY_DIR` e `NODE_ENV=production`.

Confirme os nomes dos serviços antes da primeira atualização:

```bash
sudo systemctl status luminno-orcamentos --no-pager
sudo systemctl status cloudflared --no-pager
sudo test -f /etc/luminno-orcamentos.env && echo "ambiente encontrado"
```

## 2. Criar backup antes da janela de manutenção

Faça uma cópia do banco e do diretório de uploads. O backup JSON do painel continua útil, mas não substitui o dump MySQL. Não coloque a senha na linha de comando.

```bash
sudo install -d -m 700 /var/backups/luminno-orcamentos
sudo mysqldump --defaults-extra-file=/etc/mysql/luminno-backup.cnf --single-transaction --routines --triggers luminno > /var/backups/luminno-orcamentos/db-$(date +%Y%m%d-%H%M%S).sql
sudo tar -C /var/lib/luminno -czf /var/backups/luminno-orcamentos/arquivos-$(date +%Y%m%d-%H%M%S).tar.gz uploads pdf-history
sudo sha256sum /var/backups/luminno-orcamentos/* | sudo tee /var/backups/luminno-orcamentos/SHA256SUMS
```

O arquivo `/etc/mysql/luminno-backup.cnf` deve ser legível somente por root:

```ini
[client]
user=luminno_backup
password=COLOQUE_A_SENHA_FORA_DO_GIT
host=127.0.0.1
```

```bash
sudo chmod 600 /etc/mysql/luminno-backup.cnf
```

## 3. Colocar o serviço em modo de manutenção

O Cloudflare Tunnel pode continuar ativo, mas a aplicação deve ser parada para impedir gravações durante a troca. Se houver página de manutenção configurada no Cloudflare, ative-a agora. Caso contrário, pare o serviço e atualize rapidamente.

```bash
sudo systemctl stop luminno-orcamentos
sudo systemctl is-active luminno-orcamentos || true
```

## 4. Atualizar o código pela branch publicada

A branch sugerida para esta entrega é `fix/auditoria-formularios-pdf-auth`. Confirme o nome real com `git branch -r` se ele tiver sido alterado no GitHub.

```bash
sudo -u luminno -H bash -lc '
  cd /var/www/luminno-orcamentos
  git fetch origin --prune
  git checkout fix/auditoria-formularios-pdf-auth
  git pull --ff-only origin fix/auditoria-formularios-pdf-auth
  git status --short
'
```

O `git pull --ff-only` evita criar merges acidentais na VPS. Se houver arquivos locais modificados, pare e resolva a situação; não apague a alteração sem entender sua origem.

## 5. Instalar dependências e aplicar o banco

Instale exatamente o lockfile do branch. Depois aplique somente as migrações versionadas. Não use `db:push` em produção para esta atualização, pois ele pode gerar alterações a partir de um esquema local divergente.

```bash
sudo -u luminno -H bash -lc '
  cd /var/www/luminno-orcamentos
  pnpm install --frozen-lockfile
  pnpm drizzle-kit migrate
'
```

Se a migração falhar, não inicie a aplicação. Preserve o log, verifique a conexão e restaure o dump somente se for necessário e após interromper qualquer processo que esteja escrevendo no banco.

## 6. Validar e gerar a produção

A branch corrigida executa type-check e testes antes do bundle. Se qualquer etapa falhar, a atualização deve ser interrompida.

```bash
sudo -u luminno -H bash -lc '
  cd /var/www/luminno-orcamentos
  pnpm check
  pnpm test
  pnpm build
'
```

O build deve criar `dist/index.js` e `dist/public`. O alerta sobre chunks grandes não deve ser confundido com falha de compilação; registre-o para uma futura otimização, mas não ignore erros de `check` ou de testes.

## 7. Conferir ambiente e permissões dos uploads

Não copie `.env`, segredos ou uploads do repositório. Garanta que o diretório local configurado no ambiente existe e pertence ao usuário de serviço.

```bash
sudo install -d -o luminno -g luminno -m 750 /var/lib/luminno/uploads /var/lib/luminno/pdf-history
sudo grep -E '^(NODE_ENV|UPLOAD_DIR|PDF_HISTORY_DIR|DATABASE_URL|JWT_SECRET|AUTH_RATE_LIMIT_SECRET)=' /etc/luminno-orcamentos.env | sed 's/=.*/=<configurado>/'
```

O valor de `UPLOAD_DIR` deve apontar para `/var/lib/luminno/uploads`, e o valor de `PDF_HISTORY_DIR` para `/var/lib/luminno/pdf-history`; ambos devem ficar fora do checkout para não serem substituídos numa atualização. Os PDFs do histórico são baixados por uma rota autenticada e não devem ser expostos como diretório público.

## 8. Reiniciar e verificar a aplicação

```bash
sudo systemctl daemon-reload
sudo systemctl start luminno-orcamentos
sudo systemctl is-active --quiet luminno-orcamentos && echo "aplicação ativa"
curl --fail --silent --show-error http://127.0.0.1:3000/ >/dev/null && echo "HTTP local OK"
sudo journalctl -u luminno-orcamentos -n 80 --no-pager
```

Em seguida, abra o domínio público pelo Cloudflare Tunnel e confirme: login válido, rejeição de senha inválida, bloqueio após tentativas repetidas, painel, criação de cliente, salvamento de orçamento, impressão A4, separação, upload de logo e leitura de imagem de produto.

## 9. Confirmar o Cloudflare Tunnel

A atualização do código não exige alteração no túnel se a origem continuar em `http://127.0.0.1:3000`. Confirme o serviço e os logs:

```bash
sudo systemctl is-active --quiet cloudflared && echo "túnel ativo"
sudo journalctl -u cloudflared -n 60 --no-pager
```

Não exponha a porta 3000 no firewall público. O tráfego deve chegar pela conexão de saída do `cloudflared`.

## 10. Rollback operacional

Se o serviço não iniciar ou um fluxo crítico falhar, pare a aplicação, volte para o commit anterior conhecido e restaure o banco apenas se a migração tiver alterado o esquema de forma incompatível.

```bash
sudo systemctl stop luminno-orcamentos
sudo -u luminno -H bash -lc '
  cd /var/www/luminno-orcamentos
  git log --oneline -5
  git checkout <COMMIT_ANTERIOR_VALIDADO>
  pnpm install --frozen-lockfile
  pnpm check
  pnpm test
  pnpm build
'
sudo systemctl start luminno-orcamentos
```

Para restaurar um banco, use uma cópia previamente verificada e faça a operação com a aplicação parada:

```bash
sudo mysql --defaults-extra-file=/etc/mysql/luminno-backup.cnf luminno < /var/backups/luminno-orcamentos/db-AAAAMMDD-HHMMSS.sql
```

## 11. Rotina recomendada para as próximas versões

Cada release deve seguir esta sequência: abrir uma branch de correção, executar `pnpm check`, `pnpm test` e `pnpm build`, fazer revisão do diff, publicar no GitHub, criar backup, atualizar a branch na homologação, validar os fluxos críticos e só então repetir a atualização na produção.

Mantenha pelo menos três cópias recentes de banco e uploads em armazenamento externo. Verifique periodicamente uma restauração em ambiente isolado; backup que nunca foi restaurado ainda não foi comprovado.

## Checklist final

| Verificação | Resultado esperado |
|---|---|
| Branch correta | `fix/auditoria-formularios-pdf-auth` ou nome confirmado no GitHub |
| Checkout limpo | `git status --short` sem alterações inesperadas |
| Backup | Dump SQL, uploads e checksum armazenados fora do checkout |
| Banco | Migrações aplicadas sem erro |
| Qualidade | `pnpm check`, `pnpm test` e `pnpm build` passam |
| Serviço | `luminno-orcamentos` ativo e sem erro no journal |
| Tunnel | `cloudflared` ativo e domínio respondendo |
| Segurança | Segredos fora do Git, porta 3000 não exposta |
| Fluxos | Login, orçamento, PDF, separação, upload e administração validados |
