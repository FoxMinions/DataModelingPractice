import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, 'Point2');

function loadTSV(name) {
  const path = join(__dirname, name);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf-8');
  const lines = text.trim().split('\n');
  const headers = lines[0].split('\t');
  return lines.slice(1).map(line => {
    const vals = line.split('\t');
    const row = {};
    headers.forEach((h, i) => {
      row[h.trim()] = isNaN(vals[i]) ? vals[i] : Number(vals[i]);
    });
    return row;
  });
}

const disk_tsar = loadTSV('disk_tsar.dat');
const pref_tsar = loadTSV('pref_tsar.dat');
const host_detail = loadTSV('host_detail.dat');
const mod_detail = loadTSV('mod_detail.dat');

function fmtTS(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return { event_time: `${y}-${M}-${D} ${h}:${m}:${s}`, dt: `${y}-${M}-${D}`, hour: d.getHours(), minute: d.getMinutes() };
}

function fmtVal(v, keepDec) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && keepDec) return v.toFixed(2);
  return String(v);
}

function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const decCols = ['value_num', 'avg_value', 'max_value', 'min_value'];
  const lines = rows.map(r => headers.map(h => fmtVal(r[h], decCols.includes(h))).join(','));
  return headers.join(',') + '\n' + lines.join('\n');
}

// ===== Query 1: Timestamp Parsing (disk_tsar first 10 rows) =====
const q1 = disk_tsar.slice(0, 10).map(r => {
  const t = fmtTS(r.ts);
  return {
    ts: r.ts,
    hostid: r.hostid,
    mod: r.mod,
    value_num: r.value,
    event_time: t.event_time,
    dt: t.dt,
    hour: t.hour,
    minute: t.minute,
  };
});

// ===== Query 2: Hourly Aggregation (pref_tsar by dt+hour+hostid+mod) =====
const groupMap = {};
pref_tsar.forEach(r => {
  const t = fmtTS(r.ts);
  const key = `${t.dt}|${t.hour}|${r.hostid}|${r.mod}`;
  if (!groupMap[key]) {
    groupMap[key] = { dt: t.dt, hour: t.hour, hostid: r.hostid, mod: r.mod, sum: 0, max: -Infinity, min: Infinity, cnt: 0 };
  }
  const g = groupMap[key];
  g.sum += r.value;
  if (r.value > g.max) g.max = r.value;
  if (r.value < g.min) g.min = r.value;
  g.cnt++;
});
const q2 = Object.values(groupMap)
  .map(g => ({
    dt: g.dt,
    hour: g.hour,
    hostid: g.hostid,
    mod: g.mod,
    avg_value: Math.round(g.sum / g.cnt * 100) / 100,
    max_value: Math.round(g.max * 100) / 100,
    min_value: Math.round(g.min * 100) / 100,
    sample_cnt: g.cnt,
  }))
  .sort((a, b) => a.dt.localeCompare(b.dt) || a.hour - b.hour || a.hostid.localeCompare(b.hostid) || a.mod.localeCompare(b.mod));

// Write
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, 'disk_tsar_parsed.csv'), toCSV(q1), 'utf-8');
writeFileSync(join(outDir, 'pref_hourly_summary.csv'), toCSV(q2), 'utf-8');

console.log(`Query 1: ${q1.length} rows → Point2/disk_tsar_parsed.csv`);
console.log(`Query 2: ${q2.length} rows → Point2/pref_hourly_summary.csv`);

// Print preview
console.log('\n=== Query 1 preview ===');
console.table(q1.slice(0, 3));
console.log('\n=== Query 2 preview ===');
console.table(q2.slice(0, 5));
