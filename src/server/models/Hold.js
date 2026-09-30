const mongoose = require('mongoose');

/**
 * A Hold represents a reserved pair for a user that has not yet been paid for.
 * It is created when a user clicks Buy and removed when:
 *   - The user pays (→ Order is created, Hold is deleted)
 *   - The TTL expires (→ Hold is deleted, stock is returned)
 */
const holdSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    expiresAt: { type: Date, required: true },
    // idempotency key passed to the fake payment gateway
    paymentRef: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Hold', holdSchema);
