# TrooPod Ring Try-On

GPT Image jewelry virtual try-on prototype for generating a final hand photo with the selected catalog ring placed on the selected finger.

## Run Locally

```bash
npm start
```

Then open `http://127.0.0.1:8787`.

## GPT Image Try-On

The app uses GPT Image for the final try-on output:

- Upload a hand photo.
- Choose Gleam Play Diamond, Wave Ring, or Troquise Queen.
- Pick the target finger.
- Click `Fit Product`; GPT receives the hand photo, selected product image, target finger, placement guide, finger-segment mask, and a rough ring overlay draft.
- GPT generates the final image with the ring worn on the selected finger.

## Notes

The guarded edit mask is kept tight around the selected finger segment so GPT focuses on seating and blending the exact ring while preserving the rest of the uploaded hand photo.
