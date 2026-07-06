# TrooPod Ring Try-On

Deterministic/Mistral-guided jewelry virtual try-on prototype.

## Run Locally

```bash
npm start
```

Then open `http://127.0.0.1:8787`.

## Environment

Copy `.env.example` to `.env.local` and set:

```bash
MISTRAL_API_KEY=your-mistral-key-here
```

The API key must stay server-side. Do not put it in `index.html` or any browser JavaScript.

## GitHub Pages

GitHub Pages can host the static UI, but it cannot run the Node backend or protect `MISTRAL_API_KEY`.
For live generation from a GitHub Pages URL, deploy `free-image-backend.mjs` to a server platform and set `window.TROOPOD_BACKEND_URL` to that backend URL.
