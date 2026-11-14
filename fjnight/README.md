# FJU Night — A Noite da Herança · Álbum oficial

Plataforma oficial de memórias fotográficas da **FJU Night — A Noite da Herança**
(13 de novembro, 23h · Av. Wild José de Souza, 175 — Centro · com transmissão para todo o Brasil).

Aplicação **independente** dentro deste repositório. O álbum The Love Walk 2026 (raiz do
repositório) não depende de nada desta pasta e não foi alterado.

- Publicação: veja **[DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md)**.
- Relatório da auditoria de segurança/LGPD: **[AUDITORIA.md](AUDITORIA.md)**.

---

## 1. Arquitetura

```
Visitante ──HTTPS──▶ Render (FastAPI/uvicorn)
                      ├─ site estático (frontend/) e API pública (/api, /media)
                      ├─ painel /admin (sessão + CSRF)
                      ├─ banco durável ──▶ PostgreSQL (DATABASE_URL)
                      │      catálogo · regras editoriais · oposições (cifradas) ·
                      │      autorização da busca facial · sessões · histórico · playlist
                      ├─ fotos ──▶ Cloudflare R2 (originais + derivados)  ou  pasta fotos/ do Git
                      └─ disco local efêmero (data/)
                             cache de imagens · índice facial cifrado (reconstruível)
```

| Dado | Onde fica | Sobrevive a deploy? | Observação |
|---|---|---|---|
| Fotos originais | R2 `originais/` ou `fjnight/fotos/` | Sim | Nunca alteradas |
| Miniaturas e versões de exibição | R2 `derivados/` ou `data/derivados` | R2: sim · local: refeitas no build | Reconstruíveis |
| Catálogo (ids, dimensões, datas) | PostgreSQL | Sim | Reconstruível a partir dos originais |
| Regras editoriais (ocultar, download, busca facial) | PostgreSQL (+ `config/photo-rules.json`) | Sim | Nunca apagadas pela sincronização |
| Pedidos de oposição | PostgreSQL, vetor cifrado | Sim | Reaplicados a cada início |
| Autorização da busca facial | PostgreSQL | Sim | Vinculada ao texto de `config/privacy.json` |
| Sessões, histórico, playlist | PostgreSQL | Sim | |
| Índice facial das fotos | `data/biometria/` (cifrado) | Não (refeito) | Só existe com autorização |
| Selfie do visitante | memória | — | Nunca gravada |

### Estrutura

```
fjnight/
├── backend/
│   ├── config.py          variáveis de ambiente e textos de config/
│   ├── durable.py         banco durável (SQLAlchemy: PostgreSQL ou SQLite)
│   ├── storage.py         originais e derivados: pasta local ou Cloudflare R2
│   ├── imaging.py         JPEG/PNG/WebP/RAW → derivados (nunca toca no original)
│   ├── catalog.py         sincronização por SHA-256, duplicatas, regras, consultas
│   ├── faces.py           YuNet + SFace, autorização, oposição, retenção
│   ├── jobs.py            sincronização em segundo plano com progresso e histórico
│   ├── playlist.py        trilha da FJU Night (YouTube)
│   ├── security.py        sessões, CSRF, bloqueio de login, IP real, cabeçalhos
│   ├── routes_public.py   /api/event, /api/photos, /media/*
│   ├── routes_faces.py    /api/faces/*
│   ├── routes_admin.py    /api/admin/*
│   ├── build.py           preparação no deploy
│   └── main.py            aplicação e páginas
├── frontend/              index.html, privacidade.html, admin.html, assets/
├── config/                event.json · privacy.json · photo-rules.json · playlist.json
├── models/                modelos faciais oficiais (SHA-256 conferido) + licenças
├── fotos/                 originais no modo local
├── data/                  gerado em execução (fora do Git)
└── tests/                 82 testes
```

## 2. Instalação e execução local

Requisitos: Python 3.12 e, opcionalmente, PostgreSQL.

```bash
cd fjnight
python3.12 -m venv .venv && source .venv/bin/activate      # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
cp .env.example .env                                       # edite ADMIN_TOKEN
python -m models.download_models                           # confere os modelos (SHA-256)
python -m backend.build                                    # cria tabelas e derivados
uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Site: http://127.0.0.1:8000 · Painel: http://127.0.0.1:8000/admin · Privacidade: /privacidade

Sem `DATABASE_URL`, o desenvolvimento usa `data/fjnight.sqlite3`. Gere tokens com
`python -c "import secrets; print(secrets.token_urlsafe(40))"`.

Docker: `docker compose up --build` (inclui PostgreSQL; defina `POSTGRES_PASSWORD` no `.env`).

## 3. Variáveis de ambiente

| Variável | Padrão | Função |
|---|---|---|
| `APP_ENV` | `development` | Use `production` em produção (cookie `Secure`, exige banco durável e chave). |
| `ADMIN_TOKEN` | — | Senha do painel (≥ 24 caracteres). Trocada por sessão; nunca fica no navegador. |
| `DATABASE_URL` | SQLite local | PostgreSQL. No Render, use a URL **externa** (o build também acessa o banco). |
| `SQLITE_ON_PERSISTENT_DISK` | `false` | Declare `true` só se o SQLite estiver num disco persistente. |
| `STORAGE_BACKEND` | `r2` se `R2_BUCKET`, senão `local` | Origem das fotos. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | — | Cloudflare R2. |
| `R2_ORIGINALS_PREFIX` / `R2_DERIVATIVES_PREFIX` | `originais/` / `derivados/` | Pastas no bucket. |
| `R2_DOWNLOAD_URL_TTL_SECONDS` | `300` | Validade das URLs assinadas de download. |
| `FACE_SEARCH_ENABLED` | **`false`** | Primeiro requisito da busca facial (sozinho não ativa nada). |
| `FACE_DATA_KEY` | — | Chave da cifragem facial. **Nunca altere** depois de registrar oposições. |
| `FACE_DATA_RETENTION_DAYS` / `FACE_DATA_EXPIRES_AT` | `90` / — | Fim dos dados faciais (contado da data do evento). |
| `FACE_MATCH_THRESHOLD` | `0.40` | Similaridade mínima (ver §8). |
| `FACE_SEARCH_RATE_LIMIT` / `_WINDOW_SECONDS` | `10` / `600` | Buscas por IP. |
| `TRUSTED_PROXY_HOPS` | `0` (Render: `1`) | Quantos proxies confiáveis acrescentam IP ao `X-Forwarded-For`. |
| `CLIENT_IP_HEADER` | — | Alternativa: cabeçalho que a borda sobrescreve (ex.: `cf-connecting-ip`). |
| `ADMIN_SESSION_IDLE_MINUTES` / `ADMIN_SESSION_MAX_HOURS` | `30` / `8` | Expiração da sessão. |
| `ADMIN_LOGIN_MAX_FAILURES` / `ADMIN_LOGIN_LOCKOUT_MINUTES` | `5` / `15` | Bloqueio após erros de login. |
| `DOWNLOADS_DEFAULT` | `true` | Download liberado por padrão. |
| `RAW_ORIGINAL_DOWNLOADS` | `true` | Oferece o arquivo RAW original (além do JPEG da câmera). |
| `NEW_PHOTOS_REQUIRE_REVIEW` | `false` | Fotos novas ficam ocultas até “Publicar fotos em revisão”. |

## 4. Configurações versionadas (`config/`)

- `event.json` — textos do evento exibidos no site.
- `privacy.json` — **preenchido somente pelo controlador**: controlador, CNPJ/CPF, contato, DPO,
  canal e prazo de atendimento, bases legais e como os participantes foram informados. O sistema não
  inventa esses valores: a página mostra “Não informado pelo controlador” e a busca facial não pode
  ser autorizada enquanto os campos obrigatórios estiverem vazios.
- `photo-rules.json` — padrões permanentes (`ocultas`, `sem_download`, `sem_busca_facial`) e as
  regras por arquivo exportadas pelo painel.
- `playlist.json` — trilha da FJU Night (vazia por padrão; não reaproveita músicas da Love Walk).
  O jeito mais simples é o painel → **Trilha**: cole links de vídeos do canal oficial da FJU no
  YouTube ou o link de uma playlist inteira (`youtube.com/playlist?list=…`). Só tocam vídeos cuja
  incorporação o titular permite; os demais são pulados com aviso.

## 5. Painel administrativo (`/admin`)

- **Entrar/Sair:** o `ADMIN_TOKEN` vira uma sessão (cookie HttpOnly, SameSite=Strict, Secure em
  produção) com expiração por inatividade e por idade máxima. Cinco erros bloqueiam o IP por 15 min.
- **Situação:** verificação real de leitura/escrita no banco, acesso às fotos (pasta ou R2), chave,
  HTTPS e o IP que o servidor está vendo; contadores; última sincronização.
- **Sincronizar:** progresso em tempo real; o sucesso só aparece quando o servidor confirma.
- **Fotos:** publicar/ocultar, download e busca facial por foto; lista de duplicatas e arquivos com erro.
- **Busca facial:** pendências, prévia de `privacy.json`, formulário de autorização (nome, cargo e cinco
  confirmações), revogação, oposições com número de protocolo, reconstrução e exclusão do índice.
- **Trilha, Configurações (exportar/restaurar com simulação prévia), Histórico de operações.**
- Ações destrutivas exigem digitar a palavra de confirmação.

Sem banco durável em produção, o painel entra em **modo somente leitura** (a galeria continua normal).

## 6. Fotos: sincronização e publicação

1. **Modo R2 (recomendado):** envie os originais para `originais/` no bucket, mantendo subpastas para
   os momentos (`originais/01 - Chegada/IMG_0001.CR2`).
   **Modo local:** coloque em `fjnight/fotos/` e faça commit (navegador do GitHub: até 25 MB/arquivo).
2. No painel, **Sincronizar** (ou aguarde o próximo deploy/início do servidor).
3. Formatos: JPG, PNG, WebP e RAW (CR2, CR3, NEF, ARW, DNG, ORF, RW2, RAF, PEF, SRW…).

A sincronização identifica cada foto pelo SHA-256 do conteúdo: renomear/mover mantém id e regras;
cópias idênticas viram “duplicata”; arquivos ilegíveis aparecem em “Arquivos com problema”; fotos
removidas saem do álbum, mas suas regras ficam guardadas e voltam a valer se a foto reaparecer.

**RAW:** a galeria mostra versões WebP otimizadas; “Baixar” entrega o JPEG em resolução total gravado
pela própria câmera (sem recompressão) e “CR2 original” entrega o arquivo RAW intacto. Orientação e
data de captura vêm do EXIF.

## 7. Segurança

- Sessão administrativa com cookie HttpOnly/SameSite=Strict/Secure, hash no banco, expiração e logout.
- CSRF: cabeçalho `X-CSRF-Token` + verificação de `Origin` em toda alteração.
- IP real apenas do proxy confiável (o `X-Forwarded-For` enviado pelo visitante é ignorado).
- Uploads (selfie e oposição) lidos como corpo bruto, **só em memória**, com limite de tamanho e tipo.
- CSP sem `unsafe-inline`, HSTS em HTTPS, COOP/CORP, `X-Frame-Options: DENY`, `noindex` no painel.
- Nenhum segredo em respostas, logs ou exportações; histórico sem dados pessoais.

## 8. Reconhecimento facial e privacidade

**Desligado por padrão.** Só funciona com TODOS os requisitos (o painel mostra cada um):
`FACE_SEARCH_ENABLED=true` · banco durável · `FACE_DATA_KEY` consistente · `privacy.json` completo ·
**autorização registrada no painel** por um responsável, vinculada à versão exata do texto de
privacidade · dentro do prazo · modelos presentes. Sem isso, nenhum índice facial é criado e qualquer
índice existente é apagado.

- **Modelos:** YuNet 2023mar (detecção, MIT) e SFace 2021dec (reconhecimento, Apache-2.0), oficiais
  do OpenCV Zoo, conferidos por SHA-256.
- **Calibração (fotos reais):** mesma pessoa de frente 0,56–0,95; de perfil/olhando para baixo
  0,40–0,49; pessoas diferentes abaixo de 0,38. Limiar 0,40; resultados entre 0,40 e 0,52 aparecem
  como “possíveis correspondências”. Rostos muito pequenos (< 28 px na versão de 2048 px) não são
  indexados — pessoas ao fundo de multidões podem não ser encontradas.
- **Vários rostos na selfie:** o visitante escolhe o seu.
- **Oposição:** registrada no painel a partir de uma foto da pessoa; o vetor cifrado fica no banco
  durável, é reaplicado a cada início e sincronização e bloqueia buscas parecidas.
- **Retenção:** na data de expiração, índice e oposições são apagados e um recibo com a verificação
  (contagens após a exclusão) é gravado e exibido no painel.

## 9. Backup, restauração e recuperação

| Situação | O que fazer |
|---|---|
| Backup rotineiro | `pg_dump` do banco (inclui oposições); **Exportar configurações** no painel; cópia dos originais fora do R2. |
| Perda do disco do Render | Nada: o próximo início refaz cache e índice facial a partir do banco e das fotos. |
| Perda do banco | Crie um novo, aponte `DATABASE_URL`, faça deploy, restaure o `pg_dump` (preferível) ou importe a exportação no painel; sincronize. Sem `pg_dump`, **as oposições precisam ser registradas de novo**: a exportação não inclui dados biométricos por princípio. |
| Perda da `FACE_DATA_KEY` | As oposições ficam ilegíveis e a busca é bloqueada automaticamente. Restaure a chave; se impossível, apague dados faciais com “incluir oposições”, avise os titulares e registre os pedidos novamente antes de reautorizar. |
| Banco indisponível no início | O servidor tenta 5 vezes e falha de forma visível no Render. |
| R2 indisponível | A galeria mostra erro de carregamento das imagens; o painel indica o problema em “Situação”. |

## 10. Testes

```bash
cd fjnight
pytest -q                                                            # SQLite + pasta local
FJN_TEST_DATABASE_URL=postgresql://usuario:senha@host/banco pytest -q  # PostgreSQL real (apaga o banco!)
FJN_TEST_R2=1 pytest -q                                              # "R2" via servidor S3 local (moto)
```

A suíte cobre catálogo, duplicatas, renomeações, exclusões, regras, revisão, RAW, sessões, CSRF,
bloqueio de login, cabeçalhos, uploads em memória, limite por IP real, autorização, revogação,
chave, retenção, rostos reais, oposição após reinício/novo deploy/reindexação, exportação/restauração
e playlist. Os testes com rostos reais usam as fotos de amostra da Love Walk presentes no repositório
e são pulados se elas não existirem.
