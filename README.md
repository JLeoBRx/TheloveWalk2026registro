# The Love Walk 2026

Site do **The Love Walk 2026 — A caminhada que nos une**, com visual roxo/laranja, galeria de fotos preparada para centenas de imagens, e backend para busca facial opcional.

## O que está no repositório

- `index.html`: frontend responsivo, galeria paginada/carregada progressivamente, lightbox, selfie/upload e busca conectada à API.
- `backend/main.py`: API FastAPI, SQLite, geração de miniaturas WebP, indexação facial com YuNet/SFace e busca por similaridade.
- `admin.html`: painel para verificar o serviço, indexar imagens e remover os embeddings faciais.
- `privacy.html`: modelo inicial de aviso de privacidade (precisa ser preenchido/revisado).
- `models/download_models.py`: script para baixar os dois modelos ONNX necessários.
- `requirements.txt`: dependências Python.
- `.env.example`: exemplo de configuração.

## Executar localmente

Requisitos: Python 3.11 recomendado, acesso à internet para baixar os modelos ONNX e navegador moderno.

```bash
python -m venv .venv
```

No Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

No macOS/Linux, use `source .venv/bin/activate`. Depois execute:

```bash
python -m pip install --upgrade pip
pip install -r requirements.txt
python models/download_models.py
```

Copie `.env.example` para `.env` e gere um token administrativo forte:

```bash
python -c "import secrets; print(secrets.token_urlsafe(40))"
```

Cole o token gerado no campo `ADMIN_TOKEN` do `.env`. Nunca publique nem compartilhe esse valor. Inicie a aplicação na raiz do repositório:

```bash
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Acesse:

- Site: http://127.0.0.1:8000/
- Painel administrativo: http://127.0.0.1:8000/admin.html
- Estado da API: http://127.0.0.1:8000/api/health

## Adicionar as fotografias

1. Coloque apenas fotos cuja publicação e indexação para esta finalidade tenham sido autorizadas em `frontend/images/gallery/`.
2. Para filtros por momento, organize as fotos em subpastas como `A concentração/`, `A caminhada/`, `Amigos e comunidade/` ou `Encerramento/`.
3. Abra `/admin.html`, informe o token e verifique se os modelos estão prontos.
4. Leia e confirme a declaração de autorização no painel e inicie a indexação.
5. Teste a galeria e a busca com fotografias autorizadas antes de publicar.

O índice e as miniaturas ficam em `data/`, fora da pasta pública. O banco contém embeddings faciais e deve ter acesso restrito; configure armazenamento persistente, backups protegidos e criptografia em repouso na infraestrutura de produção.

## Endpoints principais

- `GET /api/health`: estado dos modelos e contagem de fotos/rostos.
- `GET /api/gallery?page=1&page_size=24&category=...`: galeria para o frontend.
- `GET /api/photos?offset=0&limit=36&category=...`: paginação alternativa.
- `POST /api/search`: multipart com `consent=true` e `file` (JPG, PNG ou WebP, até 8 MB).
- `POST /api/admin/index`: requer o cabeçalho `X-Admin-Token` e JSON `{"confirm_authorized_photos":true}`.
- `DELETE /api/admin/photos/{photo_id}`: remove a foto do índice/galeria, mas não apaga o original da pasta de origem.
- `POST /api/admin/purge-facial-data`: requer o cabeçalho `X-Admin-Token` e JSON `{"confirm_purge_facial_data":true}`.

## Antes de publicar

Este repositório tem o código-fonte, mas **a busca facial não estará operacional apenas por publicar o HTML**. São necessários servidor Python, dependências, modelos ONNX, fotos autorizadas e indexação inicial. O fluxo facial ainda precisa de teste ponta a ponta no ambiente final.

Configure HTTPS, um token administrativo forte, CORS com a origem HTTPS exata, armazenamento persistente e acesso restrito à base de embeddings. O limitador incluído é básico/em memória e não substitui proteção de borda em implantações com várias instâncias.

## Privacidade e LGPD

Dados biométricos vinculados a uma pessoa são dados pessoais sensíveis. O responsável pelo tratamento deve avaliar e documentar a base legal, finalidade, retenção, segurança, canal para direitos dos titulares e avisos antes de ativar a indexação. Não presuma que autorização para aparecer em uma foto equivale a autorização para reconhecimento facial. O texto em `privacy.html` é apenas um modelo inicial e não constitui validação jurídica.

O código não pretende identificar nominalmente participantes nem usar reconhecimento facial para autenticação. A selfie de consulta é processada em memória e não deve ser armazenada por padrão.

## Licenças dos modelos

O script usa modelos YuNet e SFace distribuídos pelo OpenCV Zoo. Confira os avisos de licença dos arquivos de modelo e da versão baixada antes de usar publicamente. O repositório contém o script de download; os pesos ONNX não são armazenados no Git.

Links dos modelos:
- https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
- https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface
