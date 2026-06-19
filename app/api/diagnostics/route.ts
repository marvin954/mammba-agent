export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const results: Record<string, { ok: boolean; message: string }> = {}

  // ── Supabase ──────────────────────────────────────────────
  try {
    const { error } = await supabaseAdmin.from('leads').select('id').limit(1)
    if (error) throw new Error(error.message)
    const { count } = await supabaseAdmin
      .from('leads').select('*', { count: 'exact', head: true })
    results.supabase = { ok: true, message: `Connected — ${count ?? 0} leads in database` }
  } catch (e: any) {
    results.supabase = { ok: false, message: e.message }
  }

  // ── Anthropic ─────────────────────────────────────────────
  try {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Vercel environment variables')
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Reply with: ok' }]
      })
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`)
    results.anthropic = { ok: true, message: 'API key valid — Claude is reachable server-side' }
  } catch (e: any) {
    results.anthropic = { ok: false, message: e.message }
  }

  // ── Resend ────────────────────────────────────────────────
  try {
    const key = process.env.RESEND_API_KEY
    if (!key) throw new Error('RESEND_API_KEY is not set in Vercel environment variables')
    const r = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` }
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d?.message || `HTTP ${r.status} — invalid key`)
    const domains = d?.data?.map((x: any) => x.name).join(', ') || 'none verified yet'
    results.resend = { ok: true, message: `Key valid — verified domains: ${domains}` }
  } catch (e: any) {
    results.resend = { ok: false, message: e.message }
  }

  // ── Twilio ────────────────────────────────────────────────
  try {
    const sid   = process.env.TWILIO_ACCOUNT_SID
    const token = process.env.TWILIO_AUTH_TOKEN
    const phone = process.env.TWILIO_PHONE_NUMBER
    if (!sid)   throw new Error('TWILIO_ACCOUNT_SID is not set')
    if (!token) throw new Error('TWILIO_AUTH_TOKEN is not set')
    if (!phone) throw new Error('TWILIO_PHONE_NUMBER is not set')
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`,
      { headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` } }
    )
    const d = await r.json()
    if (!r.ok) throw new Error(d?.message || `HTTP ${r.status}`)
    results.twilio = { ok: true, message: `Connected — account: ${d.friendly_name || sid} · from: ${phone}` }
  } catch (e: any) {
    results.twilio = { ok: false, message: e.message }
  }

  // ── Slybroadcast ──────────────────────────────────────────
  try {
    const email = process.env.SLYBROADCAST_EMAIL
    const pass  = process.env.SLYBROADCAST_PASSWORD
    const phone = process.env.SLYBROADCAST_PHONE
    if (!email) throw new Error('SLYBROADCAST_EMAIL is not set')
    if (!pass)  throw new Error('SLYBROADCAST_PASSWORD is not set')
    if (!phone) throw new Error('SLYBROADCAST_PHONE is not set')
    const form = new URLSearchParams({ c_uid: email, c_password: pass, action: 'get_balance' })
    const r = await fetch('https://www.mobile-sphere.com/gateway/vmb.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    })
    const text = await r.text()
    if (text.toLowerCase().includes('error') || text.toLowerCase().includes('invalid')) {
      throw new Error(`Slybroadcast rejected credentials — ${text.slice(0, 100)}`)
    }
    results.slybroadcast = { ok: true, message: `Connected · caller ID: ${phone}` }
  } catch (e: any) {
    results.slybroadcast = { ok: false, message: e.message }
  }

  // ── Bland.ai ──────────────────────────────────────────────
  try {
    const key = process.env.BLAND_API_KEY
    if (!key) throw new Error('BLAND_API_KEY is not set in Vercel environment variables')
    const r = await fetch('https://api.bland.ai/v1/calls?limit=1', {
      headers: { authorization: key }
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d?.message || d?.error || `HTTP ${r.status}`)
    results.bland = { ok: true, message: 'API key valid — AI calling ready' }
  } catch (e: any) {
    results.bland = { ok: false, message: e.message }
  }

  return NextResponse.json(results)
}
