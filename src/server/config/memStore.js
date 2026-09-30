/**
 * memStore.js  –  In-memory replacement for Redis
 *
 * Node.js is single-threaded, so plain Map operations are already atomic
 * (no two callbacks can interleave mid-mutation).  This gives us the same
 * race-free guarantees that Redis Lua scripts gave us, without requiring
 * any external process.
 *
 * Structure:
 *   stock        – integer (available pairs)
 *   holds        – Map<userId, { paymentRef, expiresAt: Date, timer: Timeout }>
 *
 * When a TTL fires the hold is deleted and an optional onExpire callback
 * is called so the watcher can promote the next waitlist user.
 */

const TOTAL_STOCK = parseInt(process.env.TOTAL_STOCK || '20', 10);

let stock = TOTAL_STOCK;
const holds = new Map(); // userId → { paymentRef, expiresAt, timer }

// Callback invoked when a hold's TTL expires naturally.
// Wired up by holdExpiryWatcher.js at startup.
let _onExpire = null;
function setExpireCallback(fn) { _onExpire = fn; }

// ── stock ────────────────────────────────────────────────────────────────────

function getStock()          { return stock; }
function incrementStock()    { stock += 1; }
function decrementStock()    { stock -= 1; }
function resetStock(n)       { stock = n; }

// ── holds ────────────────────────────────────────────────────────────────────

/**
 * Atomically: check stock > 0, decrement, and create hold with TTL.
 * Returns { ok: true, paymentRef, expiresAt } or { ok: false }.
 */
function acquireHoldSync(userId, paymentRef, ttlSeconds) {
  if (stock <= 0) return { ok: false };

  // Clear any stale hold (shouldn't happen, but be safe)
  _clearHold(userId, false);

  stock -= 1;

  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const timer = setTimeout(() => _expireHold(userId), ttlSeconds * 1000);
  holds.set(userId, { paymentRef, expiresAt, timer });

  return { ok: true, paymentRef, expiresAt };
}

/**
 * Release a hold and restore stock.
 * Returns true if a hold existed and was released.
 */
function releaseHoldSync(userId) {
  if (!holds.has(userId)) return false;
  _clearHold(userId, true); // restores stock
  return true;
}

/**
 * Confirm payment: remove hold WITHOUT restoring stock (pair is sold).
 * Returns: 1 = ok, 0 = hold already gone, -1 = paymentRef mismatch.
 */
function confirmHoldSync(userId, paymentRef) {
  const hold = holds.get(userId);
  if (!hold) return 0;
  if (hold.paymentRef !== paymentRef) return -1;
  _clearHold(userId, false); // does NOT restore stock
  return 1;
}

/**
 * Promote a waitlist user: give them a fresh hold WITHOUT touching stock
 * (stock was already decremented when the original hold was acquired).
 */
function promoteHoldSync(userId, paymentRef, ttlSeconds) {
  _clearHold(userId, false);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const timer = setTimeout(() => _expireHold(userId), ttlSeconds * 1000);
  holds.set(userId, { paymentRef, expiresAt, timer });
  return expiresAt;
}

function getHold(userId)    { return holds.get(userId) || null; }
function hasHold(userId)    { return holds.has(userId); }

/** TTL in seconds remaining, or -2 if no hold. */
function getHoldTTLSeconds(userId) {
  const hold = holds.get(userId);
  if (!hold) return -2;
  return Math.max(0, Math.floor((hold.expiresAt - Date.now()) / 1000));
}

// ── private ──────────────────────────────────────────────────────────────────

function _clearHold(userId, restoreStock) {
  const hold = holds.get(userId);
  if (!hold) return;
  clearTimeout(hold.timer);
  holds.delete(userId);
  if (restoreStock) stock += 1;
}

function _expireHold(userId) {
  const hold = holds.get(userId);
  if (!hold) return; // already gone (paid / released manually)
  holds.delete(userId);
  stock += 1; // return to stock
  console.log(`[memStore] Hold expired for user ${userId}, stock now ${stock}`);
  if (_onExpire) _onExpire(userId);
}

// ── init ──────────────────────────────────────────────────────────────────────

function initStore() {
  stock = TOTAL_STOCK;
  // Clear any leftover timers (e.g. nodemon restart)
  for (const [uid, hold] of holds) {
    clearTimeout(hold.timer);
  }
  holds.clear();
  console.log(`[memStore] Initialised — stock: ${stock}`);
}

module.exports = {
  initStore,
  setExpireCallback,
  getStock,
  incrementStock,
  decrementStock,
  resetStock,
  acquireHoldSync,
  releaseHoldSync,
  confirmHoldSync,
  promoteHoldSync,
  getHold,
  hasHold,
  getHoldTTLSeconds,
};
