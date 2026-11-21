# Ateliê de Papelaria — envelope, convite, forro e selos

Editor de papelaria personalizada para **impressão física**. Ele gera um kit completo:

- **envelope aberto (planificado)**, com corpo central, aba superior de fechamento, duas abas laterais e aba inferior, linhas de corte e dobra, áreas de cola e selo;
- **convite interno**, em cartão independente que cabe no envelope;
- **forro do envelope**, peça separada colada por dentro da aba;
- **folha de selos adesivos** redondos, para lacrar o envelope.

Os arquivos saem em **PDF vetorial, em milímetros, na escala 100%**, prontos para imprimir, recortar, dobrar e montar. Também dá para baixar **imagens PNG** do convite e de uma apresentação do conjunto montado.

## Como abrir

Abra `papelaria/index.html` com um duplo clique. O editor funciona **offline e sem instalar nada**: bibliotecas e fontes já estão na pasta.

O mesmo editor também funciona publicado como página online (Artifact do claude.ai). Online, ao exportar, a plataforma mostra uma confirmação com o nome e o tamanho do arquivo antes de salvar.

Use Chrome, Edge, Firefox ou Safari em versão recente. As alterações ficam salvas no navegador. Para guardar ou levar o projeto a outro computador, use **Projeto › Salvar arquivo do projeto** (gera um `.json`) e depois **Projeto › Abrir arquivo do projeto**. Projetos salvos nas versões anteriores abrem normalmente.

## A interface

A tela tem três áreas, como um pequeno estúdio:

- **Etapas, no alto:** 1 Envelope aberto, 2 Convite, 3 Montagem (verso fechado com o selo, envelope aberto com o forro, frente e convite) e 4 Forro e selos. A etapa escolhida é o que aparece na área de trabalho.
- **Ferramentas, à esquerda:** Cores, Modelos, Textos, Cartões, Envelope, Selo, Fontes, Medidas e Impressão. Cada uma abre só as próprias opções, em seções que abrem e fecham. Ao lado do título de cada seção aparece um resumo do que está escolhido.
- **Área de trabalho, ao centro:** as peças aparecem como papel de verdade, com sombra suave. Dá para aproximar e afastar, ajustar à tela, ver em tamanho real aproximado, arrastar para mover, usar tela cheia, ligar ou desligar as guias e entrar no **modo visualização**, que esconde os painéis.

**Edição direta:** clique em qualquer texto do convite (ou no destinatário e no remetente do envelope) e edite ali mesmo. Clicar no monograma abre o Selo; clicar no ornamento abre Cartões; clicar na data abre Data e horário.

| Ferramenta | O que faz |
|---|---|
| **Cores** | 12 temas prontos, em várias cores e não só em azul. Uma **cor principal** gera a identidade inteira (bordas, centro do degradê, detalhes, textos e forro). Cada cor abre um seletor com as cores do projeto, as **usadas recentemente**, sugestões, código hexadecimal e o seletor do sistema. Também: degradê radial ou linear, metal (ouro, champanhe, ouro velho, rosé, cobre, prata) e fundo do convite (perolado, cor do envelope ou outra cor) |
| **Modelos** | galeria com miniaturas por ocasião (casamento, noivado, bodas, 15 anos, aniversário, chá de bebê, batizado, evento especial, formatura, gala corporativa), separada em categorias. Cada modelo abre uma prévia antes de ser aplicado; data, horário, local e endereço são mantidos |
| **Textos** | pré-título, título (aceita duas linhas), subtítulo, mensagem, data e horário (formatados em português), data por extenso, local, endereço, informações, assinatura e textos do envelope. O botão **Aa** de cada texto abre fonte própria, estilo (peso ou itálico, conforme a fonte), cor (texto, destaque ou metal), **alinhamento**, tamanho, **espaço entre letras** e **entrelinha** |
| **Cartões** | moldura (clássica, art déco, filete ou sem), ornamento central (losango, arabesco, pontos, filete, **símbolo** ou nenhum), monograma (círculo, louros ou simples), título e assinatura em metal, espaçamento entre blocos. As opções aparecem como miniaturas desenhadas com as suas cores |
| **Envelope** | ponta da aba (em V, curva ou reta), profundidade e largura das abas, frente (rótulo, destinatário, moldura, ornamento ou monograma), verso (remetente e filetes), textura discreta e forro interno (cor, padrão e altura) |
| **Selo** | prévia grande do selo como será impresso. Centro com **iniciais** (ex.: `H&R`, `A·B`, `M`) e a fonte delas, um dos **34 símbolos** da galeria (cruz, pomba, Bíblia, mãos em oração, coração, alianças, coroa, estrela, louros, bolo, formatura e outros) ou **sua própria imagem** com o fundo retirado automaticamente. Estilo **lacre** ou **medalhão**, metal ou **lacre colorido**, diâmetro do selo e dos adesivos e texto do anel |
| **Fontes** | 13 famílias livres para título, destaques, texto corrido, assinatura e iniciais, com amostra no próprio texto do convite; tamanhos gerais e ajuste fino de cada texto |
| **Medidas** | convite 15 × 21 cm, A5, 5 × 7 pol., quadrado 14 × 14 cm, 10 × 15 cm ou medida livre em mm; folga e sobreposição do envelope; ficha com envelope fechado, molde aberto, abas e folga; área imprimível e área segura |
| **Impressão** | mostra **todas as folhas do PDF** lado a lado, em proporção (clique numa folha da lista para aproximar). Papel e **orientação** do envelope e do convite, convites por folha, sangria, margem da impressora, marcações, cor da linha de corte, o que entra no PDF completo e exportação |

**Salvamento automático:** o indicador no alto mostra "Salvando…" e "Salvo". **Desfazer e refazer** ficam ao lado. Ações que apagam algo importante (restaurar o padrão, remover a imagem enviada, abrir outro projeto, aplicar um modelo) pedem confirmação, e o aviso que aparece depois oferece **Desfazer**.

Em telas menores o painel vira uma gaveta; no celular, as ferramentas ficam numa barra embaixo e o painel sobe como uma folha.

### Atalhos

| Tecla | Ação |
|---|---|
| Ctrl+Z · Ctrl+Shift+Z (ou Ctrl+Y) | desfazer · refazer |
| + · − | aproximar · afastar |
| 0 · 1 | ajustar à tela · tamanho real aproximado |
| Ctrl + roda do mouse | zoom em torno do ponteiro |
| V | modo visualização |
| G | guias e áreas de segurança |
| F | tela cheia |
| Esc | fecha editor, seletor, menu ou janela; sai da tela cheia e da visualização |

A **Verificação de produção**, no canto inferior esquerdo, fica verde quando está tudo pronto e mostra alertas ou problemas quando aparecem. Ela confere:

- se o molde cabe no papel;
- a folga do convite dentro do envelope;
- se os textos ficam dentro da área útil;
- o contraste entre texto e fundo;
- se o selo cabe na aba;
- as áreas de cola, a sobreposição de fechamento e a sangria.

### Imagem própria no selo

1. Em **Selo › Centro**, escolha **Imagem** e envie o arquivo (ou arraste para a área indicada).
2. O editor descobre a cor do fundo pelas bordas da imagem (ou usa a transparência do PNG) e retira esse fundo.
3. Em **Metal, igual ao selo**, o desenho vira um contorno vetorial dourado, com o mesmo relevo das iniciais. Fica nítido em qualquer tamanho e entra no arquivo de hot stamping.
4. Em **Cores originais**, a imagem é usada como está, só sem o fundo. Áreas claras dentro do desenho são mantidas.
5. Se sobrar fundo, aumente **Remoção do fundo**; se partes do desenho sumirem, diminua. Funciona melhor com logotipos em fundo liso.

A imagem é processada no próprio navegador e fica salva junto com o projeto.

## Exportação

| Item do menu Exportar | Conteúdo |
|---|---|
| **PDF completo para produção** | envelope, convite, forro, selos adesivos, faca do envelope (somente linhas), hot stamping (opcional) e ficha técnica com montagem passo a passo |
| **PDF do envelope** | molde no papel escolhido (automático: o menor papel em que o molde cabe), com legenda e régua de 50 mm |
| **PDF do convite** | convite com sangria e marcas de corte (página ajustada), em tamanho final exato ou montado em A4, Carta, A3 ou SRA3 com quantas cópias couberem |
| **PDF do forro** | forro com sangria, linha de corte e dobra |
| **PDF dos selos adesivos** | folha A4 com selos redondos e linhas de corte |
| **Imagem do convite** | PNG a 300 dpi (15 × 21 cm = 1772 × 2480 px), para WhatsApp e redes sociais |
| **Imagem de apresentação** | PNG de 2400 px com envelope fechado, aberto com forro, frente e convite |

Garantias técnicas dos PDFs:

- **Páginas no tamanho exato do papel, em milímetros.** Por exemplo, A3 = 297 × 420 mm. Nada é reduzido para caber.
- **Escala 100%:** o PDF pede ao leitor que imprima **sem ajuste de escala** (`PrintScaling = None`). Cada folha traz uma **régua de 50 mm** para conferir com uma régua de verdade.
- **Arquivo vetorial:** os textos são convertidos em curvas. O PDF não depende de fontes instaladas e imprime nítido em qualquer resolução.
- **Convite com `TrimBox` e `BleedBox`** na página ajustada, o padrão que as gráficas usam para refile e sangria.
- **Sangria configurável** (padrão de 3 mm) nas bordas externas do envelope, do convite e do forro.

### Medidas do projeto padrão

| Peça | Medida |
|---|---|
| Convite | 150 × 210 mm |
| Envelope fechado | 220 × 160 mm (o convite entra deitado, com 5 mm de folga por lado) |
| Molde aberto | ≈ 273 × 359 mm, impresso em **A3** |
| Forro | ≈ 213 × 153 mm, impresso em **A4** deitado |
| Selos adesivos | Ø 40 mm, 20 por folha A4 |
| Convite 10 × 15 cm | envelope 156 × 106 mm, molde que **cabe em A4** |

## Impressão

1. Na janela de impressão, escolha **Tamanho real / Escala 100%** e desative "Ajustar à página".
2. Confira a régua de 50 mm com uma régua.
3. Papel sugerido para o envelope: 120 a 180 g/m² (offset, color plus ou perolado).
4. Papel sugerido para o convite: 250 a 300 g/m² (couché fosco, perolado ou algodão).
5. Papel sugerido para o forro: 75 a 120 g/m². Para os selos, papel adesivo (vinil branco ou couché adesivo).
6. Impressoras domésticas não imprimem até a borda. Por isso o molde fica centralizado, com margem, e a arte avança sobre a sangria, que é cortada fora.

**Cores:** o PDF é gerado em RGB. A gráfica converte para CMYK, e cores muito saturadas podem mudar um pouco: peça uma prova impressa. O metal é simulado por degradê. Para **dourado metálico real**, ative "Hot stamping": as páginas trazem em preto 100% somente as áreas em metal, na mesma posição da arte, para a gráfica fazer o filme. O lacre colorido é impresso em cores normais e não entra no hot stamping.

## Montagem do envelope

As abas dobram **para o verso**, o lado sem impressão. Por isso a arte das abas superior e inferior, incluindo o selo e o remetente, vem desenhada de cabeça para baixo no molde. Depois de dobradas, elas ficam de pé.

1. Corte pela linha contínua. As marcas externas tracejadas ajudam a alinhar a régua nas dobras.
2. Vinque as linhas tracejadas com uma dobradeira ou uma caneta sem tinta.
3. Dobre as abas laterais para dentro e passe cola **somente** nas áreas hachuradas "COLA". Depois da montagem, elas ficam escondidas sob a aba inferior.
4. Dobre a aba inferior sobre as laterais e pressione.
5. Forro (opcional): recorte, dobre na linha tracejada, encaixe a parte de baixo dentro do envelope e cole só a parte da aba.
6. Insira o convite e feche a aba superior. Para lacrar, use um selo adesivo ou um ponto de fita dupla face sob a ponta da aba.

As medidas das abas são calculadas para que o verso fique totalmente fechado. A aba inferior sobe até cobrir a abertura, e a aba superior a sobrepõe com a margem definida em "Sobreposição no fechamento".

## Estrutura

```
papelaria/
├── index.html              editor
├── assets/css/editor.css   interface (cores, tipografia, componentes e telas menores)
├── assets/css/ui-fonts.css fontes da interface, embutidas (gerado por tools/build-ui-fonts.mjs)
├── assets/js/
│   ├── core.js             utilitários, cores (HSL, contraste), contexto de desenho (arte / faca / hot stamping)
│   ├── geometry.js         polígonos: arredondamento, sangria (offset), recorte, hachuras
│   ├── type.js             texto → curvas (opentype.js), quebra de linhas, texto em círculo
│   ├── state.js            padrões, tamanhos, temas, metais, lacres, modelos por ocasião e papéis
│   ├── symbols.js          galeria de símbolos (gerado por tools/build-symbols.mjs)
│   ├── emblem.js           encaixe de iniciais, símbolos e imagens no selo e no monograma
│   ├── imagetools.js       imagem enviada: remoção do fundo e conversão em vetor
│   ├── seal.js             selo (lacre ou medalhão, metal ou cera colorida) e monograma
│   ├── ornaments.js        divisores, arabesco, coroa de louros e monograma emoldurado
│   ├── envelope.js         geometria do molde, arte, áreas de cola, forro e prévia montada
│   ├── card.js             convite: fundo, moldura, blocos de texto e ajuste automático
│   ├── sheets.js           folhas de impressão, marcas, legenda, régua, forro, selos e ficha técnica
│   ├── pdf.js              exportação em PDF (jsPDF + svg2pdf.js)
│   ├── export.js           cena montada e imagens PNG
│   ├── app.js              interface: etapas, ferramentas, seletor de cores, edição direta, zoom,
│   │                       folhas de impressão, desfazer/refazer, salvamento e verificação
│   └── vendor/             jsPDF, svg2pdf.js, opentype.js (licença MIT)
├── assets/fonts/           fontes embutidas (SIL Open Font License) e licenças
├── tools/build-fonts.mjs   regenera assets/fonts/fonts-data.js
├── tools/build-ui-fonts.mjs regenera assets/css/ui-fonts.css
└── tools/build-symbols.mjs regenera assets/js/symbols.js
```

Todo o desenho é feito em SVG com o `viewBox` em milímetros. O mesmo SVG alimenta a prévia, o PDF e as imagens. As fontes ficam em base64 dentro de um arquivo `.js` para o editor funcionar abrindo o `index.html` direto do disco (`file://`), onde o navegador bloqueia a leitura de arquivos soltos.

## Créditos

- Ícones da galeria de símbolos: [Font Awesome Free](https://fontawesome.com) 6.7.2, por Fonticons, Inc., licença [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (cópia em `assets/js/vendor/LICENSE-fontawesome-free.txt`). Alianças, cruz com resplendor, estrela-guia e louros são desenhos próprios.
- Fontes das peças: SIL Open Font License 1.1 (`assets/fonts/LICENSES-OFL.txt`).
- Fontes da interface: Manrope e EB Garamond, SIL Open Font License 1.1.
- Bibliotecas: jsPDF, svg2pdf.js e opentype.js, licença MIT (`assets/js/vendor/`).
