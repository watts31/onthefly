// Runs on GitHub's servers (GitHub Actions). Fetches team player stats, jersey numbers
// and special teams from the NHL's public API, and saves them to data/players.json,
// which the app reads. (Phones can't call the NHL API directly: it blocks other websites.)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

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
if (JSON.stringify(old) === JSON.stringify(body)) { console.log('No changes.'); process.exit(0); }
mkdirSync('data', { recursive: true });
writeFileSync('data/players.json', JSON.stringify({ updated: now.toISOString(), ...body }));
console.log(`Saved ${sk.length} skaters, ${g.length} goalies, special teams: ${st ? 'yes' : 'no'}.`);
