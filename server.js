import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) console.warn('WARNING: Set JWT_SECRET in production.');

const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || true },
  maxHttpBufferSize: 1e6,
  pingInterval: 25000,
  pingTimeout: 20000
});
app.set('trust proxy', 1);
app.use(express.json({ limit: '30kb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }));
app.use('/api/assistant', rateLimit({ windowMs: 60 * 1000, limit: 20 }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/cesium', express.static(path.join(__dirname, 'node_modules/cesium/Build/Cesium')));
app.get('/config.js', (_req, res) => res.type('application/javascript').send(
  'window.GAME_CONFIG = ' + JSON.stringify({
    cesiumIonToken: process.env.CESIUM_ION_TOKEN || '',
    groqEnabled: !!process.env.GROQ_API_KEY,
    weatherEnabled: !!process.env.OPENWEATHER_API_KEY,
    weatherTilesEnabled: !!process.env.OPENWEATHER_API_KEY
  }) + ';'
));

let User;
if (process.env.MONGODB_URI) {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const schema = new mongoose.Schema({
      username: { type: String, unique: true, required: true, minlength: 3, maxlength: 24 },
      passwordHash: { type: String, required: true },
      planeId: { type: String, default: 'a320' },
      lastPosition: { lat: Number, lon: Number, altitude: Number },
      createdAt: { type: Date, default: Date.now }
    });
    User = mongoose.models.User || mongoose.model('User', schema);
    console.log('MongoDB connected');
  } catch (e) { console.error('MongoDB connection failed:', e.message); }
} else console.warn('MONGODB_URI is not set; authentication is unavailable until configured.');

function auth(req, res, next) {
  try {
    if (!JWT_SECRET) throw new Error('JWT_SECRET is not configured');
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Please sign in again.' }); }
}
app.post('/api/auth/register', async (req, res) => {
  try {
    if (!User || !JWT_SECRET) return res.status(503).json({ error: 'Server setup incomplete. Configure MONGODB_URI and JWT_SECRET.' });
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–24 letters, numbers, _ or -.' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const user = await User.create({ username, passwordHash: await bcrypt.hash(password, 12) });
    const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { username, planeId: user.planeId } });
  } catch (e) { res.status(e.code === 11000 ? 409 : 500).json({ error: e.code === 11000 ? 'That username is already taken.' : 'Registration failed.' }); }
});
app.post('/api/auth/login', async (req, res) => {
  try {
    if (!User || !JWT_SECRET) return res.status(503).json({ error: 'Server setup incomplete. Configure MONGODB_URI and JWT_SECRET.' });
    const username = String(req.body.username || '').trim();
    const user = await User.findOne({ username });
    if (!user || !await bcrypt.compare(String(req.body.password || ''), user.passwordHash)) return res.status(401).json({ error: 'Invalid username or password.' });
    res.json({ token: jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: '7d' }), user: { username, planeId: user.planeId, lastPosition: user.lastPosition } });
  } catch { res.status(500).json({ error: 'Login failed.' }); }
});
app.get('/api/me', auth, async (req, res) => {
  const u = await User?.findById(req.user.id).select('username planeId lastPosition');
  if (!u) return res.status(404).json({ error: 'User not found.' });
  res.json(u);
});
const AIRCRAFT_IDS = new Set(['a320','darkstar','cessna172','f16','f22','boeing787','spitfire','helicopter','glider','fighter']);
app.patch('/api/me/plane', auth, async (req, res) => {
  if (!AIRCRAFT_IDS.has(req.body.planeId)) return res.status(400).json({ error: 'Unknown aircraft.' });
  await User?.updateOne({ _id: req.user.id }, { planeId: req.body.planeId });
  res.json({ ok: true });
});
app.patch('/api/me/position', auth, async (req, res) => {
  const { lat, lon, altitude } = req.body;
  if (![lat, lon, altitude].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || altitude < 0 || altitude > 65000) return res.status(400).json({ error: 'Invalid position.' });
  await User?.updateOne({ _id: req.user.id }, { lastPosition: { lat, lon, altitude } });
  res.json({ ok: true });
});

app.post('/api/assistant', auth, async (req, res) => {
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'AI co-pilot is not configured. Add GROQ_API_KEY in Render Environment.' });
  const message = String(req.body.message || '').trim().slice(0, 2000);
  if (!message) return res.status(400).json({ error: 'Enter a message for your co-pilot.' });
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are the Earthflight Online aviation co-pilot. Help with geography, flight planning, aviation concepts, and reading the current instruments. Never claim to control the aircraft or to have live weather unless it is included in the provided context. Be concise and safety-conscious.' },
          { role: 'user', content: message + '\nFlight context: ' + JSON.stringify({
            position: req.body.position || null,
            aircraft: String(req.body.aircraft || 'unknown').slice(0, 40),
            heading: Number.isFinite(req.body.heading) ? req.body.heading : null,
            speedKts: Number.isFinite(req.body.speedKts) ? req.body.speedKts : null,
            altitudeFt: Number.isFinite(req.body.altitudeFt) ? req.body.altitudeFt : null
          }) }
        ],
        temperature: 0.65,
        max_tokens: 600
      })
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('Groq API error:', response.status, data.error?.message || 'unknown error');
      return res.status(502).json({ error: 'Groq co-pilot request failed. Check the API key and model in Render.' });
    }
    res.json({ reply: data.choices?.[0]?.message?.content || 'No response available.' });
  } catch (e) {
    console.error('Groq request failed:', e.message);
    res.status(502).json({ error: 'Groq co-pilot is temporarily unavailable.' });
  }
});

const WEATHER_LAYERS = new Set(['temp_new', 'clouds_new', 'precipitation_new', 'wind_new', 'pressure_new']);
app.get('/api/weather/tiles/:layer/:z/:x/:y.png', async (req, res) => {
  if (!process.env.OPENWEATHER_API_KEY) return res.status(503).end('Weather tiles are not configured.');
  const { layer, z, x, y } = req.params;
  if (!WEATHER_LAYERS.has(layer) || ![z, x, y].every(v => /^\d{1,2}$/.test(v)) || Number(z) > 18) return res.status(400).end();
  try {
    const url = new URL('https://tile.openweathermap.org/map/' + layer + '/' + z + '/' + x + '/' + y + '.png');
    url.searchParams.set('appid', process.env.OPENWEATHER_API_KEY);
    const upstream = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!upstream.ok) return res.status(upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status).end('Weather tile provider rejected the request.');
    res.set('Content-Type', upstream.headers.get('content-type') || 'image/png');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch { res.status(502).end('Weather tile unavailable.'); }
});

app.get('/api/weather', auth, async (req, res) => {
  if (!process.env.OPENWEATHER_API_KEY) return res.status(503).json({ error: 'Weather is not configured. Add OPENWEATHER_API_KEY in Render Environment.' });
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return res.status(400).json({ error: 'Valid coordinates required.' });
  try {
    const url = new URL('https://api.openweathermap.org/data/2.5/weather');
    url.search = new URLSearchParams({ lat: String(lat), lon: String(lon), appid: process.env.OPENWEATHER_API_KEY, units: 'metric' });
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || 'Weather request failed');
    res.json({
      temperature: data.main?.temp,
      feelsLike: data.main?.feels_like,
      description: data.weather?.[0]?.description,
      icon: data.weather?.[0]?.icon,
      humidity: data.main?.humidity,
      windMs: data.wind?.speed,
      windDeg: data.wind?.deg,
      pressureHpa: data.main?.pressure,
      city: data.name
    });
  } catch { res.status(502).json({ error: 'Could not fetch current weather.' }); }
});

io.use((socket, next) => {
  try {
    if (!JWT_SECRET) throw new Error('JWT secret unavailable');
    const claims = jwt.verify(socket.handshake.auth?.token || '', JWT_SECRET);
    socket.data.pilot = { id: claims.id, username: String(claims.username || 'Pilot').slice(0, 24) };
    next();
  } catch { next(new Error('Authentication required for multiplayer.')); }
});
const pilots = new Map();
io.on('connection', socket => {
  const identity = socket.data.pilot;
  const pilot = { id: socket.id, userId: identity.id, username: identity.username, lat: 40.6413, lon: -73.7781, altitude: 1000, heading: 90, planeId: 'a320', speedKts: 0 };
  pilots.set(socket.id, pilot);
  socket.on('pilot:join', data => {
    if (!pilots.has(socket.id)) return;
    if (Number.isFinite(data?.lat) && Number.isFinite(data?.lon) && Math.abs(data.lat) <= 90 && Math.abs(data.lon) <= 180) {
      pilot.lat = data.lat; pilot.lon = data.lon;
    }
    if (Number.isFinite(data?.altitude) && data.altitude >= 0 && data.altitude <= 65000) pilot.altitude = data.altitude;
    if (AIRCRAFT_IDS.has(data?.planeId)) pilot.planeId = data.planeId;
    socket.emit('pilots:update', [...pilots.values()].map(p => ({ ...p })));
    socket.broadcast.emit('pilot:joined', { ...pilot });
  });
  socket.on('pilot:position', pos => {
    const now = Date.now();
    if (socket.data.lastPositionAt && now - socket.data.lastPositionAt < 70) return;
    socket.data.lastPositionAt = now;
    if (!pilots.has(socket.id) || ![pos?.lat, pos?.lon, pos?.altitude, pos?.heading, pos?.speedKts].every(Number.isFinite)) return;
    if (Math.abs(pos.lat) > 90 || Math.abs(pos.lon) > 180 || pos.altitude < 0 || pos.altitude > 65000 || pos.speedKts < 0 || pos.speedKts > 7000 || !AIRCRAFT_IDS.has(pos.planeId)) return;
    Object.assign(pilot, { lat: pos.lat, lon: pos.lon, altitude: pos.altitude, heading: ((pos.heading % 360) + 360) % 360, speedKts: pos.speedKts, planeId: pos.planeId });
    socket.broadcast.volatile.emit('pilot:moved', { ...pilot });
  });
  socket.on('voice:offer', data => {
    if (typeof data?.to === 'string' && data.offer && pilots.has(data.to)) io.to(data.to).emit('voice:offer', { from: socket.id, offer: data.offer });
  });
  socket.on('voice:answer', data => {
    if (typeof data?.to === 'string' && data.answer && pilots.has(data.to)) io.to(data.to).emit('voice:answer', { from: socket.id, answer: data.answer });
  });
  socket.on('voice:ice', data => {
    if (typeof data?.to === 'string' && data.candidate && pilots.has(data.to)) io.to(data.to).emit('voice:ice', { from: socket.id, candidate: data.candidate });
  });
  socket.on('disconnect', () => { pilots.delete(socket.id); io.emit('pilot:left', socket.id); });
});
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'earthflight-online', database: mongoose.connection.readyState === 1, weather: !!process.env.OPENWEATHER_API_KEY, groq: !!process.env.GROQ_API_KEY }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
server.listen(PORT, () => console.log('Earthflight listening on ' + PORT));