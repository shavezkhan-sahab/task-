# Notes

## How to run

### Requirements

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ | LTS recommended |
| MongoDB | 6+ | Must be running locally |
| Redis | 7+ | Must be running locally |

### 1. Start MongoDB and Redis

**MongoDB** (default port 27017):
```bash
# macOS with Homebrew
brew services start mongodb-community

# Windows
net start MongoDB

# Docker (any platform)
docker run -d -p 27017:27017 --name mongo mongo:7
```

**Redis** (default port 6379):
```bash
# macOS with Homebrew
brew services start redis

# Windows (via WSL or Docker)
docker run -d -p 6379:6379 --name redis redis:7

# Linux
sudo systemctl start redis
```

### 2. Set up environment variables

```bash
cp src/server/.env.example src/server/.env
```

Edit `src/server/.env` if your MongoDB/Redis URIs differ from the defaults.

### 3. Install dependencies

```bash
# Backend
cd src/server && npm install

# Frontend
cd src/client && npm install
```

### 4. Start the backend

```bash
cd src/server
npm run dev      # development (nodemon, auto-restarts)
# or
npm start        # production
```

The server starts on **http://localhost:3000**.

### 5. Start the frontend

```bash
cd src/client
npm run dev
```

The React app starts on **http://localhost:5173** and proxies `/api` and WebSocket to the backend automatically.

### 6. Open the app

Navigate to **http://localhost:5173** in your browser.
- Register a new account (or a few different ones in different tabs to simulate multiple users).
- Click **BUY** to reserve a pair.
- Click **PAY NOW** — a fake webhook will arrive within ~0–8 seconds and confirm your order.
- Once stock hits 0, click **JOIN WAITLIST**. When someone's hold expires, you'll automatically be promoted.

---

## Architecture & Design Decisions

### The core problem: overselling

The previous system failed because it used a read-modify-write pattern with no atomicity:

```
1. Read stock (20)         ← 1000 users read "20" simultaneously
2. Check if > 0            ← all 1000 see "yes"
3. Decrement               ← 1000 decrements happen → stock goes to -980
4. Create order            ← 1000 orders created
```

### The fix: Redis atomic operations

All stock mutations go through a **Lua script** executed atomically on Redis:

```lua
-- This runs as a single atomic operation. No race window exists.
local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil or stock <= 0 then
  return 0
end
redis.call('DECR', KEYS[1])
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
return 1
```

Even if 10,000 users click Buy at the exact same millisecond, only 20 will get a `1` back. The rest get `0`. No database read is involved in the critical path — Redis does the check and decrement in one atomic step.

### Hold system

- `POST /api/sale/buy` → tries to acquire a Redis hold. If successful, writes a `Hold` doc to MongoDB (for the expiry watcher).
- Redis key: `sneakdrop:hold:<userId>` with a 5-minute TTL.
- A **background watcher** polls MongoDB every 10 seconds for expired holds. When found: deletes the Hold, checks the waitlist, promotes the next person if any.

### Waitlist

- Stored in MongoDB as FIFO entries sorted by `createdAt`.
- When a hold expires, `promoteNext()` runs: pops the oldest entry, writes a new Redis hold key (without touching stock — it's already decremented), and creates a new Hold record.

### Fake payment gateway

`fakePaymentGateway.js` simulates real-world chaos:
- **Late**: webhook fires after a random 0.5–8 second delay.
- **Duplicate**: 20% of payments fire a second webhook after another random delay.
- **Out-of-order**: the webhook may arrive before the client's `/pay` request even returns.

The webhook handler at `POST /api/payment/webhook` is **idempotent**:
1. Checks for an existing `Order` with that `paymentRef` first.
2. Uses a MongoDB unique index on `paymentRef` as a second guard against duplicate inserts.
3. Even if two webhook deliveries race, the `Order.create` duplicate-key error is caught and silently ignored.

### Per-user rules

| Rule | Enforcement |
|---|---|
| 1 hold at a time | Redis: `GET sneakdrop:hold:<userId>` must be null before acquireHold |
| Max 2 purchases | `User.purchasedCount` field, checked before Buy and Waitlist actions |
| Hold expiry | Redis TTL (enforcement) + MongoDB poll (cleanup + waitlist promotion) |

### Real-time updates

Socket.IO pushes a `state` event to all connected clients whenever:
- A Buy succeeds
- A payment webhook is processed
- A hold expires and the watcher runs

The client also polls `/api/sale/status` every 5 seconds for personal data (hold countdown, queue position).

---

## Project structure

```
src/
  server/
    config/          — MongoDB + Redis connection setup
    models/          — Mongoose schemas (User, Hold, Order, WaitlistEntry)
    services/
      stockService.js        — all Redis stock mutations (Lua scripts)
      waitlistService.js     — FIFO waitlist logic
      holdExpiryWatcher.js   — background job: expire holds, promote waitlist
      broadcaster.js         — Socket.IO state broadcaster
      fakePaymentGateway.js  — simulates delayed/duplicate webhooks
    middleware/auth.js        — JWT verification
    routes/
      auth.js      — register, login
      sale.js      — buy, status, waitlist
      payment.js   — pay, webhook
    index.js       — app entry point
  client/
    src/
      App.jsx          — single-page UI (auth + sale panel)
      api.js           — fetch wrapper
      useSocket.js     — Socket.IO hook
    vite.config.js
```
