export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Lightweight liveness check for every channel the agent depends on.
// Returns { ok: boolean, services: {...}, checked_at } — fast, no messages sent.
type Check = { ok: boolean; message: string; ms: number }

async function timed(fn: () => Promise<{ ok: boolean; message: string }>): Promise<Check> {
  const start = Date.now()
  try {
    const r = await fn()
    return { ...r, ms: Date.now() - start }
  } catch (e: any) {
    return { ok: false, message: e?.message || 'error', ms: Date.now() - start }
  }
}

export async function GET() {
  const services: Record<string, Check> = {}

  // ── Supabase ──────────────────────────────────────────────
  services.supabase = await timed(async () => {
    const { error } = await supabaseAdmin.from('leads').select('id').limit(1)
    if (error) throw new Error(error.message)
    return { ok: true, message: 'reachable' }
  })

  // ── Anthropic (key presence + cheap auth ping) ────────────
  services.anthropic = await timed(async () => {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) throw new Error('ANTHROPIC_API_KEY not set')
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'ok' }] }),
    })
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d?.error?.message || `HTTP ${r.status}`) }
    return { ok: true, message: 'auth ok' }
  })

  // ── Resend (key + domain presence) ────────────────────────
  services.resend = await timed(async () => {
    const key = process.env.RESEND_API_KEY
    if (!key) throw new Error('RESEND_API_KEY not set')
    if (!process.env.FROM_EMAIL) throw new Error('FROM_EMAIL not set')
    const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` } })
    if (r.status === 401) throw new Error('invalid RESEND_API_KEY')
    return { ok: true, message: 'auth ok' }
  })

  // ── Twilio (account auth ping) ────────────────────────────
  services.twilio = await timed(async () => {
    const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN
    if (!sid || !token) throw new Error('Twilio env vars not set')
    if (!process.env.TWILIO_PHONE_NUMBER) throw new Error('TWILIO_PHONE_NUMBER not set')
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d?.message || `HTTP ${r.status}`)
    // Surface trial status — the #1 SMS delivery blocker
    const trial = d?.type === 'Trial'
    return { ok: true, message: trial ? 'connected (TRIAL account — upgrade to deliver SMS)' : 'connected (full account)' }
  })

  // ── Slybroadcast (env presence + caller-id format) ────────
  services.slybroadcast = await timed(async () => {
    const email = process.env.SLYBROADCAST_EMAIL, pass = process.env.SLYBROADCAST_PASSWORD, phone = process.env.SLYBROADCAST_PHONE
    if (!email || !pass || !phone) throw new Error('Slybroadcast env vars not set')
    if (phone.replace(/\D/g, '').length < 10) throw new Error(`caller ID "${phone}" looks invalid`)
    return { ok: true, message: `caller ID ${phone}` }
  })

  // ── Bland.ai (key auth ping) ──────────────────────────────
  services.bland = await timed(async () => {
    const key = process.env.BLAND_API_KEY
    if (!key) throw new Error('BLAND_API_KEY not set')
    const r = await fetch('https://api.bland.ai/v1/calls?limit=1', { headers: { authorization: key } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return { ok: true, message: 'auth ok' }
  })

  const allOk = Object.values(services).every(s => s.ok)
  return NextResponse.json(
    { ok: allOk, services, checked_at: new Date().toISOString() },
    { status: allOk ? 200 : 503 }
  )
}
