# Ateliê de Papelaria — envelope planificado e convite

Editor local de papelaria personalizada para **impressão física**. Ele gera:

- um **envelope aberto (planificado)**, com corpo central, aba superior de fechamento, duas abas laterais e aba inferior, linhas de corte e dobra, áreas de cola e selo dourado;
- um **convite interno**, em cartão independente que cabe no envelope.

Os arquivos saem em **PDF vetorial, em milímetros, na escala 100%**, prontos para imprimir, recortar, dobrar e montar.

## Como abrir

Abra `papelaria/index.html` com um duplo clique. O editor funciona **offline e sem instalar nada**. Bibliotecas e fontes já estão na pasta.

Use Chrome, Edge, Firefox ou Safari em versão recente. As alterações ficam salvas no navegador. Para guardar ou levar o projeto a outro computador, use **Salvar projeto** (gera um `.json`) e depois **Abrir projeto**.

## O que dá para personalizar

| Seção | Itens |
|---|---|
| Textos do convite | pré-título, título (aceita duas linhas), subtítulo, mensagem, frase e assinatura |
| Data, horário e local | data e horário (formatados em português), estilo **bloco clássico** ou **em linha**, data por extenso livre, local, endereço e informações adicionais |
| Envelope | destinatário (em branco vira uma linha para escrever à mão), remetente no verso, formato da aba (**ponta**, **curva** ou **reta**), profundidade das abas, largura das laterais, sobreposição, folga, moldura, filetes e textura discreta |
| Selo dourado | iniciais (ex.: `H&R`, `A·B`, `M`), estilo **lacre** ou **medalhão**, texto do anel, diâmetro e fonte do monograma |
| Cores e degradês | paletas de azul-marinho a royal, cores livres, degradê radial ou linear com ângulo, tons de metal (ouro, champanhe, ouro velho, rosé, prata), fundo do convite **perolado** ou **azul** e três molduras |
| Tipografia | 13 famílias livres (caligráficas, maiúsculas, serifadas e sem serifa) para título, destaques, texto e assinatura, além do tamanho |
| Formato | convite 15 × 21 cm, A5, 5 × 7", quadrado 14 × 14 cm, 10 × 15 cm ou medida livre |
| Impressão | papel do envelope e do convite, sangria, margem da impressora, marcações, cor da linha de corte e conteúdo do PDF completo |

A prévia muda em tempo real e tem três abas: **Envelope aberto**, **Convite** e **Montado** (frente, verso fechado com o selo e o convite). A **Verificação de produção**, no rodapé, confere:

- se o molde cabe no papel;
- a folga do convite dentro do envelope;
- se os textos ficam dentro da área útil;
- se o selo cabe na aba;
- as áreas de cola, a sobreposição de fechamento e a sangria.

## Exportação em PDF

| Botão | Conteúdo |
|---|---|
| **PDF do envelope** | molde no papel escolhido (automático: o menor papel em que o molde cabe), com legenda e régua de 50 mm |
| **PDF do convite** | convite com sangria e marcas de corte (página ajustada), em tamanho final exato ou montado em A4, Carta, A3 ou SRA3, com quantas cópias couberem na folha |
| **PDF completo para produção** | envelope + convite + faca do envelope (somente linhas) + arquivos de hot stamping (opcional) + ficha técnica com montagem passo a passo |

Garantias técnicas dos PDFs:

- **Páginas no tamanho exato do papel, em milímetros.** Por exemplo, A3 = 297 × 420 mm. Nada é reduzido para caber.
- **Escala 100%:** o PDF pede ao leitor que imprima **sem ajuste de escala** (`PrintScaling = None`). Cada folha traz uma **régua de 50 mm** para conferir com uma régua de verdade.
- **Arquivo vetorial:** os textos são convertidos em curvas. O PDF não depende de fontes instaladas e imprime nítido em qualquer resolução.
- **Convite com `TrimBox` e `BleedBox`** na página ajustada, o padrão que as gráficas usam para refile e sangria.
- **Sangria configurável** (padrão de 3 mm) nas bordas externas do envelope e do convite.

### Medidas do projeto padrão

| Peça | Medida |
|---|---|
| Convite | 150 × 210 mm |
| Envelope fechado | 220 × 160 mm (o convite entra deitado, com 5 mm de folga por lado) |
| Molde aberto | ≈ 273 × 359 mm, impresso em **A3** |
| Convite 10 × 15 cm | envelope 156 × 106 mm, molde que **cabe em A4** |

## Impressão

1. Na janela de impressão, escolha **Tamanho real / Escala 100%** e desative "Ajustar à página".
2. Confira a régua de 50 mm com uma régua.
3. Papel sugerido para o envelope: 120 a 180 g/m² (offset, color plus ou perolado).
4. Papel sugerido para o convite: 250 a 300 g/m² (couché fosco, perolado ou algodão).
5. Impressoras domésticas não imprimem até a borda. Por isso o molde fica centralizado, com margem, e a arte avança sobre a sangria, que é cortada fora.

**Cores:** o PDF é gerado em RGB. A gráfica converte para CMYK, e azuis muito saturados podem mudar um pouco: peça uma prova impressa. O dourado é simulado por degradê. Para **dourado metálico real**, ative "Arquivos de hot stamping": as páginas trazem em preto 100% somente as áreas douradas, na mesma posição da arte, para a gráfica fazer o filme.

## Montagem do envelope

As abas dobram **para o verso**, o lado sem impressão. Por isso a arte das abas superior e inferior, incluindo o selo e o remetente, vem desenhada de cabeça para baixo no molde. Depois de dobradas, elas ficam de pé.

1. Corte pela linha contínua. As marcas externas tracejadas ajudam a alinhar a régua nas dobras.
2. Vinque as linhas tracejadas com uma dobradeira ou uma caneta sem tinta.
3. Dobre as abas laterais para dentro e passe cola **somente** nas áreas hachuradas "COLA". Depois da montagem, elas ficam escondidas sob a aba inferior.
4. Dobre a aba inferior sobre as laterais e pressione.
5. Insira o convite e feche a aba superior. Para lacrar, use um ponto de fita dupla face sob a ponta da aba.

As medidas das abas são calculadas para que o verso fique totalmente fechado. A aba inferior sobe até cobrir a abertura, e a aba superior a sobrepõe com a margem definida em "Sobreposição no fechamento".

## Estrutura

```
papelaria/
├── index.html              editor
├── assets/css/editor.css   interface
├── assets/js/
│   ├── core.js             utilitários, cores, contexto de desenho (arte / faca / hot stamping)
│   ├── geometry.js         polígonos: arredondamento, sangria (offset), recorte, hachuras
│   ├── type.js             texto → curvas (opentype.js), quebra de linhas, texto em círculo
│   ├── state.js            padrões, tamanhos, paletas e papéis
│   ├── seal.js             selo dourado e monograma
│   ├── envelope.js         geometria do molde, arte, áreas de cola, prévia montada
│   ├── card.js             convite: moldura, blocos de texto e ajuste automático
│   ├── sheets.js           folhas de impressão, marcas, legenda, régua e ficha técnica
│   ├── pdf.js              exportação (jsPDF + svg2pdf.js)
│   ├── app.js              interface, prévia e verificação de produção
│   └── vendor/             jsPDF, svg2pdf.js, opentype.js (licença MIT)
├── assets/fonts/           fontes embutidas (SIL Open Font License) e licenças
└── tools/build-fonts.mjs   regenera assets/fonts/fonts-data.js
```

Todo o desenho é feito em SVG com o `viewBox` em milímetros. O mesmo SVG alimenta a prévia e o PDF. As fontes ficam em base64 dentro de um arquivo `.js` para o editor funcionar abrindo o `index.html` direto do disco (`file://`), onde o navegador bloqueia a leitura de arquivos soltos.
