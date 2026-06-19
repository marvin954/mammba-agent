# M.A.M.M.B.A AI Sales Agent — Deployment Guide

## What this app does
Outbound AI sales agent that autonomously runs:
- **Ringless voicemails** via Slybroadcast
- **AI phone calls** via Bland.ai (handles objections, books meetings)
- **SMS follow-ups** via Twilio (two-way — inbound replies auto-update CRM)
- **Personalized emails** via Resend + Claude AI
- **Automated sequences** via Vercel cron (runs daily 8:30 AM ET, Mon–Fri)
- **Lead CRM** stored in Supabase

---

## Step 1 — Set up Supabase (5 minutes)

1. Go to https://supabase.com → New project
2. Pick a name (e.g. `mammba-agent`) and set a password
3. Once created: Dashboard → SQL Editor → New query
4. Paste the entire contents of `supabase_schema.sql` → Run
5. Go to Settings → API → copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`

---

## Step 2 — Get your API keys (15 minutes)

### Bland.ai (AI calls)
1. Sign up at https://app.bland.ai
2. Dashboard → API Keys → Create key
3. Copy to `BLAND_API_KEY`

### Slybroadcast (Ringless voicemail)
1. Sign up at https://www.slybroadcast.com
2. Your login email → `SLYBROADCAST_EMAIL`
3. Your password → `SLYBROADCAST_PASSWORD`
4. Your campaign phone number → `SLYBROADCAST_PHONE`

### Twilio (SMS)
1. Sign up at https://console.twilio.com
2. Get a phone number ($1/mo)
3. Account SID → `TWILIO_ACCOUNT_SID`
4. Auth Token → `TWILIO_AUTH_TOKEN`
5. Your Twilio number → `TWILIO_PHONE_NUMBER`
6. After deploy: Twilio Console → Phone Numbers → your number
   → Set SMS webhook to: `https://your-app.vercel.app/api/agent/sms`

### Resend (Email)
1. Sign up at https://resend.com
2. API Keys → Create key
3. Copy to `RESEND_API_KEY`
4. Add and verify your sending domain
5. Set `FROM_EMAIL` to your verified email (e.g. sales@yourdomain.com)

### Anthropic (AI brain)
1. Go to https://console.anthropic.com → API Keys → Create
2. Copy to `ANTHROPIC_API_KEY`

---

## Step 3 — Push to GitHub (3 minutes)

1. Go to https://github.com → New repository → name it `mammba-agent`
2. Open https://github.dev/YOUR_USERNAME/mammba-agent (replace username)
3. Drag and drop ALL files from the `mammba-agent` folder into the file tree
4. Click the Source Control icon (left sidebar) → Stage all → Commit → Push

---

## Step 4 — Deploy to Vercel (5 minutes)

1. Go to https://vercel.com → New Project
2. Import your `mammba-agent` GitHub repo
3. Framework: Next.js (auto-detected)
4. Before deploying → **Environment Variables** → add all variables from `.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
BLAND_API_KEY
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER
SLYBROADCAST_EMAIL
SLYBROADCAST_PASSWORD
SLYBROADCAST_PHONE
RESEND_API_KEY
FROM_EMAIL
FROM_NAME
ANTHROPIC_API_KEY
NEXT_PUBLIC_APP_URL        ← set to your Vercel URL after first deploy
CRON_SECRET                ← generate any random string, e.g. openssl rand -hex 32
```

5. Click Deploy → wait ~90 seconds
6. Copy your Vercel URL → update `NEXT_PUBLIC_APP_URL` → Redeploy

---

## Step 5 — Set Twilio webhook (2 minutes)

1. Twilio Console → Phone Numbers → Active Numbers → your number
2. Messaging → "A message comes in" → set to:
   `https://your-app.vercel.app/api/agent/sms`
3. HTTP Method: GET

---

## Step 6 — Set Bland.ai webhook (1 minute)

1. Bland.ai Dashboard → Settings → Webhooks
2. Set endpoint to: `https://your-app.vercel.app/api/webhooks/bland`
3. This fires after every call and auto-updates your lead status

---

## Step 7 — Add leads and launch

1. Visit `https://your-app.vercel.app`
2. Click "Add lead" tab → fill in company details → "Add lead + start sequence"
3. The cron job runs Mon–Fri 8:30 AM ET and automatically:
   - Sends RVMs to new leads
   - Fires AI calls
   - Sends SMS follow-ups
   - Emails personalized sequences
   - Pauses when a lead replies
4. You can also trigger any channel manually from the Leads tab

---

## API endpoints (all POST unless noted)

| Endpoint | Description |
|----------|-------------|
| `POST /api/agent/call` | Trigger Bland.ai AI call for a lead |
| `POST /api/agent/rvm` | Send ringless voicemail via Slybroadcast |
| `POST /api/agent/sms` | Send SMS via Twilio |
| `POST /api/agent/email` | Generate + send personalized email via Claude + Resend |
| `GET/POST /api/leads` | CRUD for leads |
| `GET /api/cron/sequence` | Manual cron trigger (requires CRON_SECRET header) |
| `POST /api/webhooks/bland` | Bland.ai call outcome webhook |
| `GET /api/agent/sms` | Twilio inbound SMS webhook |

---

## Estimated monthly costs at 70 leads, full sequence

| Service | Usage | Cost |
|---------|-------|------|
| Bland.ai | ~70 calls × 3 min avg | ~$19 |
| Slybroadcast | ~70 RVMs | ~$4 |
| Twilio | ~140 SMS | ~$2 |
| Resend | ~350 emails | Free |
| Supabase | Free tier | $0 |
| Vercel | Free tier | $0 |
| **Total** | | **~$25/mo** |

One closed contract pays for 6+ months of the agent.
