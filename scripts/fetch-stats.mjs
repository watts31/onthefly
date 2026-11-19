// Runs on GitHub's servers (GitHub Actions). Fetches team player stats, jersey numbers
// and special teams from the NHL's public API, and saves them to data/players.json,
// which the app reads. (Phones can't call the NHL API directly: it blocks other websites.)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
// Keep a copy of the team logo in the repo (the app turns it into its Home tab icon).
const LOGO = 'phi';
const TEAM_CODE = 'PHI';
if (!existsSync('data/logo.png')) {
  try {
    const r = await fetch(`https://a.espncdn.com/i/teamlogos/nhl/500/${LOGO}.png`);
    if (r.ok) { mkdirSync('data', { recursive: true }); writeFileSync('data/logo.png', Buffer.from(await r.arrayBuffer())); console.log('Saved logo'); }
  } catch (e) { console.warn('logo', e.message); }
}

const now = new Date();
const y = now.getUTCFullYear();
const sid = now.getUTCMonth() >= 8 ? `${y}${y + 1}` : `${y - 1}${y}`;
const get = async (u) => {
  const r = await fetch(u, { headers: { 'User-Agent': 'devils-in-the-details (personal app)' } });
  if (!r.ok) throw new Error(`${r.status} ${u}`);
  return r.json();
};
const q = (s) => encodeURIComponent(s);

const [club, roster, real, teams] = await Promise.all([
  get(`https://api-web.nhle.com/v1/club-stats/PHI/${sid}/2`).catch(() => get('https://api-web.nhle.com/v1/club-stats/PHI/now')),
  get('https://api-web.nhle.com/v1/roster/PHI/current').catch((e) => (console.warn(e.message), null)),
  get(`https://api.nhle.com/stats/rest/en/skater/realtime?limit=-1&cayenneExp=${q(`gameTypeId=2 and seasonId=${sid}`)}`).catch((e) => (console.warn(e.message), null)),
  get(`https://api.nhle.com/stats/rest/en/team/summary?limit=-1&cayenneExp=${q(`gameTypeId=2 and seasonId=${sid}`)}`).catch((e) => (console.warn(e.message), null)),
]);

const num = {}, byName = {};
for (const k of ['forwards', 'defensemen', 'goalies'])
  for (const p of roster?.[k] || []) {
    num[p.id] = p.sweaterNumber;
    byName[`${p.firstName?.default} ${p.lastName?.default}`] = p.sweaterNumber;
  }
const rt = {};
for (const r of real?.data || []) rt[r.playerId] = r;
const nm = (p) => `${(p.firstName?.default || '')[0] || ''}. ${p.lastName?.default || ''}`;

const sk = (club.skaters || []).map((p) => ({
  n: nm(p), num: num[p.playerId] ?? '', pos: p.positionCode, gp: p.gamesPlayed, g: p.goals, a: p.assists, pts: p.points,
  hit: rt[p.playerId]?.hits ?? null, blk: rt[p.playerId]?.blockedShots ?? null, sog: p.shots ?? null,
}));
const g = (club.goalies || []).map((p) => ({
  n: nm(p), num: num[p.playerId] ?? '', pos: 'G', gp: p.gamesPlayed, w: p.wins, gaa: p.goalsAgainstAverage, sv: p.savePercentage, so: p.shutouts,
}));
if (!sk.length) throw new Error('No skaters returned; keeping the previous file.');

let st = null;
const d = (teams?.data || []).filter((t) => t.powerPlayPct != null);
const me = d.find((t) => t.teamId === 4 || /Philadelphia/i.test(t.teamFullName || ''));
if (me && d.length >= 30) {
  const rk = (k) => 1 + d.filter((t) => t[k] > me[k]).length;
  st = { pp: +(me.powerPlayPct * 100).toFixed(1), ppR: rk('powerPlayPct'), pk: +(me.penaltyKillPct * 100).toFixed(1), pkR: rk('penaltyKillPct') };
}

const body = { season: sid, sk, g, st, nums: byName };
let old = null;
try { old = JSON.parse(readFileSync('data/players.json', 'utf8')); } catch {}
if (old) { delete old.updated; }
if (JSON.stringify(old) === JSON.stringify(body)) console.log('Players: no changes.');
else {
  mkdirSync('data', { recursive: true });
  writeFileSync('data/players.json', JSON.stringify({ updated: now.toISOString(), ...body }));
  console.log(`Saved ${sk.length} skaters, ${g.length} goalies, special teams: ${st ? 'yes' : 'no'}.`);
}

// ---------------- Season tab data: league ranks, playoff odds, how each game unfolded ----------------
await seasonData();
async function seasonData() {
  const TEAM = TEAM_CODE;
  let prev = {};
  try { prev = JSON.parse(readFileSync('data/season.json', 'utf8')); } catch {}
  const out = { ranks: prev.ranks || [], odds: prev.odds || { hist: [] }, games: prev.games || {} };
  // 1) Team stats vs the league (from the same NHL team summary used for special teams)
  if (me && d.length >= 30) {
    const M = [
      ['gf', 'Goals for / game', 'goalsForPerGame', 1, 2], ['ga', 'Goals against / game', 'goalsAgainstPerGame', -1, 2],
      ['sf', 'Shots for / game', 'shotsForPerGame', 1, 1], ['sa', 'Shots against / game', 'shotsAgainstPerGame', -1, 1],
      ['pp', 'Power play', 'powerPlayPct', 1, 'pct'], ['pk', 'Penalty kill', 'penaltyKillPct', 1, 'pct'],
      ['fo', 'Faceoffs', 'faceoffWinPct', 1, 'pct'], ['ptp', 'Points %', 'pointPct', 1, 'pct'],
    ];
    out.ranks = M.filter(([, , f]) => me[f] != null).map(([k, label, f, dir, fmt]) => {
      const vals = d.map((t) => t[f]).filter((v) => v != null);
      const r = 1 + d.filter((t) => (dir > 0 ? t[f] > me[f] : t[f] < me[f])).length;
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      return { k, label, v: me[f], r, of: d.length, avg, fmt };
    });
  }
  // 2) Playoff odds (MoneyPuck simulations): today's numbers + one value per day this season
  const MP = 'https://moneypuck.com/moneypuck/simulations/';
  const UA = { 'User-Agent': 'Mozilla/5.0 (personal app; daily odds)' };
  const rowFor = (csv) => {
    const L = csv.trim().split(/\r?\n/); const h = L[0].split(',');
    const r = L.map((l) => l.split(',')).find((c) => c[0] === 'ALL' && c[1] === TEAM);
    if (!r) return null; const o = Object.fromEntries(h.map((k, i) => [k, r[i]]));
    return { playoffs: +o.madePlayoffs, div: +o.wonDivision, cup: +o.wonCup, points: +o.points };
  };
  try { const r = await fetch(MP + 'simulations_recent.csv', { headers: UA }); if (r.ok) { const v = rowFor(await r.text()); if (v) out.odds.now = v; } } catch (e) { console.warn('odds', e.message); }
  const have = new Set(out.odds.hist.map((h) => h[0]));
  const start = new Date(Date.UTC(+sid.slice(0, 4), 9, 1));
  let fetched = 0;
  for (let t = start; t <= now && fetched < 80; t = new Date(t.getTime() + 864e5)) {
    const day = t.toISOString().slice(0, 10);
    if (have.has(day)) continue;
    fetched++;
    try {
      const r = await fetch(MP + `simulations_${day.replace(/-/g, '_')}.csv`, { headers: UA });
      if (!r.ok) continue;
      const v = rowFor(await r.text()); if (v) out.odds.hist.push([day, v.playoffs, v.points]);
    } catch {}
  }
  out.odds.hist.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  // 3) How each finished game unfolded (scored first? score after 2? OT/SO?) from the NHL game summary
  try {
    const sch = await get(`https://api-web.nhle.com/v1/club-schedule-season/${TEAM}/now`);
    let n = 0;
    for (const gm of sch.games || []) {
      if (gm.gameType !== 2 || !['OFF', 'FINAL'].includes(gm.gameState) || out.games[gm.id] || n >= 40) continue;
      n++;
      try {
        const L = await get(`https://api-web.nhle.com/v1/gamecenter/${gm.id}/landing`);
        const home = gm.homeTeam.abbrev === TEAM;
        const goals = (L.summary?.scoring || []).flatMap((p) => (p.goals || []).map((x) => ({ p: p.periodDescriptor?.number, team: x.teamAbbrev?.default || x.teamAbbrev, as: x.awayScore, hs: x.homeScore })));
        const mine = (sc) => (home ? sc.hs : sc.as), theirs = (sc) => (home ? sc.as : sc.hs);
        const after2 = goals.filter((x) => x.p <= 2).pop() || { as: 0, hs: 0 };
        const gf = home ? gm.homeTeam.score : gm.awayTeam.score, ga = home ? gm.awayTeam.score : gm.homeTeam.score;
        const end = gm.gameOutcome?.lastPeriodType || 'REG';
        out.games[gm.id] = { date: gm.gameDate, home, gf, ga, end,
          first: goals.length ? (goals[0].team === TEAM ? 'us' : 'them') : null,
          a2: [mine(after2), theirs(after2)] };
      } catch (e) { console.warn('game', gm.id, e.message); }
    }
  } catch (e) { console.warn('schedule', e.message); }
  const keyOf = (o) => JSON.stringify({ ...o, odds: { ...o.odds } });
  if (keyOf(out) === keyOf({ ranks: prev.ranks || [], odds: prev.odds || { hist: [] }, games: prev.games || {} })) { console.log('Season: no changes.'); return; }
  mkdirSync('data', { recursive: true });
  writeFileSync('data/season.json', JSON.stringify({ updated: now.toISOString(), ...out }));
  console.log('Season data saved:', out.ranks.length, 'ranks,', out.odds.hist.length, 'odds days,', Object.keys(out.games).length, 'games');
}
