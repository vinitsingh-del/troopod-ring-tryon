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
- Click `Fit Product`; GPT receives the hand photo, selected product image, target finger, placement guide, and guarded edit mask.
- GPT generates the final image with the ring worn on the selected finger.

## Notes

The guarded edit mask is kept tight around the ring placement area so GPT focuses on seating the ring while preserving the rest of the uploaded hand photo.
