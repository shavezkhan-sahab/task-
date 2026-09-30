/**
 * fakePaymentGateway.js
 *
 * Simulates a real-world payment provider that sends a webhook callback
 * to our server after "processing" the payment.
 *
 * Real providers are messy:
 *   - The webhook can arrive late  (random delay 500ms – 8s)
 *   - It can be sent twice          (20% chance of a duplicate)
 *   - It can arrive out-of-order    (we model this by occasionally sending
 *                                    the "success" webhook before returning
 *                                    a response to the client)
 *
 * This function fires-and-forgets the webhook to our own endpoint so the
 * payment route handler can return to the client immediately (just like
 * a real Stripe/PayPal integration would).
 */

const axios = require('axios');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const MIN_DELAY = 500;
const MAX_DELAY = parseInt(process.env.FAKE_PAYMENT_DELAY_MS || '2000', 10);

function randomDelay() {
  return MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);
}

async function sendWebhook(paymentRef, userId, succeed = true) {
  const delay = randomDelay();
  const payload = {
    event: succeed ? 'payment.succeeded' : 'payment.failed',
    paymentRef,
    userId,
    ts: Date.now(),
  };

  setTimeout(async () => {
    try {
      await axios.post(`${BASE_URL}/api/payment/webhook`, payload, {
        headers: { 'x-webhook-secret': process.env.WEBHOOK_SECRET || 'sneakdrop-secret' },
        timeout: 5000,
      });
    } catch (err) {
      console.error('Fake webhook send error:', err.message);
    }
  }, delay);

  // 20% chance: send a duplicate webhook after an additional delay
  if (Math.random() < 0.2) {
    setTimeout(async () => {
      console.log(`[FakeGateway] Sending duplicate webhook for ${paymentRef}`);
      try {
        await axios.post(`${BASE_URL}/api/payment/webhook`, payload, {
          headers: { 'x-webhook-secret': process.env.WEBHOOK_SECRET || 'sneakdrop-secret' },
          timeout: 5000,
        });
      } catch (err) {
        console.error('Fake duplicate webhook error:', err.message);
      }
    }, delay + randomDelay());
  }
}

/**
 * Initiate a fake payment.
 * Returns immediately; webhook arrives asynchronously.
 */
function initiatePayment(paymentRef, userId) {
  console.log(`[FakeGateway] Payment initiated ref=${paymentRef} user=${userId}`);
  sendWebhook(paymentRef, userId, true);
  return { status: 'processing', paymentRef };
}

module.exports = { initiatePayment };
