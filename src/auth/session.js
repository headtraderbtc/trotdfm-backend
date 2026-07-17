const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const SESSION_COOKIE = 'trotdfm_session';

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

function signSession(member) {
  return jwt.sign(
    { sub: member.id, email: member.email, role: member.role, name: member.name },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function verifySession(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

/* Express middleware: attaches req.member if a valid session cookie exists */
function attachMember(req, res, next) {
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  if (token) {
    const payload = verifySession(token);
    if (payload) req.member = payload;
  }
  next();
}

/* Express middleware: blocks the request unless logged in */
function requireMember(req, res, next) {
  if (!req.member) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

/* Express middleware: blocks the request unless logged in AND role=admin */
function requireAdmin(req, res, next) {
  if (!req.member || req.member.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = {
  hashPassword, verifyPassword,
  signSession, verifySession,
  attachMember, requireMember, requireAdmin,
  SESSION_COOKIE
};
