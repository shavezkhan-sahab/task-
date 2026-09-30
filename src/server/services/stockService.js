/**
 * stockService.js
 *
 * All stock mutations go through memStore which uses Node.js's single-threaded
 * event loop for atomicity — no Redis required.
 *
 * The public API is intentionally kept identical to the old Redis version
 * so all callers (routes, watcher, waitlistService) need zero changes.
 */

const store = require('../config/memStore');
const { v4: uuidv4 } = require('uuid');

const HOLD_TTL = parseInt(process.env.HOLD_TTL_SECONDS || '300', 10);

/**
 * Try to acquire a hold for userId.
 * @returns {{ ok: true, paymentRef, expiresAt } | { ok: false, reason }}
 */
async function acquireHold(userId) {
  const paymentRef = uuidv4();
  const result = store.acquireHoldSync(userId, paymentRef, HOLD_TTL);
  if (!result.ok) return { ok: false, reason: 'out_of_stock' };
  return { ok: true, paymentRef, expiresAt: result.expiresAt };
}

/**
 * Release a hold and return the pair to stock.
 * @returns {boolean}
 */
async function releaseHold(userId) {
  return store.releaseHoldSync(userId);
}

/**
 * Confirm payment: remove hold WITHOUT restoring stock.
 * @returns {1 | 0 | -1}
 */
async function confirmHold(userId, paymentRef) {
  return store.confirmHoldSync(userId, paymentRef);
}

/**
 * Promote a waitlist user: fresh hold, stock already decremented.
 */
async function promoteHold(userId, paymentRef) {
  return store.promoteHoldSync(userId, paymentRef, HOLD_TTL);
}

/** Current available stock (integer). */
async function getStock() {
  return store.getStock();
}

/** paymentRef string or null. */
async function getHoldRef(userId) {
  const hold = store.getHold(userId);
  return hold ? hold.paymentRef : null;
}

/** Remaining TTL in seconds, or -2 if no hold. */
async function getHoldTTL(userId) {
  return store.getHoldTTLSeconds(userId);
}

/** Reset stock — used during initialisation. */
async function resetStock(amount) {
  store.resetStock(amount);
}

module.exports = {
  acquireHold,
  releaseHold,
  confirmHold,
  promoteHold,
  getStock,
  getHoldRef,
  getHoldTTL,
  resetStock,
  HOLD_TTL,
};
