// Runs on GitHub's servers every 5 minutes. Collects NHL goal-clip IDs for live and recent games
// of this team into data/clips.json, which the app reads. (Phones can't read the NHL API directly.)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const ME = 'PHI';
const get = async (u) => { const r = await fetch(u, { headers: { 'User-Agent': 'goal-clips (personal app)' } }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
const sched = await get(`https://api-web.nhle.com/v1/club-schedule-season/${ME}/now`);
const games = sched.games || [];
let old = { games: {} };
try { old = JSON.parse(readFileSync('data/clips.json', 'utf8')); } catch {}
const now = Date.now();
const live = games.filter((g) => ['LIVE', 'CRIT'].includes(g.gameState));
const fin = games.filter((g) => ['OFF', 'FINAL'].includes(g.gameState)).slice(-10);
const recent = fin.filter((g) => now - new Date(g.startTimeUTC) < 36 * 3600e3);
const incomplete = fin.filter((g) => { const o = old.games?.[g.id]; return !o || o.goals.some((x) => !x.clip); });
const targets = [...new Map([...live, ...recent, ...incomplete].map((g) => [g.id, g])).values()];
if (!targets.length) { console.log('No live or recent games.'); process.exit(0); }
const out = { games: {} };
const keep = new Set([...fin.map((g) => g.id), ...live.map((g) => g.id)]);
for (const [id, v] of Object.entries(old.games || {})) if (keep.has(+id)) out.games[id] = v;
for (const g of targets) {
  try {
    const d = await get(`https://api-web.nhle.com/v1/gamecenter/${g.id}/landing`);
    const goals = [];
    for (const per of d.summary?.scoring || []) for (const x of per.goals || []) goals.push({
      p: per.periodDescriptor?.number, t: x.timeInPeriod, team: x.teamAbbrev?.default || x.teamAbbrev,
      first: x.firstName?.default, last: x.lastName?.default, clip: x.highlightClip || null,
      as: x.awayScore, hs: x.homeScore, str: x.strength || '',
    });
    out.games[g.id] = { date: new Date(g.startTimeUTC).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
      home: g.homeTeam?.abbrev, away: g.awayTeam?.abbrev, state: d.gameState, goals };
  } catch (e) { console.warn(e.message); }
}
const strip = (o) => JSON.stringify(o.games);
if (strip(out) === strip(old)) { console.log('No changes.'); process.exit(0); }
mkdirSync('data', { recursive: true });
writeFileSync('data/clips.json', JSON.stringify({ updated: new Date().toISOString(), ...out }));
console.log('Saved', Object.keys(out.games).length, 'games');
