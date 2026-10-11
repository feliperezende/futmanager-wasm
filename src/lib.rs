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
    /// Cartões amarelos acumulados (3 = suspensão automática)
    #[serde(default)]
    pub yellows: u8,
    /// Jogos de suspensão a cumprir
    #[serde(default)]
    pub suspended: u8,
    /// Rodadas de lesão restantes
    #[serde(default)]
    pub injured: u8,
    /// Moral 0..100 (50 = normal). Afeta o rendimento em ±10%.
    #[serde(default = "default_morale")]
    pub morale: i32,
    /// Jogador das categorias de base (não conta no elenco profissional)
    #[serde(default)]
    pub academy: bool,
    /// Clube dono do passe, quando o jogador está emprestado
    #[serde(default)]
    pub loan_from: Option<usize>,
}

fn default_morale() -> i32 { 50 }

impl Player {
    pub fn available(&self) -> bool { self.injured == 0 && self.suspended == 0 }
}

/// Partida em andamento (simulada minuto a minuto).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct LiveMatch {
    pub division: usize,
    pub home: usize,
    pub away: usize,
    pub on: [Vec<usize>; 2],
    pub hg: u32,
    pub ag: u32,
    pub minute: u32,
    pub events: Vec<Event>,
    /// amarelados nesta partida
    pub booked: Vec<usize>,
    /// expulsões: (jogador, jogos de suspensão)
    pub reds: Vec<(usize, u8)>,
    /// lesões: (jogador, rodadas)
    pub injuries: Vec<(usize, u8)>,
    /// substituições usadas por lado
    #[serde(default)]
    pub subs: [u8; 2],
    /// jogadores que deixaram o campo (não podem voltar)
    #[serde(default)]
    pub out: Vec<usize>,
}

pub const MAX_SUBS: u8 = 3;

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
    /// Nível das categorias de base (1..=5)
    #[serde(default = "one")]
    pub academy_level: u8,
    /// Obra de ampliação do estádio em andamento
    #[serde(default)]
    pub construction: Option<Construction>,
    /// Saldo devedor de empréstimo bancário (já com juros)
    #[serde(default)]
    pub bank_debt: i64,
    /// Parcela por rodada
    #[serde(default)]
    pub bank_payment: i64,
}

pub const BANK_INTEREST_PCT: i64 = 12;
pub const BANK_INSTALLMENTS: i64 = 30;
pub const LOAN_FEE_PCT: i64 = 10;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Construction { pub seats: i64, pub rounds_left: u32 }

/// Opções de ampliação: (lugares, rodadas de obra)
pub const STADIUM_OPTIONS: [(i64, u32); 3] = [(2000, 3), (5000, 5), (10000, 8)];
pub const SEAT_COST: i64 = 400;
pub const MAX_CAPACITY: i64 = 90000;

fn one() -> u8 { 1 }
pub const MAX_ACADEMY_LEVEL: u8 = 5;
pub const MAX_ACADEMY: usize = 8;

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
pub struct Finance { pub tickets: i64, pub salaries: i64, pub transfers_in: i64, pub transfers_out: i64, pub prizes: i64,
    #[serde(default)] pub upkeep: i64, #[serde(default)] pub investments: i64,
    #[serde(default)] pub bank_in: i64, #[serde(default)] pub bank_paid: i64, #[serde(default)] pub loan_fees: i64 }

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
    #[serde(default)]
    pub live: Vec<LiveMatch>,
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
                    formation: rng.pick(&FORMATIONS).to_string(), lineup: vec![], stats: Stats::default(), academy_level: 1, construction: None,
                    bank_debt: 0, bank_payment: 0 });
                for (pos, n) in [(Pos::G, 2), (Pos::D, 6), (Pos::M, 6), (Pos::A, 4)] {
                    for _ in 0..n { let p = Self::gen_player(&mut rng, players.len(), pos, base, Some(id)); players.push(p); }
                }
            }
        }
        let mut g = Game { rng, season: 1, round: 0, teams, players, schedule: vec![], managed: None,
            finance: Finance::default(), news: vec![], last_results: vec![], live: vec![] };
        g.refill_free_agents();
        for t in 0..g.teams.len() { for _ in 0..2 { g.gen_prospect(t); } }
        g.build_schedule();
        for t in 0..g.teams.len() { g.auto_lineup(t); }
        g
    }

    fn gen_player(rng: &mut Rng, id: usize, pos: Pos, base: i32, team: Option<usize>) -> Player {
        let skill = (base + rng.range(-10, 10) as i32).clamp(15, 95);
        Player { id, name: gen_player_name(rng), pos, skill, age: rng.range(17, 34) as i32, salary: salary_for(skill), team, goals: 0,
            yellows: 0, suspended: 0, injured: 0, morale: 50, academy: false, loan_from: None }
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

    pub fn squad(&self, team: usize) -> Vec<usize> { self.players.iter().filter(|p| p.team == Some(team) && !p.academy).map(|p| p.id).collect() }
    pub fn academy(&self, team: usize) -> Vec<usize> { self.players.iter().filter(|p| p.team == Some(team) && p.academy).map(|p| p.id).collect() }

    /// Gera um jovem na base do clube; a qualidade depende do nível da base e da divisão.
    pub fn gen_prospect(&mut self, team: usize) -> usize {
        let lvl = self.teams[team].academy_level as i32;
        let base = DIV_BASE_SKILL[self.teams[team].division] - 18 + lvl * 4;
        let pos = *self.rng.pick(&[Pos::G, Pos::D, Pos::D, Pos::M, Pos::M, Pos::A, Pos::A]);
        let id = self.players.len();
        let mut p = Self::gen_player(&mut self.rng, id, pos, base, Some(team));
        p.age = self.rng.range(16, 17) as i32;
        p.academy = true;
        p.salary = 1000;
        self.players.push(p);
        id
    }

    pub fn academy_upgrade_cost(&self, team: usize) -> i64 { 1_000_000 * self.teams[team].academy_level as i64 }
    pub fn academy_upkeep(&self, team: usize) -> i64 { 8_000 * self.teams[team].academy_level as i64 }

    pub fn upgrade_academy(&mut self, team: usize) -> Result<String, String> {
        if self.teams[team].academy_level >= MAX_ACADEMY_LEVEL { return Err("A base já está no nível máximo".into()); }
        let cost = self.academy_upgrade_cost(team);
        if self.teams[team].budget < cost { return Err("Orçamento insuficiente".into()); }
        self.teams[team].budget -= cost;
        self.teams[team].academy_level += 1;
        if Some(team) == self.managed { self.finance.investments += cost; }
        Ok(format!("Categorias de base melhoradas para o nível {}", self.teams[team].academy_level))
    }

    pub fn promote_youth(&mut self, team: usize, id: usize) -> Result<String, String> {
        if self.players.get(id).map(|p| p.team == Some(team) && p.academy) != Some(true) { return Err("Jogador não está na sua base".into()); }
        if self.squad(team).len() >= MAX_SQUAD { return Err(format!("Elenco cheio (máx. {})", MAX_SQUAD)); }
        let p = &mut self.players[id];
        p.academy = false; p.salary = salary_for(p.skill); p.morale = 70;
        Ok(format!("{} promovido ao time profissional", p.name))
    }

    pub fn release_youth(&mut self, team: usize, id: usize) -> Result<String, String> {
        if self.players.get(id).map(|p| p.team == Some(team) && p.academy) != Some(true) { return Err("Jogador não está na sua base".into()); }
        let p = &mut self.players[id];
        p.academy = false; p.team = None; p.salary = salary_for(p.skill);
        Ok(format!("{} dispensado da base", p.name))
    }

    /// Fim de temporada: novos jovens, dispensas por idade e decisões da IA.
    fn academy_season(&mut self, news: &mut Vec<String>) {
        for t in 0..self.teams.len() {
            for id in self.academy(t) {
                if self.players[id].age >= 20 {
                    if Some(t) == self.managed { news.push(format!("{} completou 20 anos e deixou a base", self.players[id].name)); }
                    let _ = self.release_youth(t, id);
                }
            }
            let n = 1 + self.teams[t].academy_level as usize / 2;
            for _ in 0..n {
                let id = self.gen_prospect(t);
                if Some(t) == self.managed { news.push(format!("Novo talento na base: {} ({}, hab. {})", self.players[id].name, self.players[id].pos.label(), self.players[id].skill)); }
            }
            let mut ac = self.academy(t);
            ac.sort_by_key(|&id| -self.players[id].skill);
            for &id in ac.iter().skip(MAX_ACADEMY) { let _ = self.release_youth(t, id); }
            if Some(t) != self.managed {
                // IA promove o melhor jovem se ele superar o pior do elenco
                let worst = self.squad(t).iter().map(|&id| self.players[id].skill).min().unwrap_or(0);
                if let Some(&best) = ac.first() {
                    if (self.players[best].skill > worst || self.squad(t).len() < 18) && self.players[best].team == Some(t) { let _ = self.promote_youth(t, best); }
                }
                if self.teams[t].budget > 6 * self.academy_upgrade_cost(t) { let _ = self.upgrade_academy(t); }
                if self.teams[t].budget > 4 * Self::stadium_cost(5000) && self.demand(t) > self.teams[t].capacity as f64 { let _ = self.upgrade_stadium(t, 1); }
            }
        }
    }
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
        let mut sq: Vec<usize> = self.squad(team).into_iter().filter(|&id| self.players[id].available()).collect();
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
            if id >= self.players.len() || self.players[id].team != Some(team) || self.players[id].academy { return Err("Jogador não pertence ao elenco".into()); }
            if !seen.insert(id) { return Err("Jogador repetido".into()); }
            if !self.players[id].available() { return Err(format!("{} está lesionado ou suspenso", self.players[id].name)); }
        }
        if ids.iter().filter(|&&id| self.players[id].pos == Pos::G).count() != 1 { return Err("Escale exatamente 1 goleiro".into()); }
        self.teams[team].formation = formation.to_string();
        self.teams[team].lineup = ids.to_vec();
        Ok(())
    }

    fn lineup_valid(&self, team: usize) -> bool {
        let l = &self.teams[team].lineup;
        l.len() == 11 && l.iter().all(|&id| self.players[id].team == Some(team) && !self.players[id].academy && self.players[id].available())
    }

    /// (ataque, defesa) do time escalado.
    pub fn strength(&self, team: usize) -> (f64, f64) { self.strength_of(&self.teams[team].lineup) }

    /// (ataque, defesa) de um conjunto de jogadores em campo.
    /// Habilidade efetiva considerando a moral.
    pub fn effective_skill(&self, id: usize) -> f64 {
        let p = &self.players[id];
        p.skill as f64 * (0.9 + 0.2 * p.morale.clamp(0, 100) as f64 / 100.0)
    }

    fn change_morale(&mut self, id: usize, d: i32) { let p = &mut self.players[id]; p.morale = (p.morale + d).clamp(0, 100); }

    /// Atualiza a moral após uma partida.
    fn update_morale(&mut self, m: &LiveMatch) {
        let scorers: Vec<String> = m.events.iter().filter(|e| e.kind == "gol").map(|e| e.text.clone()).collect();
        for side in 0..2 {
            let team = if side == 0 { m.home } else { m.away };
            let (gf, ga) = if side == 0 { (m.hg, m.ag) } else { (m.ag, m.hg) };
            let res = if gf > ga { 5 } else if gf == ga { 0 } else { -5 };
            for id in self.squad(team) {
                let played = m.on[side].contains(&id) || m.out.contains(&id);
                let mut d = res + if played { 1 } else { -2 };
                let name = format!("GOOOL! {} (", self.players[id].name);
                if played && scorers.iter().any(|t| t.starts_with(&name)) { d += 3; }
                d += (50 - self.players[id].morale) / 10; // tende a voltar ao normal
                self.change_morale(id, d);
            }
        }
    }

    pub fn team_morale(&self, team: usize) -> i32 {
        let sq = self.squad(team);
        if sq.is_empty() { return 50; }
        sq.iter().map(|&id| self.players[id].morale).sum::<i32>() / sq.len() as i32
    }

    pub fn strength_of(&self, ids: &[usize]) -> (f64, f64) {
        let (mut atk, mut def) = (0.0, 0.0);
        for &id in ids {
            let p = &self.players[id];
            let s = self.effective_skill(id);
            match p.pos { Pos::G => def += 2.5 * s, Pos::D => { def += s; atk += 0.15 * s } Pos::M => { def += 0.5 * s; atk += 0.6 * s } Pos::A => atk += s }
        }
        (atk.max(1.0), def.max(1.0))
    }

    /// Avança um minuto de uma partida ao vivo.
    fn step_match(&mut self, m: &mut LiveMatch) {
        if m.minute >= 90 { return; }
        m.minute += 1;
        let minute = m.minute;
        let (ah, dh) = self.strength_of(&m.on[0]);
        let (aa, da) = self.strength_of(&m.on[1]);
        // normaliza: um time "médio" tem ataque ~ 0.55*defesa
        let ph = 0.0125 * ((ah / da) / 0.55).powf(1.6) * 1.12;
        let pa = 0.0125 * ((aa / dh) / 0.55).powf(1.6);
        for (side, p) in [(0usize, ph), (1usize, pa)] {
            if m.on[side].is_empty() { continue; }
            let r = self.rng.f64();
            let team = if side == 0 { m.home } else { m.away };
            let ev = |kind: &str, text: String| Event { minute, side: side as u8, kind: kind.into(), text };
            if r < p {
                let scorer = self.pick_scorer(&m.on[side]);
                self.players[scorer].goals += 1;
                if side == 0 { m.hg += 1 } else { m.ag += 1 }
                m.events.push(ev("gol", format!("GOOOL! {} ({})", self.players[scorer].name, self.teams[team].name)));
            } else if r < p * 3.0 {
                let pl = self.pick_scorer(&m.on[side]);
                let t = *self.rng.pick(&["chuta para fora", "acerta a trave!", "obriga o goleiro a fazer grande defesa", "cabeceia por cima"]);
                m.events.push(ev("chance", format!("{} {}", self.players[pl].name, t)));
            } else if r < p * 3.0 + 0.0045 {
                let pl = *self.rng.pick(&m.on[side]);
                let name = self.players[pl].name.clone();
                let direct = self.rng.f64() < 0.07;
                if direct || m.booked.contains(&pl) {
                    m.on[side].retain(|&x| x != pl);
                    m.out.push(pl);
                    m.reds.push((pl, if direct { 2 } else { 1 }));
                    m.events.push(ev("vermelho", if direct { format!("Cartão VERMELHO direto para {name}!") } else { format!("Segundo amarelo: {name} expulso!") }));
                } else {
                    m.booked.push(pl);
                    m.events.push(ev("cartao", format!("Cartão amarelo para {name}")));
                }
            } else if r < p * 3.0 + 0.0045 + 0.0011 {
                let pl = *self.rng.pick(&m.on[side]);
                let rounds = self.rng.range(1, 5) as u8;
                m.injuries.push((pl, rounds));
                m.events.push(ev("lesao", format!("{} se lesiona ({} rodada(s) fora)", self.players[pl].name, rounds)));
                let pos = self.players[pl].pos;
                let bench = self.bench(m, side);
                let repl = bench.iter().copied().filter(|&b| self.players[b].pos == pos).max_by_key(|&b| self.players[b].skill)
                    .or_else(|| bench.iter().copied().max_by_key(|&b| self.players[b].skill));
                match repl {
                    Some(b) if m.subs[side] < MAX_SUBS => { let _ = self.substitute(m, side, pl, b); }
                    _ => { m.on[side].retain(|&x| x != pl); m.out.push(pl); }
                }
            }
        }
        // substituições táticas da IA
        if minute == 62 || minute == 75 {
            for side in 0..2 {
                let team = if side == 0 { m.home } else { m.away };
                if Some(team) == self.managed || m.subs[side] >= MAX_SUBS - 1 || self.rng.f64() < 0.3 { continue; }
                let Some(&worst) = m.on[side].iter().filter(|&&id| self.players[id].pos != Pos::G).min_by_key(|&&id| self.players[id].skill) else { continue };
                let pos = self.players[worst].pos;
                if let Some(b) = self.bench(m, side).into_iter().filter(|&b| self.players[b].pos == pos).max_by_key(|&b| self.players[b].skill) {
                    let _ = self.substitute(m, side, worst, b);
                }
            }
        }
    }

    /// Reservas disponíveis para um lado da partida.
    pub fn bench(&self, m: &LiveMatch, side: usize) -> Vec<usize> {
        let team = if side == 0 { m.home } else { m.away };
        self.squad(team).into_iter().filter(|id| self.players[*id].available() && !m.on[side].contains(id) && !m.out.contains(id)
            && !m.injuries.iter().any(|x| x.0 == *id)).collect()
    }

    /// Realiza uma substituição numa partida ao vivo.
    pub fn substitute(&self, m: &mut LiveMatch, side: usize, out: usize, inn: usize) -> Result<String, String> {
        if m.minute >= 90 { return Err("A partida já terminou".into()); }
        if m.subs[side] >= MAX_SUBS { return Err(format!("Limite de {MAX_SUBS} substituições atingido")); }
        if !m.on[side].contains(&out) && !m.injuries.iter().any(|x| x.0 == out && !m.out.contains(&out)) { return Err("Esse jogador não está em campo".into()); }
        if !self.bench(m, side).contains(&inn) { return Err("Esse reserva não está disponível".into()); }
        m.on[side].retain(|&x| x != out);
        m.out.push(out);
        m.on[side].push(inn);
        m.subs[side] += 1;
        let text = format!("Substituição: sai {}, entra {}", self.players[out].name, self.players[inn].name);
        m.events.push(Event { minute: m.minute, side: side as u8, kind: "sub".into(), text: text.clone() });
        Ok(text)
    }

    /// Substituição do clube gerenciado na partida em andamento.
    pub fn substitute_managed(&mut self, out: usize, inn: usize) -> Result<String, String> {
        let me = self.managed.ok_or("Nenhum time")?;
        let i = self.live.iter().position(|m| m.home == me || m.away == me).ok_or("Nenhuma partida em andamento")?;
        let mut m = std::mem::take(&mut self.live[i]);
        let side = if m.home == me { 0 } else { 1 };
        let r = self.substitute(&mut m, side, out, inn);
        self.live[i] = m;
        r
    }

    /// Público esperado (antes da variação aleatória), limitado pela capacidade.
    pub fn demand(&self, home: usize) -> f64 {
        let t = &self.teams[home];
        let (a, d) = self.strength(home);
        let s = &t.stats;
        let interest = (0.5 + ((a + d) / 1200.0 - 0.5) + 0.05 * s.pts as f64 / (s.p.max(1) as f64)).clamp(0.2, 1.3);
        let price_factor = (DIV_TICKET[t.division] as f64 / t.ticket_price.max(1) as f64).powf(1.3).min(2.0);
        DIV_CAPACITY[t.division] as f64 * interest * price_factor
    }

    fn attendance(&mut self, home: usize) -> i64 {
        let cap = self.teams[home].capacity as f64;
        (self.demand(home) * (0.9 + 0.2 * self.rng.f64())).min(cap) as i64
    }

    pub fn stadium_cost(seats: i64) -> i64 { seats * SEAT_COST }
    pub fn stadium_upkeep(&self, team: usize) -> i64 { self.teams[team].capacity / 4 }

    /// Inicia uma ampliação do estádio (opção 0..3 de STADIUM_OPTIONS).
    pub fn upgrade_stadium(&mut self, team: usize, option: usize) -> Result<String, String> {
        let &(seats, rounds) = STADIUM_OPTIONS.get(option).ok_or("Opção inválida")?;
        if self.teams[team].construction.is_some() { return Err("Já existe uma obra em andamento".into()); }
        if self.teams[team].capacity + seats > MAX_CAPACITY { return Err(format!("Capacidade máxima é de {MAX_CAPACITY} lugares")); }
        let cost = Self::stadium_cost(seats);
        if self.teams[team].budget < cost { return Err("Orçamento insuficiente".into()); }
        self.teams[team].budget -= cost;
        self.teams[team].construction = Some(Construction { seats, rounds_left: rounds });
        if Some(team) == self.managed { self.finance.investments += cost; }
        Ok(format!("Obra iniciada: +{seats} lugares em {rounds} rodadas"))
    }

    // ------------------------------------------------ Empréstimos
    pub fn loan_fee(&self, id: usize) -> i64 { player_value(&self.players[id]) * LOAN_FEE_PCT / 100 }

    /// Pega um jogador emprestado até o fim da temporada (paga taxa + salários).
    pub fn loan_in(&mut self, borrower: usize, id: usize) -> Result<String, String> {
        let p = self.players.get(id).ok_or("Jogador inexistente")?;
        let owner = p.team.ok_or("Jogador sem clube: contrate-o diretamente")?;
        if owner == borrower { return Err("Jogador já é seu".into()); }
        if p.academy || p.loan_from.is_some() { return Err("Jogador indisponível para empréstimo".into()); }
        if self.squad(owner).len() <= MIN_SQUAD { return Err("O clube dono não pode liberar mais jogadores".into()); }
        if self.squad(borrower).len() >= MAX_SQUAD { return Err(format!("Elenco cheio (máx. {})", MAX_SQUAD)); }
        let fee = self.loan_fee(id);
        if self.teams[borrower].budget < fee { return Err("Orçamento insuficiente".into()); }
        self.teams[borrower].budget -= fee;
        self.teams[owner].budget += fee;
        self.teams[owner].lineup.retain(|&x| x != id);
        if Some(borrower) == self.managed { self.finance.loan_fees -= fee; }
        if Some(owner) == self.managed { self.finance.loan_fees += fee; }
        let p = &mut self.players[id];
        p.loan_from = Some(owner);
        p.team = Some(borrower);
        Ok(format!("{} emprestado até o fim da temporada (taxa R$ {fee})", p.name))
    }

    /// Empresta um jogador próprio a outro clube até o fim da temporada.
    pub fn loan_out(&mut self, owner: usize, id: usize) -> Result<String, String> {
        if self.players.get(id).map(|p| p.team == Some(owner) && !p.academy && p.loan_from.is_none()) != Some(true) { return Err("Jogador não pode ser emprestado".into()); }
        let fee = self.loan_fee(id);
        let cands: Vec<usize> = (0..self.teams.len()).filter(|&t| t != owner && Some(t) != self.managed && self.teams[t].budget >= fee && self.squad(t).len() < MAX_SQUAD).collect();
        if cands.is_empty() { return Err("Nenhum clube interessado".into()); }
        let b = *self.rng.pick(&cands);
        let r = self.loan_in(b, id)?;
        Ok(format!("{} (para o {})", r, self.teams[b].name))
    }

    fn return_loans(&mut self, news: &mut Vec<String>) {
        for p in self.players.iter_mut() {
            if let Some(owner) = p.loan_from.take() {
                if Some(owner) == self.managed || p.team == self.managed { news.push(format!("{} retorna de empréstimo", p.name)); }
                p.team = Some(owner);
            }
        }
    }

    pub fn bank_limit(&self, team: usize) -> i64 { DIV_BUDGET[self.teams[team].division] * 2 }

    /// Empréstimo bancário: juros fixos, pago em parcelas por rodada.
    pub fn take_bank_loan(&mut self, team: usize, amount: i64) -> Result<String, String> {
        if amount <= 0 { return Err("Valor inválido".into()); }
        let owed = amount + amount * BANK_INTEREST_PCT / 100;
        if self.teams[team].bank_debt + owed > self.bank_limit(team) { return Err(format!("Limite de crédito: R$ {}", self.bank_limit(team))); }
        let t = &mut self.teams[team];
        t.budget += amount;
        t.bank_debt += owed;
        t.bank_payment = (t.bank_debt + BANK_INSTALLMENTS - 1) / BANK_INSTALLMENTS;
        if Some(team) == self.managed { self.finance.bank_in += amount; }
        Ok(format!("Empréstimo de R$ {amount} aprovado. Dívida: R$ {}", self.teams[team].bank_debt))
    }

    pub fn repay_bank_loan(&mut self, team: usize, amount: i64) -> Result<String, String> {
        let t = &mut self.teams[team];
        let amount = amount.min(t.bank_debt);
        if amount <= 0 { return Err("Não há dívida a pagar".into()); }
        if t.budget < amount { return Err("Orçamento insuficiente".into()); }
        t.budget -= amount;
        t.bank_debt -= amount;
        if t.bank_debt == 0 { t.bank_payment = 0; }
        if Some(team) == self.managed { self.finance.bank_paid += amount; }
        Ok(format!("Pagamento de R$ {amount} realizado", ))
    }

    fn pay_bank_installments(&mut self) {
        for t in 0..self.teams.len() {
            let tm = &mut self.teams[t];
            let pay = tm.bank_payment.min(tm.bank_debt);
            if pay > 0 {
                tm.budget -= pay; tm.bank_debt -= pay;
                if tm.bank_debt == 0 { tm.bank_payment = 0; }
                if Some(t) == self.managed { self.finance.bank_paid += pay; }
            }
        }
    }

    fn advance_construction(&mut self) {
        for t in 0..self.teams.len() {
            if let Some(c) = &mut self.teams[t].construction {
                c.rounds_left = c.rounds_left.saturating_sub(1);
                if c.rounds_left == 0 {
                    let seats = c.seats;
                    self.teams[t].capacity += seats;
                    self.teams[t].construction = None;
                    if Some(t) == self.managed { self.news.push(format!("Ampliação concluída! O estádio agora tem {} lugares", self.teams[t].capacity)); }
                }
            }
        }
    }

    fn pick_scorer(&mut self, on: &[usize]) -> usize {
        let l = on.to_vec();
        let w: Vec<f64> = l.iter().map(|&id| match self.players[id].pos { Pos::G => 0.02, Pos::D => 1.0, Pos::M => 3.0, Pos::A => 6.0 } * self.players[id].skill as f64).collect();
        let mut r = self.rng.f64() * w.iter().sum::<f64>();
        for (i, x) in w.iter().enumerate() { if r < *x { return l[i]; } r -= x; }
        *l.last().unwrap()
    }

    /// Joga a rodada inteira de uma vez. Ao fim da última rodada, encerra a temporada.
    pub fn play_round(&mut self) -> Vec<MatchResult> {
        self.start_round();
        while self.step() {}
        self.finish_round()
    }

    /// Inicia a rodada: escala os times e cria as partidas ao vivo.
    pub fn start_round(&mut self) {
        if !self.live.is_empty() { return; }
        if self.round >= ROUNDS { self.end_season(); }
        self.news.clear();
        self.ai_transfers();
        for t in 0..self.teams.len() {
            if Some(t) != self.managed || !self.lineup_valid(t) { self.auto_lineup(t); }
        }
        for div in 0..DIVISIONS {
            for (h, a) in self.schedule[div][self.round].clone() {
                let on = [self.teams[h].lineup.clone(), self.teams[a].lineup.clone()];
                self.live.push(LiveMatch { division: div, home: h, away: a, on, ..Default::default() });
            }
        }
    }

    /// Avança um minuto em todas as partidas. Retorna false quando acabaram.
    pub fn step(&mut self) -> bool {
        if self.live.is_empty() || self.live[0].minute >= 90 { return false; }
        let mut live = std::mem::take(&mut self.live);
        for m in live.iter_mut() { self.step_match(m); }
        self.live = live;
        true
    }

    /// Encerra a rodada: aplica resultados, cartões, lesões e finanças.
    pub fn finish_round(&mut self) -> Vec<MatchResult> {
        while self.step() {}
        let live = std::mem::take(&mut self.live);
        if live.is_empty() { return vec![]; }
        // suspensões cumpridas e recuperação de lesões
        for p in self.players.iter_mut() {
            if p.team.is_some() && p.suspended > 0 { p.suspended -= 1; }
            if p.injured > 0 { p.injured -= 1; }
        }
        let mut results = Vec::new();
        for m in live {
            for &pl in &m.booked {
                if m.reds.iter().any(|r| r.0 == pl) { continue; }
                let p = &mut self.players[pl];
                p.yellows += 1;
                if p.yellows >= 3 { p.yellows = 0; p.suspended += 1; self.news.push(format!("{} cumprirá suspensão por 3 amarelos", p.name)); }
            }
            for &(pl, n) in &m.reds { self.players[pl].suspended += n; }
            for &(pl, n) in &m.injuries { self.players[pl].injured = self.players[pl].injured.max(n); }
            self.update_morale(&m);
            let attendance = self.attendance(m.home);
            let r = MatchResult { division: m.division, home: m.home, away: m.away, hg: m.hg, ag: m.ag, attendance, events: m.events };
            self.apply_result(&r);
            results.push(r);
        }
        // salários
        for t in 0..self.teams.len() {
            let pay: i64 = self.squad(t).iter().map(|&id| self.players[id].salary).sum();
            let upkeep = self.academy_upkeep(t) + self.stadium_upkeep(t);
            self.teams[t].budget -= pay + upkeep;
            if Some(t) == self.managed { self.finance.salaries += pay; self.finance.upkeep += upkeep; }
        }
        self.advance_construction();
        self.pay_bank_installments();
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
        self.return_loans(&mut news);
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
        self.academy_season(&mut news);
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
        if p.academy { return Err("Jogadores da base de outros clubes não estão à venda".into()); }
        if p.loan_from.is_some() { return Err("Jogador emprestado não pode ser negociado".into()); }
        if self.squad(buyer).len() >= MAX_SQUAD { return Err(format!("Elenco cheio (máx. {})", MAX_SQUAD)); }
        if let Some(seller) = p.team { if self.squad(seller).len() <= MIN_SQUAD { return Err("O clube vendedor não pode liberar mais jogadores".into()); } }
        let price = self.buy_price(id);
        if self.teams[buyer].budget < price { return Err("Orçamento insuficiente".into()); }
        let seller = p.team;
        self.teams[buyer].budget -= price;
        if let Some(s) = seller { self.teams[s].budget += price; self.teams[s].lineup.retain(|&x| x != id); }
        if Some(buyer) == self.managed { self.finance.transfers_out += price; }
        self.players[id].team = Some(buyer);
        self.players[id].morale = 65;
        Ok(format!("{} contratado por R$ {}", self.players[id].name, price))
    }

    pub fn sell(&mut self, seller: usize, id: usize) -> Result<String, String> {
        if self.players.get(id).map(|p| p.team == Some(seller) && !p.academy) != Some(true) { return Err("Jogador não é do seu elenco".into()); }
        if self.players[id].loan_from.is_some() { return Err("Jogador emprestado não pode ser vendido".into()); }
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
            "goals": p.goals, "buyPrice": self.buy_price(p.id), "sellPrice": self.sell_price(p.id),
            "yellows": p.yellows, "suspended": p.suspended, "injured": p.injured, "morale": p.morale,
            "loanFee": self.loan_fee(p.id), "loanFrom": p.loan_from.map(|t| self.teams[t].name.clone())})
    }

    /// Estado das partidas ao vivo de uma divisão.
    pub fn live_json(&self, div: usize) -> serde_json::Value {
        serde_json::Value::Array(self.live.iter().filter(|m| m.division == div).map(|m| { let bench: Vec<Vec<serde_json::Value>> = [0usize, 1].iter().map(|&s| if Some(if s == 0 { m.home } else { m.away }) == self.managed {
                self.bench(m, s).iter().map(|&id| self.player_json(&self.players[id])).collect::<Vec<_>>() } else { vec![] }).collect(); serde_json::json!({
            "home": m.home, "away": m.away, "homeName": self.teams[m.home].name, "awayName": self.teams[m.away].name,
            "hg": m.hg, "ag": m.ag, "minute": m.minute, "events": m.events, "subs": m.subs, "bench": bench,

            "on": [m.on[0].iter().map(|&id| self.player_json(&self.players[id])).collect::<Vec<_>>(),
                   m.on[1].iter().map(|&id| self.player_json(&self.players[id])).collect::<Vec<_>>()]}) }).collect())
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
            serde_json::json!({"id": m, "name": t.name, "division": t.division, "budget": t.budget, "capacity": t.capacity, "morale": self.team_morale(m),
                "ticketPrice": t.ticket_price, "formation": t.formation, "lineup": t.lineup,
                "squad": self.squad(m).iter().map(|&id| self.player_json(&self.players[id])).collect::<Vec<_>>(),
                "wageBill": self.squad(m).iter().map(|&id| self.players[id].salary).sum::<i64>(), "finance": self.finance,
                "construction": t.construction, "stadiumUpkeep": self.stadium_upkeep(m), "expectedAttendance": self.demand(m).min(t.capacity as f64) as i64,
                "stadiumOptions": STADIUM_OPTIONS.iter().map(|&(s, r)| serde_json::json!({"seats": s, "rounds": r, "cost": Self::stadium_cost(s)})).collect::<Vec<_>>(),
                "bankDebt": t.bank_debt, "bankPayment": t.bank_payment, "bankLimit": self.bank_limit(m),
                "loanedOut": self.players.iter().filter(|p| p.loan_from == Some(m)).map(|p| self.player_json(p)).collect::<Vec<_>>(),
                "academyLevel": t.academy_level, "academyUpgradeCost": self.academy_upgrade_cost(m), "academyUpkeep": self.academy_upkeep(m),
                "academy": self.academy(m).iter().map(|&id| self.player_json(&self.players[id])).collect::<Vec<_>>()})
        });
        let teams: Vec<_> = self.teams.iter().map(|t| serde_json::json!({"id": t.id, "name": t.name, "division": t.division, "budget": t.budget})).collect();
        let mut scorers: Vec<&Player> = self.players.iter().filter(|p| p.goals > 0).collect();
        scorers.sort_by_key(|p| -p.goals);
        serde_json::json!({"season": self.season, "round": self.round, "rounds": ROUNDS, "tables": tables, "next": next, "liveActive": !self.live.is_empty(),
            "managed": managed, "teams": teams, "news": self.news, "formations": FORMATIONS,
            "scorers": scorers.iter().take(15).map(|p| self.player_json(p)).collect::<Vec<_>>()})
    }

    pub fn market_json(&self, pos: &str, max_price: i64) -> serde_json::Value {
        let mut v: Vec<&Player> = self.players.iter().filter(|p| !p.academy && p.loan_from.is_none() && (p.team != self.managed || self.managed.is_none()))
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
    /// Inicia a rodada ao vivo; avance com `step` e finalize com `finish_round`.
    pub fn start_round(&mut self) -> String { self.g.start_round(); self.live() }
    /// Avança `n` minutos e devolve as partidas da divisão do clube gerenciado.
    pub fn step(&mut self, n: u32) -> String { for _ in 0..n { if !self.g.step() { break; } } self.live() }
    pub fn live(&self) -> String {
        let div = self.g.managed.map(|m| self.g.teams[m].division).unwrap_or(0);
        self.g.live_json(div).to_string()
    }
    pub fn finish_round(&mut self) -> String { let r = self.g.finish_round(); self.results_json(&r) }
    /// Substituição ao vivo do clube gerenciado.
    pub fn substitute(&mut self, out: usize, inn: usize) -> String { res(self.g.substitute_managed(out, inn)) }
    fn results_json(&self, r: &[MatchResult]) -> String {
        let names = |t: usize| self.g.teams[t].name.clone();
        serde_json::Value::Array(r.iter().map(|m| serde_json::json!({"division": m.division, "home": m.home, "away": m.away,
            "homeName": names(m.home), "awayName": names(m.away), "hg": m.hg, "ag": m.ag, "attendance": m.attendance, "events": m.events})).collect()).to_string()
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
    pub fn promote_youth(&mut self, id: usize) -> String { match self.g.managed { Some(m) => res(self.g.promote_youth(m, id)), None => res(Err("Nenhum time".into())) } }
    pub fn release_youth(&mut self, id: usize) -> String { match self.g.managed { Some(m) => res(self.g.release_youth(m, id)), None => res(Err("Nenhum time".into())) } }
    pub fn loan_in(&mut self, id: usize) -> String { match self.g.managed { Some(m) => res(self.g.loan_in(m, id)), None => res(Err("Nenhum time".into())) } }
    pub fn loan_out(&mut self, id: usize) -> String { match self.g.managed { Some(m) => res(self.g.loan_out(m, id)), None => res(Err("Nenhum time".into())) } }
    pub fn take_bank_loan(&mut self, amount: f64) -> String { match self.g.managed { Some(m) => res(self.g.take_bank_loan(m, amount as i64)), None => res(Err("Nenhum time".into())) } }
    pub fn repay_bank_loan(&mut self, amount: f64) -> String { match self.g.managed { Some(m) => res(self.g.repay_bank_loan(m, amount as i64)), None => res(Err("Nenhum time".into())) } }
    pub fn upgrade_stadium(&mut self, option: usize) -> String { match self.g.managed { Some(m) => res(self.g.upgrade_stadium(m, option)), None => res(Err("Nenhum time".into())) } }
    pub fn upgrade_academy(&mut self) -> String { match self.g.managed { Some(m) => res(self.g.upgrade_academy(m)), None => res(Err("Nenhum time".into())) } }
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
    fn suspended_and_injured_players_unavailable() {
        let mut g = Game::new(21);
        let best = *g.teams[0].lineup.iter().find(|&&id| g.players[id].pos != Pos::G).unwrap();
        g.players[best].suspended = 1;
        g.auto_lineup(0);
        assert!(!g.teams[0].lineup.contains(&best));
        let mut l = g.teams[0].lineup.clone();
        let i = l.iter().position(|&id| g.players[id].pos != Pos::G).unwrap();
        l[i] = best;
        assert!(g.set_lineup(0, &g.teams[0].formation.clone(), &l).is_err());
        let inj = g.teams[0].lineup[1];
        g.players[inj].injured = 2;
        g.play_round();
        assert_eq!(g.players[best].suspended, 0, "suspensão cumprida");
        assert_eq!(g.players[inj].injured, 1);
        assert!(g.live.is_empty());
    }

    #[test]
    fn cards_accumulate_and_reds_suspend() {
        let mut g = Game::new(22);
        g.start_round();
        let (y, r, i) = (g.live[0].on[0][1], g.live[0].on[0][2], g.live[0].on[0][3]);
        g.players[y].yellows = 2;
        g.live[0].booked.push(y);
        g.live[0].reds.push((r, 2));
        g.live[0].injuries.push((i, 3));
        g.finish_round();
        assert_eq!(g.players[y].suspended, 1);
        assert_eq!(g.players[y].yellows, 0);
        assert_eq!(g.players[r].suspended, 2);
        assert_eq!(g.players[i].injured, 3);
        g.play_round();
        assert_eq!(g.players[r].suspended, 1);
        assert_eq!(g.players[i].injured, 2);
    }

    #[test]
    fn season_produces_cards_and_injuries() {
        let mut g = Game::new(23);
        let (mut cards, mut reds, mut inj) = (0, 0, 0);
        for _ in 0..ROUNDS {
            for m in g.play_round() { for e in m.events { match e.kind.as_str() { "cartao" => cards += 1, "vermelho" => reds += 1, "lesao" => inj += 1, _ => {} } } }
        }
        assert!(cards > 100 && reds > 3 && inj > 10, "cartões {cards}, vermelhos {reds}, lesões {inj}");
    }

    #[test]
    fn live_substitutions() {
        let mut g = Game::new(31);
        g.managed = Some(0);
        g.start_round();
        for _ in 0..30 { g.step(); }
        let i = g.live.iter().position(|m| m.home == 0 || m.away == 0).unwrap();
        let side = if g.live[i].home == 0 { 0 } else { 1 };
        let bench = g.bench(&g.live[i], side);
        assert!(bench.len() >= 3);
        let on = g.live[i].on[side].clone();
        assert!(g.substitute_managed(on[1], on[2]).is_err(), "titular não pode entrar de novo");
        assert!(g.substitute_managed(g.squad(1)[0], bench[0]).is_err(), "jogador de outro time");
        g.substitute_managed(on[1], bench[0]).unwrap();
        assert!(g.live[i].on[side].contains(&bench[0]) && !g.live[i].on[side].contains(&on[1]));
        assert!(g.substitute_managed(bench[0], on[1]).is_err(), "quem saiu não volta");
        g.substitute_managed(on[2], bench[1]).unwrap();
        g.substitute_managed(on[3], bench[2]).unwrap();
        let more = g.bench(&g.live[i], side);
        assert!(g.substitute_managed(on[4], more[0]).is_err(), "máximo de 3");
        assert_eq!(g.live[i].subs[side], 3);
        let res = g.finish_round();
        assert!(res.iter().any(|r| r.events.iter().any(|e| e.kind == "sub")));
        assert!(g.substitute_managed(on[5], more[0]).is_err());
    }

    #[test]
    fn injured_players_are_replaced() {
        let mut g = Game::new(32);
        let mut subs_for_injury = 0;
        for _ in 0..10 {
            g.start_round();
            while g.step() {}
            for m in &g.live {
                assert!(m.subs.iter().all(|&s| s <= MAX_SUBS));
                for s in 0..2 { assert!(m.on[s].len() <= 11); }
                subs_for_injury += m.injuries.len();
            }
            g.finish_round();
        }
        assert!(subs_for_injury > 0);
    }

    #[test]
    fn morale_affects_strength_and_results() {
        let mut g = Game::new(41);
        let (a0, d0) = g.strength(5);
        for id in g.squad(5) { g.players[id].morale = 100; }
        let (a1, d1) = g.strength(5);
        assert!(a1 > a0 * 1.05 && d1 > d0 * 1.05);
        for id in g.squad(5) { g.players[id].morale = 0; }
        let (a2, _) = g.strength(5);
        assert!(a2 < a0 * 0.95);
        // vitória sobe a moral, derrota derruba
        let mut g = Game::new(42);
        for id in g.squad(0).into_iter().chain(g.squad(1)) { g.players[id].morale = 50; }
        g.start_round();
        g.live.truncate(1);
        g.live[0].home = 0; g.live[0].away = 1;
        g.live[0].on = [g.teams[0].lineup.clone(), g.teams[1].lineup.clone()];
        g.live[0].minute = 90; g.live[0].hg = 3; g.live[0].ag = 0;
        g.live[0].events.clear();
        let starter0 = g.teams[0].lineup[0];
        let starter1 = g.teams[1].lineup[0];
        g.finish_round();
        assert!(g.players[starter0].morale > 50 && g.players[starter1].morale < 50);
        assert!(g.team_morale(0) > g.team_morale(1));
    }

    #[test]
    fn youth_academy() {
        let mut g = Game::new(51);
        g.managed = Some(2);
        let ac = g.academy(2);
        assert_eq!(ac.len(), 2);
        assert_eq!(g.squad(2).len(), 18, "base não conta no elenco");
        assert!(ac.iter().all(|&id| g.players[id].age <= 17));
        let mut l = g.teams[2].lineup.clone();
        let i = l.iter().position(|&id| g.players[id].pos != Pos::G).unwrap();
        l[i] = ac[0];
        if g.players[ac[0]].pos != Pos::G { assert!(g.set_lineup(2, "4-4-2", &l).is_err()); }
        assert!(g.buy(3, ac[0]).is_err());
        g.promote_youth(2, ac[0]).unwrap();
        assert_eq!(g.squad(2).len(), 19);
        g.release_youth(2, ac[1]).unwrap();
        assert_eq!(g.players[ac[1]].team, None);
        assert!(g.promote_youth(2, ac[1]).is_err());
        // melhorar a base
        g.teams[2].budget = 10_000_000;
        let c = g.academy_upgrade_cost(2);
        g.upgrade_academy(2).unwrap();
        assert_eq!(g.teams[2].academy_level, 2);
        assert_eq!(g.teams[2].budget, 10_000_000 - c);
        g.teams[2].budget = 0;
        assert!(g.upgrade_academy(2).is_err());
        // fim de temporada gera novos jovens
        for _ in 0..ROUNDS { g.play_round(); }
        assert_eq!(g.season, 2);
        assert!(!g.academy(2).is_empty());
        assert!(g.teams.iter().all(|t| g.academy(t.id).len() <= MAX_ACADEMY));
    }

    #[test]
    fn stadium_upgrade_and_ticket_demand() {
        let mut g = Game::new(61);
        let t = 20;
        g.managed = Some(t);
        g.teams[t].budget = 10_000_000;
        let cap = g.teams[t].capacity;
        g.upgrade_stadium(t, 1).unwrap();
        assert_eq!(g.teams[t].budget, 10_000_000 - 5000 * SEAT_COST);
        assert!(g.upgrade_stadium(t, 0).is_err(), "uma obra por vez");
        for _ in 0..4 { g.play_round(); }
        assert_eq!(g.teams[t].capacity, cap);
        g.play_round();
        assert_eq!(g.teams[t].capacity, cap + 5000);
        assert!(g.teams[t].construction.is_none());
        g.teams[t].budget = 0;
        assert!(g.upgrade_stadium(t, 0).is_err());
        // preço alto reduz a demanda
        let d0 = g.demand(t);
        g.teams[t].ticket_price *= 3;
        assert!(g.demand(t) < d0 * 0.5);
        // estádio maior não reduz o público quando há demanda reprimida
        g.teams[t].ticket_price = 1;
        g.teams[t].capacity = 1000;
        let small = g.attendance(t);
        g.teams[t].capacity = 100_000;
        assert!(g.attendance(t) > small);
    }

    #[test]
    fn player_loans() {
        let mut g = Game::new(71);
        g.managed = Some(4);
        g.teams[4].budget = 50_000_000;
        let target = g.squad(9)[0];
        let fee = g.loan_fee(target);
        let (b4, b9) = (g.teams[4].budget, g.teams[9].budget);
        g.loan_in(4, target).unwrap();
        assert_eq!(g.players[target].team, Some(4));
        assert_eq!(g.players[target].loan_from, Some(9));
        assert_eq!(g.teams[4].budget, b4 - fee);
        assert_eq!(g.teams[9].budget, b9 + fee);
        assert!(g.sell(4, target).is_err(), "emprestado não pode ser vendido");
        assert!(g.buy(5, target).is_err());
        let mine = g.squad(4)[0];
        g.loan_out(4, mine).unwrap();
        assert_eq!(g.players[mine].loan_from, Some(4));
        assert_ne!(g.players[mine].team, Some(4));
        for _ in 0..ROUNDS { g.play_round(); }
        assert_eq!(g.players[target].team, Some(9), "volta ao dono no fim da temporada");
        assert_eq!(g.players[mine].team, Some(4));
        assert!(g.players.iter().all(|p| p.loan_from.is_none()));
    }

    #[test]
    fn bank_loans() {
        let mut g = Game::new(72);
        g.managed = Some(30);
        let b = g.teams[30].budget;
        assert!(g.take_bank_loan(30, g.bank_limit(30) * 2).is_err());
        g.take_bank_loan(30, 1_000_000).unwrap();
        assert_eq!(g.teams[30].budget, b + 1_000_000);
        assert_eq!(g.teams[30].bank_debt, 1_120_000);
        let pay = g.teams[30].bank_payment;
        assert!(pay > 0);
        g.play_round();
        assert_eq!(g.teams[30].bank_debt, 1_120_000 - pay);
        g.teams[30].budget = 10_000_000;
        g.repay_bank_loan(30, 100_000_000).unwrap();
        assert_eq!(g.teams[30].bank_debt, 0);
        assert_eq!(g.teams[30].bank_payment, 0);
        assert!(g.repay_bank_loan(30, 1).is_err());
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
