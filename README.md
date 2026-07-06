# TrooPod Ring Try-On

Exact jewelry virtual try-on prototype for placing a selected catalog ring image onto an uploaded hand photo without repainting the hand or changing the product image.

## Run Locally

```bash
npm start
```

Then open `http://127.0.0.1:8787`.

## Exact Try-On

The app runs in the browser:

- Upload a hand photo.
- Choose Gleam Play Diamond, Wave Ring, or Troquise Queen.
- Pick the target finger.
- Click `Fit Product` to create the final try-on image using the original hand pixels and the exact selected product image.

## Notes

The current exact try-on flow does not call GPT for the final pixels. This is intentional so the hand photo and selected product image are not repainted or changed.
