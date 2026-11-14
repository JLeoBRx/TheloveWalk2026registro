# Checklist de publicação — FJU Night

Marque cada item **depois de verificar**, não apenas depois de ler. Itens marcados com 🔒 bloqueiam a
publicação; os marcados com ⚖️ bloqueiam apenas a ativação da busca facial.

## A. Antes do merge

- [ ] 🔒 Revisar a branch `fjnight-auditoria-producao` e o relatório [AUDITORIA.md](AUDITORIA.md).
- [ ] 🔒 Rodar `pytest -q` em `fjnight/` (esperado: 82 passam).
- [ ] 🔒 Confirmar que `fjnight/fotos/` contém apenas fotos autorizadas da FJU Night (hoje: só o `LEIA-ME.md`).
- [ ] Conferir que nenhum `.env`, chave ou senha foi adicionado ao Git (`git grep -nI "R2_SECRET\|ADMIN_TOKEN="`).

## B. Banco de dados durável (PostgreSQL)

- [ ] 🔒 Criar um PostgreSQL **que não expire**: Render Postgres em plano pago, ou outro provedor
      (ex.: Neon, Supabase). Confirme na documentação atual se o plano gratuito escolhido tem prazo
      de expiração — um banco que expira apagaria regras e pedidos de oposição.
- [ ] 🔒 Copiar a **URL externa** de conexão (com `sslmode=require` se o provedor exigir).
- [ ] Ativar backups automáticos do provedor e anotar como restaurar.

## C. Cloudflare R2 (recomendado para as fotos)

- [ ] Criar o bucket (ex.: `fjunight-album`), **privado** (sem acesso público).
- [ ] Criar um token de API do R2 com permissão *Object Read & Write* restrita a esse bucket.
- [ ] Anotar: Account ID, Access Key ID, Secret Access Key, nome do bucket.
- [ ] Enviar os originais para `originais/` mantendo subpastas por momento
      (painel da Cloudflare, `rclone` ou `aws s3 cp --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).
- [ ] Guardar uma cópia dos originais **fora** do R2.

> Sem R2, as fotos podem ir em `fjnight/fotos/` pelo Git (limite de 100 MB por arquivo).

## D. Render

- [ ] 🔒 Fazer o merge na `main` (somente após A).
- [ ] 🔒 No Render: **Blueprints → (este repositório) → Sync/Apply**. O serviço
      `fjnight-a-noite-da-heranca` será criado; o `the-love-walk-2026-album` continua igual.
- [ ] 🔒 Preencher quando solicitado: `DATABASE_URL` (passo B) e, se usar R2, `R2_ACCOUNT_ID`,
      `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
- [ ] 🔒 Copiar o `ADMIN_TOKEN` gerado (aba *Environment*) para um cofre de senhas.
- [ ] 🔒 Copiar também a `FACE_DATA_KEY` gerada para o cofre. **Nunca a altere.**
- [ ] Acompanhar o log do build até `[build] concluído` e `busca facial autorizada: False`.

## E. Verificação após o deploy

- [ ] 🔒 `https://<serviço>.onrender.com/api/health` responde `{"status":"ok"}`.
- [ ] 🔒 A página inicial abre, a abertura aparece e o álbum lista as fotos.
- [ ] 🔒 Uma foto abre ampliada e o download funciona (no R2, o navegador é redirecionado para uma URL temporária).
- [ ] 🔒 `/admin`: entrar com o `ADMIN_TOKEN`; em **Situação**, todos os itens de persistência em ✓:
      “PostgreSQL: leitura e escrita confirmadas”, “Decisões do painel são permanentes”, fotos acessíveis.
- [ ] 🔒 Em **Situação**, conferir “IP que o servidor vê para você” com o seu IP real
      (ex.: pesquisar “meu ip”). Se for diferente, ajuste `TRUSTED_PROXY_HOPS` (ou defina
      `CLIENT_IP_HEADER=cf-connecting-ip` se esse cabeçalho aparecer na lista) e repita.
- [ ] Ocultar e reexibir uma foto pelo painel; fazer um novo deploy manual; confirmar que a decisão continuou.
- [ ] **Configurações → Exportar** e guardar o arquivo.
- [ ] **Trilha:** no painel → Trilha, colar os links das músicas do canal oficial da FJU no YouTube
      (ou de uma playlist do canal), salvar e conferir no site que tocam.
- [ ] A Love Walk continua no ar e inalterada.

## F. ⚖️ Somente se a busca facial for ativada

- [ ] ⚖️ O controlador definiu, com assessoria jurídica, a base legal para indexar o rosto de **todas**
      as pessoas fotografadas (o consentimento de quem envia a selfie não basta).
- [ ] ⚖️ Os participantes foram informados (aviso no evento/inscrição, publicação da política).
- [ ] ⚖️ Preencher `config/privacy.json` com os textos **do controlador** e fazer commit/deploy.
- [ ] ⚖️ Revisar `/privacidade` publicada: nenhum campo “Não informado pelo controlador”.
- [ ] ⚖️ Canal de atendimento operando; equipe sabe registrar oposição pelo painel.
- [ ] ⚖️ Alterar `FACE_SEARCH_ENABLED=true` no Render e reiniciar.
- [ ] ⚖️ No painel → **Busca facial**: conferir todas as pendências em ✓, preencher nome e cargo,
      marcar as cinco confirmações e registrar a autorização (digitando AUTORIZAR).
- [ ] ⚖️ Aguardar “A busca facial está ATIVA” e testar com a própria selfie.
- [ ] ⚖️ Registrar uma oposição de teste com foto de um voluntário, confirmar que ele deixa de ser
      encontrado, reiniciar o serviço, confirmar de novo e remover o registro de teste.
- [ ] ⚖️ Anotar a data de exclusão automática mostrada no painel.

## G. Rotina

- [ ] Backup do banco (o provedor ou `pg_dump`) — contém os pedidos de oposição.
- [ ] Exportar configurações após mudanças importantes no painel.
- [ ] Revisar o **Histórico** periodicamente.
- [ ] Após a data de retenção, conferir no painel o recibo de exclusão com verificação “confirmada”.
