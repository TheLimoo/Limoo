// src/xray-stats.js
const { execSync } = require('child_process');
const config = require('./config');
const { stmts } = require('./db');

// In-memory map to track previous xray cumulative values per client email.
// This allows computing deltas across polls so traffic is accumulated, not overwritten.
// On panel restart, the first poll sets the baseline from current xray values.
const previousStats = {}; // { email: { up: number, down: number } }

function queryStats() {
  try {
    const output = execSync(
      `xray api statsquery -server 127.0.0.1:${config.xrayStatsPort} -pattern ""`,
      { encoding: 'utf-8', timeout: 5000 }
    );
    const stats = [];
    const blocks = output.split('stat {');
    for (const block of blocks) {
      if (!block.includes('name:')) continue;
      const nameMatch = block.match(/name:\s*"([^"]+)"/);
      const valueMatch = block.match(/value:\s*(\d+)/);
      if (nameMatch && valueMatch) {
        stats.push({ name: nameMatch[1], value: valueMatch[1] });
      }
    }
    return stats.length > 0 ? { stat: stats } : null;
  } catch (err) {
    console.error('[stats] Failed to query xray stats:', err.message);
    return null;
  }
}

function updateTrafficStats() {
  const stats = queryStats();
  if (!stats || !stats.stat) return;

  const now = Math.floor(Date.now() / 1000);
  const trafficMap = {};

  for (const stat of stats.stat) {
    // Match both formats: user>>>email>>>uplink and user>>>email>>>downlink
    const match = stat.name.match(/^user>>>(.+?)>>>(uplink|downlink)$/);
    if (!match) continue;

    const email = match[1];
    const direction = match[2];
    const value = parseInt(stat.value, 10) || 0;

    if (!trafficMap[email]) trafficMap[email] = { up: 0, down: 0 };
    if (direction === 'uplink') trafficMap[email].up += value;
    else trafficMap[email].down += value;
  }

  // For each client email, compute delta from previous xray values and accumulate into DB
  for (const [email, current] of Object.entries(trafficMap)) {
    const prev = previousStats[email];

    if (prev) {
      // Compute delta: only accumulate positive deltas (handles xray restart gracefully)
      const deltaUp = Math.max(0, current.up - prev.up);
      const deltaDown = Math.max(0, current.down - prev.down);

      // Update in-memory baseline
      previousStats[email] = { up: current.up, down: current.down };

      // Skip if no new traffic
      if (deltaUp === 0 && deltaDown === 0) continue;

      // Accumulate delta into the DB
      const clients = stmts.db.prepare('SELECT id FROM clients WHERE email = ?').all(email);
      for (const client of clients) {
        stmts.db.prepare(
          'UPDATE traffic SET up = up + ?, down = down + ?, last_check = ? WHERE client_id = ?'
        ).run(deltaUp, deltaDown, now, client.id);
      }
    } else {
      // First time seeing this email — set the baseline (no delta yet, just record current values)
      previousStats[email] = { up: current.up, down: current.down };

      // Ensure traffic rows exist and are at least at the current xray level
      // Use MAX to avoid overwriting higher accumulated values
      const clients = stmts.db.prepare('SELECT id FROM clients WHERE email = ?').all(email);
      for (const client of clients) {
        stmts.db.prepare(
          'UPDATE traffic SET up = MAX(up, ?), down = MAX(down, ?), last_check = ? WHERE client_id = ?'
        ).run(current.up, current.down, now, client.id);
      }
    }
  }

  // For clients that have traffic rows but no current xray data (client removed from xray or name mismatch),
  // leave their accumulated traffic as-is.

  return trafficMap;
}

function getTrafficSummary() {
  const total = stmts.totalTraffic.get();
  const allTraffic = stmts.getAllTraffic.all();

  const perClient = allTraffic.map(t => ({
    client_id: t.client_id,
    email: t.email,
    uuid: t.uuid,
    password: t.password ? '***' : null,
    up: t.up || 0,
    down: t.down || 0,
    total: (t.up || 0) + (t.down || 0)
  }));

  return {
    totalUp: total.total_up || 0,
    totalDown: total.total_down || 0,
    totalTraffic: (total.total_up || 0) + (total.total_down || 0),
    clients: perClient
  };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = { queryStats, updateTrafficStats, getTrafficSummary, formatBytes };
