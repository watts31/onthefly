// Runs on GitHub's servers a few times a day: injuries, prospects, draft picks and franchise history
// for the More and News tabs. Saved to data/extra.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('data', { recursive: true });
const TEAM = 'PHI', FRANCHISE = 16, ESPN_NAME = 'Philadelphia Flyers', CW = 'philadelphia_flyers', ESPN_ABBR = 'phi', SHORT = 'Flyers';
const UA = { 'User-Agent': 'Mozilla/5.0 (personal team app)' };
const get = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
const text = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.text(); };
const safe = async (label, f, dflt) => { try { return await f(); } catch (e) { console.warn(label, e.message); return dflt; } };
const now = new Date(), y = now.getUTCFullYear();
const sid = now.getUTCMonth() >= 8 ? `${y}${y + 1}` : `${y - 1}${y}`;
const enc = encodeURIComponent;
let old = {}; try { old = JSON.parse(readFileSync('data/extra.json', 'utf8')); } catch {}

// --- Injuries (ESPN, whole league; keep ours) ---
const injuries = await safe('injuries', async () => {
  const d = await get('https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries');
  const t = (d.injuries || []).find((x) => x.displayName === ESPN_NAME);
  return (t?.injuries || []).map((i) => ({
    name: i.athlete?.displayName, pos: i.athlete?.position?.abbreviation || '', status: i.status || '', date: i.date,
    type: i.details?.type || '', loc: i.details?.location || '', ret: i.details?.returnDate || null, note: i.shortComment || '',
  }));
}, old.injuries || []);

// --- Prospects (NHL) with this season's stats wherever they play ---
const prospects = await safe('prospects', async () => {
  const p = await get(`https://api-web.nhle.com/v1/prospects/${TEAM}`);
  const list = [...(p.forwards || []), ...(p.defensemen || []), ...(p.goalies || [])];
  const out = [];
  for (let i = 0; i < list.length; i += 5) await Promise.all(list.slice(i, i + 5).map(async (x) => {
    const L = await safe('prospect ' + x.id, () => get(`https://api-web.nhle.com/v1/player/${x.id}/landing`), null);
    const g = x.positionCode === 'G';
    const tot = (L?.seasonTotals || []).filter((s) => s.gameTypeId === 2);
    const cur = tot.filter((s) => String(s.season) === sid);
    const sumK = (k) => cur.reduce((a, s) => a + (s[k] || 0), 0);
    const last = cur[cur.length - 1] || tot[tot.length - 1];
    out.push({
      id: x.id, name: `${x.firstName?.default} ${x.lastName?.default}`, pos: x.positionCode, born: x.birthDate,
      country: x.birthCountry, h: x.heightInInches, w: x.weightInPounds,
      draft: L?.draftDetails ? { y: L.draftDetails.year, r: L.draftDetails.round, o: L.draftDetails.overallPick, t: L.draftDetails.teamAbbrev } : null,
      league: last?.leagueAbbrev || '', club: last?.teamName?.default || '', cur: cur.length > 0,
      s: cur.length ? (g ? { gp: sumK('gamesPlayed'), w: sumK('wins'), gaa: last.goalsAgainstAvg, sv: last.savePctg }
        : { gp: sumK('gamesPlayed'), g: sumK('goals'), a: sumK('assists'), p: sumK('points') }) : null,
      nhl: tot.filter((s) => s.leagueAbbrev === 'NHL').reduce((a, s) => a + (s.gamesPlayed || 0), 0),
    });
  }));
  return out;
}, old.prospects || []);

// --- Draft picks owned (CapWages) and recent draft classes (NHL records) ---
const picks = await safe('picks', async () => {
  const h = await text(`https://capwages.com/teams/${CW}`);
  const i = h.indexOf('id="__NEXT_DATA__"'), j = h.indexOf('>', i) + 1, k = h.indexOf('</script>', j);
  const d = JSON.parse(h.slice(j, k)).props?.pageProps?.draftPicks || [];
  return d.map((p) => ({ y: +p.year, r: p.round, team: p.team, cond: [].concat(p.conditions || []).map((c) => typeof c === 'string' ? c : (c?.description || c?.condition || c?.text || '')).filter(Boolean), away: !!p.isTradedAway, td: p.tradedDate || null, tid: p.tradeId || null, tx: p.tradeDetails || null }));
}, old.picks || []);
const drafted = await safe('drafted', async () => {
  const yrs = [y, y - 1, y - 2, y - 3, y - 4];
  const rows = [];
  for (const yr of yrs) {
    const d = await safe('draft ' + yr, () => get(`https://records.nhl.com/site/api/draft?cayenneExp=${enc(`draftYear=${yr} and triCode="${TEAM}"`)}`), { data: [] });
    for (const p of d.data || []) rows.push({ y: p.draftYear, r: p.roundNumber, o: p.overallPickNumber, name: p.playerName, pos: p.position, club: p.amateurClubName, lg: p.amateurLeague, id: p.playerId });
  }
  return rows.sort((a, b) => b.y - a.y || a.o - b.o);
}, old.drafted || []);

// --- Franchise history ---
const history = await safe('history', async () => {
  const S = await get(`https://records.nhl.com/site/api/franchise-season-results?cayenneExp=${enc(`franchiseId=${FRANCHISE} and gameTypeId=2`)}&sort=seasonId&dir=DESC`);
  const P = await safe('playoff seasons', () => get(`https://records.nhl.com/site/api/franchise-season-results?cayenneExp=${enc(`franchiseId=${FRANCHISE} and gameTypeId=3`)}&sort=seasonId&dir=DESC`), { data: [] });
  if (P.data?.[0]) console.log('playoff sample', JSON.stringify(P.data[0]).slice(0, 900));
  const po = Object.fromEntries((P.data || []).map((x) => [x.seasonId, x]));
  const T = await get(`https://records.nhl.com/site/api/franchise-team-totals?cayenneExp=${enc(`franchiseId=${FRANCHISE}`)}`);
  const tot = (T.data || []).filter((x) => x.gameTypeId === 2);
  const potot = (T.data || []).filter((x) => x.gameTypeId === 3);
  const sum = (a, k) => a.reduce((s, x) => s + (x[k] || 0), 0);
  const range = `franchiseId=${FRANCHISE} and gameTypeId=2 and seasonId<=${sid} and seasonId>=19171918`;
  const lead = async (kind, prop, n = 5) => {
    const d = await get(`https://api.nhle.com/stats/rest/en/${kind}/summary?isAggregate=true&isGame=false&sort=${enc(JSON.stringify([{ property: prop, direction: 'DESC' }]))}&start=0&limit=${n}&cayenneExp=${enc(range)}`);
    return (d.data || []).map((x) => ({ id: x.playerId, n: x.skaterFullName || x.goalieFullName, v: x[prop], gp: x.gamesPlayed }));
  };
  return {
    first: Math.min(...tot.map((x) => x.firstSeasonId)), names: tot.map((x) => x.teamName),
    gp: sum(tot, 'gamesPlayed'), w: sum(tot, 'wins'), l: sum(tot, 'losses'), otl: sum(tot, 'overtimeLosses'), t: sum(tot, 'ties'), pts: sum(tot, 'points'),
    cups: Math.max(0, ...tot.map((x) => x.cups || 0)), poSeasons: sum(tot, 'playoffSeasons'), seriesW: sum(potot, 'seriesWins'), seriesL: sum(potot, 'seriesLosses'),
    seasons: (S.data || []).map((x) => ({
      s: x.seasonId, name: x.teamName, gp: x.gamesPlayed, w: x.wins, l: x.losses, otl: x.overtimeLosses, t: x.ties, pts: x.points, gf: x.goals, ga: x.goalsAgainst,
      div: x.divisionName, dr: x.divisionSequence, lr: x.leagueSequence, po: !!x.inPlayoffs,
      pr: po[x.seasonId] ? { round: po[x.seasonId].playoffRound ?? po[x.seasonId].finalPlayoffRound, title: po[x.seasonId].seriesTitle, dec: po[x.seasonId].decision, w: po[x.seasonId].wins, l: po[x.seasonId].losses } : null,
    })),
    leaders: {
      points: await safe('l pts', () => lead('skater', 'points'), []), goals: await safe('l g', () => lead('skater', 'goals'), []),
      assists: await safe('l a', () => lead('skater', 'assists'), []), games: await safe('l gp', () => lead('skater', 'gamesPlayed'), []),
      wins: await safe('l w', () => lead('goalie', 'wins'), []), shutouts: await safe('l so', () => lead('goalie', 'shutouts'), []),
    },
  };
}, old.history || null);

// --- Calendar feed (subscribe once, stays up to date) ---
await safe('ics', async () => {
  const d = await get(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${ESPN_ABBR}/schedule?seasontype=2`);
  const z = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const icsEsc = (x) => String(x || '').replace(/[\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const ev = (d.events || []).map((e) => {
    const c = e.competitions?.[0] || {}, cs = c.competitors || [];
    const me = cs.find((x) => x.team?.displayName === ESPN_NAME), op = cs.find((x) => x !== me);
    if (!me || !op) return '';
    const tv = [...new Set((c.broadcasts || []).map((b) => b.media?.shortName).filter(Boolean))].join(', ');
    const sc = c.status?.type?.completed ? ` (${me.score?.displayValue ?? ''}-${op.score?.displayValue ?? ''})` : '';
    return ['BEGIN:VEVENT', `UID:${e.id}@${TEAM.toLowerCase()}-app`, `DTSTAMP:${z(now)}`, `DTSTART:${z(e.date)}`, 'DURATION:PT2H45M',
      `SUMMARY:${icsEsc(`${SHORT} ${me.homeAway === 'home' ? 'vs' : '@'} ${op.team?.shortDisplayName || op.team?.displayName}${sc}`)}`,
      `LOCATION:${icsEsc(c.venue?.fullName || '')}`, `DESCRIPTION:${icsEsc(tv ? 'TV: ' + tv : '')}`, 'END:VEVENT'].join('\r\n');
  }).filter(Boolean);
  if (ev.length < 20) throw new Error('short schedule');
  writeFileSync('data/schedule.ics', ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${SHORT} app//EN`, `X-WR-CALNAME:${SHORT} games`, 'X-PUBLISHED-TTL:PT6H', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n');
  console.log('ics', ev.length, 'games');
}, null);

const out = { team: TEAM, season: sid, injuries, prospects, picks, drafted, history };
const prev = { ...old }; delete prev.updated;
if (JSON.stringify(prev) === JSON.stringify(out)) console.log('unchanged');
else { writeFileSync('data/extra.json', JSON.stringify({ updated: now.toISOString(), ...out })); console.log('saved', injuries.length, 'injuries', prospects.length, 'prospects', picks.length, 'picks', drafted.length, 'drafted', history?.seasons?.length, 'seasons'); }
