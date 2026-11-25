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
const sched = async (q) => ((await get(`/schedule?sportId=1&teamId=${TEAM_ID}&${q}&hydrate=linescore,team,broadcasts(all)`)).dates || []).flatMap((d) => d.games);
const mapGame = (g) => { const home = g.teams.home.team.id === TEAM_ID, us = home ? g.teams.home : g.teams.away, them = home ? g.teams.away : g.teams.home;
  const inn = (g.linescore?.innings || []).map((i) => [home ? i.home?.runs ?? null : i.away?.runs ?? 0, home ? i.away?.runs ?? 0 : i.home?.runs ?? null]);
  return { pk: g.gamePk, date: g.officialDate || g.gameDate?.slice(0, 10), t: g.gameDate, type: g.gameType, opp: ab[them.team.id] || them.team.abbreviation, home,
    rs: us.score ?? null, ra: them.score ?? null, state: g.status?.abstractGameState, desc: g.seriesDescription || '', inn,
    h: [g.linescore?.teams?.[home ? 'home' : 'away']?.hits, g.linescore?.teams?.[home ? 'away' : 'home']?.hits],
    e: [g.linescore?.teams?.[home ? 'home' : 'away']?.errors, g.linescore?.teams?.[home ? 'away' : 'home']?.errors],
    tv: [...new Set((g.broadcasts || []).filter((b) => b.type === 'TV' && (b.isNational || b.homeAway === (home ? 'home' : 'away'))).map((b) => b.callSign || b.name))].slice(0, 3),
    tbd: !!g.status?.startTimeTBD, venue: g.venue?.name || '' }; };
out.games = (await sched(`season=${season}&gameType=R`)).map(mapGame);
out.post = (await sched(`season=${season}&gameType=F,D,L,W`)).map(mapGame);
out.upcoming = (await sched(`startDate=${next}-02-01&endDate=${next}-10-31&gameType=S,R`)).map(mapGame);

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
const safe = async (label, f, d) => { try { return await f(); } catch (e) { console.warn(label, e.message); return d; } };
const iso = (d) => d.toISOString().slice(0, 10);
// roster moves (last 6 months)
out.moves = await safe('moves', async () => ((await get(`/transactions?teamId=${TEAM_ID}&startDate=${iso(new Date(now - 183 * 864e5))}&endDate=${iso(now)}`)).transactions || [])
  .filter((t) => t.description).map((t) => ({ d: t.date, text: t.description, trade: t.typeCode === 'TR' })).sort((a, b) => (a.d < b.d ? 1 : -1)), []);
// injuries (ESPN, whole league; keep ours)
out.injuries = await safe('injuries', async () => {
  const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries'); const d = await r.json();
  const t = (d.injuries || []).find((x) => x.displayName === 'Philadelphia Phillies');
  return (t?.injuries || []).map((i) => ({ name: i.athlete?.displayName, pos: i.athlete?.position?.abbreviation || '', status: i.status || '', date: i.date,
    type: i.details?.type || '', loc: i.details?.location || '', ret: i.details?.returnDate || null, note: i.shortComment || '' }));
}, []);
// farm system: each affiliate's record and top performers
out.farm = await safe('farm', async () => {
  const aff = ((await get(`/teams/affiliates?teamIds=${TEAM_ID}&season=${season}`)).teams || []).filter((t) => t.id !== TEAM_ID && [11, 12, 13, 14].includes(t.sport?.id));
  const res = [];
  for (const t of aff) {
    const info = (await safe('aff ' + t.id, () => get(`/teams/${t.id}?hydrate=standings&season=${season}`), { teams: [] })).teams?.[0];
    const stat = async (group) => ((await safe('farm stats', () => get(`/stats?stats=season&group=${group}&sportId=${t.sport.id}&teamId=${t.id}&season=${season}&limit=200&playerPool=all`), {})).stats?.[0]?.splits || []);
    const hit = (await stat('hitting')).filter((x) => +x.stat.plateAppearances >= 120).sort((a, b) => +b.stat.ops - +a.stat.ops).slice(0, 5)
      .map((x) => ({ id: x.player.id, n: x.player.fullName, pos: x.position?.abbreviation || '', age: x.stat.age, g: x.stat.gamesPlayed, avg: x.stat.avg, hr: x.stat.homeRuns, rbi: x.stat.rbi, sb: x.stat.stolenBases, ops: x.stat.ops }));
    const pit = (await stat('pitching')).filter((x) => +x.stat.inningsPitched >= 35).sort((a, b) => +a.stat.era - +b.stat.era).slice(0, 4)
      .map((x) => ({ id: x.player.id, n: x.player.fullName, age: x.stat.age, g: x.stat.gamesPlayed, ip: x.stat.inningsPitched, w: x.stat.wins, l: x.stat.losses, era: x.stat.era, k: x.stat.strikeOuts, whip: x.stat.whip }));
    const rec = info?.record;
    res.push({ id: t.id, name: t.name, level: t.sport?.name, lvl: t.sport?.id, league: info?.league?.name || '', city: t.locationName,
      w: rec?.wins ?? rec?.leagueRecord?.wins ?? null, l: rec?.losses ?? rec?.leagueRecord?.losses ?? null, dr: rec?.divisionRank || null, div: info?.division?.name || '', hit, pit });
  }
  return res.sort((a, b) => a.lvl - b.lvl);
}, []);
// recent drafts
out.drafts = await safe('drafts', async () => {
  const rows = [];
  for (const y of [season, season - 1, season - 2]) {
    const d = await safe('draft ' + y, () => get(`/draft/${y}?teamId=${TEAM_ID}`), {});
    for (const r of d.drafts?.rounds || []) for (const p of r.picks || []) if (p.team?.id === TEAM_ID || !p.team)
      rows.push({ y, r: p.pickRound, o: p.pickNumber, name: p.person?.fullName || p.displayName || '', pos: p.person?.primaryPosition?.abbreviation || '', school: p.school?.name || '', cls: p.school?.schoolClass || '', bonus: p.signingBonus || null });
  }
  return rows.filter((x) => x.name);
}, []);
// every MLB player's season line, for Compare (separate file)
await safe('all players', async () => {
  const pull = async (group) => ((await get(`/stats?stats=season&group=${group}&sportId=1&season=${season}&limit=2500&playerPool=all`)).stats?.[0]?.splits || []);
  const h = (await pull('hitting')).filter((x) => +x.stat.plateAppearances >= 1).map((x) => [x.player.id, x.player.fullName, ab[x.team?.id] || '', x.position?.abbreviation || '',
    ...['gamesPlayed', 'plateAppearances', 'runs', 'hits', 'doubles', 'homeRuns', 'rbi', 'baseOnBalls', 'strikeOuts', 'stolenBases', 'avg', 'obp', 'slg', 'ops'].map((k) => x.stat[k] ?? null)]);
  const pp = (await pull('pitching')).filter((x) => +x.stat.battersFaced >= 1).map((x) => [x.player.id, x.player.fullName, ab[x.team?.id] || '', 'P',
    ...['gamesPlayed', 'gamesStarted', 'wins', 'losses', 'saves', 'inningsPitched', 'strikeOuts', 'baseOnBalls', 'era', 'whip', 'strikeoutsPer9Inn', 'homeRunsPer9'].map((k) => x.stat[k] ?? null)]);
  writeFileSync('data/mlb-all.json', JSON.stringify({ season, h, p: pp }));
  console.log('all players', h.length, pp.length);
}, null);
// franchise history (refreshed weekly)
await safe('history', async () => {
  let H = null; try { H = JSON.parse(readFileSync('data/mlb-history.json', 'utf8')); } catch {}
  if (H && H.v === 2 && Date.now() - new Date(H.updated) < 7 * 864e5 && H.seasons?.[0]?.y === season) return;
  const seasons = [];
  for (let y = season; y >= 1883; y--) {
    const d = await safe('standings ' + y, () => get(`/standings?leagueId=104&season=${y}`), { records: [] });
    for (const r of d.records || []) for (const t of r.teamRecords || []) if (t.team.id === TEAM_ID)
      seasons.push({ y, w: t.wins, l: t.losses, pct: t.winningPercentage, dr: +t.divisionRank || null, div: r.division?.id ? (r.division.nameShort || r.division.name || '') : '', gb: t.gamesBack });
  }
  for (const s of seasons) {
    if (s.y < 1903 || (s.w / (s.w + s.l) < 0.52 && s.y !== 1981)) continue;
    const d = await safe('post ' + s.y, () => get(`/schedule/postseason/series?sportId=1&season=${s.y}&teamId=${TEAM_ID}`), {});
    const ser = (d.series || []).filter((x) => ['F', 'D', 'L', 'W'].includes(x.series?.id?.[0]) && (x.games || []).some((g) => g.teams.home.team.id === TEAM_ID || g.teams.away.team.id === TEAM_ID)).map((x) => { const last = x.games?.[x.games.length - 1]; if (!last) return null;
      const side = last.teams.home.team.id === TEAM_ID ? last.teams.home : last.teams.away; const opp = side === last.teams.home ? last.teams.away : last.teams.home;
      return { round: x.series?.id?.[0], name: last.seriesDescription || '', won: !!side.isWinner, opp: opp.team?.name || '' }; }).filter(Boolean);
    if (ser.length) s.post = ser;
  }
  const lead = async (group, k, n = 5) => ((await safe('lead ' + k, () => get(`/stats?stats=career&group=${group}&teamId=${TEAM_ID}&sortStat=${k}&limit=${n}&playerPool=all`), {})).stats?.[0]?.splits || [])
    .map((x) => ({ id: x.player.id, n: x.player.fullName, v: x.stat[k] }));
  const leaders = { homeRuns: await lead('hitting', 'homeRuns'), hits: await lead('hitting', 'hits'), rbi: await lead('hitting', 'rbi'), stolenBases: await lead('hitting', 'stolenBases'),
    wins: await lead('pitching', 'wins'), strikeOuts: await lead('pitching', 'strikeOuts') };
  writeFileSync('data/mlb-history.json', JSON.stringify({ v: 2, updated: now.toISOString(), seasons, leaders }));
  console.log('history', seasons.length, 'seasons', seasons.filter((s) => s.post).length, 'postseasons');
}, null);
// calendar feed
await safe('ics', async () => {
  const z = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const e = (x) => String(x || '').replace(/[\;,]/g, (c) => '\\' + c);
  const nm = (a) => out.teams[a]?.name || a;
  const ev = [...out.games, ...out.post, ...out.upcoming].filter((g) => g.t).map((g) => ['BEGIN:VEVENT', `UID:${g.pk}@phillies-app`, `DTSTAMP:${z(now)}`, `DTSTART:${z(g.t)}`, 'DURATION:PT3H',
    `SUMMARY:${e(`Phillies ${g.home ? 'vs' : '@'} ${nm(g.opp)}${g.type === 'S' ? ' (spring)' : ''}${g.rs != null && g.state === 'Final' ? ` (${g.rs}-${g.ra})` : ''}`)}`,
    `LOCATION:${e(g.venue)}`, `DESCRIPTION:${e(g.tv?.length ? 'TV: ' + g.tv.join(', ') : '')}`, 'END:VEVENT'].join('\r\n'));
  writeFileSync('data/phillies.ics', ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Phillies app//EN', 'X-WR-CALNAME:Phillies games', 'X-PUBLISHED-TTL:PT6H', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n');
  console.log('ics', ev.length);
}, null);
let old = null; try { old = JSON.parse(readFileSync('data/mlb.json', 'utf8')); delete old.updated; } catch {}
const cmp = { ...out }; delete cmp.updated;
if (JSON.stringify(old) === JSON.stringify(cmp)) { console.log('No changes.'); process.exit(0); }
writeFileSync('data/mlb.json', JSON.stringify(out));
console.log('Saved: games', out.games.length, 'post', out.post.length, 'upcoming', out.upcoming.length, 'players', out.players.length, 'ranks', out.ranks.length);
