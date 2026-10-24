# The Love Walk 2026 — Álbum de Fotografias

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FJLeoBRx%2FTheloveWalk2026registro)

Site-álbum do The Love Walk 2026, com introdução editorial, trilha sonora da Banda Universos, galeria por categorias, miniaturas e visualização ampliada. O site não oferece reconhecimento facial nem processa dados biométricos.

## Publicar no Render

O repositório inclui um Blueprint em `render.yaml`. Para criar o serviço público:

1. Abra o [Render Blueprint](https://dashboard.render.com/blueprints/new?repo=https%3A%2F%2Fgithub.com%2FJLeoBRx%2FTheloveWalk2026registro) e entre na sua conta Render, caso solicitado.
2. Confira o serviço `the-love-walk-2026-album` e selecione **Apply** para criar e publicar. O Blueprint usa o plano Free.
3. Aguarde a compilação e o deploy. O Render mostrará o endereço público `*.onrender.com`; abra esse endereço para conferir o álbum.
4. O serviço gera um token administrativo automaticamente. Guarde-o com segurança no painel Environment do serviço. Nunca publique esse segredo no GitHub nem o envie em mensagens.

O deploy automático está ativado: alterações novas na branch `main` iniciam novos deploys. O plano Free pode suspender o serviço após inatividade e a primeira visita seguinte pode demorar para responder.

**Importante sobre as fotografias:** este deploy inicial publica o álbum e a trilha sonora, mesmo enquanto a coleção está vazia. O sistema atual usa arquivos no disco do servidor; o plano Free não fornece armazenamento persistente para receber e conservar fotografias entre deploys/reinicializações. Como o acervo ainda não foi recebido, isso não impede publicar agora. Antes de colocar as fotos reais, configure um armazenamento persistente apropriado ou armazenamento de objetos e teste backups e exclusão de arquivos.

## Executar localmente

Requisitos: Python 3.11+ e navegador moderno.

No PowerShell, na pasta do projeto:

    py -m venv .venv
    .\.venv\Scripts\Activate.ps1
    python -m pip install --upgrade pip
    pip install -r requirements.txt

Se o ambiente virtual já existe, use-o em vez de recriá-lo. Configure o arquivo `.env` com um token administrativo forte. Gere um token com:

    .\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(40))"

Não publique nem compartilhe esse token. Inicie o servidor:

    .\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload

- Site: http://127.0.0.1:8000/
- Painel para sincronizar o álbum: http://127.0.0.1:8000/admin.html
- Estado do serviço: http://127.0.0.1:8000/api/health

## Adicionar fotografias

1. Abra a pasta [`colocar as fotos aqui/`](https://github.com/JLeoBRx/TheloveWalk2026registro/tree/main/colocar%20as%20fotos%20aqui) no GitHub e use **Add file → Upload files** para enviar as fotografias.
2. Confirme o upload com **Commit changes** na branch `main`. O Render publicará o novo commit e o serviço indexará as fotos automaticamente ao iniciar.
3. Para criar filtros, organize as fotos em subpastas, por exemplo: `A concentração/`, `A caminhada/`, `Amigos e comunidade/` e `Encerramento/`.
4. Se necessário, abra `/admin.html`, informe o token administrativo, confirme as autorizações e clique em **Sincronizar álbum** para atualizar manualmente.
5. Formatos aceitos: JPG, JPEG, PNG e WebP.

O sistema cria miniaturas em `data/thumbnails` e mantém os originais na pasta da galeria. A página carrega as fotografias por páginas para suportar coleções grandes.

## Playlist musical

O álbum inclui uma playlist de vídeos oficiais da Banda Universos, incorporados pelo YouTube (o projeto não baixa nem hospeda os arquivos musicais). Faixas selecionadas:

- A Caminhada do Amor — https://www.youtube.com/watch?v=HBCcpKBPhYM
- Quando Olho Pra Você — https://www.youtube.com/watch?v=m0yQOrXPVI0
- I Will Love Again — https://www.youtube.com/watch?v=iYJf8z8kdJY
- Love in Ruins (Amor em Ruínas) — https://www.youtube.com/watch?v=V5HjNDEBDIs
- As Marcas Desse Amor — https://www.youtube.com/watch?v=dZ0kyYjetnY

O visitante precisa iniciar a playlist com um clique; a partir daí, o player passa para a próxima faixa automaticamente. Navegadores normalmente bloqueiam áudio com som sem interação prévia. Os vídeos e os direitos musicais continuam sob controle do YouTube e dos titulares correspondentes.

## Endpoints

- `GET /api/health`: estado do serviço e contagem de fotografias.
- `GET /api/gallery?page=1&page_size=28&category=...`: galeria paginada.
- `GET /api/photos?offset=0&limit=36&category=...`: consulta alternativa.
- `POST /api/admin/index`: requer `X-Admin-Token` e JSON `{"confirm_gallery_scan":true}`.
- `DELETE /api/admin/photos/{photo_id}`: remove uma foto do índice; o original fica preservado.

## Antes de divulgar

Confira as autorizações para publicação das fotos e complete o aviso de privacidade com os dados do responsável. O álbum não usa reconhecimento facial. A disponibilidade da música incorporada segue as regras do YouTube e do titular dos direitos.
