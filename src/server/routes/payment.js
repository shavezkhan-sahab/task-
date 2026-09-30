/**
 * payment.js
 *
 * POST /api/payment/pay      – client initiates a payment for their hold
 * POST /api/payment/webhook  – fake gateway sends success/failure notification
 *
 * The webhook handler is idempotent: processing the same paymentRef twice
 * is a no-op (Order.create throws a duplicate key error which we swallow).
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { confirmHold } = require('../services/stockService');
const { initiatePayment } = require('../services/fakePaymentGateway');
const { broadcastState } = require('../services/broadcaster');
const Hold = require('../models/Hold');
const Order = require('../models/Order');
const User = require('../models/User');
const WaitlistEntry = require('../models/WaitlistEntry');

const router = express.Router();

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'sneakdrop-secret';

// ── POST /api/payment/pay ────────────────────────────────────────────────────
// Client-side "Pay Now" button hits this endpoint.
// We just tell the fake gateway to fire a webhook; we do NOT confirm here.
router.post('/pay', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();

    // Look up their active hold
    const hold = await Hold.findOne({ userId: req.user._id });
    if (!hold) {
      return res.status(404).json({ error: 'No active hold found. Please click Buy first.' });
    }

    if (hold.expiresAt < new Date()) {
      return res.status(410).json({ error: 'Your hold has expired' });
    }

    // Tell the fake gateway to process it (fires async webhook)
    const gatewayResponse = initiatePayment(hold.paymentRef, userId);

    res.json({
      message: 'Payment initiated. Waiting for confirmation...',
      ...gatewayResponse,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/payment/webhook ────────────────────────────────────────────────
// Called by the fake payment gateway (and occasionally twice, late, or both).
router.post('/webhook', async (req, res) => {
  // Simple shared-secret validation
  const secret = req.headers['x-webhook-secret'];
  if (secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  const { event, paymentRef, userId } = req.body;

  if (!event || !paymentRef || !userId) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  // Acknowledge immediately so the gateway doesn't retry
  res.json({ received: true });

  // Process asynchronously
  processWebhook(event, paymentRef, userId, req.app.get('io')).catch((err) =>
    console.error('Webhook processing error:', err)
  );
});

async function processWebhook(event, paymentRef, userId, io) {
  if (event !== 'payment.succeeded') {
    console.log(`[Webhook] Ignoring event: ${event}`);
    return;
  }

  console.log(`[Webhook] payment.succeeded ref=${paymentRef} user=${userId}`);

  // ── Idempotency check ────────────────────────────────────────────────────
  // If we've already created an Order for this paymentRef, do nothing.
  const existingOrder = await Order.findOne({ paymentRef });
  if (existingOrder) {
    console.log(`[Webhook] Duplicate – order already exists for ref=${paymentRef}`);
    return;
  }

  // ── Confirm the hold in Redis ────────────────────────────────────────────
  const confirmResult = await confirmHold(userId, paymentRef);
  // confirmResult: 1=ok, 0=hold already gone, -1=ref mismatch

  if (confirmResult === -1) {
    console.warn(`[Webhook] paymentRef mismatch for user=${userId}`);
    return;
  }
  // Even if confirmResult===0 (hold already expired), continue creating the
  // order if the payment genuinely went through – the stock was already
  // decremented and the hold expired only because our TTL was tight.
  // In a real system you'd decide policy here; we accept it.

  // ── Create the Order (idempotent via unique index on paymentRef) ─────────
  try {
    await Order.create({ userId, paymentRef });
  } catch (err) {
    if (err.code === 11000) {
      console.log(`[Webhook] Race – order already created for ref=${paymentRef}`);
      return;
    }
    throw err;
  }

  // ── Remove the Hold record from Mongo ───────────────────────────────────
  await Hold.deleteOne({ userId, paymentRef });

  // ── Increment purchased count on the User ───────────────────────────────
  await User.findByIdAndUpdate(userId, { $inc: { purchasedCount: 1 } });

  // ── Remove from waitlist if somehow still there ──────────────────────────
  await WaitlistEntry.deleteOne({ userId });

  console.log(`[Webhook] Order confirmed for user=${userId} ref=${paymentRef}`);

  // ── Broadcast updated state ──────────────────────────────────────────────
  broadcastState(io);
}

module.exports = router;
