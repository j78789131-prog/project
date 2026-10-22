# Earthflight Online

A browser-based Earth flight game prototype using CesiumJS, Express, Socket.IO, MongoDB, WebRTC and Groq.

## Current implementation

- Account registration/login with bcrypt password hashing, JWTs and basic rate limiting.
- Cesium globe with satellite imagery when a Cesium ion token is configured, plus global elevation terrain.
- Ten aircraft choices; aircraft render as glTF/GLB scene models. The A320 and Darkstar use configured public model URLs, while several other aircraft currently share a generic sample aircraft model until aircraft-specific, licensed models are supplied.
- Continuous coordinate-based flight movement, heading, throttle, altitude controls, route line, instrument HUD and chase/cockpit/free camera modes.
- Socket.IO multiplayer positions with server-side JWT authentication, coordinate validation and position update throttling.
- WebRTC peer-to-peer microphone voice chat with mute control. STUN is configured; some networks require a separately configured TURN relay for reliable connectivity.
- OpenWeather current conditions and optional temperature/cloud/precipitation/wind/pressure map overlays through a server-side tile proxy.
- Groq co-pilot with current flight context passed from the browser.
- Render health endpoint at /api/health.

## Important limitations

This is a more capable playable prototype, not a certified or high-fidelity simulator. Flight dynamics are still simplified and do not yet implement full aerodynamic lift/stall, runway takeoff/landing, collisions, air traffic control, or instrument navigation. The model URLs are external and can change or become unavailable; the generic sample model is not the real aircraft for every selection. Use aircraft-specific GLB assets you have permission to distribute.

Cesium terrain and high-resolution imagery require a valid Cesium ion token with appropriate asset access. OpenWeather overlays require an API key and an account/plan that supports the requested map tile endpoints. Check the provider's current product terms, rate limits and attribution requirements. Weather tile access is proxied by this app so the key is not sent to the browser.

Voice chat uses peer-to-peer WebRTC. STUN alone is not sufficient for every network; reliable public voice typically needs a TURN provider. The app does not record audio. Multiplayer pilot positions are in memory on the server, not persisted or shared across multiple Render instances.

## Deploy on Render as a Web Service (not Blueprint)

1. Open https://dashboard.render.com and choose New + → Web Service.
2. Connect this repository and select the feature/real-world-flight branch for this feature preview, or merge the branch into main first and deploy main.
3. Use Node; build command: npm install; start command: npm start; health check path: /api/health. Leave Root Directory blank.
4. In the service's Environment tab, set the required variables below. Do not put secret keys in GitHub.
5. Deploy and open the Render-provided service URL.

## Environment variables

Required for account registration/login and authenticated multiplayer:
- MONGODB_URI: MongoDB Atlas connection URI.
- JWT_SECRET: long random secret used to sign tokens.

Optional:
- CESIUM_ION_TOKEN: Cesium ion token for detailed imagery and elevation terrain.
- GROQ_API_KEY: Groq API key for the AI co-pilot.
- GROQ_MODEL: optional Groq model ID; defaults to llama-3.3-70b-versatile.
- OPENWEATHER_API_KEY: OpenWeather current conditions and map overlays (availability depends on your provider plan).
- CORS_ORIGIN: optional Socket.IO origin policy; keep unset for same-origin deployment.
- PORT: supplied by Render; do not normally set manually.

Never commit real API keys or .env to GitHub. If a secret is accidentally committed, rotate it.

## Local development

    npm install
    cp .env.example .env
    npm start

Open http://localhost:10000. Configure environment variables before signing in.

## Next milestones

1. Replace generic aircraft with verified, licensed, aircraft-specific models and tune their model orientation/scale.
2. Improve aerodynamic simulation, terrain collision, runway operations and flight instrumentation.
3. Add a managed TURN service and improve voice reconnect/room controls.
4. Persist online session state if deploying multiple server instances; use a Socket.IO adapter for horizontal scaling.
5. Add automated tests, observability, accessibility and security review before public launch.