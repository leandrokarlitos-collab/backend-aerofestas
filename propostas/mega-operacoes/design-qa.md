# Design QA — Mega Operações

## Escopo final

- Referência estrutural: `https://agenda-aero-festas.web.app/p/maple-bear-macae`
- Implementação local: `http://127.0.0.1:4173/propostas/mega-operacoes/`
- Fontes de conteúdo fornecidas pelo usuário:
  - `.codex-artifacts/mega-operacoes-source/source-aero-dimensions.png`
  - `.codex-artifacts/mega-operacoes-source/source-jurassic-v2.png`
  - `.codex-artifacts/mega-operacoes-source/source-lobinho-v2.jpg`
- Estado final: quatro atrações, preço-base de `R$ 14.999,00`, aviso de variação por operação e imagens atualizadas do Jurassic Play e do Parque do Lobinho.

## Evidências comparativas

Cada comparação abaixo contém referência e implementação no mesmo arquivo.

| Superfície | Implementação | Comparação |
| --- | --- | --- |
| Hero mobile | `.codex-artifacts/mega-operacoes-qa/implementation-mobile-top-v5.png` | `.codex-artifacts/mega-operacoes-qa/comparison-mobile-top-v5.png` |
| Grade desktop | `.codex-artifacts/mega-operacoes-qa/implementation-desktop-jurassic-up-v5.png` | `.codex-artifacts/mega-operacoes-qa/comparison-desktop-products-v5.png` |
| Jurassic Play — enquadramento focado | `.codex-artifacts/mega-operacoes-qa/implementation-mobile-jurassic-up-v5.png` | `.codex-artifacts/mega-operacoes-qa/comparison-jurassic-focus-v5.png` |
| Parque do Lobinho — fidelidade do asset | `.codex-artifacts/mega-operacoes-qa/implementation-mobile-lobinho-v7d.png` | `.codex-artifacts/mega-operacoes-qa/comparison-lobinho-focus-v7.png` |
| Parque do Lobinho — galeria | `.codex-artifacts/mega-operacoes-qa/implementation-mobile-lightbox-lobinho-v7.png` | inspeção focada |
| Texto de planejamento mobile | `.codex-artifacts/mega-operacoes-qa/implementation-mobile-subtitle-v7b.png` | inspeção focada |
| Segurança para a prefeitura | `.codex-artifacts/mega-operacoes-qa/implementation-mobile-safety-v7b.png` | inspeção focada |
| CTA mobile final | `.codex-artifacts/mega-operacoes-qa/implementation-mobile-cta-v6b.png` | inspeção focada |
| Galeria Jurassic | `.codex-artifacts/mega-operacoes-qa/implementation-mobile-lightbox-jurassic-v5.png` | inspeção focada |

## Condições de captura

- Desktop: viewport solicitado `1440 × 900`, área CSS `1425 × 900`, DPR `1`.
- Mobile: viewport solicitado `390 × 844`, área CSS `375 × 844`, DPR `1`.
- Densidade normalizada nas comparações focadas; imagens-fonte e crops foram alinhados por proporção.
- Estado: fontes carregadas, animações reveladas e rolagem posicionada na região avaliada.
- Overflow horizontal mobile: `0 px`.

## Findings e histórico de correções

- P1 — Jurassic Play com enquadramento incorreto.
  - Evidência inicial: `.codex-artifacts/mega-operacoes-source/source-jurassic-framing-issue.png` mostrava excesso do shopping e pouco da atração.
  - Correção: substituição pelo novo asset `source-jurassic-v2.png`, geração WebP responsiva e ajuste vertical para `object-position: center 64%`.
  - Pós-correção: `comparison-jurassic-focus-v5.png`; atração centralizada, com escorregadores e percurso visíveis.
- P1 — MegaPark Parque do Lobinho ausente.
  - Correção: quarto card com a nova foto limpa fornecida pelo usuário, imagem responsiva, descrição, capacidade, preço e inclusão automática na galeria.
  - Ajuste final: removidas as medidas fixas; o item agora comunica apenas `50+ crianças` e `Sob medida`.
  - Pós-correção: `comparison-lobinho-focus-v7.png` e galeria validada com `4 / 4` itens.
- P2 — Aero Jump apresentava capacidade e personalização incompatíveis com a nova ficha.
  - Correção: capacidade de `25 crianças por vez`, medidas fixas de `12 × 6 × 4,5 m` e textos gerais ajustados para diferenciar Aero Jump de MegaParks.
- P2 — preço sem ressalva operacional e nomenclatura ambígua.
  - Correção: os quatro cards agora mostram `Valor total estimado`; o CTA mostra `Valor estimado por operação`; ambos apresentam `Valor pode variar conforme tamanho da operação.`
- P2 — texto institucional precisava reforçar adaptação e segurança pública.
  - Correção: subtítulo ajustado para `MegaParks e Aero Jump, sempre planejados para o espaço e o ritmo do seu evento.` e bloco operacional renomeado para `Segurança para a sua prefeitura`.
- Pós-correção: nenhum P0, P1 ou P2 remanescente.

## Superfícies de fidelidade

- Fontes e tipografia: Outfit e Inter locais, carregadas e com hierarquia consistente com a referência.
- Espaçamento e ritmo: grade desktop em `2 × 2`, cards alinhados por linha, versão mobile em uma coluna e CTA sem overflow.
- Cores e tokens: vermelho, azul-marinho, rosa suave e fundo azul-claro preservados.
- Imagens: WebP responsivo em 400, 800 e 1200 px; nova foto do Jurassic está nítida e corretamente focada; a foto limpa do Lobinho foi preservada com enquadramento central e sem distorção.
- Copy e conteúdo: nomes, capacidades, medidas aplicáveis, montagem, preço, ressalva de variação e diferenciação entre projeto sob medida e estrutura fixa conferidos.

## Interações e técnica

- Âncora de quatro brinquedos: aprovada.
- Galeria: quatro slides; Jurassic abre em `2 / 4` com o novo arquivo e Parque do Lobinho abre em `4 / 4`.
- CTA fixo mobile: aprovado.
- WhatsApp, telefone e e-mail: presentes.
- Console do navegador: sem erros ou avisos.
- `app.js`: sintaxe válida.
- `firebase.json`: válido e com rewrite `/p/mega-operacoes`.
- Página, CSS e imagens finais: HTTP `200`.
- `git diff --check`: aprovado.

final result: passed
