# Earthflight Online

A responsive browser-based 3D globe flight-game starter using CesiumJS, Express, Socket.IO and MongoDB.

## Current starter features

- Registration and login with bcrypt password hashing, JWT sessions and basic rate limiting.
- Cesium globe, terrain activation when a Cesium ion token is configured, time-of-day slider, place search and coordinate destination input.
- Ten aircraft selection cards, including the two requested GLB URLs and eight additional aircraft categories.
- Basic browser flight movement, PC keyboard and mobile touch controls.
- Socket.IO pilot position broadcasting and a basic WebRTC voice-chat signaling flow.
- Optional Groq co-pilot endpoint and OpenWeather current-conditions endpoint.
- Render deployment manifest and responsive interface.

## Important scope notes

This is a playable prototype foundation, not a finished high-fidelity flight simulator. Several catalogue aircraft currently use illustrated cards rather than verified 3D models; only the A320 and Darkstar entries have the supplied GLB URLs. The first version does not yet load aircraft GLBs into the scene or attach a cockpit/chase camera, and the movement physics are simplified. The Cesium terrain layer needs a valid ion token and suitable assets. Production voice chat usually requires a TURN relay, not just STUN. Online pilot state is currently in-memory, not durable. OpenWeather current conditions do not provide colored global satellite/radar tile imagery; that requires a compatible weather-tile provider and its terms/API. "ClaudeFlare" is ambiguous and is not integrated; tell us the exact service/API before enabling generated landscapes.

## Deploy to Render

1. Push this repository to GitHub and open https://dashboard.render.com.
2. Choose **New + → Blueprint**, select this repository, and let Render read `render.yaml`.
3. Add the secret environment variables listed below in the Render service's Environment tab. Render generates `JWT_SECRET` from the blueprint; keep it private.
4. Create a MongoDB Atlas cluster, create a database user, allow network access from Render (for a quick test you may use `0.0.0.0/0`, with a strong DB password), and copy the Atlas connection string. Set the database name to `earthflight` and URL-encode special characters in the password.
5. For Cesium terrain/imagery, create a Cesium ion access token at https://ion.cesium.com/ and set `CESIUM_ION_TOKEN`.
6. Save environment variables and deploy. Visit the Render URL and register a test account.

## Environment variables

Required:
- `MONGODB_URI`: MongoDB Atlas connection URI.
- `JWT_SECRET`: long random secret used to sign login tokens.

Optional:
- `CESIUM_ION_TOKEN`: Cesium ion token for terrain and hosted assets.
- `GROQ_API_KEY`: Groq API key for the AI co-pilot.
- `GROQ_MODEL`: optional model ID, defaults to `llama-3.3-70b-versatile`.
- `OPENWEATHER_API_KEY`: OpenWeather API key for current local conditions.
- `CORS_ORIGIN`: optional allowed origin for Socket.IO; keep unset for same-origin Render deployment.
- `PORT`: provided by Render automatically; do not normally set manually.

Never commit real API keys or `.env` to GitHub. If a secret is accidentally committed, rotate it.

## Local development

```sh
npm install
cp .env.example .env
npm start
```

Open http://localhost:10000. Set the variables in `.env` first.

## Suggested next engineering milestones

1. Replace placeholder aircraft cards with validated GLB models and load them via Cesium primitives or Three.js/Cesium integration.
2. Add proper aircraft chase/cockpit camera, physics, collisions, takeoff/landing, route line and flight instruments.
3. Persist authenticated pilot identity in socket handshakes; validate and rate-limit all socket events.
4. Use a TURN provider for reliable voice and add consent/mute controls.
5. Integrate a licensed weather tile service for global overlays and confirm the intended landscape-generation provider.
6. Add tests, logging, monitoring and security review before public launch.
