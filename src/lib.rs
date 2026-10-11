//! FutManager — motor de jogo de gerenciamento de futebol (original, clean-room).
//! Todos os nomes de times e jogadores são gerados proceduralmente e fictícios.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

pub const DIVISIONS: usize = 4;
pub const TEAMS_PER_DIV: usize = 16;
pub const ROUNDS: usize = (TEAMS_PER_DIV - 1) * 2;
pub const MAX_SQUAD: usize = 28;
pub const MIN_SQUAD: usize = 14;
pub const PROMOTED: usize = 2;

// ---------------------------------------------------------------- RNG
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Rng(pub u64);
impl Rng {
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^ (z >> 31)
    }
    pub fn f64(&mut self) -> f64 { (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64 }
    pub fn range(&mut self, lo: i64, hi: i64) -> i64 { lo + (self.next_u64() % ((hi - lo + 1) as u64)) as i64 }
    pub fn pick<'a, T>(&mut self, v: &'a [T]) -> &'a T { &v[(self.next_u64() % v.len() as u64) as usize] }
}

// ---------------------------------------------------------------- Modelo
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pos { G, D, M, A }
impl Pos {
    pub fn label(&self) -> &'static str { match self { Pos::G => "G", Pos::D => "D", Pos::M => "M", Pos::A => "A" } }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Player {
    pub id: usize,
    pub name: String,
    pub pos: Pos,
    pub skill: i32,
    pub age: i32,
    pub salary: i64, // R$ por rodada
    pub team: Option<usize>,
    pub goals: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Stats { pub p: i32, pub w: i32, pub d: i32, pub l: i32, pub gf: i32, pub ga: i32, pub pts: i32 }

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Team {
    pub id: usize,
    pub name: String,
    pub division: usize,
    pub budget: i64,
    pub capacity: i64,
    pub ticket_price: i64,
    pub formation: String,
    pub lineup: Vec<usize>,
    pub stats: Stats,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Event { pub minute: u32, pub side: u8, pub kind: String, pub text: String }

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MatchResult {
    pub division: usize,
    pub home: usize,
    pub away: usize,
    pub hg: u32,
    pub ag: u32,
    pub attendance: i64,
    pub events: Vec<Event>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Finance { pub tickets: i64, pub salaries: i64, pub transfers_in: i64, pub transfers_out: i64, pub prizes: i64 }

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Game {
    pub rng: Rng,
    pub season: u32,
    pub round: usize,
    pub teams: Vec<Team>,
    pub players: Vec<Player>,
    pub schedule: Vec<Vec<Vec<(usize, usize)>>>, // [div][round] -> pares (casa, fora)
    pub managed: Option<usize>,
    pub finance: Finance, // acumulado da temporada do clube gerenciado
    pub news: Vec<String>,
    pub last_results: Vec<MatchResult>,
}

pub const FORMATIONS: [&str; 5] = ["4-4-2", "4-3-3", "3-5-2", "5-3-2", "4-5-1"];

pub fn formation_counts(f: &str) -> Option<(usize, usize, usize)> {
    let v: Vec<usize> = f.split('-').filter_map(|s| s.parse().ok()).collect();
    if v.len() == 3 && v.iter().sum::<usize>() == 10 { Some((v[0], v[1], v[2])) } else { None }
}

// ---------------------------------------------------------------- Nomes fictícios
const SYL: [&str; 30] = ["ba", "ra", "to", "mi", "lu", "ce", "da", "vo", "ri", "na", "pe", "zu", "lo", "te", "ga",
    "qui", "so", "fe", "ma", "ni", "jo", "ve", "ta", "be", "co", "di", "xa", "ru", "le", "po"];
const CITY_END: [&str; 10] = ["polis", "lândia", "ville", " do Sul", " Alto", "nópolis", " Novo", "tins", "rama", "pó"];
const CLUB_PREFIX: [&str; 8] = ["Esporte Clube", "Atlético", "União", "Sport", "Associação", "Real", "Clube", "Recreativo"];
const FIRST: [&str; 24] = ["Adelmo", "Bráulio", "Caíque", "Dirceu", "Eloy", "Fabrício", "Gilvan", "Heitor", "Ivo", "Jandir",
    "Kleber", "Lindomar", "Maicon", "Nivaldo", "Otoniel", "Pablo", "Quirino", "Rubens", "Sávio", "Tadeu", "Ubiratan", "Valdir", "Wanderson", "Zeca"];

fn cap(s: &str) -> String { let mut c = s.chars(); match c.next() { Some(f) => f.to_uppercase().collect::<String>() + c.as_str(), None => String::new() } }
fn gen_word(rng: &mut Rng, n: usize) -> String { (0..n).map(|_| *rng.pick(&SYL)).collect::<String>() }
fn gen_city(rng: &mut Rng) -> String { let n = rng.range(2, 3) as usize; cap(&gen_word(rng, n)) + *rng.pick(&CITY_END) }
fn gen_player_name(rng: &mut Rng) -> String { format!("{} {}", rng.pick(&FIRST), cap(&(gen_word(rng, 2) + *rng.pick(&["s", "ni", "lho", "ra", "to", ""])))) }

pub fn player_value(p: &Player) -> i64 {
    let age_f = if p.age <= 23 { 1.3 } else if p.age <= 29 { 1.0 } else if p.age <= 32 { 0.7 } else { 0.4 };
    let s = p.skill.max(1) as f64;
    ((s * s * s / 30.0 * age_f) as i64).max(10) * 1000
}
fn salary_for(skill: i32) -> i64 { let s = skill as f64; ((s * s * s / 30.0) as i64 / 600).max(1) * 1000 }

const DIV_BASE_SKILL: [i32; 4] = [72, 62, 52, 42];
const DIV_CAPACITY: [i64; 4] = [45000, 25000, 12000, 6000];
const DIV_TICKET: [i64; 4] = [60, 40, 28, 20];
const DIV_BUDGET: [i64; 4] = [25_000_000, 10_000_000, 4_000_000, 1_500_000];
const DIV_PRIZE: [i64; 4] = [8_000_000, 3_000_000, 1_200_000, 500_000];

impl Game {
    pub fn new(seed: u64) -> Game {
        let mut rng = Rng(seed ^ 0xF00DBA11);
        let mut teams = Vec::new();
        let mut players = Vec::new();
        let mut used = std::collections::HashSet::new();
        for div in 0..DIVISIONS {
            for _ in 0..TEAMS_PER_DIV {
                let id = teams.len();
                let name = loop {
                    let n = format!("{} {}", rng.pick(&CLUB_PREFIX), gen_city(&mut rng));
                    if used.insert(n.clone()) { break n; }
                };
                let base = DIV_BASE_SKILL[div] + rng.range(-5, 5) as i32;
                teams.push(Team { id, name, division: div, budget: DIV_BUDGET[div] + rng.range(0, 10) * DIV_BUDGET[div] / 20,
                    capacity: DIV_CAPACITY[div] * rng.range(70, 130) / 100, ticket_price: DIV_TICKET[div],
                    formation: rng.pick(&FORMATIONS).to_string(), lineup: vec![], stats: Stats::default() });
                for (pos, n) in [(Pos::G, 2), (Pos::D, 6), (Pos::M, 6), (Pos::A, 4)] {
                    for _ in 0..n { let p = Self::gen_player(&mut rng, players.len(), pos, base, Some(id)); players.push(p); }
                }
            }
        }
        let mut g = Game { rng, season: 1, round: 0, teams, players, schedule: vec![], managed: None,
            finance: Finance::default(), news: vec![], last_results: vec![] };
        g.refill_free_agents();
        g.build_schedule();
        for t in 0..g.teams.len() { g.auto_lineup(t); }
        g
    }

    fn gen_player(rng: &mut Rng, id: usize, pos: Pos, base: i32, team: Option<usize>) -> Player {
        let skill = (base + rng.range(-10, 10) as i32).clamp(15, 95);
        Player { id, name: gen_player_name(rng), pos, skill, age: rng.range(17, 34) as i32, salary: salary_for(skill), team, goals: 0 }
    }

    fn refill_free_agents(&mut self) {
        let free = self.players.iter().filter(|p| p.team.is_none()).count();
        for _ in free..40 {
            let pos = *self.rng.pick(&[Pos::G, Pos::D, Pos::D, Pos::M, Pos::M, Pos::A]);
            let base = self.rng.range(35, 65) as i32;
            let p = Self::gen_player(&mut self.rng, self.players.len(), pos, base, None);
            self.players.push(p);
        }
    }

    pub fn squad(&self, team: usize) -> Vec<usize> { self.players.iter().filter(|p| p.team == Some(team)).map(|p| p.id).collect() }
    pub fn division_teams(&self, div: usize) -> Vec<usize> { self.teams.iter().filter(|t| t.division == div).map(|t| t.id).collect() }

    /// Tabela ordenada: pontos, vitórias, saldo, gols pró.
    pub fn table(&self, div: usize) -> Vec<usize> {
        let mut v = self.division_teams(div);
        v.sort_by(|&a, &b| {
            let (x, y) = (&self.teams[a].stats, &self.teams[b].stats);
            (y.pts, y.w, y.gf - y.ga, y.gf).cmp(&(x.pts, x.w, x.gf - x.ga, x.gf)).then(a.cmp(&b))
        });
        v
    }

    /// Turno e returno pelo método do círculo.
    pub fn build_schedule(&mut self) {
        self.schedule = (0..DIVISIONS).map(|div| {
            let mut ids = self.division_teams(div);
            // embaralha
            for i in (1..ids.len()).rev() { let j = self.rng.range(0, i as i64) as usize; ids.swap(i, j); }
            let n = ids.len();
            let mut first = Vec::new();
            for r in 0..n - 1 {
                let mut pairs = Vec::new();
                for i in 0..n / 2 {
                    let (a, b) = (ids[i], ids[n - 1 - i]);
                    pairs.push(if (r + i) % 2 == 0 { (a, b) } else { (b, a) });
                }
                first.push(pairs);
                let last = ids.pop().unwrap();
                ids.insert(1, last);
            }
            let second: Vec<_> = first.iter().map(|r| r.iter().map(|&(a, b)| (b, a)).collect()).collect();
            first.into_iter().chain(second).collect()
        }).collect();
    }

    pub fn auto_lineup(&mut self, team: usize) {
        let (d, m, a) = formation_counts(&self.teams[team].formation).unwrap_or((4, 4, 2));
        let mut sq = self.squad(team);
        sq.sort_by_key(|&id| -self.players[id].skill);
        let mut chosen = Vec::new();
        for (pos, n) in [(Pos::G, 1), (Pos::D, d), (Pos::M, m), (Pos::A, a)] {
            chosen.extend(sq.iter().copied().filter(|&id| self.players[id].pos == pos && !chosen.contains(&id)).take(n).collect::<Vec<_>>());
        }
        // completa com quem sobrar se faltar alguém da posição
        for &id in &sq { if chosen.len() >= 11 { break; } if !chosen.contains(&id) { chosen.push(id); } }
        self.teams[team].lineup = chosen;
    }

    pub fn set_lineup(&mut self, team: usize, formation: &str, ids: &[usize]) -> Result<(), String> {
        formation_counts(formation).ok_or("Formação inválida")?;
        if ids.len() != 11 { return Err("Escale exatamente 11 jogadores".into()); }
        let mut seen = std::collections::HashSet::new();
        for &id in ids {
            if id >= self.players.len() || self.players[id].team != Some(team) { return Err("Jogador não pertence ao clube".into()); }
            if !seen.insert(id) { return Err("Jogador repetido".into()); }
        }
        if ids.iter().filter(|&&id| self.players[id].pos == Pos::G).count() != 1 { return Err("Escale exatamente 1 goleiro".into()); }
        self.teams[team].formation = formation.to_string();
        self.teams[team].lineup = ids.to_vec();
        Ok(())
    }

    fn lineup_valid(&self, team: usize) -> bool {
        let l = &self.teams[team].lineup;
        l.len() == 11 && l.iter().all(|&id| self.players[id].team == Some(team))
    }

    /// (ataque, defesa) do time escalado.
    pub fn strength(&self, team: usize) -> (f64, f64) {
        let (mut atk, mut def) = (0.0, 0.0);
        for &id in &self.teams[team].lineup {
            let p = &self.players[id];
            let s = p.skill as f64;
            match p.pos { Pos::G => def += 2.5 * s, Pos::D => { def += s; atk += 0.15 * s } Pos::M => { def += 0.5 * s; atk += 0.6 * s } Pos::A => atk += s }
        }
        (atk.max(1.0), def.max(1.0))
    }

    pub fn simulate_match(&mut self, div: usize, home: usize, away: usize) -> MatchResult {
        let (ah, dh) = self.strength(home);
        let (aa, da) = self.strength(away);
        // normaliza: um time "médio" tem ataque ~ 0.55*defesa
        let ph = 0.0125 * ((ah / da) / 0.55).powf(1.6) * 1.12;
        let pa = 0.0125 * ((aa / dh) / 0.55).powf(1.6);
        let (mut hg, mut ag) = (0u32, 0u32);
        let mut events = Vec::new();
        for minute in 1..=90u32 {
            for (side, p) in [(0u8, ph), (1u8, pa)] {
                let r = self.rng.f64();
                let team = if side == 0 { home } else { away };
                if r < p {
                    let scorer = self.pick_scorer(team);
                    self.players[scorer].goals += 1;
                    if side == 0 { hg += 1 } else { ag += 1 }
                    events.push(Event { minute, side, kind: "gol".into(), text: format!("GOOOL! {} ({})", self.players[scorer].name, self.teams[team].name) });
                } else if r < p * 3.0 {
                    let pl = self.pick_scorer(team);
                    let t = *self.rng.pick(&["chuta para fora", "acerta a trave!", "obriga o goleiro a fazer grande defesa", "cabeceia por cima"]);
                    events.push(Event { minute, side, kind: "chance".into(), text: format!("{} {}", self.players[pl].name, t) });
                } else if r < p * 3.0 + 0.002 {
                    let l = &self.teams[team].lineup;
                    let pl = l[self.rng.range(0, l.len() as i64 - 1) as usize];
                    events.push(Event { minute, side, kind: "cartao".into(), text: format!("Cartão amarelo para {}", self.players[pl].name) });
                }
            }
        }
        // bilheteria
        let (sh, _) = (ah + dh, 0);
        let fill = (0.45 + (sh / 1200.0 - 0.5) + 0.03 * self.teams[home].stats.pts as f64 / (self.teams[home].stats.p.max(1) as f64)).clamp(0.2, 1.0);
        let attendance = (self.teams[home].capacity as f64 * fill * (0.9 + 0.2 * self.rng.f64())).min(self.teams[home].capacity as f64) as i64;
        MatchResult { division: div, home, away, hg, ag, attendance, events }
    }

    fn pick_scorer(&mut self, team: usize) -> usize {
        let l = self.teams[team].lineup.clone();
        let w: Vec<f64> = l.iter().map(|&id| match self.players[id].pos { Pos::G => 0.02, Pos::D => 1.0, Pos::M => 3.0, Pos::A => 6.0 } * self.players[id].skill as f64).collect();
        let mut r = self.rng.f64() * w.iter().sum::<f64>();
        for (i, x) in w.iter().enumerate() { if r < *x { return l[i]; } r -= x; }
        *l.last().unwrap()
    }

    /// Joga a rodada atual em todas as divisões. Ao fim da última rodada, encerra a temporada.
    pub fn play_round(&mut self) -> Vec<MatchResult> {
        if self.round >= ROUNDS { self.end_season(); }
        self.news.clear();
        self.ai_transfers();
        for t in 0..self.teams.len() {
            if Some(t) != self.managed || !self.lineup_valid(t) { self.auto_lineup(t); }
        }
        let mut results = Vec::new();
        for div in 0..DIVISIONS {
            for (h, a) in self.schedule[div][self.round].clone() {
                let r = self.simulate_match(div, h, a);
                self.apply_result(&r);
                results.push(r);
            }
        }
        // salários
        for t in 0..self.teams.len() {
            let pay: i64 = self.squad(t).iter().map(|&id| self.players[id].salary).sum();
            self.teams[t].budget -= pay;
            if Some(t) == self.managed { self.finance.salaries += pay; }
        }
        self.round += 1;
        if self.round >= ROUNDS { self.end_season(); }
        self.last_results = results.clone();
        results
    }

    fn apply_result(&mut self, r: &MatchResult) {
        let income = r.attendance * self.teams[r.home].ticket_price;
        self.teams[r.home].budget += income;
        if Some(r.home) == self.managed { self.finance.tickets += income; }
        for (t, gf, ga) in [(r.home, r.hg, r.ag), (r.away, r.ag, r.hg)] {
            let s = &mut self.teams[t].stats;
            s.p += 1; s.gf += gf as i32; s.ga += ga as i32;
            if gf > ga { s.w += 1; s.pts += 3 } else if gf == ga { s.d += 1; s.pts += 1 } else { s.l += 1 }
        }
    }

    pub fn end_season(&mut self) {
        let tables: Vec<Vec<usize>> = (0..DIVISIONS).map(|d| self.table(d)).collect();
        let mut news = vec![format!("Fim da temporada {}!", self.season)];
        for d in 0..DIVISIONS {
            news.push(format!("Campeão da Divisão {}: {}", d + 1, self.teams[tables[d][0]].name));
            for (pos, &t) in tables[d].iter().enumerate() {
                let prize = DIV_PRIZE[d] * (TEAMS_PER_DIV - pos) as i64 / TEAMS_PER_DIV as i64;
                self.teams[t].budget += prize;
                if Some(t) == self.managed { self.finance.prizes += prize; }
            }
        }
        for d in 0..DIVISIONS - 1 {
            for i in 0..PROMOTED {
                let down = tables[d][TEAMS_PER_DIV - 1 - i];
                let up = tables[d + 1][i];
                self.teams[down].division = d + 1;
                self.teams[up].division = d;
                news.push(format!("{} sobe para a Divisão {}; {} cai para a Divisão {}", self.teams[up].name, d + 1, self.teams[down].name, d + 2));
            }
        }
        // evolução dos jogadores
        for i in 0..self.players.len() {
            let delta = { let a = self.players[i].age; if a <= 23 { self.rng.range(0, 6) } else if a <= 29 { self.rng.range(-2, 3) } else { self.rng.range(-5, 0) } } as i32;
            let p = &mut self.players[i];
            p.age += 1; p.goals = 0;
            p.skill = (p.skill + delta).clamp(10, 99);
            p.salary = salary_for(p.skill);
        }
        // aposentadorias com reposição por jovens da base
        for i in 0..self.players.len() {
            if self.players[i].age >= 36 && self.players[i].team.is_some() {
                let team = self.players[i].team.unwrap();
                let pos = self.players[i].pos;
                news.push(format!("{} se aposenta.", self.players[i].name));
                let base = DIV_BASE_SKILL[self.teams[team].division] - 8;
                let mut np = Self::gen_player(&mut self.rng, i, pos, base, Some(team));
                np.age = 18;
                self.players[i] = np;
            } else if self.players[i].age >= 36 {
                let pos = self.players[i].pos;
                let b = self.rng.range(35, 60) as i32;
                self.players[i] = Self::gen_player(&mut self.rng, i, pos, b, None);
            }
        }
        for t in &mut self.teams { t.stats = Stats::default(); t.capacity = t.capacity.max(DIV_CAPACITY[t.division] / 2); t.ticket_price = DIV_TICKET[t.division]; }
        self.refill_free_agents();
        self.season += 1;
        self.round = 0;
        self.finance = Finance::default();
        self.build_schedule();
        for t in 0..self.teams.len() { self.auto_lineup(t); }
        self.news = news;
    }

    pub fn buy_price(&self, id: usize) -> i64 { let v = player_value(&self.players[id]); if self.players[id].team.is_none() { v / 5 } else { v * 11 / 10 } }
    pub fn sell_price(&self, id: usize) -> i64 { player_value(&self.players[id]) * 85 / 100 }

    pub fn buy(&mut self, buyer: usize, id: usize) -> Result<String, String> {
        let p = self.players.get(id).ok_or("Jogador inexistente")?;
        if p.team == Some(buyer) { return Err("Jogador já é seu".into()); }
        if self.squad(buyer).len() >= MAX_SQUAD { return Err(format!("Elenco cheio (máx. {})", MAX_SQUAD)); }
        if let Some(seller) = p.team { if self.squad(seller).len() <= MIN_SQUAD { return Err("O clube vendedor não pode liberar mais jogadores".into()); } }
        let price = self.buy_price(id);
        if self.teams[buyer].budget < price { return Err("Orçamento insuficiente".into()); }
        let seller = p.team;
        self.teams[buyer].budget -= price;
        if let Some(s) = seller { self.teams[s].budget += price; self.teams[s].lineup.retain(|&x| x != id); }
        if Some(buyer) == self.managed { self.finance.transfers_out += price; }
        self.players[id].team = Some(buyer);
        Ok(format!("{} contratado por R$ {}", self.players[id].name, price))
    }

    pub fn sell(&mut self, seller: usize, id: usize) -> Result<String, String> {
        if self.players.get(id).map(|p| p.team) != Some(Some(seller)) { return Err("Jogador não é do seu clube".into()); }
        if self.squad(seller).len() <= MIN_SQUAD { return Err(format!("Elenco mínimo de {} jogadores", MIN_SQUAD)); }
        let price = self.sell_price(id);
        let cands: Vec<usize> = (0..self.teams.len()).filter(|&t| t != seller && self.teams[t].budget >= price && self.squad(t).len() < MAX_SQUAD).collect();
        if cands.is_empty() { return Err("Nenhum clube tem dinheiro para essa compra".into()); }
        let buyer = *self.rng.pick(&cands);
        self.teams[buyer].budget -= price;
        self.teams[seller].budget += price;
        self.teams[seller].lineup.retain(|&x| x != id);
        if Some(seller) == self.managed { self.finance.transfers_in += price; }
        self.players[id].team = Some(buyer);
        Ok(format!("{} vendido ao {} por R$ {}", self.players[id].name, self.teams[buyer].name, price))
    }

    /// IA: clubes com elenco curto contratam livres; ocasionalmente algum clube compra um reforço.
    fn ai_transfers(&mut self) {
        for t in 0..self.teams.len() {
            if Some(t) == self.managed { continue; }
            while self.squad(t).len() < 16 {
                let best = self.players.iter().filter(|p| p.team.is_none()).max_by_key(|p| p.skill).map(|p| p.id);
                match best { Some(id) => { self.teams[t].budget -= self.buy_price(id); self.players[id].team = Some(t); } None => break }
            }
        }
        if self.rng.f64() < 0.5 {
            let t = self.rng.range(0, self.teams.len() as i64 - 1) as usize;
            if Some(t) != self.managed && self.squad(t).len() < 24 {
                let id = self.rng.range(0, self.players.len() as i64 - 1) as usize;
                if self.players[id].team != self.managed && self.players[id].team.is_some() && self.buy(t, id).is_ok() {
                    self.news.push(format!("Mercado: {} reforça o {}", self.players[id].name, self.teams[t].name));
                }
            }
        }
    }

    // ------------------------------------------------ JSON para a interface
    fn player_json(&self, p: &Player) -> serde_json::Value {
        serde_json::json!({"id": p.id, "name": p.name, "pos": p.pos.label(), "skill": p.skill, "age": p.age, "salary": p.salary,
            "value": player_value(p), "team": p.team, "teamName": p.team.map(|t| self.teams[t].name.clone()).unwrap_or("Sem clube".into()),
            "goals": p.goals, "buyPrice": self.buy_price(p.id), "sellPrice": self.sell_price(p.id)})
    }

    pub fn state_json(&self) -> serde_json::Value {
        let tables: Vec<_> = (0..DIVISIONS).map(|d| self.table(d).iter().map(|&t| {
            let s = &self.teams[t].stats;
            serde_json::json!({"id": t, "name": self.teams[t].name, "p": s.p, "w": s.w, "d": s.d, "l": s.l, "gf": s.gf, "ga": s.ga, "pts": s.pts})
        }).collect::<Vec<_>>()).collect();
        let mut next: Vec<serde_json::Value> = vec![];
        if self.round < ROUNDS { for d in 0..DIVISIONS { for &(h, a) in &self.schedule[d][self.round] {
            next.push(serde_json::json!({"division": d, "home": h, "away": a, "homeName": self.teams[h].name, "awayName": self.teams[a].name}));
        } } }
        let managed = self.managed.map(|m| {
            let t = &self.teams[m];
            serde_json::json!({"id": m, "name": t.name, "division": t.division, "budget": t.budget, "capacity": t.capacity,
                "ticketPrice": t.ticket_price, "formation": t.formation, "lineup": t.lineup,
                "squad": self.squad(m).iter().map(|&id| self.player_json(&self.players[id])).collect::<Vec<_>>(),
                "wageBill": self.squad(m).iter().map(|&id| self.players[id].salary).sum::<i64>(), "finance": self.finance})
        });
        let teams: Vec<_> = self.teams.iter().map(|t| serde_json::json!({"id": t.id, "name": t.name, "division": t.division, "budget": t.budget})).collect();
        let mut scorers: Vec<&Player> = self.players.iter().filter(|p| p.goals > 0).collect();
        scorers.sort_by_key(|p| -p.goals);
        serde_json::json!({"season": self.season, "round": self.round, "rounds": ROUNDS, "tables": tables, "next": next,
            "managed": managed, "teams": teams, "news": self.news, "formations": FORMATIONS,
            "scorers": scorers.iter().take(15).map(|p| self.player_json(p)).collect::<Vec<_>>()})
    }

    pub fn market_json(&self, pos: &str, max_price: i64) -> serde_json::Value {
        let mut v: Vec<&Player> = self.players.iter().filter(|p| p.team != self.managed || self.managed.is_none())
            .filter(|p| pos.is_empty() || p.pos.label() == pos).filter(|p| self.buy_price(p.id) <= max_price).collect();
        v.sort_by_key(|p| -p.skill);
        serde_json::Value::Array(v.iter().take(150).map(|p| self.player_json(p)).collect())
    }
}

// ---------------------------------------------------------------- API WebAssembly
#[wasm_bindgen]
pub struct FutManager { g: Game }

fn res(r: Result<String, String>) -> String {
    match r { Ok(m) => serde_json::json!({"ok": true, "msg": m}), Err(e) => serde_json::json!({"ok": false, "msg": e}) }.to_string()
}

#[wasm_bindgen]
impl FutManager {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: f64) -> FutManager { FutManager { g: Game::new(seed as u64) } }
    pub fn load(json: &str) -> Result<FutManager, JsValue> {
        serde_json::from_str::<Game>(json).map(|g| FutManager { g }).map_err(|e| JsValue::from_str(&format!("Save inválido: {e}")))
    }
    pub fn save(&self) -> String { serde_json::to_string(&self.g).unwrap() }
    pub fn state(&self) -> String { self.g.state_json().to_string() }
    pub fn choose_team(&mut self, team: usize) -> String {
        if team >= self.g.teams.len() { return res(Err("Time inválido".into())); }
        self.g.managed = Some(team);
        res(Ok(format!("Você assumiu o {}", self.g.teams[team].name)))
    }
    pub fn set_lineup(&mut self, formation: &str, ids_json: &str) -> String {
        let Some(m) = self.g.managed else { return res(Err("Nenhum time".into())) };
        let ids: Vec<usize> = serde_json::from_str(ids_json).unwrap_or_default();
        res(self.g.set_lineup(m, formation, &ids).map(|_| "Escalação salva".into()))
    }
    pub fn auto_lineup(&mut self, formation: &str) -> String {
        let Some(m) = self.g.managed else { return res(Err("Nenhum time".into())) };
        if formation_counts(formation).is_none() { return res(Err("Formação inválida".into())); }
        self.g.teams[m].formation = formation.into();
        self.g.auto_lineup(m);
        res(Ok("Escalação automática aplicada".into()))
    }
    pub fn set_ticket_price(&mut self, price: f64) -> String {
        let Some(m) = self.g.managed else { return res(Err("Nenhum time".into())) };
        self.g.teams[m].ticket_price = (price as i64).clamp(1, 500);
        res(Ok("Preço do ingresso atualizado".into()))
    }
    pub fn play_round(&mut self) -> String {
        let r = self.g.play_round();
        let names = |t: usize| self.g.teams[t].name.clone();
        serde_json::Value::Array(r.iter().map(|m| serde_json::json!({"division": m.division, "home": m.home, "away": m.away,
            "homeName": names(m.home), "awayName": names(m.away), "hg": m.hg, "ag": m.ag, "attendance": m.attendance, "events": m.events})).collect()).to_string()
    }
    pub fn market(&self, pos: &str, max_price: f64) -> String { self.g.market_json(pos, max_price as i64).to_string() }
    pub fn buy(&mut self, id: usize) -> String { match self.g.managed { Some(m) => res(self.g.buy(m, id)), None => res(Err("Nenhum time".into())) } }
    pub fn sell(&mut self, id: usize) -> String { match self.g.managed { Some(m) => res(self.g.sell(m, id)), None => res(Err("Nenhum time".into())) } }
}

// ---------------------------------------------------------------- Testes
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_generation() {
        let g = Game::new(1);
        assert_eq!(g.teams.len(), DIVISIONS * TEAMS_PER_DIV);
        for d in 0..DIVISIONS { assert_eq!(g.division_teams(d).len(), TEAMS_PER_DIV); }
        for t in 0..g.teams.len() { assert_eq!(g.squad(t).len(), 18); assert_eq!(g.teams[t].lineup.len(), 11); }
        let names: std::collections::HashSet<_> = g.teams.iter().map(|t| &t.name).collect();
        assert_eq!(names.len(), g.teams.len(), "nomes únicos");
    }

    #[test]
    fn schedule_is_double_round_robin() {
        let g = Game::new(7);
        for d in 0..DIVISIONS {
            assert_eq!(g.schedule[d].len(), ROUNDS);
            let mut pairs = std::collections::HashSet::new();
            for r in &g.schedule[d] {
                let mut seen = std::collections::HashSet::new();
                for &(h, a) in r { assert!(seen.insert(h) && seen.insert(a)); assert!(pairs.insert((h, a)), "jogo repetido"); }
                assert_eq!(seen.len(), TEAMS_PER_DIV);
            }
            assert_eq!(pairs.len(), TEAMS_PER_DIV * (TEAMS_PER_DIV - 1));
        }
    }

    #[test]
    fn deterministic_with_seed() {
        let mut a = Game::new(42); let mut b = Game::new(42);
        let ra = a.play_round(); let rb = b.play_round();
        assert_eq!(ra.iter().map(|m| (m.hg, m.ag)).collect::<Vec<_>>(), rb.iter().map(|m| (m.hg, m.ag)).collect::<Vec<_>>());
    }

    #[test]
    fn full_season_promotion_relegation() {
        let mut g = Game::new(3);
        g.managed = Some(0);
        for _ in 0..ROUNDS - 1 { g.play_round(); }
        assert_eq!(g.round, ROUNDS - 1);
        let tables: Vec<Vec<usize>> = (0..DIVISIONS).map(|d| g.table(d)).collect();
        // última rodada: antes de encerrar, guardo a tabela final simulando manualmente
        let mut probe = g.clone();
        let res = probe.play_round();
        assert_eq!(res.len(), DIVISIONS * TEAMS_PER_DIV / 2);
        assert_eq!(probe.season, 2);
        assert_eq!(probe.round, 0);
        for d in 0..DIVISIONS { assert_eq!(probe.division_teams(d).len(), TEAMS_PER_DIV); }
        for t in &probe.teams { assert_eq!(t.stats.p, 0); }
        // Os campeões da div 2..4 normalmente sobem: confere que ao menos houve trocas
        let moved = probe.teams.iter().zip(g.teams.iter()).filter(|(a, b)| a.division != b.division).count();
        assert_eq!(moved, (DIVISIONS - 1) * PROMOTED * 2);
        let _ = tables;
    }

    #[test]
    fn standings_points_consistent() {
        let mut g = Game::new(9);
        for _ in 0..10 { g.play_round(); }
        for t in &g.teams {
            let s = &t.stats;
            assert_eq!(s.p, 10); assert_eq!(s.w + s.d + s.l, 10); assert_eq!(s.pts, s.w * 3 + s.d);
        }
        let total_gf: i32 = g.teams.iter().map(|t| t.stats.gf).sum();
        let total_ga: i32 = g.teams.iter().map(|t| t.stats.ga).sum();
        assert_eq!(total_gf, total_ga);
        let avg = total_gf as f64 / (g.teams.len() as f64 * 10.0);
        assert!(avg > 0.6 && avg < 2.5, "média de gols por time/jogo plausível: {avg}");
    }

    #[test]
    fn lineup_validation() {
        let mut g = Game::new(5);
        let sq = g.squad(0);
        assert!(g.set_lineup(0, "4-4-2", &sq[..10]).is_err());
        let gks: Vec<usize> = sq.iter().copied().filter(|&i| g.players[i].pos == Pos::G).collect();
        let others: Vec<usize> = sq.iter().copied().filter(|&i| g.players[i].pos != Pos::G).collect();
        let mut two_gk = gks.clone(); two_gk.extend(&others[..9]);
        assert!(g.set_lineup(0, "4-4-2", &two_gk).is_err());
        let mut ok = vec![gks[0]]; ok.extend(&others[..10]);
        assert!(g.set_lineup(0, "4-3-3", &ok).is_ok());
        assert_eq!(g.teams[0].formation, "4-3-3");
        let foreign = g.squad(1)[0];
        let mut bad = ok.clone(); bad[10] = foreign;
        assert!(g.set_lineup(0, "4-3-3", &bad).is_err());
    }

    #[test]
    fn transfers_and_finances() {
        let mut g = Game::new(11);
        g.managed = Some(10);
        g.teams[10].budget = 100_000_000;
        let target = g.squad(20)[0];
        let price = g.buy_price(target);
        let before = g.teams[10].budget;
        g.buy(10, target).unwrap();
        assert_eq!(g.players[target].team, Some(10));
        assert_eq!(g.teams[10].budget, before - price);
        assert_eq!(g.squad(10).len(), 19);
        let sold = g.squad(10)[0];
        let b2 = g.teams[10].budget;
        g.sell(10, sold).unwrap();
        assert_ne!(g.players[sold].team, Some(10));
        assert!(g.teams[10].budget > b2);
        g.teams[10].budget = 0;
        assert!(g.buy(10, g.squad(21)[0]).is_err());
        // salários debitados por rodada
        let wage: i64 = g.squad(10).iter().map(|&i| g.players[i].salary).sum();
        g.play_round();
        assert!(g.finance.salaries == wage);
    }

    #[test]
    fn save_load_roundtrip() {
        let mut g = Game::new(13);
        g.managed = Some(3);
        g.play_round();
        let s = serde_json::to_string(&g).unwrap();
        let mut h: Game = serde_json::from_str(&s).unwrap();
        assert_eq!(h.round, 1);
        let a = g.play_round(); let b = h.play_round();
        assert_eq!(a.iter().map(|m| (m.hg, m.ag)).collect::<Vec<_>>(), b.iter().map(|m| (m.hg, m.ag)).collect::<Vec<_>>());
    }
}
