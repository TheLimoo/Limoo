// src/auth.js
const crypto = require('crypto');
const config = require('./config');

const sessions = new Map();

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    createdAt: Date.now(),
    expiresAt: Date.now() + config.cookieMaxAgeMs
  });
  return token;
}

function validateSession(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function destroySession(token) {
  sessions.delete(token);
}

// Cleanup expired sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt) sessions.delete(token);
  }
}, 60 * 60 * 1000);

function requireAuth(req, res, next) {
  const token = req.cookies[config.cookieName];
  if (!validateSession(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function verifyPassword(password) {
  return password === config.password;
}

module.exports = { createSession, validateSession, destroySession, requireAuth, verifyPassword };
