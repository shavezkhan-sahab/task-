/**
 * waitlistService.js
 *
 * Manages the FIFO waiting list using MongoDB.
 * When stock becomes available (hold expires), we pop the earliest entry
 * and give them a hold.
 */

const WaitlistEntry = require('../models/WaitlistEntry');
const Hold = require('../models/Hold');
const { promoteHold } = require('./stockService');
const { v4: uuidv4 } = require('uuid');

const HOLD_TTL = parseInt(process.env.HOLD_TTL_SECONDS || '300', 10);

/**
 * Add userId to the waitlist.
 * Silently ignores if already queued.
 * @returns {{ position: number }}
 */
async function joinWaitlist(userId) {
  try {
    await WaitlistEntry.create({ userId });
  } catch (err) {
    if (err.code !== 11000) throw err; // ignore duplicate key
  }
  const position = await getWaitlistPosition(userId);
  return { position };
}

/**
 * Remove userId from the waitlist (e.g. they got promoted or cancelled).
 */
async function leaveWaitlist(userId) {
  await WaitlistEntry.deleteOne({ userId });
}

/**
 * 1-based position of userId in queue, or null if not in queue.
 */
async function getWaitlistPosition(userId) {
  const entry = await WaitlistEntry.findOne({ userId });
  if (!entry) return null;
  const ahead = await WaitlistEntry.countDocuments({ createdAt: { $lt: entry.createdAt } });
  return ahead + 1;
}

/**
 * Promote the first person in the waitlist to a hold.
 * Called when a hold expires and stock becomes available.
 * @returns {Object|null} the WaitlistEntry that was promoted, or null
 */
async function promoteNext() {
  // Grab the oldest entry
  const entry = await WaitlistEntry.findOne().sort({ createdAt: 1 });
  if (!entry) return null;

  const paymentRef = uuidv4();
  const expiresAt = await promoteHold(entry.userId.toString(), paymentRef);

  // Write a Hold record
  await Hold.create({
    userId: entry.userId,
    expiresAt,
    paymentRef,
  });

  // Remove from waitlist
  await WaitlistEntry.deleteOne({ _id: entry._id });

  return { userId: entry.userId, paymentRef, expiresAt };
}

/**
 * Return entire waitlist (for debugging / admin).
 */
async function getWaitlist() {
  return WaitlistEntry.find().sort({ createdAt: 1 }).populate('userId', 'username');
}

module.exports = {
  joinWaitlist,
  leaveWaitlist,
  getWaitlistPosition,
  promoteNext,
  getWaitlist,
};
