const mongoose = require('mongoose');

/**
 * An Order is created once payment is confirmed.
 * A user can have at most 2 Orders (enforced by User.purchasedCount).
 */
const orderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    paymentRef: { type: String, required: true, unique: true },
    status: { type: String, enum: ['paid'], default: 'paid' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Order', orderSchema);
