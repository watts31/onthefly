// Runs on GitHub's servers: Phillies data from MLB's public Stats API -> data/mlb.json (+ player cards).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const TEAM_ID = 143, DIV_ID = 204, LEAGUE_ID = 104; // Phillies, NL East, National League
const API = 'https://statsapi.mlb.com/api/v1';
const get = async (u) => { const r = await fetch(API + u, { headers: { 'User-Agent': 'phillies-app (personal)' } }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
const now = new Date();
// season = most recent season that has started (MLB seasons run Mar–Oct)
const season = now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
const next = season + 1;
const out = { season, next, updated: now.toISOString() };

// teams (abbreviations, names) for logos/colours
const teams = (await get(`/teams?sportId=1&season=${season}`)).teams || [];
const ab = Object.fromEntries(teams.map((t) => [t.id, t.abbreviation]));
out.teams = Object.fromEntries(teams.map((t) => [t.abbreviation, { id: t.id, name: t.teamName, full: t.name, div: t.division?.name || '', league: t.league?.id }]));

// standings (both leagues) with splits
const st = await get(`/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason`);
out.standings = (st.records || []).map((r) => ({ div: r.division?.id, league: r.league?.id, teams: r.teamRecords.map((x) => ({
  ab: ab[x.team.id], w: x.wins, l: x.losses, pct: x.winningPercentage, gb: x.gamesBack, wcgb: x.wildCardGamesBack, dr: +x.divisionRank, wcr: x.wildCardRank ? +x.wildCardRank : null,
  rs: x.runsScored, ra: x.runsAllowed, streak: x.streak?.streakCode, clinch: x.clinchIndicator || '',
  splits: Object.fromEntries((x.records?.splitRecords || []).map((s) => [s.type, [s.wins, s.losses]])),
})) }));

// team stats vs league
const rank = (rows, key, dir) => { const mine = rows.find((r) => r.id === TEAM_ID); if (!mine || mine.s[key] == null) return null;
  const v = +mine.s[key]; const vals = rows.map((r) => +r.s[key]).filter((x) => !isNaN(x));
  return { v, r: 1 + vals.filter((x) => (dir > 0 ? x > v : x < v)).length, of: vals.length, avg: vals.reduce((a, b) => a + b, 0) / vals.length }; };
const ts = async (group) => ((await get(`/teams/stats?season=${season}&group=${group}&stats=season&sportIds=1`)).stats?.[0]?.splits || []).map((x) => ({ id: x.team.id, s: x.stat }));
const H = await ts('hitting'), P = await ts('pitching');
const perG = (rows, k) => rows.map((r) => ({ id: r.id, s: { ...r.s, [k + 'PG']: r.s.gamesPlayed ? r.s[k] / r.s.gamesPlayed : null } }));
const H2 = perG(perG(H, 'runs'), 'homeRuns');
out.ranks = [
  ['Runs / game', H2, 'runsPG', 1, 2], ['Batting avg', H, 'avg', 1, 'avg'], ['On-base + slugging', H, 'ops', 1, 'avg'], ['Home runs / game', H2, 'homeRunsPG', 1, 2],
  ['Stolen bases', H, 'stolenBases', 1, 0], ['Team ERA', P, 'era', -1, 2], ['WHIP', P, 'whip', -1, 2], ['Strikeouts / 9', P, 'strikeoutsPer9Inn', 1, 1], ['Saves', P, 'saves', 1, 0],
].map(([label, rows, k, dir, fmt]) => { const x = rank(rows, k, dir); return x && { label, fmt, ...x }; }).filter(Boolean);

// games (regular season + postseason) with linescores -> results + situational records
const sched = async (q) => ((await get(`/schedule?sportId=1&teamId=${TEAM_ID}&${q}&hydrate=linescore,team`)).dates || []).flatMap((d) => d.games);
const mapGame = (g) => { const home = g.teams.home.team.id === TEAM_ID, us = home ? g.teams.home : g.teams.away, them = home ? g.teams.away : g.teams.home;
  const inn = (g.linescore?.innings || []).map((i) => [home ? i.home?.runs ?? null : i.away?.runs ?? 0, home ? i.away?.runs ?? 0 : i.home?.runs ?? null]);
  return { pk: g.gamePk, date: g.officialDate || g.gameDate?.slice(0, 10), t: g.gameDate, type: g.gameType, opp: ab[them.team.id] || them.team.abbreviation, home,
    rs: us.score ?? null, ra: them.score ?? null, state: g.status?.abstractGameState, desc: g.seriesDescription || '', inn,
    h: [g.linescore?.teams?.[home ? 'home' : 'away']?.hits, g.linescore?.teams?.[home ? 'away' : 'home']?.hits],
    e: [g.linescore?.teams?.[home ? 'home' : 'away']?.errors, g.linescore?.teams?.[home ? 'away' : 'home']?.errors] }; };
out.games = (await sched(`season=${season}&gameType=R`)).map(mapGame);
out.post = (await sched(`season=${season}&gameType=F,D,L,W`)).map(mapGame);
out.upcoming = (await sched(`startDate=${next}-02-01&endDate=${next}-10-31&gameType=S,R`)).map(mapGame).slice(0, 40);

// players (40-man roster, season stats) + player cards (bio, season, career, last seasons)
const roster = (await get(`/teams/${TEAM_ID}/roster?rosterType=40Man&season=${next}`).catch(() => get(`/teams/${TEAM_ID}/roster?rosterType=40Man&season=${season}`))).roster || [];
const ids = roster.map((r) => r.person.id);
const ppl = ids.length ? (await get(`/people?personIds=${ids.join(',')}&hydrate=stats(group=[hitting,pitching],type=[season,career,yearByYear],season=${season})`)).people || [] : [];
const grab = (p, group, type) => (p.stats || []).find((s) => s.group?.displayName === group && s.type?.displayName === type);
const HK = ['gamesPlayed', 'atBats', 'runs', 'hits', 'doubles', 'triples', 'homeRuns', 'rbi', 'baseOnBalls', 'strikeOuts', 'stolenBases', 'avg', 'obp', 'slg', 'ops', 'plateAppearances'];
const PK = ['gamesPlayed', 'gamesStarted', 'wins', 'losses', 'saves', 'holds', 'inningsPitched', 'strikeOuts', 'baseOnBalls', 'era', 'whip', 'strikeoutsPer9Inn'];
const trim = (o, isP) => Object.fromEntries((isP ? PK : HK).filter((k) => o?.[k] != null).map((k) => [k, o[k]]));
out.players = ppl.map((p) => {
  const pos = p.primaryPosition?.abbreviation, isP = ['P', 'SP', 'RP', 'TWP'].includes(pos) || p.primaryPosition?.type === 'Pitcher';
  const g = isP ? 'pitching' : 'hitting';
  const seasonS = grab(p, g, 'season')?.splits?.[0]?.stat || {}, careerS = grab(p, g, 'career')?.splits?.[0]?.stat || {};
  const yby = (grab(p, g, 'yearByYear')?.splits || []).filter((s) => s.sport?.id === 1 || s.league?.id === 103 || s.league?.id === 104);
  const r = roster.find((x) => x.person.id === p.id);
  return { id: p.id, name: p.fullName, first: p.useName || p.firstName, last: p.lastName, num: r?.jerseyNumber || p.primaryNumber || '', pos, isP,
    bats: p.batSide?.code, throws: p.pitchHand?.code, born: p.birthDate, h: p.height, w: p.weight,
    place: [p.birthCity, p.birthStateProvince, p.birthCountry].filter(Boolean).join(', '), draft: p.draftYear || null, debut: p.mlbDebutDate || null,
    s: trim(seasonS, isP), c: trim(careerS, isP),
    past: yby.slice(-5).reverse().map((y) => ({ yr: y.season, t: y.team?.abbreviation || y.team?.name || '', s: trim(y.stat, isP) })) };
});
mkdirSync('data', { recursive: true });
let old = null; try { old = JSON.parse(readFileSync('data/mlb.json', 'utf8')); delete old.updated; } catch {}
const cmp = { ...out }; delete cmp.updated;
if (JSON.stringify(old) === JSON.stringify(cmp)) { console.log('No changes.'); process.exit(0); }
writeFileSync('data/mlb.json', JSON.stringify(out));
console.log('Saved: games', out.games.length, 'post', out.post.length, 'upcoming', out.upcoming.length, 'players', out.players.length, 'ranks', out.ranks.length);
