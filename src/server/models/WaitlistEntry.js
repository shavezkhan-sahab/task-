const mongoose = require('mongoose');

/**
 * WaitlistEntry stores a user's place in the waitlist queue.
 * Position is determined by createdAt (FIFO).
 */
const waitlistEntrySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  },
  { timestamps: true }
);

// Index so we can pop the earliest entry efficiently
waitlistEntrySchema.index({ createdAt: 1 });

module.exports = mongoose.model('WaitlistEntry', waitlistEntrySchema);
