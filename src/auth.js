// src/auth.js
const crypto = require('crypto');
const config = require('./config');

// In-memory session store
const sessions = new Map();

// Generate session token
function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    createdAt: Date.now(),
    expiresAt: Date.now() + config.cookieMaxAgeMs
  });
  return token;
}

// Validate session token
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

// Destroy session
function destroySession(token) {
  sessions.delete(token);
}

// Cleanup expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(token);
    }
  }
}, 60 * 60 * 1000); // Every hour

// Auth middleware
function requireAuth(req, res, next) {
  const token = req.cookies[config.cookieName];
  if (!validateSession(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Verify password only
function verifyPassword(password) {
  return password === config.password;
}

module.exports = {
  createSession,
  validateSession,
  destroySession,
  requireAuth,
  verifyPassword
};
