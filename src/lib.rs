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
    /// Última temporada do contrato (0 = sem contrato)
    #[serde(default)]
    pub contract_until: u32,
    /// Propostas de renovação recusadas nesta temporada
    #[serde(default)]
    pub refusals: u8,
    /// Atributos técnicos (0..99)
    #[serde(default)]
    pub attrs: Attrs,
    /// Condição física entre partidas (0..100)
    #[serde(default = "full")]
    pub condition: i32,
    /// Aposentado (vaga reaproveitada para novos jogadores)
    #[serde(default)]
    pub retired: bool,
}

fn full() -> i32 { 100 }

/// Recuperação entre rodadas: recupera 59%..69% do que falta para 100 (conforme a resistência).
pub fn recover(energy: f64, stamina: i32) -> i32 {
    let k = 0.5 + stamina.clamp(0, 99) as f64 / 500.0;
    (energy + (100.0 - energy) * k).round().clamp(0.0, 100.0) as i32
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq)]
pub struct Attrs { pub finishing: i32, pub passing: i32, pub tackling: i32, pub keeping: i32, pub stamina: i32 }

impl Attrs {
    /// Gera atributos coerentes com a posição e a habilidade geral.
    pub fn generate(rng: &mut Rng, pos: Pos, skill: i32) -> Attrs {
        let mut v = |main: bool| (skill + if main { rng.range(-4, 6) } else { rng.range(-28, -8) } as i32).clamp(5, 99);
        let (f, p, t, k) = match pos {
            Pos::G => (v(false), v(false), v(false), v(true)),
            Pos::D => (v(false), v(false), v(true), v(false) / 2),
            Pos::M => (v(false) + 6, v(true), v(false) + 6, v(false) / 2),
            Pos::A => (v(true), v(false) + 6, v(false), v(false) / 2),
        };
        Attrs { finishing: f.min(99), passing: p.min(99), tackling: t.min(99), keeping: k.min(99), stamina: rng.range(45, 95) as i32 }
    }
    /// Ajusta os atributos quando a habilidade geral muda (envelhecimento/evolução).
    pub fn shift(&mut self, d: i32) { for a in [&mut self.finishing, &mut self.passing, &mut self.tackling, &mut self.keeping] { *a = (*a + d).clamp(5, 99); } }
}

pub const MENTALITIES: [&str; 3] = ["defensiva", "equilibrada", "ofensiva"];
fn default_tactic() -> String { "equilibrada".into() }

pub const MAX_CONTRACT_YEARS: u32 = 5;
pub const MAX_REFUSALS: u8 = 3;

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
    /// energia (0..100) de quem entrou em campo
    #[serde(default)]
    pub energy: std::collections::BTreeMap<usize, f64>,
    /// público e renda definidos no início da rodada
    #[serde(default)]
    pub attendance: i64,
    #[serde(default)]
    pub receipts: i64,
}

pub const MAX_SUBS: u8 = 3;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Stats { pub p: i32, pub w: i32, pub d: i32, pub l: i32, pub gf: i32, pub ga: i32, pub pts: i32,
    /// pontos perdidos por punição financeira
    #[serde(default)] pub deducted: i32 }

/// Pontos descontados por punição financeira
pub const DEBT_PENALTY_POINTS: i32 = 3;

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
    /// Mentalidade: defensiva / equilibrada / ofensiva
    #[serde(default = "default_tactic")]
    pub tactic: String,
    /// Marcação pressão (rouba mais bolas, cansa mais)
    #[serde(default)]
    pub pressing: bool,
    /// Rodadas consecutivas com caixa negativo
    #[serde(default)]
    pub debt_rounds: u32,
    /// Últimos resultados (V/E/D), mais recente por último, até 5
    #[serde(default)]
    pub form: String,
}

/// Juros por rodada sobre saldo negativo (%)
pub const OVERDRAFT_PCT: f64 = 1.5;
/// Rodadas seguidas no vermelho até a diretoria demitir o técnico
pub const FIRE_AFTER_ROUNDS: u32 = 12;
pub const MAX_FREE_AGENTS: usize = 150;

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
    /// renda (bilheteria) da partida para o mandante
    #[serde(default)]
    pub receipts: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Finance { pub tickets: i64, pub salaries: i64, pub transfers_in: i64, pub transfers_out: i64, pub prizes: i64,
    #[serde(default)] pub upkeep: i64, #[serde(default)] pub investments: i64,
    #[serde(default)] pub bank_in: i64, #[serde(default)] pub bank_paid: i64, #[serde(default)] pub loan_fees: i64,
    #[serde(default)] pub tv: i64 }

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
    /// O técnico foi demitido e precisa escolher um novo clube
    #[serde(default)]
    pub fired: bool,
    /// Receitas/despesas do clube gerenciado na última rodada
    #[serde(default)]
    pub last_round: Finance,
    /// Posição esperada (ranking de força) de cada time na sua divisão no início da temporada
    #[serde(default)]
    pub expected: Vec<usize>,
    /// Relatório da última temporada encerrada (encerramento)
    #[serde(default)]
    pub last_report: Option<serde_json::Value>,
    /// O encerramento ainda não foi visto pelo usuário
    #[serde(default)]
    pub report_pending: bool,
    /// Galeria de campeões e temporadas do usuário
    #[serde(default)]
    pub history: Vec<serde_json::Value>,
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
fn salary_for(skill: i32) -> i64 { let s = skill as f64; ((s * s * s / 30.0) as i64 / 450).max(1) * 1000 }

const DIV_BASE_SKILL: [i32; 4] = [72, 62, 52, 42];
const DIV_CAPACITY: [i64; 4] = [40000, 22000, 12000, 7000];
const DIV_TICKET: [i64; 4] = [40, 30, 22, 18];
const DIV_BUDGET: [i64; 4] = [25_000_000, 10_000_000, 4_000_000, 1_500_000];
const DIV_PRIZE: [i64; 4] = [8_000_000, 3_000_000, 1_200_000, 500_000];
/// Cotas de TV/patrocínio por rodada
const DIV_TV: [i64; 4] = [200_000, 120_000, 80_000, 55_000];

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
                    bank_debt: 0, bank_payment: 0, tactic: default_tactic(), pressing: false, debt_rounds: 0, form: String::new() });
                for (pos, n) in [(Pos::G, 2), (Pos::D, 6), (Pos::M, 6), (Pos::A, 4)] {
                    for _ in 0..n { let p = Self::gen_player(&mut rng, players.len(), pos, base, Some(id)); players.push(p); }
                }
            }
        }
        let mut g = Game { rng, season: 1, round: 0, teams, players, schedule: vec![], managed: None,
            finance: Finance::default(), news: vec![], last_results: vec![], live: vec![], fired: false, last_round: Finance::default(),
            expected: vec![], last_report: None, report_pending: false, history: vec![] };
        g.refill_free_agents();
        for i in 0..g.players.len() { if g.players[i].team.is_some() { g.players[i].contract_until = 1 + g.rng.range(0, 3) as u32; } }
        for t in 0..g.teams.len() { for _ in 0..2 { g.gen_prospect(t); } }
        g.build_schedule();
        for t in 0..g.teams.len() { g.auto_lineup(t); }
        g.compute_expected();
        g
    }

    fn gen_player(rng: &mut Rng, id: usize, pos: Pos, base: i32, team: Option<usize>) -> Player {
        let skill = (base + rng.range(-10, 10) as i32).clamp(15, 95);
        Player { id, name: gen_player_name(rng), pos, skill, age: rng.range(17, 34) as i32, salary: salary_for(skill), team, goals: 0,
            yellows: 0, suspended: 0, injured: 0, morale: 50, academy: false, loan_from: None, contract_until: 0, refusals: 0,
            attrs: Attrs::generate(rng, pos, skill), condition: 100, retired: false }
    }

    fn refill_free_agents(&mut self) {
        // aposenta livres veteranos e o excesso de livres fracos (reaproveita as vagas)
        let mut free: Vec<usize> = self.free_agents();
        for &id in &free { if self.players[id].age >= 34 { self.players[id].retired = true; } }
        free.retain(|&id| !self.players[id].retired);
        free.sort_by_key(|&id| -self.players[id].skill);
        for &id in free.iter().skip(MAX_FREE_AGENTS) { self.players[id].retired = true; }
        for _ in free.len().min(MAX_FREE_AGENTS)..40 {
            let pos = *self.rng.pick(&[Pos::G, Pos::D, Pos::D, Pos::M, Pos::M, Pos::A]);
            let base = self.rng.range(35, 65) as i32;
            let id = self.alloc_id();
            let p = Self::gen_player(&mut self.rng, id, pos, base, None);
            self.put_player(p);
        }
    }

    pub fn free_agents(&self) -> Vec<usize> { self.players.iter().filter(|p| p.team.is_none() && !p.retired).map(|p| p.id).collect() }

    /// Próximo id livre (reaproveita aposentados).
    fn alloc_id(&self) -> usize { self.players.iter().position(|p| p.retired).unwrap_or(self.players.len()) }
    fn put_player(&mut self, p: Player) { let id = p.id; if id == self.players.len() { self.players.push(p) } else { self.players[id] = p } }

    /// Consequências de dívidas: juros, vendas forçadas e demissão do técnico.
    fn debt_consequences(&mut self) {
        for t in 0..self.teams.len() {
            if self.teams[t].budget >= 0 { self.teams[t].debt_rounds = 0; continue; }
            let interest = (-self.teams[t].budget as f64 * OVERDRAFT_PCT / 100.0) as i64;
            self.teams[t].budget -= interest;
            self.teams[t].debt_rounds += 1;
            if Some(t) == self.managed { self.finance.upkeep += interest; }
            let dr = self.teams[t].debt_rounds;
            let is_user = Some(t) == self.managed;
            // punição esportiva: -3 pontos a cada 8 rodadas no vermelho (a cada 4 se a dívida for muito alta)
            let deep = self.teams[t].budget < -DIV_BUDGET[self.teams[t].division];
            if dr % 8 == 0 || (deep && dr % 4 == 0) {
                self.teams[t].stats.pts -= DEBT_PENALTY_POINTS;
                self.teams[t].stats.deducted += DEBT_PENALTY_POINTS;
                let msg = format!("Punição: {} perde {} pontos por dívidas", self.teams[t].name, DEBT_PENALTY_POINTS);
                if is_user { self.news.push(format!("Diretoria: {msg}")); } else { self.news.push(msg); }
            }
            // venda forçada do jogador mais valioso
            let force = if is_user { dr >= 6 && dr % 3 == 0 } else { dr >= 2 };
            if force && self.squad(t).len() > MIN_SQUAD + 1 {
                let best = self.squad(t).into_iter().filter(|&id| self.players[id].loan_from.is_none()).max_by_key(|&id| player_value(&self.players[id]));
                if let Some(id) = best {
                    if let Ok(msg) = self.sell(t, id) {
                        if is_user { self.news.push(format!("Diretoria: venda forçada para cobrir a dívida — {msg}")); }
                    }
                }
            }
            if is_user {
                if dr == 3 { self.news.push("Diretoria: o caixa está no vermelho! Equilibre as contas.".into()); }
                if dr == FIRE_AFTER_ROUNDS - 3 { self.news.push(format!("Diretoria: ÚLTIMO AVISO — {} rodadas no vermelho levam à demissão.", FIRE_AFTER_ROUNDS)); }
                if dr >= FIRE_AFTER_ROUNDS || self.teams[t].budget < -3 * DIV_BUDGET[self.teams[t].division] {
                    self.news.push(format!("Você foi DEMITIDO do {} por causa das dívidas.", self.teams[t].name));
                    self.fired = true;
                    self.managed = None;
                }
            }
        }
    }

    /// Clubes que aceitariam contratar o técnico demitido (divisão inferior ou igual à mais baixa).
    pub fn job_offers(&self) -> Vec<usize> {
        let mut v: Vec<usize> = self.teams.iter().filter(|t| t.division == DIVISIONS - 1 || t.division >= 2).map(|t| t.id).collect();
        v.sort_by_key(|&t| -(self.teams[t].budget));
        v.truncate(6);
        v
    }

    pub fn squad(&self, team: usize) -> Vec<usize> { self.players.iter().filter(|p| p.team == Some(team) && !p.academy).map(|p| p.id).collect() }
    pub fn academy(&self, team: usize) -> Vec<usize> { self.players.iter().filter(|p| p.team == Some(team) && p.academy).map(|p| p.id).collect() }

    /// Gera um jovem na base do clube; a qualidade depende do nível da base e da divisão.
    pub fn gen_prospect(&mut self, team: usize) -> usize {
        let lvl = self.teams[team].academy_level as i32;
        let base = DIV_BASE_SKILL[self.teams[team].division] - 18 + lvl * 4;
        let pos = *self.rng.pick(&[Pos::G, Pos::D, Pos::D, Pos::M, Pos::M, Pos::A, Pos::A]);
        let id = self.alloc_id();
        let mut p = Self::gen_player(&mut self.rng, id, pos, base, Some(team));
        p.age = self.rng.range(16, 17) as i32;
        p.academy = true;
        p.salary = 1000;
        self.put_player(p);
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
        p.academy = false; p.salary = salary_for(p.skill); p.morale = 70; p.contract_until = self.season + 3;
        Ok(format!("{} promovido ao time profissional", p.name))
    }

    pub fn release_youth(&mut self, team: usize, id: usize) -> Result<String, String> {
        if self.players.get(id).map(|p| p.team == Some(team) && p.academy) != Some(true) { return Err("Jogador não está na sua base".into()); }
        let p = &mut self.players[id];
        p.academy = false; p.team = None; p.salary = salary_for(p.skill); p.contract_until = 0;
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
            // equilibra mando de campo: manda quem jogou fora na rodada anterior (ou tem menos jogos em casa)
            let mut homes = std::collections::HashMap::new();
            let mut last_home = std::collections::HashMap::new();
            for r in first.iter_mut() {
                for pair in r.iter_mut() {
                    let (a, b) = *pair;
                    let la = *last_home.get(&a).unwrap_or(&false);
                    let lb = *last_home.get(&b).unwrap_or(&false);
                    let a_home = if la != lb { lb } else { homes.get(&a).unwrap_or(&0) <= homes.get(&b).unwrap_or(&0) };
                    *pair = if a_home { (a, b) } else { (b, a) };
                    *homes.entry(pair.0).or_insert(0) += 1;
                    last_home.insert(pair.0, true);
                    last_home.insert(pair.1, false);
                }
            }
            let second: Vec<_> = first.iter().map(|r| r.iter().map(|&(a, b)| (b, a)).collect()).collect();
            first.into_iter().chain(second).collect()
        }).collect();
    }

    pub fn auto_lineup(&mut self, team: usize) { self.teams[team].lineup = self.pick_lineup(team); }
    /// Melhor escalação disponível (sem lesionados/suspensos) na formação do clube.
    pub fn pick_lineup(&self, team: usize) -> Vec<usize> {
        let (d, m, a) = formation_counts(&self.teams[team].formation).unwrap_or((4, 4, 2));
        let mut sq: Vec<usize> = self.squad(team).into_iter().filter(|&id| self.players[id].available()).collect();
        sq.sort_by_key(|&id| -self.players[id].skill);
        let mut chosen = Vec::new();
        for (pos, n) in [(Pos::G, 1), (Pos::D, d), (Pos::M, m), (Pos::A, a)] {
            chosen.extend(sq.iter().copied().filter(|&id| self.players[id].pos == pos && !chosen.contains(&id)).take(n).collect::<Vec<_>>());
        }
        // completa com quem sobrar se faltar alguém da posição
        for &id in &sq { if chosen.len() >= 11 { break; } if !chosen.contains(&id) { chosen.push(id); } }
        chosen
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
    pub fn strength(&self, team: usize) -> (f64, f64) { self.strength_of(team, &self.teams[team].lineup, None) }

    /// Distribui os jogadores pelas funções da formação (G, D, M, A).
    /// Quem não cabe na sua posição natural joga improvisado.
    pub fn assign_roles(&self, team: usize, ids: &[usize]) -> Vec<(usize, Pos)> {
        let (d, m, a) = formation_counts(&self.teams[team].formation).unwrap_or((4, 4, 2));
        let mut slots = vec![(Pos::G, 1usize), (Pos::D, d), (Pos::M, m), (Pos::A, a)];
        let mut out = Vec::new();
        let mut rest = Vec::new();
        for &id in ids {
            let pos = self.players[id].pos;
            let s = slots.iter_mut().find(|s| s.0 == pos).unwrap();
            if s.1 > 0 { s.1 -= 1; out.push((id, pos)); } else { rest.push(id); }
        }
        // improvisados: preenche as vagas restantes, priorizando a linha vizinha
        for id in rest {
            let order: [Pos; 4] = match self.players[id].pos { Pos::G => [Pos::D, Pos::M, Pos::A, Pos::G], Pos::D => [Pos::M, Pos::A, Pos::G, Pos::D],
                Pos::M => [Pos::A, Pos::D, Pos::G, Pos::M], Pos::A => [Pos::M, Pos::D, Pos::G, Pos::A] };
            let role = order.iter().copied().find(|r| slots.iter().any(|s| s.0 == *r && s.1 > 0)).unwrap_or(self.players[id].pos);
            if let Some(s) = slots.iter_mut().find(|s| s.0 == role) { s.1 = s.1.saturating_sub(1); }
            out.push((id, role));
        }
        out
    }

    /// Contribuição de um jogador numa função, considerando atributos, moral e energia.
    pub fn role_value(&self, id: usize, role: Pos, energy: f64) -> f64 {
        let p = &self.players[id];
        let a = &p.attrs;
        let raw = match role {
            Pos::G => a.keeping as f64,
            Pos::D => 0.8 * a.tackling as f64 + 0.2 * a.passing as f64,
            Pos::M => 0.6 * a.passing as f64 + 0.2 * a.tackling as f64 + 0.2 * a.finishing as f64,
            Pos::A => 0.8 * a.finishing as f64 + 0.2 * a.passing as f64,
        };
        let improvised = if role == p.pos { 1.0 } else { 0.9 };
        raw * improvised * (0.9 + 0.2 * p.morale.clamp(0, 100) as f64 / 100.0) * (0.75 + 0.25 * energy.clamp(0.0, 100.0) / 100.0)
    }

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

    /// (ataque, defesa) de um conjunto de jogadores em campo, com tática e energia.
    pub fn strength_of(&self, team: usize, ids: &[usize], energy: Option<&std::collections::BTreeMap<usize, f64>>) -> (f64, f64) {
        let (mut atk, mut def) = (0.0, 0.0);
        for (id, role) in self.assign_roles(team, ids) {
            let e = energy.and_then(|m| m.get(&id).copied()).unwrap_or(self.players[id].condition as f64);
            let s = self.role_value(id, role, e);
            match role { Pos::G => def += 2.5 * s, Pos::D => { def += s; atk += 0.15 * s } Pos::M => { def += 0.5 * s; atk += 0.6 * s } Pos::A => atk += s }
        }
        let (ma, md) = match self.teams[team].tactic.as_str() { "defensiva" => (0.85, 1.15), "ofensiva" => (1.15, 0.88), _ => (1.0, 1.0) };
        ((atk * ma).max(1.0), (def * md).max(1.0))
    }

    /// Multiplicador de cansaço por minuto de acordo com a tática.
    fn fatigue_rate(&self, team: usize) -> f64 {
        let t = &self.teams[team];
        (match t.tactic.as_str() { "defensiva" => 0.9, "ofensiva" => 1.1, _ => 1.0 }) * if t.pressing { 1.35 } else { 1.0 }
    }

    pub fn set_tactic(&mut self, team: usize, mentality: &str, pressing: bool) -> Result<String, String> {
        if !MENTALITIES.contains(&mentality) { return Err("Mentalidade inválida".into()); }
        self.teams[team].tactic = mentality.into();
        self.teams[team].pressing = pressing;
        Ok(format!("Tática: {mentality}{}", if pressing { ", com pressão" } else { "" }))
    }

    /// Avança um minuto de uma partida ao vivo.
    fn step_match(&mut self, m: &mut LiveMatch) {
        if m.minute >= 90 { return; }
        m.minute += 1;
        let minute = m.minute;
        // cansaço
        for side in 0..2 {
            let team = if side == 0 { m.home } else { m.away };
            let rate = self.fatigue_rate(team);
            for &id in &m.on[side] {
                let p = &self.players[id];
                let e = m.energy.entry(id).or_insert(p.condition as f64);
                let gk = if p.pos == Pos::G { 0.4 } else { 1.0 };
                *e = (*e - 0.32 * (1.5 - p.attrs.stamina as f64 / 100.0) * rate * gk).max(0.0);
            }
        }
        let (mut ah, dh) = self.strength_of(m.home, &m.on[0], Some(&m.energy));
        let (mut aa, da) = self.strength_of(m.away, &m.on[1], Some(&m.energy));
        // marcação pressão reduz o ataque adversário
        if self.teams[m.away].pressing { ah *= 0.93; }
        if self.teams[m.home].pressing { aa *= 0.93; }
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
                // sai o mais cansado (ou o pior, se ninguém estiver cansado)
                let energy = |id: usize| m.energy.get(&id).copied().unwrap_or(100.0);
                let tired = m.on[side].iter().copied().filter(|&id| self.players[id].pos != Pos::G && energy(id) < 70.0)
                    .min_by(|&a, &b| energy(a).partial_cmp(&energy(b)).unwrap());
                let Some(worst) = tired.or_else(|| m.on[side].iter().copied().filter(|&id| self.players[id].pos != Pos::G).min_by_key(|&id| self.players[id].skill)) else { continue };
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
        // interesse relativo ao nível da divisão + campanha
        let rel = (a + d) / (13.5 * DIV_BASE_SKILL[t.division] as f64) - 1.0;
        let interest = (0.6 + rel + 0.08 * s.pts as f64 / (s.p.max(1) as f64)).clamp(0.2, 1.3);
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
        let w: Vec<f64> = l.iter().map(|&id| match self.players[id].pos { Pos::G => 0.02, Pos::D => 1.0, Pos::M => 3.0, Pos::A => 6.0 } * self.players[id].attrs.finishing.max(1) as f64).collect();
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
                let attendance = self.attendance(h);
                let receipts = attendance * self.teams[h].ticket_price;
                self.live.push(LiveMatch { division: div, home: h, away: a, on, attendance, receipts, ..Default::default() });
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
        let fin_before = self.finance.clone();
        let mut played_energy: std::collections::HashMap<usize, f64> = std::collections::HashMap::new();
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
            for (&id, &e) in &m.energy { played_energy.insert(id, e); }
            self.update_morale(&m);
            let r = MatchResult { division: m.division, home: m.home, away: m.away, hg: m.hg, ag: m.ag, attendance: m.attendance, events: m.events, receipts: m.receipts };
            self.apply_result(&r);
            results.push(r);
        }
        // salários
        for t in 0..self.teams.len() {
            let pay: i64 = self.squad(t).iter().map(|&id| self.players[id].salary).sum();
            let upkeep = self.academy_upkeep(t) + self.stadium_upkeep(t);
            let tv = DIV_TV[self.teams[t].division];
            self.teams[t].budget += tv;
            if Some(t) == self.managed { self.finance.tv += tv; }
            self.teams[t].budget -= pay + upkeep;
            if Some(t) == self.managed { self.finance.salaries += pay; self.finance.upkeep += upkeep; }
        }
        self.advance_construction();
        self.pay_bank_installments();
        self.debt_consequences();
        // recuperação física: quem jogou recupera boa parte do que perdeu; quem descansou volta a 100%
        for p in self.players.iter_mut() {
            p.condition = match played_energy.get(&p.id) { Some(&e) => recover(e, p.attrs.stamina), None => 100 };
        }
        let f = &self.finance;
        let b = &fin_before;
        self.last_round = Finance { tickets: f.tickets - b.tickets, salaries: f.salaries - b.salaries, transfers_in: f.transfers_in - b.transfers_in,
            transfers_out: f.transfers_out - b.transfers_out, prizes: f.prizes - b.prizes, upkeep: f.upkeep - b.upkeep, investments: f.investments - b.investments,
            bank_in: f.bank_in - b.bank_in, bank_paid: f.bank_paid - b.bank_paid, loan_fees: f.loan_fees - b.loan_fees, tv: f.tv - b.tv };
        self.round += 1;
        if self.round >= ROUNDS { self.end_season(); }
        self.last_results = results.clone();
        results
    }

    fn apply_result(&mut self, r: &MatchResult) {
        let income = r.receipts;
        self.teams[r.home].budget += income;
        if Some(r.home) == self.managed { self.finance.tickets += income; }
        for (t, gf, ga) in [(r.home, r.hg, r.ag), (r.away, r.ag, r.hg)] {
            let s = &mut self.teams[t].stats;
            s.p += 1; s.gf += gf as i32; s.ga += ga as i32;
            if gf > ga { s.w += 1; s.pts += 3 } else if gf == ga { s.d += 1; s.pts += 1 } else { s.l += 1 }
            let f = &mut self.teams[t].form;
            f.push(if gf > ga { 'V' } else if gf == ga { 'E' } else { 'D' });
            while f.chars().count() > 5 { f.remove(0); }
        }
    }

    /// Ranking de força dentro de cada divisão (1 = favorito).
    pub fn compute_expected(&mut self) {
        let mut exp = vec![0; self.teams.len()];
        for d in 0..DIVISIONS {
            let mut v: Vec<(usize, f64)> = self.division_teams(d).iter().map(|&t| { let (a, b) = self.strength(t); (t, a + b) }).collect();
            v.sort_by(|x, y| y.1.partial_cmp(&x.1).unwrap_or(std::cmp::Ordering::Equal).then(x.0.cmp(&y.0)));
            for (i, (t, _)) in v.iter().enumerate() { exp[*t] = i + 1; }
        }
        self.expected = exp;
    }

    /// Monta o relatório de encerramento com os dados ainda intactos da temporada.
    fn build_report(&self, tables: &[Vec<usize>]) -> serde_json::Value {
        use serde_json::json;
        let pj = |id: usize| { let p = &self.players[id]; json!({"id": id, "name": p.name, "pos": p.pos.label(), "age": p.age, "skill": p.skill, "goals": p.goals,
            "team": p.team.map(|t| self.teams[t].name.clone()).unwrap_or("Sem clube".into())}) };
        let score = |id: usize| self.players[id].skill * 10 + self.players[id].goals * 20;
        let active: Vec<usize> = self.players.iter().filter(|p| p.team.is_some() && !p.academy && !p.retired).map(|p| p.id).collect();
        let exp = |t: usize| self.expected.get(t).copied().filter(|&e| e > 0).unwrap_or(TEAMS_PER_DIV / 2);
        let divisions: Vec<_> = (0..DIVISIONS).map(|d| {
            let tb = &tables[d];
            let row = |t: usize| { let s = &self.teams[t].stats; json!({"id": t, "name": self.teams[t].name, "pts": s.pts, "w": s.w, "d": s.d, "l": s.l, "gf": s.gf, "ga": s.ga, "p": s.p}) };
            let top: Vec<usize> = active.iter().copied().filter(|&id| self.players[id].team.map(|t| self.teams[t].division) == Some(d)).collect();
            let scorer = top.iter().copied().max_by_key(|&id| (self.players[id].goals, self.players[id].skill, std::cmp::Reverse(id)));
            json!({"division": d, "champion": row(tb[0]), "runnerUp": row(tb[1]),
                "promoted": if d > 0 { tb[..PROMOTED].iter().map(|&t| row(t)).collect::<Vec<_>>() } else { vec![] },
                "relegated": if d + 1 < DIVISIONS { tb[TEAMS_PER_DIV - PROMOTED..].iter().map(|&t| row(t)).collect::<Vec<_>>() } else { vec![] },
                "table": tb.iter().map(|&t| row(t)).collect::<Vec<_>>(),
                "topScorer": scorer.map(pj)})
        }).collect();
        let user_div = self.managed.map(|m| self.teams[m].division).unwrap_or(0);
        let by = |v: &mut Vec<usize>| v.sort_by_key(|&id| (std::cmp::Reverse(score(id)), id));
        let mut all = active.clone(); by(&mut all);
        let top_scorer = active.iter().copied().max_by_key(|&id| (self.players[id].goals, self.players[id].skill, std::cmp::Reverse(id)));
        // melhor jogador: preferência para a elite (divisão 1)
        let best = all.iter().copied().filter(|&id| self.players[id].team.map(|t| self.teams[t].division) == Some(0)).next().or(all.first().copied());
        let revelation = all.iter().copied().find(|&id| self.players[id].age <= 21);
        let mut xi = vec![];
        for (pos, n) in [(Pos::G, 1), (Pos::D, 4), (Pos::M, 4), (Pos::A, 2)] {
            xi.extend(all.iter().copied().filter(|&id| self.players[id].pos == pos && self.players[id].team.map(|t| self.teams[t].division) == Some(user_div)).take(n).map(pj));
        }
        let mut best_mgr: Option<(i64, usize, usize)> = None;
        for d in 0..DIVISIONS { for (i, &t) in tables[d].iter().enumerate() {
            let over = exp(t) as i64 - (i + 1) as i64 + if i == 0 { 2 } else { 0 } + if d == 0 { 1 } else { 0 };
            if best_mgr.map_or(true, |b| over > b.0) { best_mgr = Some((over, t, i + 1)); }
        } }
        let manager = best_mgr.map(|(over, t, pos)| json!({"team": self.teams[t].name, "you": Some(t) == self.managed, "position": pos, "expected": exp(t), "over": over,
            "division": self.teams[t].division}));
        let user = self.managed.map(|m| {
            let d = self.teams[m].division;
            let pos = tables[d].iter().position(|&t| t == m).unwrap() + 1;
            let s = &self.teams[m].stats;
            let promoted = d > 0 && pos <= PROMOTED;
            let relegated = d + 1 < DIVISIONS && pos > TEAMS_PER_DIV - PROMOTED;
            let champion = pos == 1;
            let diff = exp(m) as f64 - pos as f64;
            let f = &self.finance;
            let fin_adj = if self.teams[m].budget < 0 { -2.0 } else if self.teams[m].budget > DIV_BUDGET[d] { 0.5 } else { 0.0 };
            let grade = (6.0 + diff * 0.6 + if promoted || (champion && d == 0) { 2.0 } else { 0.0 } - if relegated { 3.0 } else { 0.0 } + fin_adj).clamp(0.0, 10.0);
            let grade = (grade * 10.0).round() / 10.0;
            let (mood, text) = if grade >= 8.0 { ("eufórica", "A diretoria está eufórica! A torcida canta seu nome e o conselho já fala em renovação.") }
                else if grade >= 5.5 { ("satisfeita", "A diretoria está satisfeita com o trabalho e confia no planejamento para a próxima temporada.") }
                else if grade >= 3.5 { ("preocupada", "A diretoria está preocupada. Os resultados ficaram abaixo do esperado e a cobrança vai aumentar.") }
                else { ("furiosa", "A diretoria está furiosa. A permanência no cargo depende de uma reação imediata.") };
            let security = if grade >= 8.0 { "Total" } else if grade >= 5.5 { "Estável" } else if grade >= 3.5 { "Ameaçado" } else { "Por um fio" };
            let fate = if champion && d == 0 { "champion" } else if champion { "champion_up" } else if promoted { "promoted" } else if relegated { "relegated" } else { "stay" };
            json!({"team": self.teams[m].name, "id": m, "division": d, "position": pos, "expected": exp(m), "p": s.p, "w": s.w, "d": s.d, "l": s.l,
                "gf": s.gf, "ga": s.ga, "pts": s.pts, "deducted": s.deducted, "champion": champion, "promoted": promoted, "relegated": relegated, "fate": fate,
                "finance": f, "budget": self.teams[m].budget, "bankDebt": self.teams[m].bank_debt, "grade": grade, "mood": mood, "boardText": text, "security": security,
                "topScorer": self.squad(m).into_iter().filter(|&id| self.players[id].goals > 0).max_by_key(|&id| (self.players[id].goals, std::cmp::Reverse(id))).map(pj)})
        });
        json!({"season": self.season, "divisions": divisions, "awards": {"topScorer": top_scorer.map(pj), "bestPlayer": best.map(pj),
            "revelation": revelation.map(pj), "teamOfSeason": xi, "teamOfSeasonDivision": user_div, "bestManager": manager}, "user": user})
    }

    pub fn end_season(&mut self) {
        let tables: Vec<Vec<usize>> = (0..DIVISIONS).map(|d| self.table(d)).collect();
        let old_div: Vec<usize> = self.teams.iter().map(|t| t.division).collect();
        let mut news = vec![format!("Fim da temporada {}!", self.season)];
        let mut report = self.build_report(&tables);
        let mut retired_names: Vec<String> = vec![];
        let news_before = news.len();
        self.return_loans(&mut news);
        self.expire_contracts(&mut news);
        let expired: Vec<String> = news[news_before..].iter().filter_map(|n| n.strip_prefix("Contrato encerrado: ").map(|s| s.trim_end_matches(" deixa o clube").to_string())).collect();
        for d in 0..DIVISIONS {
            news.push(format!("Campeão da Divisão {}: {}", d + 1, self.teams[tables[d][0]].name));
            for (pos, &t) in tables[d].iter().enumerate() {
                let prize = DIV_PRIZE[d] * (TEAMS_PER_DIV - pos) as i64 / TEAMS_PER_DIV as i64;
                self.teams[t].budget += prize;
                if Some(t) == self.managed { self.finance.prizes += prize; }
            }
        }
        if let Some(m) = self.managed {
            report["user"]["finance"] = serde_json::to_value(&self.finance).unwrap();
            report["user"]["budget"] = serde_json::json!(self.teams[m].budget);
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
            let old = p.skill;
            p.skill = (p.skill + delta).clamp(10, 99);
            p.attrs.shift(p.skill - old);
            p.condition = 100;
            if p.team.is_none() { p.salary = salary_for(p.skill); }
            p.refusals = 0;
        }
        // aposentadorias com reposição por jovens da base
        for i in 0..self.players.len() {
            if self.players[i].age >= 36 && self.players[i].team.is_some() {
                let team = self.players[i].team.unwrap();
                let pos = self.players[i].pos;
                news.push(format!("{} se aposenta.", self.players[i].name));
                if Some(team) == self.managed { retired_names.push(format!("{} ({} anos)", self.players[i].name, self.players[i].age)); }
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
        for (i, t) in self.teams.iter_mut().enumerate() {
            t.stats = Stats::default();
            t.capacity = t.capacity.max(DIV_CAPACITY[t.division] / 2);
            // o preço do ingresso é mantido; ao mudar de divisão, é ajustado proporcionalmente e limitado à faixa da nova divisão
            let scaled = t.ticket_price * DIV_TICKET[t.division] / DIV_TICKET[old_div[i]];
            let (lo, hi) = Self::ticket_range(t.division);
            t.ticket_price = scaled.clamp(lo, hi);
        }
        self.academy_season(&mut news);
        self.refill_free_agents();
        self.season += 1;
        self.round = 0;
        self.finance = Finance::default();
        self.build_schedule();
        for t in 0..self.teams.len() { self.auto_lineup(t); }
        self.news = news;
        self.compute_expected();
        if let Some(m) = self.managed {
            let s = self.season;
            let expiring: Vec<String> = self.squad(m).iter().filter(|&&id| self.players[id].contract_until <= s && self.players[id].loan_from.is_none())
                .map(|&id| format!("{} ({}, {})", self.players[id].name, self.players[id].pos.label(), self.players[id].skill)).collect();
            let prize = report["user"]["finance"]["prizes"].clone();
            report["next"] = serde_json::json!({"season": s, "division": self.teams[m].division, "budget": self.teams[m].budget, "prize": prize,
                "expected": self.expected[m], "retirements": retired_names, "expiredContracts": expired, "expiringContracts": expiring,
                "ticketPrice": self.teams[m].ticket_price, "wageBill": self.squad(m).iter().map(|&id| self.players[id].salary).sum::<i64>()});
        }
        let u = &report["user"];
        self.history.push(serde_json::json!({"season": report["season"],
            "champions": report["divisions"].as_array().map(|v| v.iter().map(|d| d["champion"]["name"].clone()).collect::<Vec<_>>()).unwrap_or_default(),
            "team": u["team"], "division": u["division"], "position": u["position"], "expected": u["expected"], "pts": u["pts"], "grade": u["grade"], "fate": u["fate"],
            "topScorer": report["awards"]["topScorer"]["name"]}));
        if self.history.len() > 200 { self.history.remove(0); }
        self.last_report = Some(report);
        self.report_pending = self.managed.is_some();
    }

    pub fn buy_price(&self, id: usize) -> i64 { let v = player_value(&self.players[id]); if self.players[id].team.is_none() { v / 5 } else { v * 11 / 10 } }
    pub fn sell_price(&self, id: usize) -> i64 { player_value(&self.players[id]) * 85 / 100 }

    pub fn buy(&mut self, buyer: usize, id: usize) -> Result<String, String> {
        let p = self.players.get(id).ok_or("Jogador inexistente")?;
        if p.team == Some(buyer) { return Err("Jogador já é seu".into()); }
        if p.academy { return Err("Jogadores da base de outros clubes não estão à venda".into()); }
        if p.retired { return Err("Jogador aposentado".into()); }
        if p.loan_from.is_some() { return Err("Jogador emprestado não pode ser negociado".into()); }
        if self.squad(buyer).len() >= MAX_SQUAD { return Err(format!("Elenco cheio (máx. {})", MAX_SQUAD)); }
        if let Some(seller) = p.team { if self.squad(seller).len() <= MIN_SQUAD { return Err("O clube vendedor não pode liberar mais jogadores".into()); } }
        let price = self.buy_price(id);
        if self.teams[buyer].budget < price { return Err("Orçamento insuficiente".into()); }
        let seller = p.team;
        self.teams[buyer].budget -= price;
        if let Some(s) = seller { self.teams[s].budget += price; self.teams[s].lineup.retain(|&x| x != id); }
        if Some(buyer) == self.managed { self.finance.transfers_out += price; }
        self.players[id].morale = 65;
        self.sign(buyer, id, 3);
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
            let min = if Some(t) == self.managed { 13 } else { 16 };
            while self.squad(t).len() < min {
                // contrata o melhor livre que couber no bolso (ou o mais barato)
                let budget = self.teams[t].budget;
                let free: Vec<usize> = self.free_agents();
                let best = free.iter().copied().filter(|&id| self.buy_price(id) <= budget / 4).max_by_key(|&id| self.players[id].skill)
                    .or_else(|| free.iter().copied().min_by_key(|&id| self.buy_price(id)));
                let Some(id) = best else { break };
                self.teams[t].budget -= self.buy_price(id);
                if Some(t) == self.managed { self.finance.transfers_out += self.buy_price(id); self.news.push(format!("Elenco curto: a diretoria contratou {} (livre)", self.players[id].name)); }
                self.sign(t, id, 2);
            }
        }

        // clubes ricos investem em reforços (faz o dinheiro circular entre as divisões)
        for t in 0..self.teams.len() {
            if Some(t) == self.managed || self.squad(t).len() >= 24 { continue; }
            let div = self.teams[t].division;
            if self.teams[t].budget < 2 * DIV_BUDGET[div] || self.rng.f64() > 0.2 { continue; }
            let mut skills: Vec<i32> = self.squad(t).iter().map(|&i| self.players[i].skill).collect();
            skills.sort();
            let median = skills[skills.len() / 2];
            let budget = self.teams[t].budget / 3;
            let target = self.players.iter().filter(|p| !p.retired && !p.academy && p.loan_from.is_none() && p.team != Some(t) && p.team != self.managed
                && p.skill > median && p.age <= 30 && p.team.map_or(true, |o| self.squad(o).len() > MIN_SQUAD + 2))
                .map(|p| p.id).filter(|&id| self.buy_price(id) <= budget).max_by_key(|&id| self.players[id].skill);
            if let Some(id) = target {
                if self.buy(t, id).is_ok() { self.news.push(format!("Mercado: {} reforça o {}", self.players[id].name, self.teams[t].name)); }
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

    /// Assina contrato com o salário pedido.
    fn sign(&mut self, team: usize, id: usize, years: u32) {
        let wage = self.wage_demand(id, years, Some(team));
        let season = self.season;
        let p = &mut self.players[id];
        p.team = Some(team); p.salary = wage; p.contract_until = season + years; p.refusals = 0;
    }

    /// Salário pedido por rodada para um contrato de `years` temporadas.
    pub fn wage_demand(&self, id: usize, years: u32, team: Option<usize>) -> i64 {
        let p = &self.players[id];
        let mut f = 1.2 - p.morale.clamp(0, 100) as f64 / 250.0; // 0.8 .. 1.2
        let extra = years.saturating_sub(1) as f64;
        f *= if p.age >= 30 { 1.0 + 0.06 * extra } else if p.age <= 24 { 1.0 - 0.02 * extra } else { 1.0 };
        f *= 1.0 + 0.07 * p.refusals as f64;
        // clubes de divisões mais altas pagam mais
        if let Some(t) = team { f *= [1.25, 1.1, 1.0, 0.9][self.teams[t].division]; }
        ((salary_for(p.skill) as f64 * f / 1000.0).round() as i64).max(1) * 1000
    }

    /// Proposta de renovação. Se recusada, devolve a contraproposta.
    pub fn renew(&mut self, team: usize, id: usize, years: u32, wage: i64) -> Result<String, String> {
        let p = self.players.get(id).ok_or("Jogador inexistente")?;
        if p.team != Some(team) || p.academy || p.loan_from.is_some() { return Err("Só é possível renovar com jogadores do seu elenco".into()); }
        if !(1..=MAX_CONTRACT_YEARS).contains(&years) { return Err(format!("Contrato de 1 a {MAX_CONTRACT_YEARS} temporadas")); }
        if p.refusals >= MAX_REFUSALS { return Err(format!("{} não quer mais negociar nesta temporada", p.name)); }
        let demand = self.wage_demand(id, years, Some(team));
        let season = self.season;
        let p = &mut self.players[id];
        if wage >= demand {
            p.salary = wage; p.contract_until = season + years; p.refusals = 0;
            Ok(format!("{} renovou até a temporada {} por R$ {}/rodada", p.name, p.contract_until, wage))
        } else {
            p.refusals += 1;
            p.morale = (p.morale - 3).max(0);
            if p.refusals >= MAX_REFUSALS { Err(format!("{} recusou e encerrou as negociações nesta temporada", p.name)) }
            else { Err(format!("{} recusou. Pede pelo menos R$ {}/rodada (tentativas restantes: {})", p.name, demand, MAX_REFUSALS - p.refusals)) }
        }
    }

    /// Contratos que terminam nesta temporada: IA renova os úteis; o clube do usuário perde quem não renovou.
    fn expire_contracts(&mut self, news: &mut Vec<String>) {
        for id in 0..self.players.len() {
            let p = &self.players[id];
            let Some(t) = p.team else { continue };
            if p.academy || p.contract_until > self.season { continue; }
            if Some(t) == self.managed {
                news.push(format!("Contrato encerrado: {} deixa o clube", p.name));
                let p = &mut self.players[id];
                p.team = None; p.contract_until = 0; p.salary = salary_for(p.skill);
                self.teams[t].lineup.retain(|&x| x != id);
            } else {
                let mut skills: Vec<i32> = self.squad(t).iter().map(|&i| self.players[i].skill).collect();
                skills.sort();
                let median = skills.get(skills.len() / 2).copied().unwrap_or(0);
                let keep = (p.skill >= median - 3 && p.age < 33) || self.squad(t).len() <= 16;
                if keep {
                    let years = self.rng.range(1, 3) as u32;
                    self.sign(t, id, years);
                } else {
                    let p = &mut self.players[id];
                    p.team = None; p.contract_until = 0; p.salary = salary_for(p.skill);
                    self.teams[t].lineup.retain(|&x| x != id);
                }
            }
        }
    }

    /// Ajustes após carregar saves de versões antigas.
    pub fn normalize(&mut self) {
        let s = self.season;
        for p in self.players.iter_mut() { if p.team.is_some() && !p.academy && p.contract_until == 0 { p.contract_until = s + 1; } }
        let mut rng = Rng(self.rng.0 ^ 0xA77);
        for p in self.players.iter_mut() { if p.attrs == Attrs::default() { p.attrs = Attrs::generate(&mut rng, p.pos, p.skill); } }
        // saves antigos: jogadores esgotados (0%) recebem uma recuperação imediata
        for p in self.players.iter_mut() { if p.condition < 60 { p.condition = recover(p.condition as f64, p.attrs.stamina); } }
        if self.expected.len() != self.teams.len() { self.compute_expected(); }
    }

    // ------------------------------------------------ JSON para a interface
    fn player_json(&self, p: &Player) -> serde_json::Value {
        serde_json::json!({"id": p.id, "name": p.name, "pos": p.pos.label(), "skill": p.skill, "age": p.age, "salary": p.salary,
            "value": player_value(p), "team": p.team, "teamName": p.team.map(|t| self.teams[t].name.clone()).unwrap_or("Sem clube".into()),
            "goals": p.goals, "buyPrice": self.buy_price(p.id), "sellPrice": self.sell_price(p.id),
            "yellows": p.yellows, "suspended": p.suspended, "injured": p.injured, "morale": p.morale,
            "loanFee": self.loan_fee(p.id), "loanFrom": p.loan_from.map(|t| self.teams[t].name.clone()),
            "contractUntil": p.contract_until, "refusals": p.refusals, "attrs": p.attrs, "condition": p.condition})
    }

    /// Estado das partidas ao vivo de uma divisão.
    pub fn live_json(&self, div: usize) -> serde_json::Value {
        serde_json::Value::Array(self.live.iter().filter(|m| m.division == div).map(|m| { let bench: Vec<Vec<serde_json::Value>> = [0usize, 1].iter().map(|&s| if Some(if s == 0 { m.home } else { m.away }) == self.managed {
                self.bench(m, s).iter().map(|&id| self.player_json(&self.players[id])).collect::<Vec<_>>() } else { vec![] }).collect(); serde_json::json!({
            "home": m.home, "away": m.away, "homeName": self.teams[m.home].name, "awayName": self.teams[m.away].name,
            "hg": m.hg, "ag": m.ag, "minute": m.minute, "events": m.events, "subs": m.subs, "bench": bench,
            "attendance": m.attendance, "receipts": m.receipts, "capacity": self.teams[m.home].capacity,
            "booked": m.booked, "sentOff": m.reds.iter().map(|r| r.0).collect::<Vec<_>>(), "hurt": m.injuries.iter().map(|r| r.0).collect::<Vec<_>>(),
            "outIds": m.out, "outPlayers": m.out.iter().map(|&id| serde_json::json!({"id": id, "name": self.players[id].name, "pos": self.players[id].pos.label(), "team": self.players[id].team})).collect::<Vec<_>>(),
            "tactics": [&self.teams[m.home].tactic, &self.teams[m.away].tactic], "formations": [&self.teams[m.home].formation, &self.teams[m.away].formation],
            "energy": m.energy.iter().map(|(k, v)| (k.to_string(), serde_json::json!(v))).collect::<serde_json::Map<String, serde_json::Value>>(),

            "on": [m.on[0].iter().map(|&id| self.player_json(&self.players[id])).collect::<Vec<_>>(),
                   m.on[1].iter().map(|&id| self.player_json(&self.players[id])).collect::<Vec<_>>()]}) }).collect())
    }

    /// Ficha somente leitura de qualquer clube.
    pub fn team_json(&self, t: usize) -> serde_json::Value {
        let team = &self.teams[t];
        let d = team.division;
        let pos = self.table(d).iter().position(|&x| x == t).unwrap_or(0) + 1;
        let (atk, def) = self.strength(t);
        let order = |p: &Pos| match p { Pos::G => 0, Pos::D => 1, Pos::M => 2, Pos::A => 3 };
        let mut squad = self.squad(t);
        squad.sort_by_key(|&id| (order(&self.players[id].pos), -self.players[id].skill));
        // escalação provável: a mesma regra usada no início da rodada
        let probable = if Some(t) == self.managed && self.lineup_valid(t) { team.lineup.clone() } else { self.pick_lineup(t) };
        let roles = self.assign_roles(t, &probable);
        let mut xi: Vec<(usize, Pos)> = roles.clone();
        xi.sort_by_key(|(id, r)| (order(r), -self.players[*id].skill));
        let unavailable: Vec<usize> = squad.iter().copied().filter(|&id| !self.players[id].available()).collect();
        let mut scorers: Vec<usize> = squad.iter().copied().filter(|&id| self.players[id].goals > 0).collect();
        scorers.sort_by_key(|&id| -self.players[id].goals);
        let s = &team.stats;
        serde_json::json!({"id": t, "name": team.name, "division": d, "position": pos, "budget": team.budget, "capacity": team.capacity,
            "ticketPrice": team.ticket_price, "academyLevel": team.academy_level, "form": team.form, "formation": team.formation, "tactic": team.tactic,
            "pressing": team.pressing, "attack": (atk * 10.0).round() / 10.0, "defense": (def * 10.0).round() / 10.0, "morale": self.team_morale(t),
            "managed": Some(t) == self.managed, "expected": self.expected.get(t).copied(),
            "stats": {"p": s.p, "w": s.w, "d": s.d, "l": s.l, "gf": s.gf, "ga": s.ga, "pts": s.pts},
            "wageBill": squad.iter().map(|&id| self.players[id].salary).sum::<i64>(),
            "lineup": xi.iter().map(|(id, r)| { let mut v = self.player_json(&self.players[*id]); v["role"] = serde_json::json!(r.label()); v }).collect::<Vec<_>>(),
            "unavailable": unavailable.iter().map(|&id| self.player_json(&self.players[id])).collect::<Vec<_>>(),
            "squad": squad.iter().map(|&id| self.player_json(&self.players[id])).collect::<Vec<_>>(),
            "scorers": scorers.iter().take(5).map(|&id| self.player_json(&self.players[id])).collect::<Vec<_>>()})
    }

    pub fn state_json(&self) -> serde_json::Value {
        let tables: Vec<_> = (0..DIVISIONS).map(|d| self.table(d).iter().map(|&t| {
            let s = &self.teams[t].stats;
            serde_json::json!({"id": t, "name": self.teams[t].name, "p": s.p, "w": s.w, "d": s.d, "l": s.l, "gf": s.gf, "ga": s.ga, "pts": s.pts, "ded": s.deducted, "form": self.teams[t].form})
        }).collect::<Vec<_>>()).collect();
        let mut next: Vec<serde_json::Value> = vec![];
        if self.round < ROUNDS { for d in 0..DIVISIONS { for &(h, a) in &self.schedule[d][self.round] {
            next.push(serde_json::json!({"division": d, "home": h, "away": a, "homeName": self.teams[h].name, "awayName": self.teams[a].name}));
        } } }
        let managed = self.managed.map(|m| {
            let t = &self.teams[m];
            serde_json::json!({"id": m, "name": t.name, "division": t.division, "budget": t.budget, "capacity": t.capacity, "morale": self.team_morale(m),
                "ticketPrice": t.ticket_price, "ticketRange": Self::ticket_range(t.division), "formation": t.formation, "lineup": t.lineup,
                "squad": self.squad(m).iter().map(|&id| self.player_json(&self.players[id])).collect::<Vec<_>>(),
                "wageBill": self.squad(m).iter().map(|&id| self.players[id].salary).sum::<i64>(), "finance": self.finance,
                "construction": t.construction, "stadiumUpkeep": self.stadium_upkeep(m), "expectedAttendance": self.demand(m).min(t.capacity as f64) as i64,
                "stadiumOptions": STADIUM_OPTIONS.iter().map(|&(s, r)| serde_json::json!({"seats": s, "rounds": r, "cost": Self::stadium_cost(s)})).collect::<Vec<_>>(),
                "bankDebt": t.bank_debt, "bankPayment": t.bank_payment, "bankLimit": self.bank_limit(m),
                "loanedOut": self.players.iter().filter(|p| p.loan_from == Some(m)).map(|p| self.player_json(p)).collect::<Vec<_>>(),
                "tactic": t.tactic, "pressing": t.pressing, "mentalities": MENTALITIES,
                "debtRounds": t.debt_rounds, "lastRound": self.last_round,
                "academyLevel": t.academy_level, "academyUpgradeCost": self.academy_upgrade_cost(m), "academyUpkeep": self.academy_upkeep(m),
                "academy": self.academy(m).iter().map(|&id| self.player_json(&self.players[id])).collect::<Vec<_>>()})
        });
        let teams: Vec<_> = self.teams.iter().map(|t| serde_json::json!({"id": t.id, "name": t.name, "division": t.division, "budget": t.budget})).collect();
        let mut scorers: Vec<&Player> = self.players.iter().filter(|p| p.goals > 0).collect();
        scorers.sort_by_key(|p| -p.goals);
        serde_json::json!({"season": self.season, "round": self.round, "rounds": ROUNDS, "tables": tables, "next": next, "liveActive": !self.live.is_empty(),
            "fired": self.fired, "jobOffers": self.job_offers().iter().map(|&t| serde_json::json!({"id": t, "name": self.teams[t].name, "division": self.teams[t].division, "budget": self.teams[t].budget})).collect::<Vec<_>>(),
            "managed": managed, "teams": teams, "news": self.news, "formations": FORMATIONS,
            "reportPending": self.report_pending, "report": self.last_report, "history": self.history,
            "expected": self.managed.and_then(|m| self.expected.get(m).copied()), "promoted": PROMOTED, "teamsPerDiv": TEAMS_PER_DIV,
            "scorers": scorers.iter().take(15).map(|p| self.player_json(p)).collect::<Vec<_>>()})
    }

    /// Política de um técnico humano "razoável", usada para calibrar a economia.
    /// Ajusta ingresso, renova contratos, compra/vende, investe em estádio e base.
    pub fn human_policy(&mut self, t: usize) {
        let refp = DIV_TICKET[self.teams[t].division];
        // ingresso: maximiza a receita esperada
        let (lo, hi) = Self::ticket_range(self.teams[t].division);
        let mut best = (refp, 0.0);
        let mut p = lo;
        while p <= hi {
            self.teams[t].ticket_price = p;
            let rev = self.demand(t).min(self.teams[t].capacity as f64) * p as f64;
            if rev > best.1 { best = (p, rev); }
            p += (refp / 10).max(1);
        }
        self.teams[t].ticket_price = best.0;
        let wage_bill: i64 = self.squad(t).iter().map(|&i| self.players[i].salary).sum();
        let reserve = wage_bill * 20;
        let mut skills: Vec<i32> = self.squad(t).iter().map(|&i| self.players[i].skill).collect();
        skills.sort();
        let median = skills.get(skills.len() / 2).copied().unwrap_or(50);
        // renovações (perto do fim da temporada)
        if self.round + 3 >= ROUNDS {
            for id in self.squad(t) {
                let p = &self.players[id];
                if p.loan_from.is_some() || p.contract_until > self.season { continue; }
                if p.skill >= median - 2 || p.age < 24 || self.squad(t).len() <= 18 {
                    let years = if p.age < 28 { 3 } else { 1 };
                    let w = self.wage_demand(id, years, Some(t));
                    // não aceita pedidas muito acima do salário atual, exceto para destaques
                    if w <= self.players[id].salary * 5 / 4 || self.players[id].skill >= median + 5 || self.squad(t).len() <= 18 { let _ = self.renew(t, id, years, w); }
                }
            }
        }
        // vende excedentes / alivia dívida
        while self.squad(t).len() > 22 || (self.teams[t].budget < 0 && self.squad(t).len() > 16) {
            let cand = self.squad(t).into_iter().filter(|&i| self.players[i].loan_from.is_none())
                .min_by_key(|&i| if self.teams[t].budget < 0 { -self.players[i].salary } else { self.players[i].skill as i64 });
            match cand { Some(id) if self.sell(t, id).is_ok() => {}, _ => break }
        }
        // compra um reforço se houver folga
        let free = self.teams[t].budget - reserve;
        if free > 0 && self.squad(t).len() < 24 {
            let target = self.players.iter().filter(|p| !p.retired && !p.academy && p.loan_from.is_none() && p.team != Some(t)
                && p.skill > median + 3 && p.age <= 29 && p.team.map_or(true, |o| self.squad(o).len() > MIN_SQUAD))
                .map(|p| p.id).filter(|&id| self.buy_price(id) + self.wage_demand(id, 3, Some(t)) * ROUNDS as i64 <= free / 2).max_by_key(|&id| self.players[id].skill);
            if let Some(id) = target { let _ = self.buy(t, id); }
        }
        // investimentos
        let free = self.teams[t].budget - reserve;
        if self.teams[t].construction.is_none() {
            self.teams[t].ticket_price = refp;
            let wants = self.demand(t) > self.teams[t].capacity as f64 * 1.05;
            self.teams[t].ticket_price = best.0;
            if wants && free > 2 * Self::stadium_cost(5000) { let _ = self.upgrade_stadium(t, 1); }
        }
        let free = self.teams[t].budget - reserve;
        if self.teams[t].academy_level < 3 && free > 3 * self.academy_upgrade_cost(t) { let _ = self.upgrade_academy(t); }
        for id in self.academy(t) { if self.players[id].skill > median && self.squad(t).len() < 22 { let _ = self.promote_youth(t, id); } }
        self.auto_lineup(t);
    }

    pub fn set_ticket_price(&mut self, team: usize, price: i64) -> Result<String, String> {
        let (lo, hi) = Self::ticket_range(self.teams[team].division);
        let p = price.clamp(lo, hi);
        self.teams[team].ticket_price = p;
        Ok(if p != price { format!("Preço ajustado para R$ {p} (faixa da divisão: R$ {lo} a R$ {hi})") } else { format!("Preço do ingresso: R$ {p}") })
    }

    /// Faixa de preço de ingresso aceita para uma divisão.
    pub fn ticket_range(div: usize) -> (i64, i64) { (DIV_TICKET[div] / 2, DIV_TICKET[div] * 3) }

    /// Simula um técnico humano por várias temporadas. Retorna (temporada, divisão, caixa, demitido).
    pub fn human_run(seed: u64, team: usize, seasons: usize) -> Vec<(u32, usize, i64, bool)> {
        let mut g = Game::new(seed);
        g.managed = Some(team);
        let mut out = vec![];
        for _ in 0..seasons {
            for _ in 0..ROUNDS {
                if g.managed.is_none() { break; }
                g.human_policy(team);
                g.play_round();
            }
            out.push((g.season - 1, g.teams[team].division, g.teams[team].budget, g.fired));
            if g.fired { break; }
        }
        out
    }

    pub fn summary_json(&self) -> serde_json::Value {
        let m = self.managed.map(|t| &self.teams[t]);
        serde_json::json!({"team": m.map(|t| t.name.clone()).unwrap_or("Desempregado".into()), "division": m.map(|t| t.division + 1),
            "season": self.season, "round": self.round, "budget": m.map(|t| t.budget)})
    }

    pub fn market_json(&self, pos: &str, max_price: i64) -> serde_json::Value {
        let mut v: Vec<&Player> = self.players.iter().filter(|p| !p.retired && !p.academy && p.loan_from.is_none() && (p.team != self.managed || self.managed.is_none()))
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
        serde_json::from_str::<Game>(json).map(|mut g| { g.normalize(); FutManager { g } }).map_err(|e| JsValue::from_str(&format!("Save inválido: {e}")))
    }
    pub fn save(&self) -> String { serde_json::to_string(&self.g).unwrap() }
    pub fn state(&self) -> String { self.g.state_json().to_string() }
    /// O usuário viu o encerramento da temporada.
    pub fn ack_report(&mut self) { self.g.report_pending = false; }
    /// Ficha de qualquer clube (somente leitura).
    pub fn team(&self, id: usize) -> String {
        if id >= self.g.teams.len() { return "null".into(); }
        self.g.team_json(id).to_string()
    }
    /// Cartão de um jogador.
    pub fn player(&self, id: usize) -> String {
        if id >= self.g.players.len() || self.g.players[id].retired { return "null".into(); }
        let p = &self.g.players[id];
        let mut v = self.g.player_json(p);
        v["academy"] = serde_json::json!(p.academy);
        v["mine"] = serde_json::json!(p.team.is_some() && p.team == self.g.managed);
        v["season"] = serde_json::json!(self.g.season);
        v.to_string()
    }


    /// Resumo para a lista de saves (clube, temporada, rodada, caixa).
    pub fn summary(&self) -> String { self.g.summary_json().to_string() }
    pub fn choose_team(&mut self, team: usize) -> String {
        if team >= self.g.teams.len() { return res(Err("Time inválido".into())); }
        if self.g.fired && !self.g.job_offers().contains(&team) { return res(Err("Esse clube não fez proposta".into())); }
        self.g.fired = false;
        self.g.teams[team].debt_rounds = 0;
        self.g.finance = Finance::default();
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
        res(self.g.set_ticket_price(m, price as i64))
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
            "homeName": names(m.home), "awayName": names(m.away), "hg": m.hg, "ag": m.ag, "attendance": m.attendance, "receipts": m.receipts, "events": m.events})).collect()).to_string()
    }
    pub fn play_round(&mut self) -> String {
        let r = self.g.play_round();
        let names = |t: usize| self.g.teams[t].name.clone();
        serde_json::Value::Array(r.iter().map(|m| serde_json::json!({"division": m.division, "home": m.home, "away": m.away,
            "homeName": names(m.home), "awayName": names(m.away), "hg": m.hg, "ag": m.ag, "attendance": m.attendance, "receipts": m.receipts, "events": m.events})).collect()).to_string()
    }
    pub fn market(&self, pos: &str, max_price: f64) -> String { self.g.market_json(pos, max_price as i64).to_string() }
    pub fn buy(&mut self, id: usize) -> String { match self.g.managed { Some(m) => res(self.g.buy(m, id)), None => res(Err("Nenhum time".into())) } }
    pub fn sell(&mut self, id: usize) -> String { match self.g.managed { Some(m) => res(self.g.sell(m, id)), None => res(Err("Nenhum time".into())) } }
    pub fn promote_youth(&mut self, id: usize) -> String { match self.g.managed { Some(m) => res(self.g.promote_youth(m, id)), None => res(Err("Nenhum time".into())) } }
    pub fn release_youth(&mut self, id: usize) -> String { match self.g.managed { Some(m) => res(self.g.release_youth(m, id)), None => res(Err("Nenhum time".into())) } }
    /// Salário pedido (JSON) para renovar/contratar por `years` temporadas.
    pub fn wage_demand(&self, id: usize, years: u32) -> String {
        if id >= self.g.players.len() { return "0".into(); }
        self.g.wage_demand(id, years, self.g.managed).to_string()
    }
    pub fn renew(&mut self, id: usize, years: u32, wage: f64) -> String { match self.g.managed { Some(m) => res(self.g.renew(m, id, years, wage as i64)), None => res(Err("Nenhum time".into())) } }
    pub fn set_tactic(&mut self, mentality: &str, pressing: bool) -> String { match self.g.managed { Some(m) => res(self.g.set_tactic(m, mentality, pressing)), None => res(Err("Nenhum time".into())) } }
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
            for &t in &g.division_teams(d) {
                let venues: Vec<bool> = g.schedule[d].iter().map(|r| r.iter().any(|&(h, _)| h == t)).collect();
                assert_eq!(venues.iter().filter(|&&h| h).count(), TEAMS_PER_DIV - 1, "metade dos jogos em casa");
                let max_run = venues.windows(4).filter(|w| w.iter().all(|&x| x == w[0])).count();
                assert_eq!(max_run, 0, "time {t} com 4+ jogos seguidos no mesmo mando: {venues:?}");
            }
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
            assert_eq!(s.p, 10); assert_eq!(s.w + s.d + s.l, 10); assert_eq!(s.pts, s.w * 3 + s.d - s.deducted);
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
        while g.step() {}
        // remove eventos sorteados na partida para esses jogadores e injeta os do teste
        let ours = [y, r, i];
        g.live[0].booked.retain(|x| !ours.contains(x));
        g.live[0].reds.retain(|x| !ours.contains(&x.0));
        g.live[0].injuries.retain(|x| !ours.contains(&x.0));
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
    fn contracts_negotiation_and_expiry() {
        let mut g = Game::new(81);
        g.managed = Some(6);
        let sq = g.squad(6);
        let p = sq[0];
        assert!(g.players.iter().filter(|p| p.team.is_some() && !p.academy).all(|p| (1..=4).contains(&p.contract_until)));
        let demand = g.wage_demand(p, 3, Some(6));
        let err = g.renew(6, p, 3, demand / 2).unwrap_err();
        assert!(err.contains("Pede"), "{err}");
        assert!(g.wage_demand(p, 3, Some(6)) > demand, "recusa encarece a pedida");
        assert!(g.renew(6, p, 9, demand * 10).is_err(), "duração inválida");
        let d2 = g.wage_demand(p, 3, Some(6));
        g.renew(6, p, 3, d2).unwrap();
        assert_eq!(g.players[p].contract_until, g.season + 3);
        assert_eq!(g.players[p].salary, d2);
        // três recusas encerram a negociação
        let q = sq[1];
        for _ in 0..3 { let _ = g.renew(6, q, 1, 1000); }
        assert!(g.renew(6, q, 1, 100_000_000).unwrap_err().contains("não quer"));
        // habilidade maior => pedida maior
        let mut sorted = sq.clone();
        sorted.sort_by_key(|&i| g.players[i].skill);
        let (lo, hi) = (sorted[2], sorted[sorted.len() - 1]);
        g.players[lo].morale = 50; g.players[hi].morale = 50; g.players[lo].refusals = 0; g.players[hi].refusals = 0;
        if g.players[hi].skill > g.players[lo].skill + 5 { assert!(g.wage_demand(hi, 2, Some(6)) > g.wage_demand(lo, 2, Some(6))); }
        // expiração no fim da temporada
        let leaving = sq[2];
        g.players[leaving].contract_until = 1;
        for _ in 0..ROUNDS { g.play_round(); }
        assert_ne!(g.players[leaving].team, Some(6));
        assert_eq!(g.players[p].team, Some(6));
        assert!(g.players.iter().filter(|p| p.team.is_some() && !p.academy).all(|p| p.contract_until >= g.season));
        for t in 0..g.teams.len() { if t != 6 { assert!(g.squad(t).len() >= MIN_SQUAD, "time {t} ficou com elenco curto"); } }
    }

    #[test]
    fn tactics_change_balance() {
        let mut g = Game::new(91);
        let (a0, d0) = g.strength(3);
        g.set_tactic(3, "ofensiva", false).unwrap();
        let (a1, d1) = g.strength(3);
        assert!(a1 > a0 && d1 < d0);
        g.set_tactic(3, "defensiva", true).unwrap();
        let (a2, d2) = g.strength(3);
        assert!(a2 < a0 && d2 > d0);
        assert!(g.set_tactic(3, "maluca", false).is_err());
        assert!(g.fatigue_rate(3) > 1.0);
    }

    #[test]
    fn out_of_position_players_are_weaker() {
        let mut g = Game::new(92);
        let sq = g.squad(0);
        let pick = |pos: Pos, n: usize| sq.iter().copied().filter(|&i| g.players[i].pos == pos).take(n).collect::<Vec<_>>();
        let mut proper = pick(Pos::G, 1); proper.extend(pick(Pos::D, 4)); proper.extend(pick(Pos::M, 4)); proper.extend(pick(Pos::A, 2));
        let mut wrong = pick(Pos::G, 1); wrong.extend(pick(Pos::D, 6)); wrong.extend(pick(Pos::M, 4));
        g.teams[0].formation = "4-4-2".into();
        let roles = g.assign_roles(0, &wrong);
        assert_eq!(roles.iter().filter(|r| r.1 == Pos::A).count(), 2, "zagueiros improvisados no ataque");
        let (ap, _) = g.strength_of(0, &proper, None);
        let (aw, _) = g.strength_of(0, &wrong, None);
        assert!(aw < ap * 0.9, "ataque improvisado {aw} vs {ap}");
        // atributos coerentes com a posição
        for p in g.players.iter().filter(|p| p.pos == Pos::A) { assert!(p.attrs.finishing > p.attrs.keeping); }
        for p in g.players.iter().filter(|p| p.pos == Pos::G) { assert!(p.attrs.keeping >= p.attrs.finishing); }
    }

    #[test]
    fn fatigue_builds_and_recovers() {
        let mut g = Game::new(93);
        g.teams[0].pressing = true;
        g.start_round();
        while g.step() {}
        let m = g.live.iter().find(|m| m.home == 0 || m.away == 0).unwrap().clone();
        let side = if m.home == 0 { 0 } else { 1 };
        let outfield: Vec<usize> = m.on[side].iter().copied().filter(|&i| g.players[i].pos != Pos::G).collect();
        let avg = |ids: &[usize]| ids.iter().map(|i| m.energy[i]).sum::<f64>() / ids.len() as f64;
        let mine = avg(&outfield);
        assert!(mine < 85.0, "energia média {mine}");
        let other: Vec<usize> = m.on[1 - side].iter().copied().filter(|&i| g.players[i].pos != Pos::G && !g.teams[if side == 0 { m.away } else { m.home }].pressing).collect();
        if !other.is_empty() { assert!(mine < avg(&other) + 2.0); }
        let e = m.energy[&outfield[0]];
        g.finish_round();
        let p = outfield[0];
        assert_eq!(g.players[p].condition, recover(e, g.players[p].attrs.stamina), "recupera parte do desgaste");
        assert!(g.players[p].condition > e as i32);
        // jogador cansado rende menos
        let full = g.role_value(p, g.players[p].pos, 100.0);
        assert!(g.role_value(p, g.players[p].pos, 30.0) < full * 0.85);
    }

    /// Estatísticas de várias temporadas sem técnico humano (usado para calibrar a economia).
    pub fn season_report(seed: u64, seasons: usize) -> Vec<String> {
        let mut g = Game::new(seed);
        let mut out = vec![];
        for s in 0..seasons {
            let mut goals = 0u32; let mut games = 0u32;
            for _ in 0..ROUNDS { for m in g.play_round() { goals += m.hg + m.ag; games += 1; } }
            let mut line = format!("T{} gols/jogo {:.2} jogadores {} livres {}", s + 1, goals as f64 / games as f64, g.players.len(), g.free_agents().len());
            for d in 0..DIVISIONS {
                let mut b: Vec<i64> = g.division_teams(d).iter().map(|&t| g.teams[t].budget).collect();
                b.sort();
                let neg = b.iter().filter(|&&x| x < 0).count();
                line += &format!(" | D{} min {:.1}M med {:.1}M max {:.1}M neg {}", d + 1, b[0] as f64 / 1e6, b[b.len() / 2] as f64 / 1e6, b[b.len() - 1] as f64 / 1e6, neg);
            }
            out.push(line);
        }
        out
    }

    #[test]
    #[ignore]
    fn finance_report() { for l in season_report(2024, 8) { println!("{l}"); } }

    /// Times de referência (o de caixa mediano) em cada divisão.
    fn reference_teams(seed: u64) -> Vec<usize> {
        let g = Game::new(seed);
        (0..DIVISIONS).map(|d| { let mut v = g.division_teams(d); v.sort_by_key(|&t| g.teams[t].budget); v[v.len() / 2] }).collect()
    }

    #[test]
    #[ignore]
    fn human_report() {
        for seed in [7u64, 8, 9] {
            for (d, t) in reference_teams(seed).into_iter().enumerate() {
                let start = Game::new(seed).teams[t].budget;
                let r = Game::human_run(seed, t, 6);
                println!("seed {seed} D{} início {:.1}M -> {}", d + 1, start as f64 / 1e6,
                    r.iter().map(|(s, dv, b, f)| format!("T{s}:D{} {:.1}M{}", dv + 1, *b as f64 / 1e6, if *f { " DEMITIDO" } else { "" })).collect::<Vec<_>>().join(" "));
            }
        }
    }

    #[test]
    fn human_strategy_is_balanced() {
        for (d, t) in reference_teams(7).into_iter().enumerate() {
            let start = Game::new(7).teams[t].budget;
            let r = Game::human_run(7, t, 4);
            assert!(r.iter().all(|x| !x.3), "D{} demitido: {r:?}", d + 1);
            let end = r.last().unwrap().2;
            let scale = DIV_BUDGET[r.last().unwrap().1].max(start);
            assert!(end > -scale / 4, "D{} quebrou: {r:?}", d + 1);
            assert!(end < 6 * scale, "D{} enriqueceu demais: {r:?}", d + 1);
        }
    }


    #[test]
    fn economy_is_stable_over_seasons() {
        let mut g = Game::new(2025);
        for _ in 0..5 * ROUNDS { g.play_round(); }
        assert_eq!(g.season, 6);
        let neg = g.teams.iter().filter(|t| t.budget < 0).count();
        assert!(neg <= g.teams.len() / 5, "{neg} clubes no vermelho");
        assert!(g.teams.iter().all(|t| t.budget > -2 * DIV_BUDGET[t.division]), "nenhuma dívida explosiva");
        assert!(g.teams.iter().all(|t| g.squad(t.id).len() >= MIN_SQUAD));
        let mut med: Vec<Vec<i64>> = (0..DIVISIONS).map(|d| g.division_teams(d).iter().map(|&t| g.teams[t].budget).collect()).collect();
        for v in med.iter_mut() { v.sort(); }
        assert!(med[0][8] > med[3][8], "primeira divisão mais rica que a quarta");
        assert!(g.players.len() < 2400, "vagas de jogadores reaproveitadas: {}", g.players.len());
    }

    #[test]
    fn debt_consequences_for_user_and_ai() {
        let mut g = Game::new(94);
        g.managed = Some(40);
        g.teams[41].budget = -5_000_000;
        let sq41 = g.squad(41).len();
        g.teams[40].budget = -100_000;
        g.play_round();
        assert!(g.teams[40].budget < -100_000, "juros sobre saldo negativo");
        g.play_round();
        assert!(g.squad(41).len() < sq41, "IA endividada vende jogadores");
        assert!(g.buy(40, g.free_agents()[0]).is_err() || g.buy_price(g.free_agents()[0]) == 0);
        for _ in 0..FIRE_AFTER_ROUNDS { if g.managed.is_none() { break; } g.teams[40].budget = g.teams[40].budget.min(-100_000); g.play_round(); }
        assert!(g.fired && g.managed.is_none(), "técnico demitido");
        let offers = g.job_offers();
        assert!(!offers.is_empty());
        // o jogo continua sem técnico
        g.play_round();
    }

    #[test]
    fn debt_point_deductions() {
        let mut g = Game::new(111);
        let t = 41;
        g.managed = Some(0);
        for _ in 0..8 { g.teams[t].budget = -50_000_000; g.play_round(); }
        let s = &g.teams[t].stats;
        assert!(s.deducted >= DEBT_PENALTY_POINTS, "dívida profunda gera punição");
        assert_eq!(s.pts, s.w * 3 + s.d - s.deducted);
        let row = g.state_json()["tables"][g.teams[t].division].as_array().unwrap().iter().find(|r| r["id"] == t).unwrap().clone();
        assert_eq!(row["ded"], s.deducted);
        // o clube do usuário também é punido
        let mut g = Game::new(112);
        g.managed = Some(50);
        for _ in 0..8 { if g.managed.is_none() { break; } g.teams[50].budget = -2_000_000; g.play_round(); }
        assert!(g.teams[50].stats.deducted >= DEBT_PENALTY_POINTS);
        assert!(g.news.iter().any(|n| n.contains("Punição")) || g.teams[50].stats.deducted > 0);
    }

    #[test]
    fn ticket_price_persists_across_seasons() {
        let mut g = Game::new(121);
        // um time que fica, um que sobe e um que cai
        g.managed = Some(0);
        for t in 0..g.teams.len() { let (lo, hi) = Game::ticket_range(g.teams[t].division); g.teams[t].ticket_price = (lo + hi) / 2 + 1; }
        g.set_ticket_price(0, 1).unwrap();
        assert_eq!(g.teams[0].ticket_price, Game::ticket_range(g.teams[0].division).0, "limitado à faixa");
        g.set_ticket_price(0, 55).unwrap();
        let before: Vec<(usize, i64)> = g.teams.iter().map(|t| (t.division, t.ticket_price)).collect();
        for _ in 0..ROUNDS { g.play_round(); }
        for (i, t) in g.teams.iter().enumerate() {
            let (od, op) = before[i];
            let (lo, hi) = Game::ticket_range(t.division);
            assert!(t.ticket_price >= lo && t.ticket_price <= hi);
            if od == t.division { assert_eq!(t.ticket_price, op, "preço mantido"); }
            else { assert_eq!(t.ticket_price, (op * DIV_TICKET[t.division] / DIV_TICKET[od]).clamp(lo, hi), "preço ajustado na troca de divisão"); }
        }
        assert!(g.teams.iter().enumerate().any(|(i, t)| t.division != before[i].0));
    }

    #[test]
    fn attendance_and_receipts_per_match() {
        let mut g = Game::new(131);
        g.managed = Some(5);
        g.start_round();
        let live = g.live.clone();
        for m in &live {
            assert!(m.attendance > 0 && m.attendance <= g.teams[m.home].capacity);
            assert_eq!(m.receipts, m.attendance * g.teams[m.home].ticket_price);
        }
        let js = g.live_json(g.teams[5].division);
        assert!(js[0]["attendance"].as_i64().unwrap() > 0 && js[0]["receipts"].as_i64().unwrap() > 0);
        let budget_home: Vec<i64> = live.iter().map(|m| g.teams[m.home].budget).collect();
        let res = g.finish_round();
        for (i, m) in live.iter().enumerate() {
            let r = res.iter().find(|r| r.home == m.home).unwrap();
            assert_eq!((r.attendance, r.receipts), (m.attendance, m.receipts), "resultado mantém público/renda");
            let _ = budget_home[i];
        }
        let my = res.iter().find(|r| r.home == 5 || r.away == 5).unwrap();
        let lr = &g.last_round;
        assert_eq!(lr.tickets, if my.home == 5 { my.receipts } else { 0 });
        assert_eq!(lr.tv, DIV_TV[g.teams[5].division]);
        assert!(lr.salaries > 0);
    }

    #[test]
    fn team_viewer_and_form() {
        let mut g = Game::new(5);
        g.managed = Some(0);
        for _ in 0..7 { g.play_round(); }
        for t in 0..g.teams.len() {
            assert_eq!(g.teams[t].form.chars().count(), 5);
            assert!(g.teams[t].form.chars().all(|c| "VED".contains(c)));
        }
        let t = 17;
        let v = g.team_json(t);
        assert_eq!(v["id"], t);
        assert_eq!(v["squad"].as_array().unwrap().len(), g.squad(t).len());
        assert_eq!(v["lineup"].as_array().unwrap().len(), 11);
        assert!(v["lineup"].as_array().unwrap().iter().all(|p| p["role"].is_string() && p["condition"].is_i64()));
        // desfalques nunca aparecem na escalação provável
        let hurt = g.squad(t)[0];
        g.players[hurt].injured = 3;
        let v = g.team_json(t);
        assert!(v["lineup"].as_array().unwrap().iter().all(|p| p["injured"] == 0 && p["suspended"] == 0));
        assert!(v["unavailable"].as_array().unwrap().iter().any(|p| p["id"] == hurt));
        assert_eq!(v["lineup"].as_array().unwrap().len(), 11);

        let pos = v["position"].as_u64().unwrap() as usize;
        assert_eq!(g.table(g.teams[t].division)[pos - 1], t);
        assert!(v["attack"].as_f64().unwrap() > 0.0 && v["defense"].as_f64().unwrap() > 0.0);
        let st = g.state_json();
        assert_eq!(st["tables"][0][0]["form"].as_str().unwrap().len(), 5);
        // ao vivo: listas em campo e cartões expostos
        g.start_round();
        for _ in 0..90 { g.step(); }
        let live = g.live_json(0);
        let m = &live[0];
        assert!(m["booked"].is_array() && m["sentOff"].is_array() && m["outPlayers"].is_array());
        assert!(m["on"][1].as_array().unwrap().len() >= 9);
    }

    #[test]
    fn season_report_and_history() {

        let mut g = Game::new(77);
        g.managed = Some(20);
        assert_eq!(g.expected.len(), g.teams.len());
        let champ_expected = { for _ in 0..ROUNDS - 1 { g.play_round(); } assert!(g.last_report.is_none()); g.table(1)[0] };
        g.play_round();
        assert_eq!(g.season, 2);
        assert!(g.report_pending);
        let r = g.last_report.clone().unwrap();
        assert_eq!(r["season"], 1);
        assert_eq!(r["divisions"].as_array().unwrap().len(), DIVISIONS);
        let _ = champ_expected;
        assert_eq!(r["divisions"][0]["promoted"].as_array().unwrap().len(), 0);
        assert_eq!(r["divisions"][1]["promoted"].as_array().unwrap().len(), PROMOTED);
        assert_eq!(r["divisions"][3]["relegated"].as_array().unwrap().len(), 0);
        assert_eq!(r["awards"]["teamOfSeason"].as_array().unwrap().len(), 11);
        assert!(r["awards"]["topScorer"]["goals"].as_i64().unwrap() > 0);
        assert!(r["awards"]["revelation"]["age"].as_i64().unwrap() <= 21);
        let u = &r["user"];
        assert_eq!(u["p"], ROUNDS as i64);
        assert_eq!(u["w"].as_i64().unwrap() + u["d"].as_i64().unwrap() + u["l"].as_i64().unwrap(), ROUNDS as i64);
        let gr = u["grade"].as_f64().unwrap(); assert!((0.0..=10.0).contains(&gr));
        assert!(u["finance"]["prizes"].as_i64().unwrap() > 0);
        assert_eq!(r["next"]["prize"], u["finance"]["prizes"]);
        assert_eq!(r["next"]["division"].as_u64().unwrap() as usize, g.teams[20].division);
        assert_eq!(g.history.len(), 1);
        assert_eq!(g.history[0]["champions"].as_array().unwrap().len(), DIVISIONS);
        // persistência no save
        let s = serde_json::to_string(&g).unwrap();
        let g2: Game = serde_json::from_str(&s).unwrap();
        assert!(g2.report_pending && g2.history.len() == 1);
        let st = g.state_json();
        assert_eq!(st["reportPending"], true);
    }

    #[test]
    fn same_xi_all_season_keeps_fitness() {

        for (tactic, pressing, floor, avg_min, avg_max) in [("equilibrada", false, 60, 75.0, 92.0), ("ofensiva", true, 40, 60.0, 90.0)] {
            let mut g = Game::new(141);
            let t = 0;
            g.managed = Some(t);
            g.set_tactic(t, tactic, pressing).unwrap();
            // XI fixo, incluindo o jogador de menor resistência
            g.auto_lineup(t);
            let xi = g.teams[t].lineup.clone();
            let mut min_cond = 100;
            let mut avg_end = 0.0;
            for r in 0..ROUNDS - 1 {
                for &id in &xi { g.players[id].injured = 0; g.players[id].suspended = 0; }
                let f = g.teams[t].formation.clone();
                g.set_lineup(t, &f, &xi).unwrap();
                g.play_round();
                if r >= 5 {
                    for &id in &xi { if g.players[id].team == Some(t) { min_cond = min_cond.min(g.players[id].condition); } }
                }
                avg_end = xi.iter().map(|&id| g.players[id].condition as f64).sum::<f64>() / xi.len() as f64;
            }
            println!("{tactic}/pressão={pressing}: mínima {min_cond}, média final {avg_end:.1}");
            assert!(min_cond >= floor, "{tactic}/{pressing}: condição mínima {min_cond}");
            assert!(avg_end >= avg_min && avg_end <= avg_max, "{tactic}/{pressing}: média {avg_end}");
        }
        // save antigo com 0% se recupera ao carregar
        let mut g = Game::new(142);
        g.players[0].condition = 0;
        g.normalize();
        assert!(g.players[0].condition >= 55);
    }

    #[test]
    fn save_summary() {




        let mut g = Game::new(101);
        assert_eq!(g.summary_json()["team"], "Desempregado");
        g.managed = Some(7);
        g.play_round();
        let s = g.summary_json();
        assert_eq!(s["team"], g.teams[7].name.as_str());
        assert_eq!(s["round"], 1);
        assert_eq!(s["season"], 1);
        assert_eq!(s["budget"], g.teams[7].budget);
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
#[cfg(test)]
mod size_probe {
    #[test]
    #[ignore]
    fn save_size() {
        let mut g = super::Game::new(1);
        g.managed = Some(0);
        println!("inicial {}", serde_json::to_string(&g).unwrap().len());
        for _ in 0..super::ROUNDS * 3 { g.play_round(); }
        println!("3 temporadas {}", serde_json::to_string(&g).unwrap().len());
    }
}
