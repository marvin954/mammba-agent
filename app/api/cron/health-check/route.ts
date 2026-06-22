export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// ── Vercel Cron — runs the watchdog ───────────────────────────
// Add to vercel.json:
// { "path": "/api/cron/health-check", "schedule": "0 * * * *" }   (hourly)
//
// Pings /api/health, stores the result, and alerts you (email + SMS)
// ONLY when a service flips state (was up → now down, or recovered).
// This avoids alert spam while still catching every real outage.

export async function GET(req: NextRequest) {
  // Allow Vercel Cron (sends its own header) OR a manual call with CRON_SECRET
  const auth = req.headers.get('authorization')
  const isVercelCron = req.headers.get('user-agent')?.includes('vercel-cron')
  if (!isVercelCron && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  if (!appUrl) return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL not set' }, { status: 500 })

  // 1. Run the health check
  let health: any
  try {
    const r = await fetch(`${appUrl}/api/health`, { cache: 'no-store' })
    health = await r.json()
  } catch (e: any) {
    health = { ok: false, services: {}, error: e.message, checked_at: new Date().toISOString() }
  }

  // 2. Load previous state from settings
  const { data: prevRow } = await supabaseAdmin
    .from('settings').select('value').eq('key', 'health_state').single()
  let prev: Record<string, boolean> = {}
  try { prev = prevRow?.value ? JSON.parse(prevRow.value) : {} } catch {}

  // 3. Compute current state + detect flips
  const current: Record<string, boolean> = {}
  const nowDown: string[] = []
  const recovered: string[] = []
  for (const [name, svc] of Object.entries<any>(health.services || {})) {
    current[name] = !!svc.ok
    const was = prev[name]
    if (was === true && svc.ok === false) nowDown.push(`${name} — ${svc.message}`)
    if (was === false && svc.ok === true) recovered.push(name)
  }

  // 4. Persist new state
  await supabaseAdmin.from('settings').upsert(
    { key: 'health_state', value: JSON.stringify(current) },
    { onConflict: 'key' }
  )
  await supabaseAdmin.from('settings').upsert(
    { key: 'health_last_check', value: new Date().toISOString() },
    { onConflict: 'key' }
  )

  // 5. Log to activity feed if anything changed
  if (nowDown.length || recovered.length) {
    const summary = [
      nowDown.length ? `🔴 DOWN: ${nowDown.map(s => s.split(' — ')[0]).join(', ')}` : '',
      recovered.length ? `🟢 RECOVERED: ${recovered.join(', ')}` : '',
    ].filter(Boolean).join(' · ')
    await supabaseAdmin.from('activity_log').insert({
      lead_id: null, channel: 'note', direction: 'system',
      summary: `System health: ${summary}`,
      body: JSON.stringify(health.services, null, 2),
      result: health.ok ? 'all_ok' : 'degraded',
    })
  }

  // 6. Alert on new outages (email + SMS to the owner)
  if (nowDown.length) {
    const lines = nowDown.join('\n')
    const subject = `⚠️ MAMMBA Agent: ${nowDown.length} service${nowDown.length > 1 ? 's' : ''} down`
    const text = `Your MAMMBA sales agent has a problem:\n\n${lines}\n\nChecked: ${health.checked_at}\nDashboard: ${appUrl}/health`

    // Email via Resend
    try {
      if (process.env.RESEND_API_KEY && process.env.ALERT_EMAIL) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: `${process.env.FROM_NAME || 'MAMMBA Monitor'} <${process.env.FROM_EMAIL}>`,
            to: [process.env.ALERT_EMAIL],
            subject,
            html: `<h2>⚠️ Service alert</h2><pre style="font-family:monospace;font-size:14px;line-height:1.6">${lines}</pre><p>Checked: ${health.checked_at}</p><p><a href="${appUrl}/health">Open health dashboard →</a></p>`,
          }),
        })
      }
    } catch (e) { console.error('alert email failed', e) }

    // SMS via Twilio
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN
      const from = process.env.TWILIO_PHONE_NUMBER, to = process.env.ALERT_PHONE
      if (sid && token && from && to) {
        await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: 'POST',
          headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ From: from, To: to, Body: `⚠️ MAMMBA Agent down: ${nowDown.map(s => s.split(' — ')[0]).join(', ')}. Check ${appUrl}/health` }).toString(),
        })
      }
    } catch (e) { console.error('alert sms failed', e) }
  }

  return NextResponse.json({
    ok: health.ok,
    nowDown,
    recovered,
    services: current,
    checked_at: health.checked_at,
  })
}
