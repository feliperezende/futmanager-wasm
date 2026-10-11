# FutManager 98 ⚽

Jogo de gerenciamento de futebol para navegador, **original e clean-room**, inspirado no gênero dos manager games clássicos dos anos 90. Nenhum código, dado, nome ou arquivo de outros jogos foi usado: todos os clubes e jogadores são **fictícios e gerados proceduralmente**.

- **Motor:** Rust compilado para WebAssembly (`src/lib.rs`, via `wasm-bindgen`)
- **Interface:** HTML/CSS/JS puro com visual retrô estilo Windows 98 (`www/`), em português (pt-BR)

## Funcionalidades

- **4 divisões** com 16 clubes fictícios cada; elencos de 18 jogadores + mercado de livres
- **Jogadores** com posição (G/D/M/A), habilidade, atributos (finalização, passe, marcação, goleiro, resistência), idade, salário, contrato, moral e condição física
- **Escalação** manual ou automática; formações 4-4-2, 4-3-3, 3-5-2, 5-3-2, 4-5-1; jogadores fora de posição jogam improvisados (rendem menos)
- **Táticas**: mentalidade defensiva/equilibrada/ofensiva e marcação pressão (rouba bolas, mas cansa mais) — alteráveis durante o jogo
- **Partidas ao vivo** minuto a minuto (pausar / pular), narração de gols, chances, cartões, lesões e substituições
- **Substituições**: até 3 por jogo, feitas ao vivo; lesionados são trocados automaticamente; a IA troca jogadores cansados
- **Cartões e suspensões**: 2º amarelo = expulsão (1 jogo), vermelho direto (2 jogos), 3 amarelos acumulados = 1 jogo
- **Lesões** de 1 a 5 rodadas; lesionados/suspensos não podem ser escalados
- **Moral** (±10% de rendimento): sobe com vitórias e gols, cai com derrotas e banco
- **Cansaço**: energia cai durante o jogo (conforme resistência e tática) e se recupera entre as rodadas
- **Categorias de base**: jovens surgem a cada temporada; promover ou dispensar; 5 níveis de investimento
- **Estádio**: ampliações (+2.000/+5.000/+10.000 lugares) com obras que duram rodadas; manutenção; público depende de força, campanha e preço do ingresso
- **Empréstimos**: pegar/ceder jogadores até o fim da temporada (taxa de 10% do valor) e empréstimo bancário com juros e parcelas por rodada
- **Contratos**: duração de 1 a 5 temporadas, pedidas salariais (habilidade, idade, moral, divisão), até 3 propostas recusadas por temporada, contratos que expiram no fim da temporada
- **Finanças** calibradas por simulação de várias temporadas: bilheteria, cotas de TV, prêmios, salários, manutenção; clubes ricos da IA investem em reforços
- **Dívidas**: juros de 1,5% por rodada no vermelho; IA endividada vende jogadores; o técnico sofre vendas forçadas após 6 rodadas e é **demitido** após 12 (ou dívida muito alta), recebendo propostas de outros clubes
- **Fim de temporada**: acesso/rebaixamento (2 sobem, 2 caem), premiação, evolução/envelhecimento, aposentadorias
- **Saves**: 5 slots + **autosave** a cada rodada, compactados com gzip, gravados no **IndexedDB** (com fallback para `localStorage`). Se faltar espaço, o autosave é descartado automaticamente e, se ainda assim não couber, o jogo avisa para apagar um slot. Saves antigos do `localStorage` são migrados

## Requisitos

- Rust (stable) com o alvo `wasm32-unknown-unknown`: `rustup target add wasm32-unknown-unknown`
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/): `cargo install wasm-pack` (ou binário pré-compilado)
- Python 3 (ou qualquer servidor HTTP estático)

## Compilar e rodar

Forma rápida (testes + build + site pronto em `dist/`):

```bash
./build.sh
python3 -m http.server -d dist 8080   # abra http://localhost:8080/
```

Manualmente:

```bash
wasm-pack build --target web      # gera ./pkg
python3 -m http.server 8080       # na raiz do projeto
```

Abra <http://localhost:8080/www/> no navegador.

> É preciso servir via HTTP (não abrir o arquivo direto com `file://`), pois o navegador bloqueia o carregamento de módulos WebAssembly locais.

Autoteste no navegador: <http://localhost:8080/www/?selftest> (cria um jogo, faz substituição, usa base, estádio, empréstimos, contratos e slots de save, e joga uma temporada inteira). Demonstração de partida ao vivo: `?demo`.

Autoteste automatizado em Chrome headless (tempo real, necessário para o IndexedDB):

```bash
node --experimental-websocket tools/headless-selftest.mjs http://localhost:8080/www/?selftest
```

## Publicação (GitHub Pages)

O arquivo `ci/github-pages.yml` é um workflow do GitHub Actions que roda os testes, executa `./build.sh` e publica `dist/` no GitHub Pages. Para ativá-lo, copie-o para `.github/workflows/pages.yml` (o push de workflows exige um token com escopo `workflow`). Em repositórios privados, o GitHub Pages requer plano pago; por isso o deploy só roda via "Run workflow".

## Testes

```bash
cargo test
```

Os testes cobrem: geração do mundo, tabela de jogos, determinismo, temporada completa com acesso/rebaixamento, classificação, escalação, transferências, cartões/suspensões/lesões, substituições, moral, base, estádio, empréstimos, contratos, táticas/improvisação/cansaço, estabilidade da economia em 5 temporadas, consequências de dívidas e saves.

Relatório da economia (8 temporadas simuladas):

```bash
cargo test --release finance_report -- --ignored --nocapture
```

## Estrutura

```
src/lib.rs      motor do jogo + API wasm + testes
build.sh        testes + build wasm + site em dist/
ci/             workflow do GitHub Pages (modelo)
www/index.html  interface
www/main.js     lógica da interface
www/style.css   visual retrô
```

## Licença

MIT
