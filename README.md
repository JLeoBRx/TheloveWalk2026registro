# The Love Walk 2026 — Álbum de Fotografias

Site-álbum do The Love Walk 2026, com introdução editorial, trilha sonora oficial da Banda Universos, galeria organizada por subpastas, miniaturas e visualização ampliada. O site não oferece reconhecimento facial nem armazena dados biométricos.

## Executar localmente

Requisitos: Python 3.11+ e navegador moderno.

No PowerShell, na pasta do projeto, execute:

    py -m venv .venv
    .\.venv\Scripts\Activate.ps1
    python -m pip install --upgrade pip
    pip install -r requirements.txt

Se o ambiente virtual já existe, use-o em vez de recriá-lo. Configure o arquivo .env com um token administrativo forte. Gere um token com:

    .\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(40))"

Não publique nem compartilhe esse token. Inicie o servidor:

    .\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload

- Site: http://127.0.0.1:8000/
- Painel para sincronizar o álbum: http://127.0.0.1:8000/admin.html
- Estado do serviço: http://127.0.0.1:8000/api/health

## Adicionar fotografias

1. Copie apenas fotografias que você tem autorização para publicar para a pasta frontend/images/gallery/.
2. Para criar filtros no álbum, organize as fotos em subpastas, por exemplo: A concentração/, A caminhada/, Amigos e comunidade/ e Encerramento/.
3. Abra o painel /admin.html, informe o token, marque a confirmação de autorização e clique em Sincronizar álbum.
4. Atualize a página inicial. As subpastas viram categorias automaticamente.
5. Formatos aceitos: JPG, PNG e WebP.

O sistema cria miniaturas leves em data/thumbnails e mantém os originais na pasta da galeria. A página carrega as fotografias em páginas para não tentar abrir centenas de imagens de uma só vez.

## Música tema

O site incorpora, depois do clique do visitante, o vídeo oficial “A Caminhada do Amor” da Banda Universos no YouTube. O projeto não copia nem hospeda o arquivo musical. O navegador pode exigir uma interação do visitante para iniciar a reprodução.

Vídeo oficial: https://www.youtube.com/watch?v=HBCcpKBPhYM

## Endpoints

- GET /api/health: status, contagem de fotografias e configuração administrativa.
- GET /api/gallery?page=1&page_size=28&category=...: galeria paginada.
- GET /api/photos?offset=0&limit=36&category=...: consulta alternativa.
- POST /api/admin/index: requer o cabeçalho X-Admin-Token e JSON {"confirm_gallery_scan":true}.
- DELETE /api/admin/photos/{photo_id}: remove uma foto do índice do álbum; o arquivo original é mantido.

## Antes de publicar

O endereço local 127.0.0.1 só abre no seu computador. Para publicar, hospede o site e a API em uma infraestrutura com HTTPS e armazenamento persistente para frontend/images/gallery/ e data/. Proteja o token administrativo, mantenha backups e confira as autorizações de publicação. Complete e revise o aviso de privacidade com os dados do responsável pelo álbum.

O player usa um vídeo hospedado no canal oficial da Banda Universos. A disponibilidade e as regras de incorporação dependem do YouTube e do titular do conteúdo.
