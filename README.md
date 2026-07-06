# TrooPod Ring Try-On

GPT-guided jewelry virtual try-on prototype for placing a selected catalog ring image onto an uploaded hand photo without repainting the hand or changing the product image.

## Run Locally

```bash
npm start
```

Then open `http://127.0.0.1:8787`.

## GPT-Guided Exact Try-On

The app uses GPT only for placement geometry, then renders the final output in the browser:

- Upload a hand photo.
- Choose Gleam Play Diamond, Wave Ring, or Troquise Queen.
- Pick the target finger.
- Click `Fit Product`; GPT returns center, scale, and rotation.
- Canvas creates the final try-on image using the original hand pixels and the exact selected product image.

## Notes

GPT is not used to generate the final pixels. This is intentional so the hand photo and selected product image are not repainted or changed.
