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

Use Chrome, Edge, Firefox ou Safari em versão recente. As alterações ficam salvas no navegador. Para guardar ou levar o projeto a outro computador, use **Salvar projeto** (gera um `.json`) e depois **Abrir projeto**. Projetos salvos na versão anterior abrem normalmente.

## Seções do editor

| Seção | O que faz |
|---|---|
| **Cores** | 12 temas prontos, em várias cores e não só em azul. Uma **cor principal** gera a identidade inteira (bordas, centro do degradê, detalhes, textos e forro). Também há cores livres com código hexadecimal, degradê radial ou linear, metal (ouro, champanhe, ouro velho, rosé, cobre, prata), fundo do convite (perolado, cor do envelope ou outra cor), selo em metal ou **lacre colorido**, e cor do forro |
| **Modelo** | textos prontos por ocasião: casamento, noivado, bodas, 15 anos, aniversário, batizado, formatura, gala corporativa, chá de bebê e evento especial. Data, horário e endereço são mantidos |
| **Textos** | pré-título, título (aceita duas linhas), subtítulo, mensagem, data e horário (formatados em português), data por extenso, local, endereço, informações e assinatura |
| **Convite** | moldura (clássica, art déco, filete ou sem), ornamento central (losango, arabesco, pontos, filete, **símbolo** ou sem), monograma (círculo, **coroa de louros** ou sem moldura), título e assinatura em metal, espaçamento |
| **Envelope** | destinatário (em branco vira uma linha para escrever à mão), monograma ou ornamento na frente, remetente no verso, ponta da aba (em V, curva ou reta), profundidade e largura das abas, filetes, textura discreta, padrão e altura do forro |
| **Selo e símbolo** | centro do selo e do monograma com **iniciais** (ex.: `H&R`, `A·B`, `M`), um dos **34 símbolos** da galeria (cruz, cruz com resplendor, pomba, Bíblia, mãos em oração, coração, alianças, coroa, estrela, louros, bolo, formatura e outros) ou **sua própria imagem**: envie PNG, JPG, WEBP ou SVG e o fundo é retirado automaticamente. A imagem pode ficar em **metal, igual ao selo** (vira desenho vetorial com relevo) ou nas **cores originais**. Também: estilo **lacre** ou **medalhão**, texto do anel e diâmetro do selo e dos adesivos |
| **Fontes** | 13 famílias livres para título, destaques, texto e assinatura, tamanhos gerais e **ajuste fino de cada texto** |
| **Medidas** | convite 15 × 21 cm, A5, 5 × 7", quadrado 14 × 14 cm, 10 × 15 cm ou medida livre; folga e sobreposição do envelope |
| **Impressão** | papel do envelope e do convite, sangria, margem da impressora, marcações, cor da linha de corte, o que entra no PDF completo, exportação e projeto |

**Desfazer e refazer** ficam na barra superior (Ctrl+Z e Ctrl+Shift+Z).

A prévia muda em tempo real e tem quatro abas: **Envelope aberto**, **Convite**, **Montado** (verso fechado com o selo, envelope aberto com o forro, frente e convite) e **Forro e selos**.

A **Verificação de produção**, no rodapé, confere:

- se o molde cabe no papel;
- a folga do convite dentro do envelope;
- se os textos ficam dentro da área útil;
- o contraste entre texto e fundo;
- se o selo cabe na aba;
- as áreas de cola, a sobreposição de fechamento e a sangria.

### Imagem própria no selo

1. Em **Selo e símbolo**, escolha **Minha imagem** e envie o arquivo (ou arraste para a área indicada).
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
├── assets/css/editor.css   interface
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
│   ├── app.js              interface, desfazer/refazer, prévia e verificação de produção
│   └── vendor/             jsPDF, svg2pdf.js, opentype.js (licença MIT)
├── assets/fonts/           fontes embutidas (SIL Open Font License) e licenças
├── tools/build-fonts.mjs   regenera assets/fonts/fonts-data.js
└── tools/build-symbols.mjs regenera assets/js/symbols.js
```

Todo o desenho é feito em SVG com o `viewBox` em milímetros. O mesmo SVG alimenta a prévia, o PDF e as imagens. As fontes ficam em base64 dentro de um arquivo `.js` para o editor funcionar abrindo o `index.html` direto do disco (`file://`), onde o navegador bloqueia a leitura de arquivos soltos.

## Créditos

- Ícones da galeria de símbolos: [Font Awesome Free](https://fontawesome.com) 6.7.2, por Fonticons, Inc., licença [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (cópia em `assets/js/vendor/LICENSE-fontawesome-free.txt`). Alianças, cruz com resplendor, estrela-guia e louros são desenhos próprios.
- Fontes: SIL Open Font License 1.1 (`assets/fonts/LICENSES-OFL.txt`).
- Bibliotecas: jsPDF, svg2pdf.js e opentype.js, licença MIT (`assets/js/vendor/`).
