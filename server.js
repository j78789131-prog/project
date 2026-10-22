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
const io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN || true } });
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) console.warn('WARNING: Set JWT_SECRET in production.');

app.set('trust proxy', 1);
app.use(express.json({ limit: '30kb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/cesium', express.static(path.join(__dirname, 'node_modules/cesium/Build/Cesium')));
app.get('/config.js', (_req, res) => res.type('application/javascript').send(
  'window.GAME_CONFIG = ' + JSON.stringify({ cesiumIonToken: process.env.CESIUM_ION_TOKEN || '', groqEnabled: !!process.env.GROQ_API_KEY, weatherEnabled: !!process.env.OPENWEATHER_API_KEY }) + ';'
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
    User = mongoose.model('User', schema);
    console.log('MongoDB connected');
  } catch (e) { console.error('MongoDB connection failed:', e.message); }
} else console.warn('MONGODB_URI is not set; authentication is unavailable until configured.');

function auth(req, res, next) {
  try {
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
app.patch('/api/me/plane', auth, async (req, res) => {
  const allowed = ['a320','darkstar','cessna172','f16','f22','boeing787','spitfire','helicopter','glider','fighter'];
  if (!allowed.includes(req.body.planeId)) return res.status(400).json({ error: 'Unknown aircraft.' });
  await User?.updateOne({ _id: req.user.id }, { planeId: req.body.planeId });
  res.json({ ok: true });
});
app.patch('/api/me/position', auth, async (req, res) => {
  const { lat, lon, altitude } = req.body;
  if (![lat, lon, altitude].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return res.status(400).json({ error: 'Invalid position.' });
  await User?.updateOne({ _id: req.user.id }, { lastPosition: { lat, lon, altitude } });
  res.json({ ok: true });
});
app.post('/api/assistant', auth, async (req, res) => {
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'AI guide is not configured yet.' });
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', messages: [
        { role: 'system', content: 'You are an engaging aviation and geography co-pilot. Explain real places and flight concepts. Be clear when you do not have live data.' },
        { role: 'user', content: String(req.body.message || '').slice(0, 2000) + (req.body.position ? '\nCurrent coordinates: ' + JSON.stringify(req.body.position) : '') }
      ], temperature: 0.7, max_tokens: 500 })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'AI request failed');
    res.json({ reply: data.choices?.[0]?.message?.content || 'No response available.' });
  } catch (e) { res.status(502).json({ error: e.message || 'AI service unavailable.' }); }
});
app.get('/api/weather', auth, async (req, res) => {
  if (!process.env.OPENWEATHER_API_KEY) return res.status(503).json({ error: 'Weather imagery is not configured.' });
  const { lat, lon } = req.query;
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return res.status(400).json({ error: 'Coordinates required.' });
  try {
    const url = new URL('https://api.openweathermap.org/data/2.5/weather');
    url.search = new URLSearchParams({ lat, lon, appid: process.env.OPENWEATHER_API_KEY, units: 'metric' });
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || 'Weather request failed');
    res.json({ temperature: data.main?.temp, description: data.weather?.[0]?.description, icon: data.weather?.[0]?.icon, humidity: data.main?.humidity });
  } catch { res.status(502).json({ error: 'Could not fetch weather.' }); }
});

const pilots = new Map();
io.on('connection', socket => {
  socket.on('pilot:join', data => {
    const p = { id: socket.id, username: String(data?.username || 'Pilot').slice(0,24), lat: 0, lon: 0, altitude: 1000, planeId: 'a320' };
    pilots.set(socket.id, p); socket.emit('pilots:update', [...pilots.values()]);
    socket.broadcast.emit('pilot:joined', p);
  });
  socket.on('pilot:position', pos => {
    if (!pilots.has(socket.id) || ![pos?.lat,pos?.lon,pos?.altitude].every(Number.isFinite) || Math.abs(pos.lat)>90 || Math.abs(pos.lon)>180) return;
    Object.assign(pilots.get(socket.id), { lat: pos.lat, lon: pos.lon, altitude: pos.altitude, planeId: String(pos.planeId || 'a320') });
    socket.broadcast.emit('pilot:moved', pilots.get(socket.id));
  });
  socket.on('voice:offer', ({ to, offer }) => { if (pilots.has(to)) io.to(to).emit('voice:offer', { from: socket.id, offer }); });
  socket.on('voice:answer', ({ to, answer }) => { if (pilots.has(to)) io.to(to).emit('voice:answer', { from: socket.id, answer }); });
  socket.on('voice:ice', ({ to, candidate }) => { if (pilots.has(to)) io.to(to).emit('voice:ice', { from: socket.id, candidate }); });
  socket.on('disconnect', () => { pilots.delete(socket.id); io.emit('pilot:left', socket.id); });
});
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'earthflight-online' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
server.listen(PORT, () => console.log('Earthflight listening on ' + PORT));
