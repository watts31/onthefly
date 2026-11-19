// Runs once a day on GitHub's servers: bio + season/career stats for every player on the team,
// saved to data/bios.json for the app's player cards.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const TEAM = 'PHI';
const get = async (u) => { const r = await fetch(u, { headers: { 'User-Agent': 'player-cards (personal app)' } }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
const now = new Date(), y = now.getUTCFullYear();
const sid = now.getUTCMonth() >= 8 ? `${y}${y + 1}` : `${y - 1}${y}`;
const roster = await get(`https://api-web.nhle.com/v1/roster/${TEAM}/current`);
const club = await get(`https://api-web.nhle.com/v1/club-stats/${TEAM}/${sid}/2`).catch(() => ({}));
const ids = new Set();
for (const k of ['forwards', 'defensemen', 'goalies']) for (const p of roster[k] || []) ids.add(p.id);
for (const p of [...(club.skaters || []), ...(club.goalies || [])]) ids.add(p.playerId);
const out = { season: sid, players: {} };
const pick = (o, ks) => Object.fromEntries(ks.filter((k) => o?.[k] != null).map((k) => [k, o[k]]));
const SK = ['gamesPlayed', 'goals', 'assists', 'points', 'plusMinus', 'pim', 'powerPlayGoals', 'gameWinningGoals', 'shots', 'shootingPctg'];
const GK = ['gamesPlayed', 'wins', 'losses', 'otLosses', 'goalsAgainstAvg', 'savePctg', 'shutouts'];
for (const id of ids) {
  try {
    const L = await get(`https://api-web.nhle.com/v1/player/${id}/landing`);
    const g = L.position === 'G', keys = g ? GK : SK;
    const totals = (L.seasonTotals || []).filter((s) => s.leagueAbbrev === 'NHL' && s.gameTypeId === 2);
    const cur = totals.filter((s) => String(s.season) === sid);
    out.players[id] = {
      id, first: L.firstName?.default, last: L.lastName?.default, num: L.sweaterNumber ?? '', pos: L.position,
      shoots: L.shootsCatches, h: L.heightInInches, w: L.weightInPounds, born: L.birthDate,
      place: [L.birthCity?.default, L.birthStateProvince?.default, L.birthCountry].filter(Boolean).join(', '),
      draft: L.draftDetails ? pick(L.draftDetails, ['year', 'teamAbbrev', 'round', 'pickInRound', 'overallPick']) : null,
      team: L.currentTeamAbbrev || null,
      season: pick(L.featuredStats?.regularSeason?.subSeason, keys),
      toi: cur.length ? cur[cur.length - 1].avgToi || null : null,
      career: pick(L.featuredStats?.regularSeason?.career || L.careerTotals?.regularSeason, keys),
      last5: (L.last5Games || []).map((x) => g
        ? { d: x.gameDate, o: x.opponentAbbrev, h: x.homeRoadFlag, dec: x.decision || '', ga: x.goalsAgainst, sv: x.savePctg }
        : { d: x.gameDate, o: x.opponentAbbrev, h: x.homeRoadFlag, g: x.goals, a: x.assists, p: x.points, toi: x.toi }),
      past: totals.filter((s) => String(s.season) !== sid).slice(-4).reverse().map((s) => g
        ? { s: s.season, t: s.teamName?.default, gp: s.gamesPlayed, w: s.wins, gaa: s.goalsAgainstAvg, sv: s.savePctg }
        : { s: s.season, t: s.teamName?.default, gp: s.gamesPlayed, g: s.goals, a: s.assists, p: s.points }),
    };
  } catch (e) { console.warn(id, e.message); }
}
if (!Object.keys(out.players).length) throw new Error('No players fetched; keeping the previous file.');
let old = null; try { old = JSON.parse(readFileSync('data/bios.json', 'utf8')); delete old.updated; } catch {}
if (JSON.stringify(old) === JSON.stringify(out)) { console.log('No changes.'); process.exit(0); }
mkdirSync('data', { recursive: true });
writeFileSync('data/bios.json', JSON.stringify({ updated: now.toISOString(), ...out }));
console.log('Saved', Object.keys(out.players).length, 'players');
