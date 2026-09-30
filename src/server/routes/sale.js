/**
 * sale.js – routes for stock status, buying, and waitlist
 *
 * POST /api/sale/buy        – attempt to reserve a pair
 * POST /api/sale/waitlist   – join the waiting line
 * DELETE /api/sale/waitlist – leave the waiting line
 * GET  /api/sale/status     – personal status (hold TTL, queue position, etc.)
 * GET  /api/sale/state      – public state (stock, queue length)
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  acquireHold,
  getStock,
  getHoldTTL,
  getHoldRef,
  HOLD_TTL,
} = require('../services/stockService');
const {
  joinWaitlist,
  leaveWaitlist,
  getWaitlistPosition,
} = require('../services/waitlistService');
const Hold = require('../models/Hold');
const { broadcastState } = require('../services/broadcaster');

const router = express.Router();

// ── GET /api/sale/state ──────────────────────────────────────────────────────
router.get('/state', async (req, res) => {
  try {
    const { getWaitlist } = require('../services/waitlistService');
    const stock = await getStock();
    const waitlist = await getWaitlist();
    res.json({ stock, queueLength: waitlist.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sale/status ─────────────────────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();

    const [stock, holdTTL, holdRef, queuePos, purchasedCount] = await Promise.all([
      getStock(),
      getHoldTTL(userId),
      getHoldRef(userId),
      getWaitlistPosition(userId),
      Promise.resolve(req.user.purchasedCount),
    ]);

    const hasHold = holdTTL > 0;

    res.json({
      stock,
      purchasedCount,
      maxAllowed: 2,
      remainingAllowed: Math.max(0, 2 - purchasedCount),
      hold: hasHold
        ? {
            paymentRef: holdRef,
            secondsLeft: holdTTL,
            expiresAt: new Date(Date.now() + holdTTL * 1000).toISOString(),
          }
        : null,
      queuePosition: queuePos,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sale/buy ───────────────────────────────────────────────────────
router.post('/buy', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();

    // Rule 2a: can only hold 1 pair at a time
    const existingTTL = await getHoldTTL(userId);
    if (existingTTL > 0) {
      return res.status(409).json({ error: 'You already have an active hold' });
    }

    // Rule 2b: max 2 total purchases
    if (req.user.purchasedCount >= 2) {
      return res.status(403).json({ error: 'You have already purchased the maximum of 2 pairs' });
    }

    const result = await acquireHold(userId);

    if (!result.ok) {
      return res.status(409).json({ error: 'out_of_stock', message: 'No pairs available. Join the waitlist.' });
    }

    // Persist hold in MongoDB (for expiry watcher)
    await Hold.create({
      userId: req.user._id,
      expiresAt: result.expiresAt,
      paymentRef: result.paymentRef,
    });

    // Tell all clients stock changed
    broadcastState(req.app.get('io'));

    res.status(201).json({
      message: 'Hold acquired! You have 5 minutes to pay.',
      paymentRef: result.paymentRef,
      expiresAt: result.expiresAt,
      holdSeconds: HOLD_TTL,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sale/waitlist ──────────────────────────────────────────────────
router.post('/waitlist', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();

    if (req.user.purchasedCount >= 2) {
      return res.status(403).json({ error: 'You have already purchased the maximum of 2 pairs' });
    }

    // Don't join if you already have a hold
    const existingTTL = await getHoldTTL(userId);
    if (existingTTL > 0) {
      return res.status(409).json({ error: 'You already have an active hold – no need to queue' });
    }

    const { position } = await joinWaitlist(userId);
    broadcastState(req.app.get('io'));

    res.status(201).json({ message: 'Added to waitlist', position });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/sale/waitlist ────────────────────────────────────────────────
router.delete('/waitlist', requireAuth, async (req, res) => {
  try {
    await leaveWaitlist(req.user._id.toString());
    broadcastState(req.app.get('io'));
    res.json({ message: 'Removed from waitlist' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
