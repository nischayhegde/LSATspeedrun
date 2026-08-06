# LSAT Tycoon Mobile

The Expo application is a lightweight native shell around the production React application. It renders the same routes and source code as desktop, including the Three.js office, Three.js world map, case runner, tutorial, sound system, progression, fonts, and account state.

There is no separate mobile interpretation of those screens. Responsive CSS in `frontend/src/mobile.css` handles smaller viewports while the native shell supplies safe-area handling, hardware back navigation, shared cookies, pull-to-refresh, and a connection fallback.

## Run locally

Start the backend and frontend from the repository root:

```sh
cd backend
../.venv/bin/flask --app run:app run --host 0.0.0.0 --port 5001
```

```sh
cd frontend
npm run dev -- --host 0.0.0.0
```

Copy `.env.example` to `.env` in this folder and set `EXPO_PUBLIC_WEB_APP_URL`:

- iOS Simulator: `http://127.0.0.1:5173`
- Android Emulator: `http://10.0.2.2:5173`
- Physical iPhone/Android: `http://YOUR-MAC-LAN-IP:5173`
- Store build: the deployed HTTPS website URL

Then start Expo:

```sh
npx expo start --lan
```

The phone must be able to reach the configured URL. `127.0.0.1` on a physical phone points to the phone, not the development computer.

## Production

Set `EXPO_PUBLIC_WEB_APP_URL` to the deployed HTTPS application before running EAS:

```sh
npx eas build --platform ios --profile preview
npx eas build --platform android --profile preview
npx eas build --platform all --profile production
```

Google Identity Services may restrict authentication inside an embedded browser. Before App Store submission, verify the production Google flow on physical iOS and Android devices; if Google blocks the embedded user agent, retain this exact UI and bridge only the authentication exchange through the system browser.
