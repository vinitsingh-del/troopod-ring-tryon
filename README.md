# TrooPod Ring Try-On

GPT Image-powered jewelry virtual try-on prototype for generating a final hand photo with the selected catalog ring placed on the selected finger.

## Run Locally

```bash
npm start
```

Then open `http://127.0.0.1:8787`.

## GPT Image Try-On

The app uses the local Node backend to call the OpenAI Image API:

- Upload a hand photo.
- Choose Gleam Play Diamond, Wave Ring, or Troquise Queen.
- Pick the target finger.
- Click `Fit Product` to generate the final try-on image with GPT Image.

## Environment

Keep the API key server-side in `.env.local` or the host environment:

```bash
OPENAI_API_KEY=your-openai-key-here
```

Do not put secrets in `index.html` or browser JavaScript. GitHub Pages can host the static UI, but GPT Image generation needs a deployed backend URL configured with `window.TROOPOD_BACKEND_URL`.
