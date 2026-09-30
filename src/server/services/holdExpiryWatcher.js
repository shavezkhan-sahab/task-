/**
 * holdExpiryWatcher.js
 *
 * With the in-memory store, hold TTLs fire via setTimeout callbacks directly.
 * We register an onExpire callback with memStore so when a hold naturally
 * expires we:
 *   1. Clean up the Hold record in MongoDB.
 *   2. Promote the next waitlist user (if any).
 *   3. Broadcast updated state to all Socket.IO clients.
 *
 * We also keep a safety-net poll every 30s that catches any Mongo Hold
 * records whose in-memory timer was lost (e.g. server restart).
 */

const store = require('../config/memStore');
const Hold  = require('../models/Hold');
const { releaseHold } = require('./stockService');
const { promoteNext } = require('./waitlistService');
const { broadcastState } = require('./broadcaster');

let _io = null;

function startHoldExpiryWatcher(io) {
  _io = io;

  // Register the callback that fires when a hold's setTimeout fires
  store.setExpireCallback(async (userId) => {
    try {
      await Hold.deleteOne({ userId });
      const promoted = await promoteNext();
      if (promoted) {
        console.log(`[Watcher] Waitlist: promoted user ${promoted.userId}`);
      }
      broadcastState(_io);
    } catch (err) {
      console.error('[Watcher] onExpire error:', err);
    }
  });

  // Safety-net: on startup clean up any stale Mongo Hold records from a
  // previous server run (their in-memory timers are gone after restart).
  setTimeout(() => cleanStaleMongHolds(io), 3000);

  // Re-run the safety net periodically
  setInterval(() => cleanStaleMongHolds(io), 60_000);

  console.log('[Watcher] Hold expiry watcher started (in-memory mode)');
}

async function cleanStaleMongHolds(io) {
  try {
    const now = new Date();
    const stale = await Hold.find({ expiresAt: { $lte: now } });
    for (const hold of stale) {
      const userId = hold.userId.toString();
      // releaseHold is a no-op if the timer already ran; it just makes sure
      // stock is correct if this is genuinely a restart-recovery scenario.
      await releaseHold(userId);
      await Hold.deleteOne({ _id: hold._id });
      const promoted = await promoteNext();
      if (promoted) {
        console.log(`[Watcher] Recovery: promoted user ${promoted.userId}`);
      }
    }
    if (stale.length > 0) broadcastState(io);
  } catch (err) {
    console.error('[Watcher] cleanStaleMongHolds error:', err);
  }
}

module.exports = { startHoldExpiryWatcher };
