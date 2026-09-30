const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function signToken(userId) {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET || 'supersecretkey',
    { expiresIn: '7d' }
  );
}

function userPayload(user) {
  return { id: user._id, username: user.username, email: user.email };
}

// ── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email and password are all required' });
    }

    if (!email.toLowerCase().endsWith('@gmail.com')) {
      return res.status(400).json({ error: 'Only Gmail addresses (@gmail.com) are accepted' });
    }

    const user = await User.create({
      username: username.trim(),
      email: email.toLowerCase().trim(),
      password,
    });

    const token = signToken(user._id);
    return res.status(201).json({ token, user: userPayload(user) });

  } catch (err) {
    if (err.code === 11000) {
      const field = err.keyPattern?.email ? 'email' : 'username';
      return res.status(409).json({ error: `That ${field} is already registered` });
    }
    if (err.name === 'ValidationError') {
      const msg = Object.values(err.errors).map(e => e.message).join(', ');
      return res.status(400).json({ error: msg });
    }
    console.error('Register error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────
// Accepts either username OR Gmail in the "identifier" field
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'username/email and password are required' });
    }

    const identifier = username.trim();
    const user = await User.findOne({
      $or: [
        { username: identifier },
        { email: identifier.toLowerCase() },
      ],
    });

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user._id);
    return res.json({ token, user: userPayload(user) });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const { _id, username, email, purchasedCount, createdAt } = req.user;
  res.json({ id: _id, username, email, purchasedCount, createdAt });
});

module.exports = router;
