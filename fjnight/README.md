# FJ Night — A Noite da Herança · Álbum oficial

Plataforma oficial de memórias fotográficas da **FJ Night — A Noite da Herança**
(13 de novembro, 23h · Av. Wild José de Souza, 175 — Centro · com transmissão para todo o Brasil).

Aplicação independente dentro deste repositório: reaproveita a experiência técnica do álbum
The Love Walk 2026 (índice gerado no build, RAW de câmera, paginação), com identidade visual
nova e reconhecimento facial real. **Nada da Love Walk foi alterado.**

## O que o site faz

| Recurso | Como funciona |
|---|---|
| Abertura cinematográfica | Fundo preto → raios dourados → pomba → FJ NIGHT → coroa → “A Noite da Herança” → botão *Entrar no álbum*. Só CSS e SVG (sem vídeo); exibida uma vez por sessão; respeita “reduzir movimento”. As fotos já carregam por trás dela. |
| Galeria | Mosaico justificado que preenche cada linha sem cortar a proporção, páginas de 60 fotos com rolagem progressiva, *lazy loading*, cor média como fundo enquanto a miniatura chega, filtros por momento (subpastas) e contador. |
| Visualização ampliada | Fundo escuro, transição suave, anterior/próxima, indicador `12 / 600`, arrastar para os lados (celular), arrastar para baixo ou botão *Voltar* do Android para fechar, toque duplo para ampliar, teclado (← → Esc), compartilhar link e **baixar o original**. |
| Reconhecimento facial | Selfie pela câmera ou envio de foto → detecção (YuNet) → comparação (SFace) com todos os rostos das fotos publicadas → resultados em duas faixas (“você aparece” e “possíveis correspondências”). Trata vários rostos (“Qual destes é você?”), rosto pequeno, foto sem rosto, limite de buscas e erros de rede. |
| Privacidade (LGPD) | Consentimento explícito em duas declarações; selfie nunca armazenada; vetores faciais cifrados (AES-256-GCM) e nunca expostos; resultados só com fotos públicas; apagamento automático após o prazo; oposição (opt-out) pelo painel. |
| Administração (`/admin`) | Sincronizar, ocultar fotos, bloquear download, retirar fotos da busca facial, registrar oposição, reconstruir/apagar o índice facial e exportar regras. |

## Estrutura

```
fjnight/
├── backend/
│   ├── config.py         # variáveis de ambiente e config/event.json
│   ├── db.py             # SQLite: catálogo e banco biométrico separados
│   ├── imaging.py        # JPEG/PNG/WebP/RAW → miniatura e versão de exibição
│   ├── catalog.py        # varredura incremental, categorias, regras por arquivo
│   ├── faces.py          # YuNet + SFace, cifragem, busca, retenção, oposição
│   ├── jobs.py           # indexação em segundo plano com progresso
│   ├── routes_public.py  # /api/event, /api/photos, /media/*
│   ├── routes_faces.py   # /api/faces/status, /api/faces/search
│   ├── routes_admin.py   # /api/admin/*
│   ├── security.py       # token, limite de requisições, cabeçalhos (CSP etc.)
│   ├── build.py          # gera todo o índice durante o deploy
│   └── main.py           # aplicação FastAPI e páginas
├── frontend/             # index.html, privacidade.html, admin.html, assets/
├── models/               # modelos faciais (verificados por SHA-256) + licenças
├── config/               # event.json (textos do evento) e photo-rules.json
├── fotos/                # ← coloque as fotografias aqui
├── data/                 # gerado: miniaturas, exibição, catálogo, biometria (fora do Git)
└── tests/
```

**Originais × versões otimizadas:** os arquivos em `fotos/` nunca são alterados. O sistema cria
em `data/derivados/` uma miniatura WebP (720 px) para o mosaico e uma versão WebP (2048 px) para
a visualização ampliada. O botão *Baixar* entrega o arquivo original, byte a byte; para RAW,
entrega o JPEG em resolução total gravado pela própria câmera (sem recompressão).

**Atualização sem reconstruir a interface:** a página não tem lista fixa de fotos — tudo vem da API.
Ao sincronizar, a versão do catálogo muda; visitantes com o site aberto veem o aviso
“Novas fotografias foram publicadas” e atualizam o álbum sem recarregar a página.

## Instalação e execução local

Requisitos: **Python 3.12** (3.11+ funciona) e um navegador moderno.

Windows (PowerShell), na pasta `fjnight`:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
copy .env.example .env      # depois edite o ADMIN_TOKEN
python -m models.download_models
python -m backend.build
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Linux/macOS:

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m models.download_models && python -m backend.build
uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

- Site: http://127.0.0.1:8000/
- Privacidade: http://127.0.0.1:8000/privacidade
- Administração: http://127.0.0.1:8000/admin
- Estado: http://127.0.0.1:8000/api/status

> A câmera do celular só funciona em **HTTPS** (ou em `localhost`). Em produção o Render já
> fornece HTTPS; o envio de foto funciona em qualquer caso.

Gere um token administrativo forte com:

```bash
python -c "import secrets; print(secrets.token_urlsafe(40))"
```

### Docker (opcional)

```bash
cp .env.example .env   # edite
docker compose up --build
```

As fotos (`./fotos`, somente leitura) e os dados (`./data`) ficam em volumes. Na primeira
execução o servidor indexa em segundo plano; acompanhe em `/admin`.

## Publicar no Render

O `render.yaml` na raiz do repositório agora tem dois serviços independentes:

- `the-love-walk-2026-album` — o álbum existente, sem mudanças de funcionamento. Ganhou apenas um
  filtro para **não** ser republicado quando algo muda em `fjnight/`.
- `fjnight-a-noite-da-heranca` — este álbum (`rootDir: fjnight`), republicado só quando algo muda
  em `fjnight/`.

Passos:

1. Faça o merge desta branch na `main`.
2. No Render, abra o Blueprint do repositório e aplique (**Apply**). O novo serviço é criado no plano Free.
3. O Render gera `ADMIN_TOKEN` e `FACE_DATA_KEY` automaticamente. Copie o `ADMIN_TOKEN` do painel
   *Environment* para entrar em `/admin`. Nunca publique esses valores.
4. O build instala as dependências, confere os modelos e roda `python -m backend.build`, que gera
   miniaturas, versões de exibição e o índice facial cifrado. Com ~600 fotos, conte ~5 a 10 minutos.

**Sobre o plano Free:** o disco é recriado a cada deploy. Tudo que vem das fotos é refeito no
build, mas mudanças feitas no painel (ocultar foto, bloquear download, oposições) se perdem no
próximo deploy. Para torná-las permanentes:

- use **Exportar regras** no painel e salve o arquivo em `fjnight/config/photo-rules.json` (commit);
- após registrar uma oposição, use **Retirar estas fotos da busca facial** e exporte as regras —
  assim a decisão fica no Git **sem nenhum dado biométrico**;
- ou adicione um disco persistente (plano pago) montado em `fjnight/data`.

## Adicionar fotografias

1. Coloque as fotos em `fjnight/fotos/`. Subpastas viram filtros; o número inicial só ordena:
   `01 - Chegada/`, `02 - Louvor/`, `03 - A Palavra/`, `04 - Encerramento/`.
2. Formatos: JPG, JPEG, PNG, WebP e RAW (CR2, CR3, NEF, ARW, DNG, ORF, RW2, RAF, PEF, SRW…).
3. Faça commit e push na `main` (o envio pelo navegador do GitHub aceita até 25 MB por arquivo;
   pelo `git push`, até 100 MB). O Render republica e indexa sozinho.
4. Rodando em servidor próprio: copie as fotos e clique em **Sincronizar álbum** no `/admin`.

Publique somente fotografias com autorização de uso de imagem.

## Configuração

### Variáveis de ambiente (`.env` ou painel do Render)

| Variável | Padrão | Função |
|---|---|---|
| `ADMIN_TOKEN` | — | Token do `/admin` (mín. 24 caracteres). Sem ele, o painel fica bloqueado. |
| `FACE_DATA_KEY` | gerada em `data/biometria/.chave` | Segredo que cifra os vetores faciais. |
| `PHOTO_DIR` / `DATA_DIR` | `./fotos` / `./data` | Pastas de originais e de dados gerados. |
| `DOWNLOADS_DEFAULT` | `true` | Download liberado por padrão (exceções no painel ou nas regras). |
| `FACE_SEARCH_ENABLED` | `true` | Liga/desliga a busca facial (o álbum continua normal). |
| `FACE_MATCH_THRESHOLD` | `0.40` | Similaridade mínima. Maior = menos resultados, mais precisos. |
| `FACE_DATA_RETENTION_DAYS` | `90` | Dias após a data do evento para apagar todo dado facial. |
| `FACE_DATA_EXPIRES_AT` | — | Data exata de expiração (substitui o cálculo acima). |
| `FACE_SEARCH_RATE_LIMIT` / `_WINDOW_SECONDS` | `10` / `600` | Buscas permitidas por origem na janela. |
| `MAX_UPLOAD_MB` | `12` | Tamanho máximo da imagem enviada na busca. |
| `INDEX_ON_STARTUP` | `true` | Indexa ao iniciar quando o build não gerou o índice. |
| `CORS_ORIGINS` | — | Apenas se outro domínio consumir a API. |

### `config/event.json`

Textos exibidos no site e na política de privacidade: nome, tema, data, horário, endereço,
`map_url` (link opcional do mapa — só aparece se preenchido), identidade institucional,
`controller` (responsável pelos dados) e `privacy_contact` (canal para pedidos LGPD).
**Preencha `controller` e `privacy_contact` antes de divulgar o site.**

### `config/photo-rules.json`

Regras permanentes por caminho (aceita curingas, ex.: `"Bastidores/*"`): `ocultas`,
`sem_download` e `sem_busca_facial`. O painel exporta este arquivo pronto.

## Reconhecimento facial — detalhes técnicos

- **Detecção:** YuNet 2023mar (OpenCV Zoo, licença MIT), em três escalas (2048, 1024 e 512 px)
  para encontrar tanto rostos pequenos em fotos de grupo quanto rostos muito próximos.
- **Comparação:** SFace 2021dec (OpenCV Zoo, Apache-2.0) gera um vetor de 128 dimensões por rosto,
  alinhado pelos 5 pontos faciais; a busca usa similaridade de cosseno contra todos os rostos.
- **Modelos:** incluídos em `models/` e conferidos por SHA-256 em `python -m models.download_models`
  (baixa das fontes oficiais se estiverem ausentes). Licenças em `models/LICENSES/`.
- **Calibração:** com fotos reais, correspondências verdadeiras ficaram entre 0,56 e 0,95
  (de frente) e 0,40–0,49 (de perfil/olhando para baixo); pessoas diferentes ficaram abaixo de 0,38.
  Por isso o limiar é 0,40 e os resultados entre 0,40 e 0,52 aparecem como “possíveis correspondências”.
- **Desempenho:** ~0,5 s por foto no build (miniaturas + rostos); a busca compara milhares de
  rostos em milissegundos (matriz em memória, recarregada só quando o índice muda).

### Proteção de dados

- A selfie é reduzida no próprio aparelho, enviada por HTTPS, processada só em memória e
  descartada; não há gravação em disco, banco ou log.
- Os vetores das fotos ficam em `data/biometria/faces.sqlite3` (permissão 0600), separados do
  catálogo, cada um cifrado com AES-256-GCM e vinculado à sua foto.
- Nenhuma API pública devolve vetores, posições de rostos ou pontuações; a resposta traz apenas
  fotos já públicas no álbum e uma faixa qualitativa.
- Consentimento com versão (`2026-11-v1`) exigido pelo servidor; sem ele, a busca é recusada.
- Limite de buscas por origem e declaração de que a pessoa procura apenas o próprio rosto (ou
  de quem está sob sua responsabilidade legal) para dificultar pesquisas de terceiros.
- Na data de expiração, o servidor apaga todo o diretório biométrico e encerra a busca; builds
  posteriores não recriam o índice.

### ⚠️ Antes de ativar publicamente

O índice facial é criado a partir de **todas as pessoas que aparecem nas fotos**, não só de quem
faz a busca. Vetores faciais são dados pessoais sensíveis (LGPD, art. 5º, II, e art. 11). Antes de
divulgar a busca, o responsável pelo evento deve confirmar a base legal com assessoria jurídica
— por exemplo, aviso e consentimento no credenciamento/entrada do evento — e manter um canal para
oposição. Se isso não estiver resolvido, publique o álbum com `FACE_SEARCH_ENABLED=false`; a
galeria funciona normalmente e a busca pode ser ligada depois.

## API

| Método e rota | Descrição |
|---|---|
| `GET /api/status` | Saúde do serviço, total de fotos, progresso da indexação. |
| `GET /api/event` | Dados do evento, categorias, versão do catálogo, estado da busca facial. |
| `GET /api/photos?offset=0&limit=60&category=` | Página da galeria (com `ETag`). |
| `GET /api/photos/{id}` | Uma fotografia (links diretos `/#foto={id}`). |
| `GET /media/thumb/{id}.webp`, `/media/display/{id}.webp` | Versões otimizadas (cache imutável). |
| `GET /media/download/{id}` | Original (ou JPEG da câmera para RAW), quando autorizado. |
| `GET /api/faces/status` | Disponibilidade, versão do consentimento e prazo de retenção. |
| `POST /api/faces/search` | `multipart`: `image`, `consent=true`, `consent_version`, `face` (opcional). |
| `/api/admin/*` | Exigem o cabeçalho `X-Admin-Token`. |

## Testes

```bash
cd fjnight
python -m pytest -q tests
```

São 22 testes cobrindo catálogo, orientação EXIF, paginação, cache, download original, regras,
segurança, consentimento, cifragem, limite de buscas, retenção e — quando as fotos de amostra
da Love Walk estão no repositório — reconhecimento real: a mesma pessoa é encontrada numa foto
de grupo em RAW, outra pessoa não aparece, vários rostos pedem escolha e a oposição bloqueia a
pessoa mesmo após reindexar.
