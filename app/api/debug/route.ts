export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const log: Record<string, any> = {}

  // 1. Check all env vars (masked)
  const vars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ANTHROPIC_API_KEY',
    'RESEND_API_KEY',
    'FROM_EMAIL',
    'FROM_NAME',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
    'SLYBROADCAST_EMAIL',
    'SLYBROADCAST_PASSWORD',
    'SLYBROADCAST_PHONE',
    'BLAND_API_KEY',
    'NEXT_PUBLIC_APP_URL',
  ]
  log.env_vars = {}
  for (const v of vars) {
    const val = process.env[v]
    log.env_vars[v] = val
      ? `SET (${val.slice(0,4)}...${val.slice(-4)}, len=${val.length})`
      : 'NOT SET'
  }

  // 2. Get first lead with email and phone
  try {
    const { data: leads } = await supabaseAdmin
      .from('leads').select('*').limit(5)
    log.sample_leads = (leads || []).map((l: any) => ({
      id:      l.id,
      name:    l.name,
      company: l.company,
      email:   l.email   || 'MISSING',
      phone:   l.phone   || 'MISSING',
      status:  l.status,
    }))
  } catch (e: any) {
    log.leads_error = e.message
  }

  // 3. Test Resend directly
  try {
    const key = process.env.RESEND_API_KEY!
    const from = `${process.env.FROM_NAME} <${process.env.FROM_EMAIL}>`
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [process.env.FROM_EMAIL!],
        subject: 'MAMMBA debug test',
        html: '<p>Debug test from MAMMBA agent diagnostics.</p>'
      })
    })
    const d = await r.json()
    log.resend_test = { status: r.status, response: d }
  } catch (e: any) {
    log.resend_test = { error: e.message }
  }

  // 4. Test Twilio directly
  try {
    const sid   = process.env.TWILIO_ACCOUNT_SID!
    const token = process.env.TWILIO_AUTH_TOKEN!
    const from  = process.env.TWILIO_PHONE_NUMBER!
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: from,
          To:   from, // send to self as a test
          Body: 'MAMMBA debug test SMS'
        }).toString()
      }
    )
    const d = await r.json()
    log.twilio_test = { status: r.status, sid: d.sid, error: d.message || null }
  } catch (e: any) {
    log.twilio_test = { error: e.message }
  }

  // 5. Test Bland.ai directly
  try {
    const key = process.env.BLAND_API_KEY!
    const r = await fetch('https://api.bland.ai/v1/calls?limit=1', {
      headers: { authorization: key }
    })
    const d = await r.json()
    log.bland_test = { status: r.status, response: d }
  } catch (e: any) {
    log.bland_test = { error: e.message }
  }

  // 6. Test Anthropic directly
  try {
    const key = process.env.ANTHROPIC_API_KEY!
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'say ok' }]
      })
    })
    const d = await r.json()
    log.anthropic_test = { status: r.status, content: d?.content?.[0]?.text || d?.error }
  } catch (e: any) {
    log.anthropic_test = { error: e.message }
  }

  return NextResponse.json(log, { status: 200 })
}
