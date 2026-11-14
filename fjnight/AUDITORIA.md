# Auditoria técnica — FJU Night (novembro de 2026)

Branch: `fjnight-auditoria-producao`, criada a partir de `ccr-bdffddab-ymp5m1` (`a3c63dc`).
A `main` não foi alterada nem mesclada. Fora de `fjnight/`, só mudaram `render.yaml` (serviço da
FJU e um filtro de build no serviço da Love Walk) e duas linhas do `README.md` raiz.

Severidade: **crítica** (dano a pessoas ou perda de dados), **alta**, **média**, **baixa**.

## 1. Problemas encontrados e correções

### Segurança

| # | Sev. | Problema | Correção | Verificação |
|---|---|---|---|---|
| S1 | Alta | `--forwarded-allow-ips '*'` fazia o servidor usar o 1º IP do `X-Forwarded-For`, escolhido pelo visitante: bastava trocar o valor a cada requisição para burlar o limite de buscas. Demonstrado em teste (`6.6.6.6` forjado foi aceito). | IP obtido só do proxy confiável (`TRUSTED_PROXY_HOPS`) ou de cabeçalho da borda (`CLIENT_IP_HEADER`); opção removida do Render e do Docker; diagnóstico no painel. | `test_client_ip_ignores_spoofed_forwarded_for`, `test_search_rate_limit_by_real_ip`, `test_lockout_uses_real_ip_not_spoofed_header` |
| S2 | Alta | O parser multipart grava em arquivo temporário qualquer upload acima de 1 MB: selfies grandes tocavam o disco, contrariando a promessa de não armazenar. | Selfie e foto de oposição chegam como corpo bruto, lidas só em memória, com limite e tipo verificados. | `test_face_upload_is_never_written_to_disk` (falharia com o código anterior) |
| S3 | Média | Painel autenticado por token fixo enviado em toda requisição e guardado em `sessionStorage` (exposto a XSS); sem expiração, logout no servidor ou bloqueio de tentativas; `sleep` bloqueava o threadpool. | Sessão com cookie HttpOnly/SameSite=Strict/Secure, hash no banco, expiração por inatividade e idade, logout e “encerrar todas”; CSRF + `Origin`; bloqueio por IP. | 26 testes em `test_security.py` |
| S4 | Média | CSP com `unsafe-inline`; sem HSTS, COOP e CORP. | CSP sem `unsafe-inline` (estilos inline removidos), HSTS em HTTPS, COOP/CORP, `frame-src` restrito ao YouTube. | `test_security_headers`, `test_html_pages_have_no_inline_styles_or_scripts` |
| S5 | Baixa | Respostas do painel sem `no-store`. | `no-store` e `noindex` em todo `/admin` e `/api/admin`. | `test_security_headers` |

### LGPD e reconhecimento facial

| # | Sev. | Problema | Correção | Verificação |
|---|---|---|---|---|
| L1 | Crítica | Busca facial ligada por padrão (código e `render.yaml`) e índice facial de **todas** as pessoas criado no build sem qualquer autorização. | Desligada por padrão; ativação exige variável + banco durável + chave + `privacy.json` completo + autorização registrada por responsável e vinculada à versão do texto de privacidade. Sem autorização não há índice (e o existente é apagado). | `test_face_search_is_disabled_by_default_and_no_index_is_created`, `test_env_flag_alone_does_not_enable_search`, `test_changing_privacy_text_invalidates_authorization_and_purges_index` |
| L2 | Crítica | Oposições e exclusões da busca ficavam no disco efêmero do Render: num deploy/reinício, a pessoa voltava a ser indexada. | Oposições no banco durável (vetor cifrado), reaplicadas a cada início/sincronização; regras por foto também no banco e nunca apagadas. | `test_optout_survives_restart_new_deploy_and_reindex`, `test_photo_excluded_from_face_search_stays_excluded_after_new_deploy` |
| L3 | Alta | Sem `FACE_DATA_KEY`, uma chave era gerada no disco efêmero; troca de chave não era detectada. | Em produção a chave é obrigatória; impressão digital guardada no banco; chave diferente bloqueia a busca. | `test_production_requires_durable_db_and_env_key`, `test_key_mismatch_blocks_search` |
| L4 | Alta | Exclusão por fim da retenção sem comprovação (marcador em disco efêmero). | Exclusão de índice, oposições e autorizações com recibo verificável no banco e no histórico. | `test_retention_expiry_erases_everything_with_verifiable_receipt` |
| L5 | Média | Página de privacidade com textos de base legal escritos pelo sistema e campos “[a preencher]”. | Página alimentada só por `config/privacy.json` do controlador; vazio = “Não informado pelo controlador”. | `test_privacy_page_never_invents_controller` |
| L6 | Média | (Achado na validação) Busca liberada com o índice ainda parcial: 1 resultado em vez de 2. | Estado “em preparação” até o índice inicial terminar. | Validação no navegador: 2 fotos corretas |

### Persistência e catálogo

| # | Sev. | Problema | Correção |
|---|---|---|---|
| P1 | Crítica | Todas as decisões do painel em SQLite no disco efêmero. | Banco durável (PostgreSQL); em produção sem ele, o painel recusa alterações (galeria segue normal). |
| P2 | Média | Foto identificada pelo caminho: renomear perdia regras; duplicatas e arquivos com erro invisíveis. | Identidade por SHA-256; duplicatas e erros listados no painel; regras sobrevivem à remoção do arquivo. |
| P3 | Média | Sem suporte a armazenamento externo das fotos. | Cloudflare R2 (originais e derivados), downloads por URL assinada de curta duração. |
| P4 | Baixa | Fotos novas entravam no ar sem revisão possível. | Modo opcional `NEW_PHOTOS_REQUIRE_REVIEW`. |

### Painel, RAW, música e interface

| # | Sev. | Problema | Correção |
|---|---|---|---|
| A1 | Média | (Achado na validação) Uma resposta 401 atrasada da verificação inicial derrubava a sessão recém-criada. | Botão liberado após a verificação; respostas antigas não encerram sessões novas. |
| A2 | Média | Sem histórico, verificação de persistência, restauração, confirmações digitadas. | Implementados. |
| R1 | Média | RAW: só o JPEG embutido podia ser baixado; o arquivo da câmera não. | “Baixar” (JPEG da câmera, sem recompressão) e “CR2 original” (byte a byte). |
| M1 | Baixa | Não havia player da FJU. | Playlist própria (vazia por padrão), vídeos ou playlists inteiras do canal oficial da FJU, controles completos e tratamento de erros do YouTube. |
| U1 | Baixa | Botões de busca facial visíveis mesmo com a busca indisponível; marca “FJ Night”. | Botões só aparecem quando o servidor confirma a busca pronta; marca FJU NIGHT. |

### Infraestrutura

- `render.yaml`: busca desligada, `APP_ENV=production`, `DATABASE_URL` e R2 como variáveis manuais,
  health check leve (`/api/health`), filtros de build (FJU só reage a `fjnight/**`, exceto testes e
  `.md`; Love Walk ignora `fjnight/**`). Plano, comandos e variáveis da Love Walk inalterados.
- Docker: sem confiança cega em proxies; `docker-compose.yml` com PostgreSQL.

## 2. Testes executados (resultados reais)

| Configuração | Resultado |
|---|---|
| SQLite + pasta local | 82 passaram |
| PostgreSQL 16 real + pasta local | 81 passaram, 1 pulado (cenário exclusivo de SQLite) |
| PostgreSQL 16 real + “R2” (servidor S3 local moto, boto3 via HTTP) | 81 passaram, 1 pulado |
| Love Walk (`tests/` na raiz) | 3 passaram, 2 falharam — **as mesmas 2 falhas preexistentes**, sem relação com a FJU |

Antes da auditoria a FJU tinha 22 testes; agora são 82.

Validação no navegador (Playwright, Chromium, desktop e Pixel 7/iPhone 13) contra servidor em
`APP_ENV=production` com PostgreSQL: abertura, galeria, visualização de RAW, privacidade, login com
token errado e certo, cookies, painel em todas as abas, autorização pela interface, busca com selfie
(2 resultados corretos), player (com eventos do YouTube simulados — ver pendências).

## 3. Pendências que dependem de terceiros

1. **Credenciais**: `DATABASE_URL` de um PostgreSQL durável e credenciais do Cloudflare R2. O código foi
   testado com PostgreSQL real e com um servidor compatível com S3, mas **não contra o R2 real**.
2. **Controlador**: preencher `config/privacy.json` (controlador, contato, canal, bases legais, aviso
   aos participantes) após revisão jurídica. Sem isso, a busca facial permanece desligada.
3. **Playlist**: os links das músicas do canal oficial da FJU no YouTube (vídeos ou uma playlist do
   canal), a colar no painel. O YouTube estava bloqueado nesta sessão: não foi possível confirmar quais
   vídeos do canal são músicas nem se permitem incorporação, então nenhum ID foi cadastrado às cegas.
   A lógica do player foi validada com um player simulado que emite os eventos oficiais.
4. **Proxy do Render**: a documentação do Render não estava acessível nesta sessão. Após o deploy,
   confirme no painel o “IP que o servidor vê” e ajuste `TRUSTED_PROXY_HOPS`/`CLIENT_IP_HEADER`.
5. **Fotos reais da FJU Night**: a pasta está vazia. A calibração facial usou fotos diurnas da
   Love Walk; valide com fotos da noite (iluminação de palco) antes de ativar a busca.

## 4. Recomendações

- Não ative a busca facial antes dos itens F do [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md).
- Use banco com backup automático; o `pg_dump` é a única cópia dos pedidos de oposição.
- Prefira o R2 às fotos no Git: o repositório já tem ~12 GB e cada deploy clona tudo.
- Faça uma revisão independente (outra pessoa) do texto de `privacy.json` e do procedimento de oposição.
