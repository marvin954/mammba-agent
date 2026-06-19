'use client'
import { useEffect, useState, useCallback } from 'react'

type Lead = {
  id: string; name: string; title: string; company: string
  phone: string; email: string; county: string; tier: string
  status: string; priority: string; monthly_value: string
  touches: number; last_contact: string; notes: string
  sequence_step: number; sequence_paused: boolean
}
type LogEntry = {
  id: string; channel: string; summary: string; result: string
  created_at: string; lead_id: string
}

const STATUS_COLORS: Record<string, string> = {
  'New':            '#E8F0FE',
  'RVM Sent':       '#E6F1FB',
  'Called':         '#EEEDFE',
  'Texted':         '#E1F5EE',
  'Emailed':        '#FAEEDA',
  'Engaged':        '#EAF3DE',
  'Proposal Sent':  '#FFF3CD',
  'Closed Won':     '#D5EFDF',
  'Closed Lost':    '#FDECEA',
  'On Hold':        '#F1EFE8',
}

export default function Dashboard() {
  const [leads, setLeads]         = useState<Lead[]>([])
  const [log, setLog]             = useState<LogEntry[]>([])
  const [tab, setTab]             = useState('leads')
  const [filterStatus, setFilter] = useState('all')
  const [filterCounty, setCounty] = useState('all')
  const [loading, setLoading]     = useState(false)
  const [agentOn, setAgentOn]     = useState(true)
  const [toast, setToast]         = useState('')
  const [newLead, setNewLead]     = useState({
    name:'', title:'', company:'', phone:'', email:'',
    county:'Broward', tier:'Tier 1', monthly_value:'', priority:'High'
  })

  const notify = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  const loadLeads = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterStatus !== 'all') params.set('status', filterStatus)
    if (filterCounty !== 'all') params.set('county', filterCounty)
    const res  = await fetch(`/api/leads?${params}`)
    const data = await res.json()
    setLeads(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [filterStatus, filterCounty])

  const loadLog = async () => {
    const res  = await fetch('/api/leads')
    const data = await res.json()
    const allLog: LogEntry[] = []
    if (Array.isArray(data)) {
      data.forEach((l: any) => {
        if (Array.isArray(l.activity_log)) allLog.push(...l.activity_log)
      })
    }
    allLog.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    setLog(allLog.slice(0, 30))
  }

  useEffect(() => { loadLeads() }, [loadLeads])
  useEffect(() => { if (tab === 'log') loadLog() }, [tab])

  const trigger = async (lead: Lead, action: string) => {
    notify(`Sending ${action} to ${lead.name}…`)
    const res = await fetch(`/api/agent/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: lead.id }),
    })
    const data = await res.json()
    if (res.ok) {
      notify(`${action.toUpperCase()} sent to ${lead.name}`)
      loadLeads()
    } else {
      notify(`Error: ${data.error}`)
    }
  }

  const addLead = async () => {
    if (!newLead.name || !newLead.company) { notify('Name and company required'); return }
    const res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newLead),
    })
    if (res.ok) {
      notify(`Lead added: ${newLead.company}`)
      setNewLead({ name:'', title:'', company:'', phone:'', email:'',
                   county:'Broward', tier:'Tier 1', monthly_value:'', priority:'High' })
      loadLeads()
    }
  }

  const kpis = {
    total:    leads.length,
    engaged:  leads.filter(l => ['Engaged','Proposal Sent'].includes(l.status)).length,
    closed:   leads.filter(l => l.status === 'Closed Won').length,
    newLeads: leads.filter(l => l.status === 'New').length,
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1100, margin: '0 auto', fontFamily: 'system-ui, sans-serif', fontSize: 14 }}>

      {toast && (
        <div style={{ position: 'fixed', top: 20, right: 20, background: '#1A2540', color: '#fff',
                      padding: '10px 18px', borderRadius: 8, zIndex: 1000, fontSize: 13 }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>M.A.M.M.B.A Sales Agent</h1>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: '#666' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                           background: agentOn ? '#3B6D11' : '#E24B4A', marginRight: 6 }} />
            {agentOn ? 'Active — sequence running daily at 8:30 AM ET' : 'Paused'}
          </p>
        </div>
        <button onClick={() => setAgentOn(!agentOn)}
          style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #ddd',
                   background: agentOn ? '#FDECEA' : '#EAF3DE',
                   color: agentOn ? '#A32D2D' : '#3B6D11', cursor: 'pointer', fontSize: 13 }}>
          {agentOn ? 'Pause agent' : 'Resume agent'}
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: '1.5rem' }}>
        {[['Total leads', kpis.total, '#000'], ['New', kpis.newLeads, '#185FA5'],
          ['Engaged', kpis.engaged, '#BA7517'], ['Closed', kpis.closed, '#3B6D11']].map(([label, val, color]) => (
          <div key={label as string} style={{ background: '#F4F6FA', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: color as string }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '1rem', flexWrap: 'wrap' }}>
        {['leads','add','log'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid #ddd', cursor: 'pointer', fontSize: 13,
                     background: tab === t ? '#E6F1FB' : '#fff', color: tab === t ? '#0C447C' : '#555',
                     fontWeight: tab === t ? 500 : 400 }}>
            {t === 'leads' ? 'Lead pipeline' : t === 'add' ? '+ Add lead' : 'Activity log'}
          </button>
        ))}
      </div>

      {/* LEADS TAB */}
      {tab === 'leads' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <select value={filterStatus} onChange={e => setFilter(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}>
              {['all','New','RVM Sent','Called','Texted','Emailed','Engaged','Proposal Sent','Closed Won','Closed Lost','On Hold']
                .map(s => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
            </select>
            <select value={filterCounty} onChange={e => setCounty(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}>
              {['all','Broward','Miami-Dade','Palm Beach'].map(c => <option key={c} value={c}>{c === 'all' ? 'All counties' : c}</option>)}
            </select>
            <button onClick={loadLeads}
              style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', fontSize: 13, cursor: 'pointer' }}>
              Refresh
            </button>
          </div>

          {loading ? <p style={{ color: '#888' }}>Loading leads…</p> : (
            <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10 }}>
              {leads.length === 0 && (
                <p style={{ padding: '2rem', color: '#888', textAlign: 'center' }}>
                  No leads yet. Add your first lead or load the CRM data.
                </p>
              )}
              {leads.map((lead, i) => (
                <div key={lead.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 100px 180px',
                                            gap: 10, padding: '12px 16px', alignItems: 'center',
                                            borderTop: i > 0 ? '1px solid #f0f0f0' : 'none' }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{lead.name}</div>
                    <div style={{ fontSize: 12, color: '#666' }}>{lead.company} · {lead.county}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{lead.title}</div>
                    {lead.monthly_value && <div style={{ fontSize: 11, color: '#3B6D11', marginTop: 2 }}>{lead.monthly_value}/mo</div>}
                  </div>
                  <div>
                    <span style={{ background: STATUS_COLORS[lead.status] || '#F4F6FA',
                                   padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 500 }}>
                      {lead.status}
                    </span>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{lead.touches || 0} touches</div>
                  </div>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    Step {lead.sequence_step || 0} / 10
                    {lead.sequence_paused && <div style={{ color: '#BA7517', fontSize: 11 }}>Paused</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {[['rvm','RVM'],['call','Call'],['sms','SMS'],['email','Email']].map(([action, label]) => (
                      <button key={action} onClick={() => trigger(lead, action)}
                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #ddd',
                                 background: '#fff', fontSize: 11, cursor: 'pointer' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ADD LEAD TAB */}
      {tab === 'add' && (
        <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: '1.25rem' }}>
          <h3 style={{ margin: '0 0 1rem', fontWeight: 500, fontSize: 16 }}>Add a new lead</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {[['name','Full name *'],['title','Job title'],['company','Company *'],
              ['phone','Phone'],['email','Email'],['monthly_value','Est. monthly value']].map(([key, label]) => (
              <div key={key}>
                <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>{label}</label>
                <input value={(newLead as any)[key]} onChange={e => setNewLead(p => ({...p, [key]: e.target.value}))}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }} />
              </div>
            ))}
            <div>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>County</label>
              <select value={newLead.county} onChange={e => setNewLead(p => ({...p, county: e.target.value}))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}>
                {['Broward','Miami-Dade','Palm Beach'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Priority</label>
              <select value={newLead.priority} onChange={e => setNewLead(p => ({...p, priority: e.target.value}))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}>
                {['High','Medium','Low'].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <button onClick={addLead}
            style={{ marginTop: '1rem', padding: '9px 20px', borderRadius: 8, border: 'none',
                     background: '#0A1628', color: '#C9A84C', fontWeight: 500, fontSize: 14, cursor: 'pointer' }}>
            Add lead + start sequence
          </button>
        </div>
      )}

      {/* ACTIVITY LOG TAB */}
      {tab === 'log' && (
        <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10 }}>
          {log.length === 0 && <p style={{ padding: '2rem', color: '#888', textAlign: 'center' }}>No activity yet.</p>}
          {log.map((entry, i) => {
            const colors: Record<string, string> = { call:'#EEEDFE', rvm:'#E6F1FB', sms:'#E1F5EE', email:'#FAEEDA', note:'#F4F6FA' }
            return (
              <div key={entry.id} style={{ display: 'flex', gap: 12, padding: '10px 16px',
                                            borderTop: i > 0 ? '1px solid #f0f0f0' : 'none', alignItems: 'flex-start' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: colors[entry.channel] || '#F4F6FA',
                               display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                  {entry.channel === 'call' ? '📞' : entry.channel === 'rvm' ? '📳' : entry.channel === 'sms' ? '💬' : '✉️'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13 }}>{entry.summary}</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                    {new Date(entry.created_at).toLocaleString()} · {entry.result || ''}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
