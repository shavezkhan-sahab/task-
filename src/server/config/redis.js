const Redis = require('ioredis');

let client;

async function connectRedis() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  client = new Redis(url);

  client.on('error', (err) => console.error('Redis error:', err));

  // Seed stock key if it doesn't exist yet
  const TOTAL = parseInt(process.env.TOTAL_STOCK || '20', 10);
  const exists = await client.exists('sneakdrop:stock');
  if (!exists) {
    await client.set('sneakdrop:stock', TOTAL);
    console.log(`Redis: stock initialised to ${TOTAL}`);
  } else {
    const current = await client.get('sneakdrop:stock');
    console.log(`Redis: stock already set to ${current}`);
  }

  console.log('Redis connected');
  return client;
}

function getRedis() {
  if (!client) throw new Error('Redis not initialised');
  return client;
}

module.exports = { connectRedis, getRedis };
