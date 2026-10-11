# FutManager 98 ⚽

Jogo de gerenciamento de futebol para navegador, **original e clean-room**, inspirado no gênero dos manager games clássicos dos anos 90. Nenhum código, dado, nome ou arquivo de outros jogos foi usado: todos os clubes e jogadores são **fictícios e gerados proceduralmente**.

- **Motor:** Rust compilado para WebAssembly (`src/lib.rs`, via `wasm-bindgen`)
- **Interface:** HTML/CSS/JS puro com visual retrô estilo Windows 98 (`www/`), em português (pt-BR)

## Funcionalidades

- 4 divisões com 16 clubes fictícios cada (64 clubes, 18 jogadores por elenco + mercado de jogadores livres)
- Jogadores com posição (G/D/M/A), habilidade, idade, salário e valor de mercado
- Escolha do clube a gerenciar (qualquer divisão)
- Escalação manual (11 titulares, 1 goleiro) ou automática; formações 4-4-2, 4-3-3, 3-5-2, 5-3-2, 4-5-1
- Rodadas com turno e returno (30 rodadas), placares ao vivo minuto a minuto e narração (gols, chances, cartões)
- Classificação por pontos, vitórias, saldo e gols pró; artilharia
- Fim de temporada: acesso (2 primeiros) e rebaixamento (2 últimos), premiação, evolução/envelhecimento e aposentadoria de jogadores (com reposição por jovens da base)
- Finanças: caixa, bilheteria (público depende de força do time e campanha), preço do ingresso ajustável, folha salarial paga por rodada, prêmios
- Mercado de transferências: compra (de clubes ou livres) e venda; IA também contrata
- Salvar/carregar no `localStorage` do navegador

## Requisitos

- Rust (stable) com o alvo `wasm32-unknown-unknown`: `rustup target add wasm32-unknown-unknown`
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/): `cargo install wasm-pack` (ou binário pré-compilado)
- Python 3 (ou qualquer servidor HTTP estático)

## Compilar e rodar

```bash
wasm-pack build --target web      # gera ./pkg
python3 -m http.server 8080       # na raiz do projeto
```

Abra <http://localhost:8080/www/> no navegador.

> É preciso servir via HTTP (não abrir o arquivo direto com `file://`), pois o navegador bloqueia o carregamento de módulos WebAssembly locais.

Autoteste no navegador: <http://localhost:8080/www/?selftest> (cria um jogo, joga uma temporada inteira, salva e carrega).

## Testes

```bash
cargo test
```

Os testes cobrem: geração do mundo, tabela de jogos (turno e returno sem repetições), determinismo por semente, temporada completa com acesso/rebaixamento, consistência da classificação, validação de escalação, transferências e finanças, e salvar/carregar.

## Estrutura

```
src/lib.rs      motor do jogo + API wasm + testes
www/index.html  interface
www/main.js     lógica da interface
www/style.css   visual retrô
```

## Licença

MIT
