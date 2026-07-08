import express from 'express';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.static(join(__dirname, 'public')));

// Load .dat files
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

const host_detail = loadTSV('host_detail.dat');
const mod_detail = loadTSV('mod_detail.dat');
const disk_tsar = loadTSV('disk_tsar.dat');
const pref_tsar = loadTSV('pref_tsar.dat');

// Use the max timestamp in the dataset as the effective "now" for time windows
const prefMaxTs = pref_tsar.length ? Math.max(...pref_tsar.map(r => r.ts)) : Date.now();
const diskMaxTs = disk_tsar.length ? Math.max(...disk_tsar.map(r => r.ts)) : Date.now();

// Convert ms timestamp to ISO string
const fmtTime = ts => {
  const d = new Date(ts);
  return d.toISOString().replace('T', ' ').slice(0, 19);
};

// Range-based aggregation helper — use dataset-specific maxTs as "now"
const RANGE_MS = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000 };
function applyRange(data, range, mods, hostid, dataNow) {
  const rangeMs = RANGE_MS[range] || RANGE_MS['24h'];
  const cutoff = dataNow - rangeMs;
  const filtered = data.filter(r => r.hostid === hostid && mods.includes(r.mod) && r.ts >= cutoff);
  // Determine bucket size for aggregation: 5min for 6h+, 15min for 24h+, 1h for 7d+
  const bucketMs = range === '7d' ? 3600000 : range === '24h' ? 900000 : range === '6h' ? 300000 : 300000;
  // Group by time bucket + mod
  const groups = {};
  filtered.forEach(r => {
    const bucket = Math.floor(r.ts / bucketMs) * bucketMs;
    const key = bucket + '|' + r.mod;
    if (!groups[key]) groups[key] = { ts: bucket, mod: r.mod, sum: 0, cnt: 0 };
    groups[key].sum += r.value;
    groups[key].cnt++;
  });
  return Object.values(groups)
    .map(g => ({ time: fmtTime(g.ts), mod_name: g.mod, value: Math.round(g.sum / g.cnt * 100) / 100 }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

app.get('/api/hosts', (req, res) => res.json(host_detail));

app.get('/api/cpu', (req, res) => {
  const { hostid = 'host001', range = '24h' } = req.query;
  const mods = ['cpu_user', 'cpu_sys', 'cpu_wait', 'cpu_idle'];
  res.json(applyRange(pref_tsar, range, mods, hostid, prefMaxTs));
});

app.get('/api/mem-net', (req, res) => {
  const { hostid = 'host001', range = '24h' } = req.query;
  const mods = ['mem_used', 'mem_free', 'net_in', 'net_out'];
  res.json(applyRange(pref_tsar, range, mods, hostid, prefMaxTs));
});

app.get('/api/disk', (req, res) => {
  const { hostid = 'host001', disk = 'sda', range = '24h' } = req.query;
  const mods = [`${disk}_util`, `${disk}_await`, `${disk}_read`, `${disk}_write`];
  res.json(applyRange(disk_tsar, range, mods, hostid, diskMaxTs));
});

app.get('/api/load-proc', (req, res) => {
  const { hostid = 'host001', range = '24h' } = req.query;
  const mods = ['load1', 'load5', 'load15', 'proc_run', 'proc_block', 'proc_total'];
  res.json(applyRange(pref_tsar, range, mods, hostid, prefMaxTs));
});

// Distribution: location or model
app.get('/api/distribution', (req, res) => {
  const { type = 'location' } = req.query;
  const key = type === 'model' ? 'model' : 'location1';
  const map = {};
  host_detail.forEach(h => {
    const v = h[key] || 'unknown';
    map[v] = (map[v] || 0) + 1;
  });
  res.json(Object.entries(map).map(([name, value]) => ({ name, value })));
});

// Health score (0-100)
app.get('/api/health-score', (req, res) => {
  // CPU health: average cpu_usage across all hosts (lower is better), weight 40%
  const cpuData = pref_tsar.filter(r => r.mod === 'cpu_usage');
  const avgCpu = cpuData.length ? cpuData.reduce((s, r) => s + r.value, 0) / cpuData.length : 0;
  const cpuScore = Math.max(0, 100 - avgCpu) * 0.4;

  // Memory health: average mem_used/(mem_used+mem_free), weight 30%
  const memUsedData = pref_tsar.filter(r => r.mod === 'mem_used');
  const memFreeData = pref_tsar.filter(r => r.mod === 'mem_free');
  const memRatios = [];
  const usedMap = {}, freeMap = {};
  memUsedData.forEach(r => { const k = r.ts + '|' + r.hostid; usedMap[k] = r.value; });
  memFreeData.forEach(r => { const k = r.ts + '|' + r.hostid; freeMap[k] = r.value; });
  Object.keys(usedMap).forEach(k => {
    if (freeMap[k] && (usedMap[k] + freeMap[k]) > 0) {
      memRatios.push(usedMap[k] / (usedMap[k] + freeMap[k]));
    }
  });
  const avgMemRatio = memRatios.length ? memRatios.reduce((s, v) => s + v, 0) / memRatios.length : 0;
  const memScore = Math.max(0, (1 - avgMemRatio) * 100 * 0.3);

  // Load health: average load5 across all hosts, weight 30%
  const loadData = pref_tsar.filter(r => r.mod === 'load5');
  const avgLoad = loadData.length ? loadData.reduce((s, r) => s + r.value, 0) / loadData.length : 0;
  const loadScore = Math.max(0, 30 - Math.min(avgLoad * 2, 30));

  const total = Math.round((cpuScore + memScore + loadScore) * 10) / 10;
  const reasons = [];
  const avgCpuRounded = Math.round(avgCpu * 10) / 10;
  if (avgCpu > 60) reasons.push({ item: 'CPU', deduct: Math.round((avgCpu - 60) * 0.4 * 10) / 10, desc: `平均CPU使用率 ${avgCpuRounded}%（阈值 60%）` });
  if (avgMemRatio > 0.7) reasons.push({ item: '内存', deduct: Math.round((avgMemRatio - 0.7) * 100 * 0.3 * 10) / 10, desc: `平均内存占用 ${Math.round(avgMemRatio * 100)}%（阈值 70%）` });
  if (avgLoad > 8) reasons.push({ item: '负载', deduct: Math.round(Math.min((avgLoad - 8) * 2, 30) * 10) / 10, desc: `平均负载 ${Math.round(avgLoad * 10) / 10}（阈值 8）` });
  res.json({ score: Math.min(100, Math.max(0, total)), cpu: Math.round(cpuScore * 10) / 10, mem: Math.round(memScore * 10) / 10, load: Math.round(loadScore * 10) / 10, reasons });
});

// Alerts: find threshold violations in recent data
app.get('/api/alerts', (req, res) => {
  const alerts = [];
  const window = 3600000; // look at last 1 hour

  const recentPref = pref_tsar.filter(r => r.ts >= prefMaxTs - window);
  const recentDisk = disk_tsar.filter(r => r.ts >= diskMaxTs - window);

  recentPref.forEach(r => {
    if (r.mod === 'cpu_usage' && r.value > 80) {
      alerts.push({ time: fmtTime(r.ts), hostid: r.hostid, metric: 'CPU使用率', value: r.value, unit: '%', severity: r.value > 90 ? 'critical' : 'warning', msg: `CPU ${r.value}%` });
    }
    if (r.mod === 'cpu_wait' && r.value > 30) {
      alerts.push({ time: fmtTime(r.ts), hostid: r.hostid, metric: 'CPU等待', value: r.value, unit: '%', severity: 'warning', msg: `CPU wait ${r.value}%` });
    }
    if (r.mod === 'mem_used' && r.value > 800000) {
      alerts.push({ time: fmtTime(r.ts), hostid: r.hostid, metric: '内存使用', value: Math.round(r.value / 1024), unit: 'MB', severity: r.value > 950000 ? 'critical' : 'warning', msg: `内存 ${Math.round(r.value / 1024)}MB` });
    }
    if (r.mod === 'load1' && r.value > 20) {
      alerts.push({ time: fmtTime(r.ts), hostid: r.hostid, metric: '负载', value: r.value, unit: '', severity: r.value > 30 ? 'critical' : 'warning', msg: `load1 ${r.value}` });
    }
  });

  recentDisk.forEach(r => {
    if (r.mod.endsWith('_util') && r.value > 85) {
      const diskName = r.mod.replace('_util', '');
      alerts.push({ time: fmtTime(r.ts), hostid: r.hostid, metric: `${diskName}利用率`, value: r.value, unit: '%', severity: r.value > 95 ? 'critical' : 'warning', msg: `${diskName} util ${r.value}%` });
    }
  });

  alerts.sort((a, b) => b.time.localeCompare(a.time));
  res.json(alerts.slice(0, 50));
});

// Host status overview (green/yellow/red per host)
app.get('/api/host-status', (req, res) => {
  const window = 3600000;
  const recentPref = pref_tsar.filter(r => r.ts >= prefMaxTs - window);
  const recentDisk = disk_tsar.filter(r => r.ts >= diskMaxTs - window);

  const result = host_detail.map(host => {
    const issues = [];
    const hostPref = recentPref.filter(r => r.hostid === host.hostid);
    const hostDisk = recentDisk.filter(r => r.hostid === host.hostid);

    // CPU
    const cpuVals = hostPref.filter(r => r.mod === 'cpu_usage').map(r => r.value);
    const avgCpu = cpuVals.length ? cpuVals.reduce((s, v) => s + v, 0) / cpuVals.length : 0;
    if (avgCpu > 90) issues.push({ severity: 'critical', msg: `CPU ${Math.round(avgCpu)}%` });
    else if (avgCpu > 75) issues.push({ severity: 'warning', msg: `CPU ${Math.round(avgCpu)}%` });

    // Disk
    const diskUtil = {};
    hostDisk.forEach(r => {
      if (r.mod.endsWith('_util')) {
        const name = r.mod.replace('_util', '');
        if (!diskUtil[name] || r.ts > diskUtil[name].ts) diskUtil[name] = { ts: r.ts, val: r.value };
      }
    });
    Object.values(diskUtil).forEach(d => {
      if (d.val > 95) issues.push({ severity: 'critical', msg: `磁盘 ${d.val}%` });
      else if (d.val > 85) issues.push({ severity: 'warning', msg: `磁盘 ${d.val}%` });
    });

    // Load
    const loadVals = hostPref.filter(r => r.mod === 'load1').map(r => r.value);
    const avgLoad = loadVals.length ? loadVals.reduce((s, v) => s + v, 0) / loadVals.length : 0;
    if (avgLoad > 30) issues.push({ severity: 'critical', msg: `负载 ${Math.round(avgLoad)}` });
    else if (avgLoad > 15) issues.push({ severity: 'warning', msg: `负载 ${Math.round(avgLoad)}` });

    const maxSev = issues.reduce((m, i) => i.severity === 'critical' ? 'critical' : m === 'critical' ? m : 'warning', 'healthy');
    return { hostid: host.hostid, hostname: host.hostname, model: host.model, location1: host.location1, owner: host.owner, status: maxSev, issues };
  });

  res.json(result);
});

app.get('/api/host-summary', (req, res) => {
  const { hostid = 'host001' } = req.query;
  const host = host_detail.find(h => h.hostid === hostid);
  if (!host) return res.status(404).json({ error: 'not found' });
  const diskCount = disk_tsar.filter(r => r.hostid === hostid).length;
  const prefCount = pref_tsar.filter(r => r.hostid === hostid).length;
  res.json({ ...host, diskCount, prefCount });
});

app.listen(3000, () => {
  console.log(`Server running at http://localhost:3000`);
  console.log(`  hosts: ${host_detail.length}, mods: ${mod_detail.length}`);
  console.log(`  disk_tsar: ${disk_tsar.length}, pref_tsar: ${pref_tsar.length}`);
});
