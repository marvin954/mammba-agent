'use client'
import React, { useEffect, useState, useCallback, useRef } from 'react'

type Lead = {
  id: string; name: string; title: string; company: string
  phone: string; email: string; county: string; tier: string
  status: string; priority: string; monthly_value: string
  touches: number; last_contact: string; notes: string
  sequence_step: number; sequence_paused: boolean
}
type LogEntry = {
  id: string; channel: string; summary: string; result: string
  body: string; created_at: string; lead_id: string
}
type ImportRow = {
  name: string; company: string; title?: string; phone?: string
  email?: string; county?: string; tier?: string
  monthly_value?: string; priority?: string; notes?: string
  _valid: boolean; _error?: string
}

const STATUS_COLORS: Record<string, string> = {
  'New': '#E8F0FE', 'RVM Sent': '#E6F1FB', 'Called': '#EEEDFE',
  'Texted': '#E1F5EE', 'Emailed': '#FAEEDA', 'Engaged': '#EAF3DE',
  'Proposal Sent': '#FFF3CD', 'Closed Won': '#D5EFDF',
  'Closed Lost': '#FDECEA', 'On Hold': '#F1EFE8',
}

const CH_ICON: Record<string, string> = {
  call: '📞', rvm: '📳', sms: '💬', email: '✉️', note: '📝'
}
const CH_COLOR: Record<string, string> = {
  call: '#EEEDFE', rvm: '#E6F1FB', sms: '#E1F5EE', email: '#FAEEDA', note: '#F4F6FA'
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    const cols: string[] = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = '' }
      else cur += ch
    }
    cols.push(cur.trim())
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = (cols[i] || '').replace(/^"|"$/g, '') })
    return obj
  })
}

function normaliseRow(raw: Record<string, string>): ImportRow {
  const name    = (raw.name    || raw.Name    || raw.full_name   || '').trim()
  const company = (raw.company || raw.Company || raw.business    || raw['Company Name'] || '').trim()
  return {
    name, company,
    title:         (raw.title    || raw.Title    || raw.job_title   || '').trim(),
    phone:         (raw.phone    || raw.Phone    || raw.phone_number || '').trim(),
    email:         (raw.email    || raw.Email    || '').trim(),
    county:        (['Broward','Miami-Dade','Palm Beach'].includes(raw.county || raw.County || '')
                     ? (raw.county || raw.County) : 'Broward'),
    tier:          (raw.tier     || raw.Tier     || 'Tier 1').trim(),
    monthly_value: (raw.monthly_value || raw['Monthly Value'] || raw.value || '').trim(),
    priority:      (['High','Medium','Low'].includes(raw.priority || raw.Priority || '')
                     ? (raw.priority || raw.Priority) : 'Medium'),
    notes:         (raw.notes   || raw.Notes    || '').trim(),
    _valid: !!(name && company),
    _error: (name && company) ? undefined : 'Missing name or company',
  }
}

const CSV_TEMPLATE = `name,title,company,phone,email,county,tier,monthly_value,priority,notes
Maria Santos,Operations Manager,Broward Health Medical Center,954-355-4400,msantos@example.com,Broward,Tier 1,"$4,000-$8,000",High,Inter-facility transfers
James Ortega,Supply Chain Director,Memorial Regional Hospital,954-987-2000,jortega@example.com,Broward,Tier 1,"$4,000-$8,000",High,
Carlos Rivera,Director of Logistics,Jackson Memorial Hospital,305-585-1111,crivera@example.com,Miami-Dade,Tier 1,"$6,000-$10,000",High,3 campuses`

// ── Message Preview Modal ──────────────────────────────────────
function MessageModal({ entry, onClose }: { entry: LogEntry; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const channelLabel: Record<string, string> = {
    call: 'AI Call Script', rvm: 'Ringless Voicemail', sms: 'SMS Text', email: 'Email', note: 'Note'
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: '1rem'
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 12, width: '100%', maxWidth: 560,
        maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      }} onClick={e => e.stopPropagation()}>

        {/* Modal header */}
        <div style={{
          background: '#0A1628', padding: '14px 18px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderRadius: '12px 12px 0 0'
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#C9A84C' }}>
              {CH_ICON[entry.channel] || '📋'} {channelLabel[entry.channel] || 'Message'}
            </div>
            <div style={{ fontSize: 12, color: '#8899BB', marginTop: 2 }}>
              {new Date(entry.created_at).toLocaleString()} · {entry.result || 'sent'}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#8899BB',
            fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '2px 6px'
          }}>✕</button>
        </div>

        {/* Summary bar */}
        <div style={{
          background: '#F4F6FA', padding: '10px 18px',
          fontSize: 13, color: '#1A2540', borderBottom: '1px solid #DDE3F0'
        }}>
          {entry.summary}
        </div>

        {/* Message body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '18px' }}>
          {entry.body ? (
            <pre style={{
              fontFamily: 'system-ui, sans-serif', fontSize: 13.5,
              lineHeight: 1.7, color: '#1A2540', whiteSpace: 'pre-wrap',
              wordBreak: 'break-word', margin: 0,
              background: entry.channel === 'email' ? '#FAFBFF' : 'transparent',
              padding: entry.channel === 'email' ? '12px 14px' : 0,
              borderRadius: entry.channel === 'email' ? 8 : 0,
              border: entry.channel === 'email' ? '1px solid #DDE3F0' : 'none'
            }}>
              {/* Strip HTML tags for display if email */}
              {entry.channel === 'email'
                ? entry.body.replace(/<[^>]+>/g, '').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim()
                : entry.body}
            </pre>
          ) : (
            <p style={{ color: '#6B7A99', fontSize: 13, fontStyle: 'italic' }}>
              No message body recorded for this entry.
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div style={{
          padding: '12px 18px', borderTop: '1px solid #DDE3F0',
          display: 'flex', gap: 8, justifyContent: 'flex-end'
        }}>
          <button onClick={() => {
            navigator.clipboard.writeText(entry.body || entry.summary)
          }} style={{
            padding: '7px 14px', borderRadius: 8, border: '1px solid #DDE3F0',
            background: '#F4F6FA', fontSize: 13, cursor: 'pointer', color: '#1A2540'
          }}>
            Copy text
          </button>
          <button onClick={onClose} style={{
            padding: '7px 14px', borderRadius: 8, border: 'none',
            background: '#0A1628', color: '#C9A84C', fontSize: 13,
            fontWeight: 500, cursor: 'pointer'
          }}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Inline message preview (in lead row) ───────────────────────
function MessagePreviewDrawer({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const [messages, setMessages] = useState<LogEntry[]>([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState<LogEntry | null>(null)

  useEffect(() => {
    fetch('/api/leads')
      .then(r => r.json())
      .then(data => {
        const lead = Array.isArray(data) ? data.find((l: any) => l.id === leadId) : null
        const log  = lead?.activity_log || []
        log.sort((a: LogEntry, b: LogEntry) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        setMessages(log)
        setLoading(false)
      })
  }, [leadId])

  return (
    <>
      {selected && <MessageModal entry={selected} onClose={() => setSelected(null)} />}
      <div style={{
        position: 'fixed', right: 0, top: 0, bottom: 0, width: 340,
        background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
        zIndex: 1000, display: 'flex', flexDirection: 'column'
      }}>
        {/* Drawer header */}
        <div style={{ background: '#0A1628', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#C9A84C' }}>Message History</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8899BB', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading && <p style={{ padding: '1rem', color: '#888', fontSize: 13 }}>Loading…</p>}
          {!loading && messages.length === 0 && (
            <p style={{ padding: '1rem', color: '#888', fontSize: 13, fontStyle: 'italic' }}>
              No messages sent yet for this lead.
            </p>
          )}
          {messages.map((msg, i) => (
            <div key={msg.id} style={{
              borderTop: i > 0 ? '1px solid #f0f0f0' : 'none',
              padding: '12px 14px', cursor: 'pointer',
              background: 'transparent', transition: 'background .1s'
            }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F4F6FA')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              onClick={() => setSelected(msg)}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                  background: CH_COLOR[msg.channel] || '#F4F6FA',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14
                }}>
                  {CH_ICON[msg.channel] || '📋'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: '#1A2540' }}>
                    {msg.channel.toUpperCase()}
                    <span style={{ fontWeight: 400, color: '#6B7A99', marginLeft: 6 }}>
                      {msg.result || 'sent'}
                    </span>
                  </div>
                  <div style={{
                    fontSize: 12, color: '#6B7A99',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }}>
                    {msg.body
                      ? msg.body.replace(/<[^>]+>/g, '').slice(0, 60) + (msg.body.length > 60 ? '…' : '')
                      : msg.summary.slice(0, 60)}
                  </div>
                  <div style={{ fontSize: 11, color: '#A0AECC', marginTop: 2 }}>
                    {new Date(msg.created_at).toLocaleString()}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#C9A84C', flexShrink: 0 }}>View →</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}


// ── Edit Lead Modal ────────────────────────────────────────────
function EditLeadModal({
  lead, onClose, onSave
}: {
  lead: Lead
  onClose: () => void
  onSave: (updated: Partial<Lead>) => void
}) {
  const [form, setForm] = React.useState({
    name:          lead.name          || '',
    title:         lead.title         || '',
    company:       lead.company       || '',
    phone:         lead.phone         || '',
    email:         lead.email         || '',
    county:        lead.county        || 'Broward',
    monthly_value: lead.monthly_value || '',
    priority:      lead.priority      || 'Medium',
    status:        lead.status        || 'New',
    notes:         lead.notes         || '',
  })
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const inp: React.CSSProperties = {
    width: '100%', padding: '7px 10px', borderRadius: 6,
    border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box'
  }

  const handleSave = async () => {
    setSaving(true)
    await onSave(form)
    setSaving(false)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: '1rem'
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 12, width: '100%', maxWidth: 560,
        maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ background: '#0A1628', padding: '14px 18px',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      borderRadius: '12px 12px 0 0' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#C9A84C' }}>
            ✏️  Edit Lead
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#8899BB',
            fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '2px 6px'
          }}>✕</button>
        </div>

        {/* Form */}
        <div style={{ flex: 1, overflow: 'auto', padding: '18px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {([
              ['name',          'Full Name'],
              ['title',         'Job Title'],
              ['company',       'Company'],
              ['phone',         'Phone'],
              ['email',         'Email'],
              ['monthly_value', 'Est. Monthly Value'],
            ] as [string, string][]).map(([key, label]) => (
              <div key={key}>
                <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
                  {label}
                </label>
                <input
                  value={(form as any)[key]}
                  onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                  style={inp}
                />
              </div>
            ))}

            <div>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>County</label>
              <select value={form.county}
                onChange={e => setForm(p => ({ ...p, county: e.target.value }))} style={inp as any}>
                {['Broward', 'Miami-Dade', 'Palm Beach'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Priority</label>
              <select value={form.priority}
                onChange={e => setForm(p => ({ ...p, priority: e.target.value }))} style={inp as any}>
                {['High', 'Medium', 'Low'].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Status</label>
              <select value={form.status}
                onChange={e => setForm(p => ({ ...p, status: e.target.value }))} style={inp as any}>
                {['New','RVM Sent','Called','Texted','Emailed','Engaged',
                  'Proposal Sent','Negotiating','Closed Won','Closed Lost','On Hold']
                  .map(s => <option key={s}>{s}</option>)}
              </select>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Notes</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                rows={3}
                style={{ ...inp, resize: 'vertical' as any }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid #DDE3F0',
                      display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '7px 16px', borderRadius: 8, border: '1px solid #ddd',
            background: '#F4F6FA', fontSize: 13, cursor: 'pointer', color: '#555'
          }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{
            padding: '7px 20px', borderRadius: 8, border: 'none',
            background: saving ? '#2A3E6B' : '#0A1628',
            color: '#C9A84C', fontWeight: 600, fontSize: 13, cursor: 'pointer'
          }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
export default function Dashboard() {
  const [leads, setLeads]             = useState<Lead[]>([])
  const [log, setLog]                 = useState<LogEntry[]>([])
  const [tab, setTab]                 = useState('leads')
  const [filterStatus, setFilter]     = useState('all')
  const [filterCounty, setCounty]     = useState('all')
  const [loading, setLoading]         = useState(false)
  const [agentOn, setAgentOn]         = useState(true)
  const [toast, setToast]             = useState('')
  const [toastType, setToastType]     = useState<'ok'|'err'>('ok')
  const [selectedMsg, setSelectedMsg] = useState<LogEntry | null>(null)
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null)
  const [editLead, setEditLead]           = useState<Lead | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<Lead | null>(null)

  const [blandVoice, setBlandVoice]       = useState('derek')
  const [agentName, setAgentName]         = useState('Marcus')
  const [agentRole, setAgentRole]         = useState('Logistics Coordinator')
  const [companyName, setCompanyName]     = useState('M.A.M.M.B.A Enterprises')
  const [agentTone, setAgentTone]         = useState('confident and direct, with warmth')
  const [savingSettings, setSavingSettings] = useState(false)
  const [testCallPhone, setTestCallPhone] = useState('')
  const [testCalling, setTestCalling]     = useState(false)

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(s => {
      if (s.bland_voice)   setBlandVoice(s.bland_voice)
      if (s.agent_name)    setAgentName(s.agent_name)
      if (s.agent_role)    setAgentRole(s.agent_role)
      if (s.company_name)  setCompanyName(s.company_name)
      if (s.agent_tone)    setAgentTone(s.agent_tone)
    }).catch(() => {})
  }, [])

  const saveSettings = async () => {
    setSavingSettings(true)
    await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bland_voice: blandVoice, agent_name: agentName, agent_role: agentRole, company_name: companyName, agent_tone: agentTone }) })
    setSavingSettings(false)
    notify('Settings saved')
  }

  const sendTestCall = async () => {
    if (!testCallPhone) { notify('Enter your phone number first', 'err'); return }
    setTestCalling(true)
    try {
      const res = await fetch('/api/voice-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: blandVoice, phone: testCallPhone }),
      })
      const data = await res.json()
      if (!res.ok) { notify(data.error || 'Test call failed', 'err'); return }
      notify('Test call placed -- pick up your phone to hear the ' + blandVoice + ' voice')
    } catch (err) {
      notify('Error: ' + (err as any).message, 'err')
    } finally {
      setTestCalling(false)
    }
  }

  const [importRows, setImportRows]   = useState<ImportRow[]>([])
  const [importFile, setImportFile]   = useState('')
  const [importLoading, setImpLoad]   = useState(false)
  const [importResult, setImpResult]  = useState<{inserted:number;skipped:number}|null>(null)
  const [dragOver, setDragOver]       = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [newLead, setNewLead] = useState({
    name:'', title:'', company:'', phone:'', email:'',
    county:'Broward', tier:'Tier 1', monthly_value:'', priority:'High', notes:''
  })

  const notify = (msg: string, type: 'ok'|'err' = 'ok') => {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 4000)
  }

  const loadLeads = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (filterStatus !== 'all') p.set('status', filterStatus)
    if (filterCounty !== 'all') p.set('county', filterCounty)
    const res  = await fetch(`/api/leads?${p}`)
    const data = await res.json()
    setLeads(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [filterStatus, filterCounty])

  const loadLog = async () => {
    const res  = await fetch('/api/leads')
    const data = await res.json()
    const all: LogEntry[] = []
    if (Array.isArray(data)) data.forEach((l: any) => {
      if (Array.isArray(l.activity_log)) all.push(...l.activity_log)
    })
    all.sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    setLog(all.slice(0, 60))
  }

  useEffect(() => { loadLeads() }, [loadLeads])
  useEffect(() => { if (tab === 'log') loadLog() }, [tab])

  const processFile = (file: File) => {
    setImportFile(file.name); setImpResult(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      let rawRows: Record<string, string>[] = []
      try {
        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(text)
          rawRows = Array.isArray(parsed) ? parsed : parsed.leads || []
        } else {
          rawRows = parseCSV(text)
        }
        const rows = rawRows.map(normaliseRow)
        setImportRows(rows)
        const valid = rows.filter(r => r._valid).length
        notify(`Parsed ${rows.length} rows — ${valid} valid`, valid > 0 ? 'ok' : 'err')
      } catch (err: any) { notify(`Parse error: ${err.message}`, 'err') }
    }
    reader.readAsText(file)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (file) processFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files?.[0]; if (file) processFile(file)
  }

  const handleImport = async () => {
    const valid = importRows.filter(r => r._valid)
    if (valid.length === 0) { notify('No valid rows to import', 'err'); return }
    setImpLoad(true)
    try {
      const res  = await fetch('/api/leads/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: valid }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setImpResult({ inserted: data.inserted, skipped: data.skipped })
      notify(`Imported ${data.inserted} leads`, 'ok')
      setImportRows([]); setImportFile(''); loadLeads()
    } catch (err: any) { notify(`Import failed: ${err.message}`, 'err') }
    finally { setImpLoad(false) }
  }

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = 'mammba_leads_template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const trigger = async (lead: Lead, action: string) => {
    const displayName = lead.name || lead.company || 'lead'
    notify(`Sending ${action.toUpperCase()} to ${displayName}…`)
    try {
      const res  = await fetch(`/api/agent/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.id }),
      })
      const data = await res.json()
      if (res.ok) { notify(`${action.toUpperCase()} sent to ${displayName}`); loadLeads() }
      else {
        const msg = data.error || 'Unknown error'
        notify(msg.length > 80 ? msg.slice(0, 80) + '…' : msg, 'err')
      }
    } catch (err: any) { notify(`Network error: ${err.message}`, 'err') }
  }

  const addLead = async () => {
    if (!newLead.name || !newLead.company) { notify('Name and company required', 'err'); return }
    const res = await fetch('/api/leads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newLead),
    })
    if (res.ok) {
      notify(`Lead added: ${newLead.company}`)
      setNewLead({ name:'', title:'', company:'', phone:'', email:'',
                   county:'Broward', tier:'Tier 1', monthly_value:'', priority:'High', notes:'' })
      loadLeads()
    }
  }

  const saveLead = async (updated: Partial<Lead>) => {
    if (!editLead) return
    const res = await fetch('/api/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editLead.id, ...updated }),
    })
    if (res.ok) {
      notify('Lead updated')
      setEditLead(null)
      loadLeads()
    } else {
      const d = await res.json()
      notify(d.error || 'Save failed', 'err')
    }
  }

  const confirmDelete = async () => {
    if (!deleteConfirm) return
    const res = await fetch(`/api/leads?id=${deleteConfirm.id}`, { method: 'DELETE' })
    if (res.ok) {
      notify(`${deleteConfirm.name || deleteConfirm.company} removed`)
      setDeleteConfirm(null)
      loadLeads()
    } else {
      notify('Delete failed', 'err')
    }
  }

  const kpis = {
    total:   leads.length,
    engaged: leads.filter(l => ['Engaged','Proposal Sent'].includes(l.status)).length,
    closed:  leads.filter(l => l.status === 'Closed Won').length,
    newL:    leads.filter(l => l.status === 'New').length,
  }

  const inp: React.CSSProperties = {
    width:'100%', padding:'8px 10px', borderRadius:6,
    border:'1px solid #ddd', fontSize:13, boxSizing:'border-box'
  }
  const btn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    padding:'7px 16px', borderRadius:8, border:'1px solid #ddd',
    background:'#fff', fontSize:13, cursor:'pointer', ...extra
  })

  return (
    <div style={{ padding:'1.5rem', maxWidth:1100, margin:'0 auto',
                  fontFamily:'system-ui,sans-serif', fontSize:14 }}>

      {/* Message Detail Modal */}
      {selectedMsg && <MessageModal entry={selectedMsg} onClose={() => setSelectedMsg(null)} />}

      {/* Edit Lead Modal */}
      {editLead && (
        <EditLeadModal
          lead={editLead}
          onClose={() => setEditLead(null)}
          onSave={saveLead}
        />
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: '1rem'
        }} onClick={() => setDeleteConfirm(null)}>
          <div style={{
            background: '#fff', borderRadius: 12, padding: '1.5rem',
            maxWidth: 400, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1A2540', marginBottom: 8 }}>
              Remove this lead?
            </div>
            <div style={{ fontSize: 13, color: '#6B7A99', marginBottom: '1.25rem', lineHeight: 1.6 }}>
              <strong>{deleteConfirm.name || deleteConfirm.company}</strong> at <strong>{deleteConfirm.company}</strong> will be permanently removed from your pipeline along with all activity history.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteConfirm(null)} style={{
                padding: '7px 16px', borderRadius: 8, border: '1px solid #ddd',
                background: '#F4F6FA', fontSize: 13, cursor: 'pointer'
              }}>Cancel</button>
              <button onClick={confirmDelete} style={{
                padding: '7px 16px', borderRadius: 8, border: 'none',
                background: '#A32D2D', color: '#fff', fontSize: 13,
                fontWeight: 600, cursor: 'pointer'
              }}>Remove lead</button>
            </div>
          </div>
        </div>
      )}

      {/* Message History Drawer */}
      {drawerLeadId && (
        <MessagePreviewDrawer
          leadId={drawerLeadId}
          onClose={() => setDrawerLeadId(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position:'fixed', top:20, right:20, zIndex:2000,
          background: toastType==='err' ? '#A32D2D' : '#1A2540',
          color:'#fff', padding:'10px 18px', borderRadius:8, fontSize:13,
          boxShadow:'0 4px 12px rgba(0,0,0,.2)', maxWidth: 360
        }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                    marginBottom:'1.5rem', flexWrap:'wrap', gap:8 }}>
        <div>
          <h1 style={{ fontSize:20, fontWeight:600, margin:0 }}>M.A.M.M.B.A Sales Agent</h1>
          <p style={{ margin:'2px 0 0', fontSize:13, color:'#666' }}>
            <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%',
                           background: agentOn ? '#3B6D11' : '#E24B4A', marginRight:6 }} />
            {agentOn ? 'Active — sequence running Mon–Fri 8:30 AM ET' : 'Paused'}
          </p>
        </div>
        <button onClick={() => setAgentOn(!agentOn)}
          style={btn({ background: agentOn ? '#FDECEA' : '#EAF3DE',
                       color: agentOn ? '#A32D2D' : '#3B6D11',
                       borderColor: agentOn ? '#F5C6C6' : '#B8DFAD' })}>
          {agentOn ? 'Pause agent' : 'Resume agent'}
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',
                    gap:10, marginBottom:'1.5rem' }}>
        {([['Total leads', kpis.total, '#1A2540'],
           ['New',         kpis.newL,  '#185FA5'],
           ['Engaged',     kpis.engaged,'#BA7517'],
           ['Closed Won',  kpis.closed, '#3B6D11']] as [string,number,string][])
          .map(([label, val, color]) => (
          <div key={label} style={{ background:'#F4F6FA', borderRadius:8, padding:'12px 14px' }}>
            <div style={{ fontSize:11, color:'#666', marginBottom:4 }}>{label}</div>
            <div style={{ fontSize:24, fontWeight:600, color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:4, marginBottom:'1rem', flexWrap:'wrap' }}>
        {[['leads','Pipeline'],['upload','Upload Leads'],['add','Add One'],['log','Activity Log'],['agents','Agents'],['settings','⚙️ Settings']]
          .map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={btn({ background: tab===t ? '#E6F1FB' : '#fff',
                         color:      tab===t ? '#0C447C' : '#555',
                         fontWeight: tab===t ? 500 : 400,
                         borderColor: tab===t ? '#B3D1F5' : '#ddd' })}>
            {label}
          </button>
        ))}
      </div>

      {/* ── LEADS TAB ── */}
      {tab === 'leads' && (
        <>
          <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
            <select value={filterStatus} onChange={e => setFilter(e.target.value)} style={inp as any}>
              {['all','New','RVM Sent','Called','Texted','Emailed','Engaged',
                'Proposal Sent','Closed Won','Closed Lost','On Hold']
                .map(s => <option key={s} value={s}>{s==='all'?'All statuses':s}</option>)}
            </select>
            <select value={filterCounty} onChange={e => setCounty(e.target.value)} style={inp as any}>
              {['all','Broward','Miami-Dade','Palm Beach']
                .map(c => <option key={c} value={c}>{c==='all'?'All counties':c}</option>)}
            </select>
            <button onClick={loadLeads} style={btn()}>Refresh</button>
          </div>

          {loading ? <p style={{ color:'#888' }}>Loading…</p> : (
            <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:10 }}>
              {leads.length === 0 && (
                <p style={{ padding:'2rem', color:'#888', textAlign:'center' }}>
                  No leads yet.{' '}
                  <button onClick={() => setTab('upload')}
                    style={{ background:'none', border:'none', color:'#0C447C',
                             cursor:'pointer', textDecoration:'underline', fontSize:14 }}>
                    Upload a CSV
                  </button>{' '}or add one manually.
                </p>
              )}
              {leads.map((lead, i) => (
                <div key={lead.id}
                  style={{ padding:'12px 16px', borderTop: i > 0 ? '1px solid #f0f0f0' : 'none' }}>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 120px 90px', gap:10, alignItems:'start' }}>
                    <div>
                      <div style={{ fontWeight:500 }}>{lead.name || '—'}</div>
                      <div style={{ fontSize:12, color:'#666' }}>{lead.company} · {lead.county}</div>
                      <div style={{ fontSize:12, color:'#888' }}>{lead.title}</div>
                      {lead.monthly_value && (
                        <div style={{ fontSize:11, color:'#3B6D11', marginTop:2 }}>
                          {lead.monthly_value}/mo
                        </div>
                      )}
                    </div>
                    <div>
                      <span style={{ background: STATUS_COLORS[lead.status]||'#F4F6FA',
                                     padding:'3px 10px', borderRadius:12,
                                     fontSize:11, fontWeight:500 }}>
                        {lead.status}
                      </span>
                      <div style={{ fontSize:11, color:'#888', marginTop:4 }}>
                        {lead.touches||0} touches
                      </div>
                    </div>
                    <div style={{ fontSize:12, color:'#666' }}>
                      Step {lead.sequence_step||0}/10
                      {lead.sequence_paused && (
                        <div style={{ color:'#BA7517', fontSize:11 }}>Paused</div>
                      )}
                    </div>
                  </div>
                  {/* Action buttons — full width row below */}
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center',
                                paddingTop:8, borderTop:'1px solid #f5f5f5', marginTop:4 }}>
                  {[['rvm','📳 RVM'],['call','📞 Call'],['sms','💬 SMS'],['email','✉️ Email']]
                    .map(([action, label]) => (
                    <button key={action} onClick={() => trigger(lead, action)}
                      title={action.toUpperCase()}
                      style={btn({ fontSize:12, padding:'5px 10px' })}>
                      {label}
                    </button>
                  ))}
                  <button
                    onClick={() => setDrawerLeadId(lead.id)}
                    title="View message history"
                    style={btn({
                      fontSize:12, padding:'5px 10px',
                      background: drawerLeadId===lead.id ? '#0A1628' : '#F4F6FA',
                      color:      drawerLeadId===lead.id ? '#C9A84C' : '#555',
                    })}>
                    📋 History
                  </button>
                  <button
                    onClick={() => setEditLead(lead)}
                    title="Edit this lead"
                    style={btn({ fontSize:12, padding:'5px 10px',
                                 background:'#E6F1FB', color:'#185FA5',
                                 borderColor:'#B3D1F5' })}>
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(lead)}
                    title="Remove this lead"
                    style={btn({ fontSize:12, padding:'5px 10px',
                                 background:'#FDECEA', color:'#A32D2D',
                                 borderColor:'#F5C6C6' })}>
                    🗑 Remove
                  </button>
                </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── UPLOAD TAB ── */}
      {tab === 'upload' && (
        <div>
          <div style={{ background:'#F4F6FA', border:'1px solid #DDE3F0',
                        borderRadius:10, padding:'1rem 1.25rem', marginBottom:'1rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between',
                          alignItems:'center', flexWrap:'wrap', gap:8 }}>
              <div>
                <div style={{ fontWeight:500, marginBottom:4 }}>Upload leads via CSV or JSON</div>
                <div style={{ fontSize:13, color:'#666' }}>
                  Required: <code>name</code>, <code>company</code> — everything else optional.
                </div>
              </div>
              <button onClick={downloadTemplate}
                style={btn({ background:'#0A1628', color:'#C9A84C', borderColor:'#0A1628', fontWeight:500 })}>
                Download template CSV
              </button>
            </div>
          </div>

          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            style={{ border:`2px dashed ${dragOver ? '#0C447C' : '#CBD3E8'}`,
                     borderRadius:10, padding:'2.5rem', textAlign:'center', cursor:'pointer',
                     background: dragOver ? '#EAF1FD' : '#FAFBFF', marginBottom:'1rem' }}>
            <div style={{ fontSize:32, marginBottom:8 }}>📂</div>
            <div style={{ fontWeight:500, marginBottom:4 }}>
              {importFile ? `📄 ${importFile}` : 'Drop your CSV or JSON file here'}
            </div>
            <div style={{ fontSize:13, color:'#888' }}>or click to browse</div>
            <input ref={fileRef} type="file" accept=".csv,.json,.txt"
              onChange={handleFileInput} style={{ display:'none' }} />
          </div>

          {importRows.length > 0 && (
            <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:10, marginBottom:'1rem', overflow:'auto' }}>
              <div style={{ padding:'12px 16px', borderBottom:'1px solid #f0f0f0',
                            display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
                <div>
                  <span style={{ fontWeight:500 }}>Preview — {importRows.length} rows</span>
                  <span style={{ marginLeft:10, fontSize:12, color:'#3B6D11' }}>
                    ✓ {importRows.filter(r=>r._valid).length} valid
                  </span>
                  {importRows.some(r=>!r._valid) && (
                    <span style={{ marginLeft:8, fontSize:12, color:'#A32D2D' }}>
                      ✗ {importRows.filter(r=>!r._valid).length} invalid
                    </span>
                  )}
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => { setImportRows([]); setImportFile('') }} style={btn({ color:'#A32D2D' })}>Clear</button>
                  <button onClick={handleImport} disabled={importLoading}
                    style={btn({ background:'#0A1628', color:'#C9A84C', borderColor:'#0A1628', fontWeight:500 })}>
                    {importLoading ? 'Importing…' : `Import ${importRows.filter(r=>r._valid).length} leads`}
                  </button>
                </div>
              </div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ background:'#F4F6FA' }}>
                    {['','Name','Company','Title','Phone','Email','County','Priority'].map(h => (
                      <th key={h} style={{ padding:'8px 10px', textAlign:'left', fontWeight:500, color:'#555', borderBottom:'1px solid #eee' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importRows.slice(0,50).map((row,i) => (
                    <tr key={i} style={{ background: row._valid ? '#fff' : '#FFF5F5' }}>
                      <td style={{ padding:'7px 10px', borderBottom:'1px solid #f5f5f5' }}>
                        {row._valid ? <span style={{ color:'#3B6D11' }}>✓</span> : <span style={{ color:'#A32D2D' }}>✗</span>}
                      </td>
                      {[row.name,row.company,row.title||'—',row.phone||'—',row.email||'—',row.county||'Broward',row.priority||'Medium'].map((val,j) => (
                        <td key={j} style={{ padding:'7px 10px', borderBottom:'1px solid #f5f5f5', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color: row._valid ? '#222' : '#A32D2D' }}>{val}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {importResult && (
            <div style={{ background:'#EAF3DE', border:'1px solid #B8DFAD', borderRadius:10, padding:'1rem 1.25rem' }}>
              <div style={{ fontWeight:500, color:'#3B6D11', fontSize:15 }}>✓ Import complete</div>
              <div style={{ fontSize:13, color:'#555', marginTop:4 }}>
                <strong>{importResult.inserted}</strong> leads imported.
                {importResult.skipped > 0 && <> <strong>{importResult.skipped}</strong> skipped.</>}
              </div>
              <button onClick={() => setTab('leads')} style={btn({ marginTop:10, background:'#3B6D11', color:'#fff', borderColor:'#3B6D11' })}>
                View leads →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── ADD SINGLE LEAD TAB ── */}
      {tab === 'add' && (
        <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:10, padding:'1.25rem' }}>
          <h3 style={{ margin:'0 0 1rem', fontWeight:500, fontSize:16 }}>Add a single lead</h3>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:12 }}>
            {([['name','Full name *'],['title','Job title'],['company','Company *'],
               ['phone','Phone'],['email','Email'],['monthly_value','Est. monthly value'],
               ['notes','Notes']] as [string,string][]).map(([key, label]) => (
              <div key={key} style={{ gridColumn: key==='notes' ? '1 / -1' : 'auto' }}>
                <label style={{ fontSize:12, color:'#666', display:'block', marginBottom:4 }}>{label}</label>
                <input value={(newLead as any)[key]}
                  onChange={e => setNewLead(p => ({...p, [key]: e.target.value}))} style={inp} />
              </div>
            ))}
            <div>
              <label style={{ fontSize:12, color:'#666', display:'block', marginBottom:4 }}>County</label>
              <select value={newLead.county} onChange={e => setNewLead(p => ({...p, county: e.target.value}))} style={inp as any}>
                {['Broward','Miami-Dade','Palm Beach'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:12, color:'#666', display:'block', marginBottom:4 }}>Priority</label>
              <select value={newLead.priority} onChange={e => setNewLead(p => ({...p, priority: e.target.value}))} style={inp as any}>
                {['High','Medium','Low'].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <button onClick={addLead} style={btn({ marginTop:'1rem', background:'#0A1628', color:'#C9A84C', borderColor:'#0A1628', fontWeight:500 })}>
            Add lead + start sequence
          </button>
        </div>
      )}

      {/* ── ACTIVITY LOG TAB ── */}
      {tab === 'log' && (
        <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:10 }}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid #f0f0f0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontWeight:500, fontSize:14 }}>Activity Log</span>
            <span style={{ fontSize:12, color:'#888' }}>{log.length} events — click any to read full message</span>
          </div>
          {log.length === 0 && (
            <p style={{ padding:'2rem', color:'#888', textAlign:'center' }}>No activity yet.</p>
          )}
          {log.map((entry, i) => (
            <div key={entry.id}
              style={{
                display:'flex', gap:12, padding:'10px 16px', alignItems:'flex-start',
                borderTop: i > 0 ? '1px solid #f0f0f0' : 'none',
                cursor: 'pointer', transition: 'background .1s'
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F4F6FA')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              onClick={() => setSelectedMsg(entry)}
            >
              <div style={{ width:32, height:32, borderRadius:'50%',
                             background: CH_COLOR[entry.channel]||'#F4F6FA',
                             display:'flex', alignItems:'center',
                             justifyContent:'center', fontSize:14, flexShrink:0 }}>
                {CH_ICON[entry.channel]||'📋'}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13 }}>{entry.summary}</div>
                {entry.body && (
                  <div style={{ fontSize:12, color:'#6B7A99', marginTop:2,
                                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {entry.body.replace(/<[^>]+>/g,'').slice(0,80)}
                    {entry.body.length > 80 ? '…' : ''}
                  </div>
                )}
                <div style={{ fontSize:11, color:'#A0AECC', marginTop:2 }}>
                  {new Date(entry.created_at).toLocaleString()} · {entry.result||''}
                </div>
              </div>
              <div style={{ fontSize:11, color:'#C9A84C', flexShrink:0, paddingTop:2 }}>
                View →
              </div>
            </div>
          ))}
        </div>
      )}

      {tab==='agents' && (
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
            <div>
              <div style={{ fontWeight:600, fontSize:16 }}>AI Agents</div>
              <div style={{ fontSize:13, color:'#666', marginTop:2 }}>Select the active agent for outbound calls, RVMs, SMS and emails.</div>
            </div>
            <button onClick={() => setTab('settings')} style={{ padding:'7px 16px', borderRadius:8, border:'1px solid #DDE3F0', background:'#F4F6FA', fontSize:13, cursor:'pointer' }}>+ Add agent</button>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:16 }}>
            <div style={{ border:'2px solid #0A1628', borderRadius:12, padding:'1.25rem', background:'#fff', position:'relative' }}>
              <div style={{ position:'absolute', top:14, right:14, background:'#EAF3DE', color:'#3B6D11', fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:20 }}>Active</div>
              <div style={{ width:52, height:52, borderRadius:'50%', background:'#0A1628', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:12 }}>
                <span style={{ fontSize:22, fontWeight:700, color:'#C9A84C' }}>{agentName.charAt(0).toUpperCase()}</span>
              </div>
              <div style={{ fontSize:18, fontWeight:700, color:'#1A2540', marginBottom:2 }}>{agentName}</div>
              <div style={{ fontSize:13, color:'#6B7A99', marginBottom:12 }}>{agentRole} &middot; {companyName}</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:14 }}>
                <span style={{ background:'#EEEDFE', color:'#4B3FA0', fontSize:11, padding:'3px 10px', borderRadius:20, fontWeight:500 }}>Voice: {blandVoice}</span>
                <span style={{ background:'#FAEEDA', color:'#7A4F0D', fontSize:11, padding:'3px 10px', borderRadius:20, fontWeight:500 }}>{agentTone.split(',')[0]}</span>
                <span style={{ background:'#E1F5EE', color:'#1A6B44', fontSize:11, padding:'3px 10px', borderRadius:20, fontWeight:500 }}>English</span>
              </div>
              <div style={{ background:'#F4F6FA', borderRadius:8, padding:'10px 12px', fontSize:12, color:'#555', lineHeight:1.7, marginBottom:14 }}>
                "Hi, this is <strong>{agentName}</strong>, {agentRole} at {companyName}..."
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={() => setTab('settings')} style={{ flex:1, padding:'8px', borderRadius:8, border:'1px solid #DDE3F0', background:'#F4F6FA', fontSize:13, cursor:'pointer', color:'#1A2540' }}>Edit persona</button>
                <button onClick={() => setTab('settings')} style={{ flex:1, padding:'8px', borderRadius:8, border:'none', background:'#0A1628', color:'#C9A84C', fontSize:13, fontWeight:500, cursor:'pointer' }}>Test call</button>
              </div>
            </div>
            <div onClick={() => setTab('settings')}
              style={{ border:'2px dashed #DDE3F0', borderRadius:12, padding:'1.25rem', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:260, cursor:'pointer', color:'#A0AECC', gap:8 }}
              onMouseEnter={e => (e.currentTarget.style.background='#F4F6FA')}
              onMouseLeave={e => (e.currentTarget.style.background='transparent')}>
              <div style={{ fontSize:36 }}>+</div>
              <div style={{ fontSize:14, fontWeight:500 }}>Add agent</div>
              <div style={{ fontSize:12, textAlign:'center', maxWidth:180 }}>Create a new persona with a different name, voice and style</div>
            </div>
          </div>
        </div>
      )}

      {tab==='settings' && (
        <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:10, padding:'1.25rem' }}>
          <h3 style={{ margin:'0 0 1.25rem', fontWeight:500, fontSize:16 }}>Agent Settings</h3>
          {/* Persona */}
          <div style={{ marginBottom:'1.5rem' }}>
            <div style={{ fontWeight:500, fontSize:15, marginBottom:12, paddingBottom:8, borderBottom:'1px solid #EEF0F5' }}>Agent Persona</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
              <div>
                <label style={{ fontSize:12, color:'#666', display:'block', marginBottom:4 }}>Agent name</label>
                <input value={agentName} onChange={e => setAgentName(e.target.value)}
                  placeholder="Marcus"
                  style={{ width:'100%', padding:'8px 10px', borderRadius:6, border:'1px solid #ddd', fontSize:13, boxSizing:'border-box' as any }} />
              </div>
              <div>
                <label style={{ fontSize:12, color:'#666', display:'block', marginBottom:4 }}>Role</label>
                <input value={agentRole} onChange={e => setAgentRole(e.target.value)}
                  placeholder="Logistics Coordinator"
                  style={{ width:'100%', padding:'8px 10px', borderRadius:6, border:'1px solid #ddd', fontSize:13, boxSizing:'border-box' as any }} />
              </div>
              <div>
                <label style={{ fontSize:12, color:'#666', display:'block', marginBottom:4 }}>Company name</label>
                <input value={companyName} onChange={e => setCompanyName(e.target.value)}
                  placeholder="M.A.M.M.B.A Enterprises"
                  style={{ width:'100%', padding:'8px 10px', borderRadius:6, border:'1px solid #ddd', fontSize:13, boxSizing:'border-box' as any }} />
              </div>
              <div>
                <label style={{ fontSize:12, color:'#666', display:'block', marginBottom:4 }}>Tone</label>
                <select value={agentTone} onChange={e => setAgentTone(e.target.value)}
                  style={{ width:'100%', padding:'8px 10px', borderRadius:6, border:'1px solid #ddd', fontSize:13, boxSizing:'border-box' as any }}>
                  {['confident and direct, with warmth','professional and formal','friendly and conversational','energetic and enthusiastic','calm and reassuring'].map(t => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ background:'#F4F6FA', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#555', lineHeight:1.7 }}>
              <strong style={{ color:'#1A2540' }}>Preview:</strong> "Hi, this is <strong>{agentName}</strong>, {agentRole} at <strong>{companyName}</strong>. We help South Florida facilities with same-day courier routes..."
            </div>
          </div>

          <div style={{ marginBottom:'1.5rem' }}>
            <div style={{ fontWeight:500, marginBottom:4 }}>Bland.ai Call Voice</div>
            <div style={{ fontSize:13, color:'#666', marginBottom:12 }}>The voice your AI agent uses on outbound calls.</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:10 }}>
              {[
                { id:'maya',    label:'Maya',    desc:'Female · Professional' },
                { id:'derek',   label:'Derek',   desc:'Male · Confident' },
                { id:'ryan',    label:'Ryan',    desc:'Male · Conversational' },
                { id:'jessica', label:'Jessica', desc:'Female · Warm' },
                { id:'josh',    label:'Josh',    desc:'Male · Energetic' },
              ].map(v => (
                <div key={v.id}
                  style={{ border:`2px solid ${blandVoice===v.id?'#0A1628':'#DDE3F0'}`, borderRadius:10, padding:'12px 14px', cursor:'pointer', background:blandVoice===v.id?'#0A1628':'#FAFBFF' }}
                  onClick={() => setBlandVoice(v.id)}>
                  <div style={{ fontWeight:600, fontSize:14, color:blandVoice===v.id?'#C9A84C':'#1A2540' }}>{v.label}</div>
                  <div style={{ fontSize:12, color:blandVoice===v.id?'#8899BB':'#6B7A99', marginTop:2, marginBottom:8 }}>{v.desc}</div>
                  {blandVoice===v.id && <div style={{ fontSize:11, color:'#C9A84C', marginTop:6 }}>✓ Selected</div>}
                </div>
              ))}
            </div>
          </div>
          <div style={{ background:'#F4F6FA', border:'1px solid #DDE3F0', borderRadius:10, padding:'1rem 1.25rem', marginBottom:'1rem' }}>
            <div style={{ fontWeight:500, marginBottom:4 }}>Hear it on your phone</div>
            <div style={{ fontSize:13, color:'#666', marginBottom:10 }}>Enter your number and we will call you using the selected voice so you can hear exactly how it sounds on a real call.</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <input value={testCallPhone} onChange={e => setTestCallPhone(e.target.value)}
                placeholder="+1 954 555 0000"
                style={{ flex:1, minWidth:180, padding:'8px 10px', borderRadius:6, border:'1px solid #ddd', fontSize:13 }} />
              <button onClick={sendTestCall} disabled={testCalling}
                style={btn({ background:'#1A2540', color:'#fff', borderColor:'#1A2540', fontWeight:500 })}>
                {testCalling ? 'Calling...' : 'Test call'}
              </button>
            </div>
          </div>
          <button onClick={saveSettings} disabled={savingSettings}
            style={btn({ background:'#0A1628', color:'#C9A84C', borderColor:'#0A1628', fontWeight:500 })}>
            {savingSettings ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}
    </div>
  )
}
