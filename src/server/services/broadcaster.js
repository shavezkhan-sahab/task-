/**
 * broadcaster.js
 *
 * Pushes the current sale state to connected Socket.IO clients.
 * Each client can identify themselves by userId and receive personalised data.
 */

const { getStock } = require('./stockService');
const WaitlistEntry = require('../models/WaitlistEntry');

/**
 * Emit global state to all clients (or just one socket if provided).
 * Per-user data (hold TTL, queue position) is fetched client-side via REST.
 */
async function broadcastState(io, socket) {
  try {
    const stock = await getStock();
    const queueLength = await WaitlistEntry.countDocuments();

    const payload = { stock, queueLength, timestamp: Date.now() };

    if (socket) {
      socket.emit('state', payload);
    } else {
      io.emit('state', payload);
    }
  } catch (err) {
    console.error('broadcastState error:', err);
  }
}

module.exports = { broadcastState };
