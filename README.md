# TrooPod Ring Try-On

Deterministic jewelry virtual try-on prototype for fitting catalog ring product images onto an uploaded hand photo.

## Run Locally

```bash
npm start
```

Then open `http://127.0.0.1:8787`.

## Catalog Try-On

The GitHub Pages app runs in the browser:

- Upload a hand photo.
- Choose Gleam Play Diamond, Wave Ring, or Troquise Queen.
- Pick the target finger.
- Click `Fit Product` to place the exact selected product image on the hand photo.

## Optional Backend

The Node backend is kept for future server-side image workflows. If you use it, keep any API keys in `.env.local` or the host environment. Do not put secrets in `index.html` or browser JavaScript.
