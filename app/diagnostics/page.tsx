'use client'
import { useState } from 'react'

type Result = { ok: boolean; message: string }
type Results = Record<string, Result>

const CHECKS = [
  {
    id: 'supabase',
    label: 'Supabase — lead database',
    sub: 'NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY',
    fix: 'Go to Vercel → Settings → Env Vars. Check NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are all set correctly. Get values from supabase.com → Project → Settings → API.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude — AI email generation',
    sub: 'ANTHROPIC_API_KEY',
    fix: 'Go to console.anthropic.com → API Keys → Create Key. Add as ANTHROPIC_API_KEY in Vercel env vars.',
  },
  {
    id: 'resend',
    label: 'Resend — email delivery',
    sub: 'RESEND_API_KEY · FROM_EMAIL · FROM_NAME',
    fix: 'Go to resend.com → API Keys. Add RESEND_API_KEY, FROM_EMAIL (must be a verified domain), and FROM_NAME in Vercel env vars.',
  },
  {
    id: 'twilio',
    label: 'Twilio — SMS messages',
    sub: 'TWILIO_ACCOUNT_SID · TWILIO_AUTH_TOKEN · TWILIO_PHONE_NUMBER',
    fix: 'Go to console.twilio.com → Account Info. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER (format: +15551234567) in Vercel env vars.',
  },
  {
    id: 'slybroadcast',
    label: 'Slybroadcast — ringless voicemail',
    sub: 'SLYBROADCAST_EMAIL · SLYBROADCAST_PASSWORD · SLYBROADCAST_PHONE',
    fix: 'Add SLYBROADCAST_EMAIL, SLYBROADCAST_PASSWORD, and SLYBROADCAST_PHONE (your verified caller ID number) in Vercel env vars. Verify your phone number in slybroadcast.com → Account → Caller ID.',
  },
  {
    id: 'bland',
    label: 'Bland.ai — AI outbound calls',
    sub: 'BLAND_API_KEY',
    fix: 'Go to app.bland.ai → API Keys → Create Key. Add as BLAND_API_KEY in Vercel env vars.',
  },
]

const S = {
  pending: { bg: '#F4F6FA', color: '#6B7A99', label: 'Pending' },
  running: { bg: '#FFF3CD', color: '#BA7517', label: 'Testing…' },
  ok:      { bg: '#D5EFDF', color: '#1E7D4F', label: '✓ Connected' },
  error:   { bg: '#FDECEA', color: '#A32D2D', label: '✗ Error' },
} as const

export default function Diagnostics() {
  const [statuses, setStatuses] = useState<Record<string, keyof typeof S>>(
    Object.fromEntries(CHECKS.map(c => [c.id, 'pending']))
  )
  const [messages, setMessages] = useState<Record<string, string>>({})
  const [running, setRunning]   = useState(false)
  const [done, setDone]         = useState(false)

  const set = (id: string, status: keyof typeof S, msg = '') => {
    setStatuses(p => ({ ...p, [id]: status }))
    setMessages(p => ({ ...p, [id]: msg }))
  }

  const runChecks = async () => {
    setRunning(true); setDone(false)
    CHECKS.forEach(c => set(c.id, 'running'))
    try {
      const r = await fetch('/api/diagnostics')
      if (!r.ok) {
        CHECKS.forEach(c => set(c.id, 'error', `API route returned HTTP ${r.status} — redeploy may be needed`))
        return
      }
      const data: Results = await r.json()
      CHECKS.forEach(c => {
        const res = data[c.id]
        if (res) set(c.id, res.ok ? 'ok' : 'error', res.message)
        else set(c.id, 'error', 'No result returned — check server logs in Vercel')
      })
    } catch (e: any) {
      CHECKS.forEach(c => set(c.id, 'error', `Could not reach /api/diagnostics — ${e.message}`))
    } finally {
      setRunning(false); setDone(true)
    }
  }

  const failures = CHECKS.filter(c => statuses[c.id] === 'error')
  const allOk    = done && failures.length === 0

  return (
    <div style={{ padding: '2rem', maxWidth: 680, margin: '0 auto', fontFamily: 'system-ui, sans-serif', fontSize: 14 }}>

      {/* Header */}
      <div style={{ background: '#0A1628', borderRadius: 12, padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: '#C9A84C', marginBottom: 4 }}>
          M.A.M.M.B.A — Agent Diagnostics
        </div>
        <div style={{ fontSize: 13, color: '#8899BB', lineHeight: 1.6 }}>
          All checks run server-side from inside your app — tests every API key and connection live.
        </div>
        <button onClick={runChecks} disabled={running} style={{
          marginTop: 14, padding: '9px 22px', borderRadius: 8, border: 'none',
          background: running ? '#2A3E6B' : '#C9A84C',
          color: '#0A1628', fontWeight: 600, fontSize: 14,
          cursor: running ? 'not-allowed' : 'pointer'
        }}>
          {running ? 'Running…' : 'Run all checks'}
        </button>
      </div>

      {/* Check cards */}
      {CHECKS.map(check => {
        const status = statuses[check.id]
        const msg    = messages[check.id]
        const s      = S[status]
        return (
          <div key={check.id} style={{
            background: '#fff', border: '1px solid #DDE3F0',
            borderRadius: 10, padding: '1rem 1.25rem', marginBottom: 10
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, color: '#1A2540' }}>{check.label}</div>
                <div style={{ fontSize: 12, color: '#6B7A99', marginTop: 3, fontFamily: 'monospace' }}>
                  {check.sub}
                </div>
              </div>
              <span style={{
                background: s.bg, color: s.color,
                fontSize: 11, padding: '4px 12px', borderRadius: 8,
                fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0
              }}>
                {s.label}
              </span>
            </div>

            {/* Result message */}
            {msg && (
              <div style={{
                marginTop: 10, padding: '8px 12px', borderRadius: 6,
                background: status === 'ok' ? '#F0FFF4' : '#FFF5F5',
                border: `1px solid ${status === 'ok' ? '#B8DFAD' : '#F5C6C6'}`,
                fontSize: 12,
                color: status === 'ok' ? '#1E7D4F' : '#A32D2D',
                fontFamily: 'monospace', wordBreak: 'break-word', lineHeight: 1.5
              }}>
                {msg}
              </div>
            )}

            {/* Fix instructions */}
            {status === 'error' && (
              <div style={{
                marginTop: 8, padding: '8px 12px', borderRadius: 6,
                background: '#F4F6FA', border: '1px solid #DDE3F0',
                fontSize: 12, color: '#555', lineHeight: 1.7
              }}>
                <strong style={{ color: '#1A2540' }}>How to fix:</strong> {check.fix}
              </div>
            )}
          </div>
        )
      })}

      {/* Summary */}
      {done && (
        <div style={{
          borderRadius: 10, padding: '1rem 1.25rem', marginTop: 4,
          background: allOk ? '#D5EFDF' : '#FDECEA',
          border: `1px solid ${allOk ? '#B8DFAD' : '#F5C6C6'}`
        }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: allOk ? '#1E7D4F' : '#A32D2D' }}>
            {allOk
              ? '✓ All systems connected — agent is ready to send'
              : `${failures.length} issue${failures.length > 1 ? 's' : ''} found`}
          </div>
          <div style={{ fontSize: 13, marginTop: 6, color: allOk ? '#1E7D4F' : '#A32D2D', lineHeight: 1.6 }}>
            {allOk
              ? 'Every channel is live. Go back to the dashboard and try sending to a lead.'
              : 'Fix the errors above → Vercel → Settings → Environment Variables → add the missing values → Deployments → Redeploy → run checks again.'}
          </div>
        </div>
      )}

      {/* Env var quick reference */}
      <div style={{
        marginTop: '1.5rem', background: '#F4F6FA',
        border: '1px solid #DDE3F0', borderRadius: 10, padding: '1rem 1.25rem'
      }}>
        <div style={{ fontWeight: 500, marginBottom: 10, color: '#1A2540' }}>
          All required environment variables
        </div>
        {[
          ['NEXT_PUBLIC_SUPABASE_URL',     'supabase.com → Project → Settings → API'],
          ['NEXT_PUBLIC_SUPABASE_ANON_KEY','supabase.com → Project → Settings → API'],
          ['SUPABASE_SERVICE_ROLE_KEY',    'supabase.com → Project → Settings → API'],
          ['ANTHROPIC_API_KEY',            'console.anthropic.com → API Keys'],
          ['RESEND_API_KEY',               'resend.com → API Keys'],
          ['FROM_EMAIL',                   'Your verified sending email'],
          ['FROM_NAME',                    'M.A.M.M.B.A Enterprises LLC'],
          ['TWILIO_ACCOUNT_SID',           'console.twilio.com → Account Info'],
          ['TWILIO_AUTH_TOKEN',            'console.twilio.com → Account Info'],
          ['TWILIO_PHONE_NUMBER',          'Your Twilio number (+15551234567)'],
          ['SLYBROADCAST_EMAIL',           'Your slybroadcast.com login email'],
          ['SLYBROADCAST_PASSWORD',        'Your slybroadcast.com password'],
          ['SLYBROADCAST_PHONE',           'Your verified caller ID (+15551234567)'],
          ['BLAND_API_KEY',               'app.bland.ai → API Keys'],
          ['NEXT_PUBLIC_APP_URL',          'Your Vercel deployment URL'],
          ['CRON_SECRET',                  'Any random string (openssl rand -hex 32)'],
        ].map(([name, source]) => (
          <div key={name} style={{
            display: 'flex', justifyContent: 'space-between', gap: 12,
            padding: '5px 0', borderTop: '1px solid #DDE3F0', fontSize: 12
          }}>
            <code style={{ color: '#1A2540', fontWeight: 500 }}>{name}</code>
            <span style={{ color: '#6B7A99', textAlign: 'right' }}>{source}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '1rem', textAlign: 'center', fontSize: 12, color: '#A0AECC' }}>
        <a href="/" style={{ color: '#C9A84C' }}>← Back to dashboard</a>
      </div>
    </div>
  )
}
