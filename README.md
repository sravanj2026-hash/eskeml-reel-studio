# Eskeml AI Reel Studio

Drop a jewellery photo and the studio does the rest:

1. **Clean cut-out** with Photoroom, which works on any background (hands, velvet, shop counters).
2. **Claude** looks at the piece and writes its name, a tagline, an offer line, an Instagram caption with hashtags, and ideas for backdrops and camera motion. It also picks the 3 reel styles that suit the piece.
3. **Branded reels** render in the browser. There are 7 piece styles and 4 logo videos, with music and the Eskeml end card, in 9:16, 4:5 or 1:1.
4. **AI backdrop** (optional) uses Photoroom to place the piece on a newly generated scene, such as maroon velvet or marble with rose petals.
5. **AI motion clip** uses Runway to turn the photo into a 5 or 10 second clip with real camera and light movement.

Every AI feature is optional. With no keys set, the studio still works, using its built-in cut-out and animations.

## What you need

| Service | What it does | Where to get the key | Setting name |
|---|---|---|---|
| Photoroom API | Cut-outs and AI backdrops | photoroom.com/api, then Dashboard, then API keys | `PHOTOROOM_API_KEY` |
| Runway API | AI motion clips (image to video) | dev.runwayml.com, then API keys (buy credits first) | `RUNWAYML_API_SECRET` |
| Anthropic API | Claude writing the words | console.anthropic.com, then API keys | `ANTHROPIC_API_KEY` |
| *(optional)* | A passcode so only your team can spend credits | You choose it | `STUDIO_PASSCODE` |

All three services charge per use: per image (Photoroom), per second of video (Runway) and per request (Claude). Check each service's pricing page for current rates. Set `STUDIO_PASSCODE` before you share the link with anyone.

## Put it online (Vercel, free tier is enough)

1. Push this folder to your GitHub repo.
2. Go to vercel.com, sign in with GitHub, choose **Add New → Project** and pick the repo. Keep the default settings.
3. Under **Settings → Environment Variables**, add the keys from the table above.
4. Click **Deploy**. Vercel gives you a link like `eskeml-reel-studio.vercel.app`. Open it on a computer in Chrome or Edge.

After you add or change a key, redeploy so the app picks it up (**Deployments → ⋯ → Redeploy**).

## Run it on your computer

```bash
npm install
cp .env.example .env    # then paste your keys into .env
npm run dev             # open http://localhost:3000
```

## How it fits together

- `public/index.html` is the whole studio. Previews and reels are drawn on a canvas and recorded in the browser, so they cost nothing.
- `api/photo.js` calls Photoroom (`mode: "cutout"` or `mode: "backdrop"`).
- `api/video.js` starts a Runway clip (POST) and checks on it (GET `?id=`).
- `api/write.js` asks Claude for the words and ideas (model `claude-opus-5-5`).
- `api/health.js` tells the page which keys are set, without exposing them.

The API keys stay on the server. The browser never sees them.

## Good to know

- **Use Chrome or Edge on a computer** for rendering. They record MP4, which Instagram accepts. Keep the tab in front while a reel renders, because it records in real time.
- **Runway links expire**, so download each AI clip when it's ready.
- **Photo size:** photos are shrunk to about 1600 px before upload, which keeps them under Vercel's request limit.
