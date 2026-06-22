'use client'
import { useEffect, useState, useCallback } from 'react'

type Check = { ok: boolean; message: string; ms: number }
type Health = { ok: boolean; services: Record<string, Check>; checked_at: string }

const LABELS: Record<string, string> = {
  supabase: 'Supabase — lead database',
  anthropic: 'Anthropic Claude — AI generation',
  resend: 'Resend — email delivery',
  twilio: 'Twilio — SMS',
  slybroadcast: 'Slybroadcast — ringless voicemail',
  bland: 'Bland.ai — AI calls',
}

export default function HealthDashboard() {
  const [health, setHealth] = useState<Health | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  const check = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/health', { cache: 'no-store' })
      setHealth(await r.json())
      setLastFetch(new Date())
    } catch { setHealth(null) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    check()
    const t = setInterval(check, 60000) // auto-refresh every 60s
    return () => clearInterval(t)
  }, [check])

  const allOk = health?.ok
  const services = health?.services || {}

  return (
    <div style={{ padding: '2rem', maxWidth: 680, margin: '0 auto', fontFamily: 'system-ui, sans-serif', fontSize: 14 }}>
      <div style={{ background: '#0A1628', borderRadius: 12, padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: '#C9A84C', marginBottom: 4 }}>
          MAMMBA — System Health Monitor
        </div>
        <div style={{ fontSize: 13, color: '#8899BB', lineHeight: 1.6 }}>
          Live status of every channel. Auto-refreshes every 60 seconds. A background watchdog also checks hourly and alerts you if anything goes down.
        </div>
        <button onClick={check} disabled={loading} style={{
          marginTop: 14, padding: '9px 22px', borderRadius: 8, border: 'none',
          background: loading ? '#2A3E6B' : '#C9A84C', color: '#0A1628', fontWeight: 600, fontSize: 14,
          cursor: loading ? 'not-allowed' : 'pointer',
        }}>{loading ? 'Checking…' : 'Check now'}</button>
      </div>

      {/* Overall banner */}
      {health && (
        <div style={{
          borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1rem',
          background: allOk ? '#D5EFDF' : '#FDECEA',
          border: `1px solid ${allOk ? '#B8DFAD' : '#F5C6C6'}`,
        }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: allOk ? '#1E7D4F' : '#A32D2D' }}>
            {allOk ? '✓ All systems operational' : '✗ One or more services are down'}
          </div>
          {lastFetch && (
            <div style={{ fontSize: 12, color: allOk ? '#1E7D4F' : '#A32D2D', marginTop: 4 }}>
              Last checked {lastFetch.toLocaleTimeString()}
            </div>
          )}
        </div>
      )}

      {/* Service cards */}
      {Object.keys(LABELS).map(id => {
        const svc = services[id]
        const ok = svc?.ok
        const pending = !svc
        return (
          <div key={id} style={{
            background: '#fff', border: '1px solid #DDE3F0', borderRadius: 10,
            padding: '1rem 1.25rem', marginBottom: 10,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, color: '#1A2540' }}>{LABELS[id]}</div>
              {svc && (
                <div style={{ fontSize: 12, color: '#6B7A99', marginTop: 3, fontFamily: 'monospace' }}>
                  {svc.message} · {svc.ms}ms
                </div>
              )}
            </div>
            <span style={{
              background: pending ? '#F4F6FA' : ok ? '#D5EFDF' : '#FDECEA',
              color: pending ? '#6B7A99' : ok ? '#1E7D4F' : '#A32D2D',
              fontSize: 11, padding: '5px 14px', borderRadius: 8, fontWeight: 600, whiteSpace: 'nowrap',
            }}>
              {pending ? '…' : ok ? '✓ Online' : '✗ Down'}
            </span>
          </div>
        )
      })}

      <div style={{ marginTop: '1rem', textAlign: 'center', fontSize: 12, color: '#A0AECC' }}>
        <a href="/" style={{ color: '#C9A84C' }}>← Back to dashboard</a>
      </div>
    </div>
  )
}
