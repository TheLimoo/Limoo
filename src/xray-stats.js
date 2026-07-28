// src/xray-stats.js
const { execSync } = require('child_process');
const config = require('./config');
const { stmts } = require('./db');

// Query xray stats via CLI (protobuf text format)
function queryStats() {
  try {
    const output = execSync(
      `xray api statsquery -server 127.0.0.1:${config.xrayStatsPort} -pattern ""`,
      { encoding: 'utf-8', timeout: 5000 }
    );
    // Parse protobuf text format:
    // stat { name: "user>>>email>>>uplink" value: 12345 }
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

// Parse stats and update traffic table
function updateTrafficStats() {
  const stats = queryStats();
  if (!stats || !stats.stat) return;

  const now = Math.floor(Date.now() / 1000);

  // Build traffic map from xray stats
  const trafficMap = {};

  for (const stat of stats.stat) {
    const name = stat.name;
    const value = parseInt(stat.value, 10) || 0;

    // Parse user traffic: "user>>>><email>>>><uplink|downlink>"
    const match = name.match(/^user>>>([^>]+)>>>(uplink|downlink)$/);
    if (match) {
      const email = match[1];
      const direction = match[2];

      if (!trafficMap[email]) {
        trafficMap[email] = { up: 0, down: 0 };
      }
      if (direction === 'uplink') {
        trafficMap[email].up += value;
      } else {
        trafficMap[email].down += value;
      }
    }
  }

  // Update traffic table for each client
  for (const [email, traffic] of Object.entries(trafficMap)) {
    const clients = stmts.db.prepare('SELECT id FROM clients WHERE email = ?').all(email);
    for (const client of clients) {
      stmts.upsertTraffic.run(client.id, traffic.up, traffic.down, now);
    }
  }

  return trafficMap;
}

// Get traffic summary for dashboard
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

// Format bytes to human readable
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = {
  queryStats,
  updateTrafficStats,
  getTrafficSummary,
  formatBytes
};
