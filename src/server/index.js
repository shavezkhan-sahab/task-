require('dotenv').config();
const express = require('express');
const http    = require('http');
const cors    = require('cors');
const { Server } = require('socket.io');

const connectDB = require('./config/db');
const { initStore } = require('./config/memStore');
const { startHoldExpiryWatcher } = require('./services/holdExpiryWatcher');
const { broadcastState } = require('./services/broadcaster');

const authRoutes    = require('./routes/auth');
const saleRoutes    = require('./routes/sale');
const paymentRoutes = require('./routes/payment');

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.set('io', io);

app.use(cors());
app.use(express.json());

app.use('/api/auth',    authRoutes);
app.use('/api/sale',    saleRoutes);
app.use('/api/payment', paymentRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  broadcastState(io, socket);
  socket.on('disconnect', () => console.log(`Socket disconnected: ${socket.id}`));
});

const PORT = process.env.PORT || 3000;

async function start() {
  await connectDB();          // MongoDB only — no Redis
  initStore();                // seed in-memory stock counter
  startHoldExpiryWatcher(io); // wire up TTL callbacks
  server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
