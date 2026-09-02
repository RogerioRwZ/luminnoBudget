# Validação da autenticação local

## Configuração inicial

A tela inicial foi validada sem sessão ativa. A aplicação apresentou corretamente o fluxo **Criar administrador**, com campos de nome, usuário, e-mail opcional e senha, sem qualquer redirecionamento para serviço de autenticação externo. O texto de apoio informa que a configuração inicial só pode ser concluída uma vez e que a sessão é armazenada em cookie seguro.

## Requisito de produção

Em produção, a aplicação bloqueia a criação de sessão se `JWT_SECRET` tiver menos de 32 caracteres. Para a VPS, o arquivo de ambiente deve usar uma chave aleatória forte, por exemplo o resultado de `openssl rand -hex 64`.

## Transição de acesso

Após a criação temporária do primeiro administrador, a interface passou automaticamente para a tela **Entrar no sistema**, comprovando que a etapa única de configuração foi encerrada e que o fluxo subsequente usa credenciais locais.

## Sessão e permissão administrativa

O login do administrador temporário foi concluído com sucesso. Após a autenticação, a aplicação exibiu o painel interno, a identificação do usuário autenticado, a ação de encerramento de sessão e o item **Administração** na navegação, visível somente para o papel de administrador.

## Painel administrativo

O painel administrativo exibiu o status da aplicação, a confirmação da conexão com o banco, o número de usuários locais, o espaço de uploads disponível, a versão de execução e o diretório de arquivos. Também apresentou criação, alteração de papel, ativação e redefinição de senha para usuários. O usuário de validação foi removido ao fim do teste, para que o administrador real seja criado no primeiro acesso de produção.

Uma segunda sessão temporária foi criada exclusivamente para a verificação responsiva final do painel administrativo. Ela também será removida antes da entrega.

Em viewport mobile, a tela de criação do administrador foi revisada visualmente com campos e ação principal acessíveis sem sobreposição. O painel administrativo possui cobertura automatizada dos pontos de quebra responsivos para cards, colunas e ações empilhadas; a captura sem sessão em viewport isolado confirma que a proteção de acesso também permanece ativa nessa rota.

## Validação visual final — 25/08/2026

Após a inclusão da validação pré-envio e do feedback específico para rate limit, o formulário de acesso foi revisado em 1280 × 720 e 375 × 812. Em ambos os tamanhos, a marca Luminno, os campos Usuário e Senha, a orientação de formato, o limite mínimo de senha, o botão Entrar e o aviso de cookie seguro permanecem legíveis e sem sobreposição. A mensagem de rate limit é produzida por `formatLoginError` e enviada ao toast do formulário quando a mutação de login falha por tentativas excedidas.
