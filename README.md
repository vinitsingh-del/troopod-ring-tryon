# TrooPod Ring Try-On

GPT-protected jewelry virtual try-on prototype for placing a selected catalog ring image onto an uploaded hand photo without allowing the final hand or product pixels to be overwritten.

## Run Locally

```bash
npm start
```

Then open `http://127.0.0.1:8787`.

## GPT-Protected Exact Try-On

The app uses GPT Image for a local try-on pass, then protects the final pixels in the browser:

- Upload a hand photo.
- Choose Gleam Play Diamond, Wave Ring, or Troquise Queen.
- Pick the target finger.
- Click `Fit Product`; GPT analyzes placement and generates the local try-on effect.
- Canvas restores the uploaded hand as the base and overlays the exact selected product image.

## Notes

GPT Image can reinterpret photos, so the app does a final protection pass. The final hand base comes from the original upload, and the visible ring comes from the selected product image.
