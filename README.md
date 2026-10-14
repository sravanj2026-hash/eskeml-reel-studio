# Eskeml AI Reel Studio

Drop a jewellery photo and the studio does the rest:

1. **Clean cut-out**, free by default: an open-source AI model runs right in the browser, so no key or credits are needed. Photoroom's **Pro cut-out** is there too if you add its key.
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
- **Free cut-out:** the first use downloads the model (about 80 MB) from IMG.LY's CDN, and the browser keeps it for next time. It uses [@imgly/background-removal](https://github.com/imgly/background-removal-js) 1.4.5, bundled in `public/vendor/bg-removal.js`. That library is AGPL-3.0, so this app's source must stay public; the page links to this repo.

---

# Art of Eskeml business system

The same app also runs the business side, built only on free tiers. It follows the "one-person company" idea: software handles the routine work and the owner makes the decisions.

| Part | What it does | Where |
|---|---|---|
| Catalogue | Every piece with weight, purity, making charge, stones, stock, photos and reels. Reel Studio's **Save to catalogue** box stores Claude's name, tagline and caption and uploads the photo and finished reels. | Dashboard → Catalogue |
| Inbox | WhatsApp, Instagram DMs and your website form land in one inbox. Calls and walk-ins are added by hand. | Dashboard → Inbox |
| Sales assistant | Every new message gets a ready reply: matching pieces with photos, today's price incl. GST, call slots, and a question about budget or occasion. You tap **Send**. | Dashboard → Approvals |
| Orders | Stages: design approved → advance paid → in making → QC → hallmarked (HUID required) → shipped → delivered. The customer hears at each step. | Dashboard → Orders |
| Payments | A payment page with a UPI QR code and a "Pay with UPI app" button. No gateway fees. You mark money received. | `/api/pay` links |
| Invoices | GST tax invoice PDF (HSN 7113, HUID, CGST+SGST or IGST) on delivery. | Order → Create GST invoice |
| Daily job | Review request (3 days after delivery), referral code (10 days), birthday/anniversary reminders (with consent), balance reminders (every 3 days, max 3), follow-up drafts for quiet enquiries. | Vercel Cron, 9:00 IST |
| Money | Month's sales, money received, what customers owe, bills to pay, 8-week cash forecast. | Dashboard → Money |

## What stays free, and how

- **Hosting:** Vercel Hobby. The app uses 10 serverless functions; the Hobby limit is 12.
- **Database and file storage:** Supabase free tier (500 MB database, 1 GB storage).
- **WhatsApp and Instagram:** replying within 24 hours of the customer's last message is free. Outside that window the app never sends a paid template. It puts the message on **Today → To send from your phone** with a one-tap link that opens the chat on your phone with the text ready.
- **Sales assistant:** built-in rules, free. If you add `ANTHROPIC_API_KEY`, Claude writes the replies instead (pay per use), and the app falls back to the built-in assistant if Claude fails. Prices always come from the catalogue and today's rate, never from the AI.
- **Payments:** UPI to your own UPI ID. No Razorpay or gateway fees.
- **Metal rate:** you type today's rate each morning on the Today screen. Until you do, the assistant won't quote prices.

## Set it up

1. **Supabase** (supabase.com, free): create a project. Copy the *Transaction pooler* connection string (Project settings → Database) into `DATABASE_URL`, and the project URL and `service_role` key (Project settings → API) into `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. Under Storage, create a **public** bucket named `catalogue`.
2. **Create the tables:** put `DATABASE_URL` in `.env` and run `npm install` then `npm run db:setup`.
3. **Vercel → Settings → Environment Variables:** add `DATABASE_URL`, `ADMIN_PASSCODE` (long and private), `PUBLIC_URL` (your site address), `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CRON_SECRET` (any random text). Redeploy, then open `/admin.html`.
4. **Settings tab:** business name, GSTIN, state, address, **UPI ID**, Google review link, approval limits, call hours, cash on hand.
5. **WhatsApp** (free Cloud API): at developers.facebook.com create an app (type Business), add **WhatsApp**, and connect your number. If it's on the WhatsApp Business app, choose the option to keep using the app on the same number where Meta offers it. Create a permanent token (System user in Business settings) and copy it with the phone number ID into `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID`. Copy the app secret into `META_APP_SECRET`, choose a `META_VERIFY_TOKEN`, then set the webhook URL to `https://YOUR-SITE/api/whatsapp` with that verify token and subscribe to **messages**.
6. **Instagram** (free): in the same app add **Instagram → API setup with Instagram login**, connect your professional Instagram account, and copy the token, account ID and Instagram app secret into `INSTAGRAM_TOKEN`, `INSTAGRAM_ACCOUNT_ID`, `INSTAGRAM_APP_SECRET`. Set the webhook URL to `https://YOUR-SITE/api/instagram` and subscribe to **messages**. Meta only delivers messages from the public after the app passes App Review for `instagram_business_manage_messages` (free, but it needs a short screen recording).
7. **Website form (optional):** post `{ name, phone, message }` as JSON to `https://YOUR-SITE/api/enquiry` and set `ENQUIRY_ORIGIN` to your website's address.

## Daily routine

1. **Today:** enter today's gold and silver rates. Send anything under *To send from your phone*.
2. **Approvals:** read each reply, edit if needed, tap **Send**.
3. **Orders:** move each order forward. Add the HUID at hallmarking and the tracking link at shipping. Record payments as they arrive.

## Tests

`npm test` runs the pricing tests on their own. The full flow (webhooks, drafts, orders, invoices, daily job) runs against a local Postgres: `TEST_DATABASE_URL=postgres://user:pass@localhost:5432/test_db npm test`. **It wipes that database**, so never point it at Supabase.
