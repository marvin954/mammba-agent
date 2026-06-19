'use client'
import { useEffect, useState, useCallback, useRef } from 'react'

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

// ── Parse CSV text → array of objects ─────────────────────────
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    // Handle quoted commas
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

// ── Validate + normalise a raw row ─────────────────────────────
function normaliseRow(raw: Record<string, string>): ImportRow {
  const name    = (raw.name    || raw.Name    || raw.full_name   || '').trim()
  const company = (raw.company || raw.Company || raw.business    || raw['Company Name'] || '').trim()
  const valid   = !!(name && company)
  return {
    name,
    company,
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
    _valid: valid,
    _error: valid ? undefined : 'Missing name or company',
  }
}

const CSV_TEMPLATE = `name,title,company,phone,email,county,tier,monthly_value,priority,notes
Maria Santos,Operations Manager,Broward Health Medical Center,954-355-4400,msantos@example.com,Broward,Tier 1,"$4,000-$8,000",High,Inter-facility transfers
James Ortega,Supply Chain Director,Memorial Regional Hospital,954-987-2000,jortega@example.com,Broward,Tier 1,"$4,000-$8,000",High,
Carlos Rivera,Director of Logistics,Jackson Memorial Hospital,305-585-1111,crivera@example.com,Miami-Dade,Tier 1,"$6,000-$10,000",High,3 campuses
Tom Beckford,VP of Supply Chain,Palm Beach Health Network,561-844-6300,tbeckford@example.com,Palm Beach,Tier 1,"$6,000-$10,000",High,7 hospitals`

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

  // Import state
  const [importRows, setImportRows]   = useState<ImportRow[]>([])
  const [importFile, setImportFile]   = useState('')
  const [importLoading, setImpLoad]   = useState(false)
  const [importResult, setImpResult]  = useState<{inserted:number;skipped:number}|null>(null)
  const [dragOver, setDragOver]       = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Add lead state
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
    setLog(all.slice(0, 30))
  }

  useEffect(() => { loadLeads() }, [loadLeads])
  useEffect(() => { if (tab === 'log') loadLog() }, [tab])

  // ── File parse ───────────────────────────────────────────────
  const processFile = (file: File) => {
    setImportFile(file.name)
    setImpResult(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      let rawRows: Record<string, string>[] = []
      try {
        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(text)
          rawRows = Array.isArray(parsed) ? parsed : parsed.leads || []
        } else {
          // CSV (also handles .txt)
          rawRows = parseCSV(text)
        }
        const rows = rawRows.map(normaliseRow)
        setImportRows(rows)
        const valid = rows.filter(r => r._valid).length
        notify(`Parsed ${rows.length} rows — ${valid} valid, ${rows.length - valid} skipped`, valid > 0 ? 'ok' : 'err')
      } catch (err: any) {
        notify(`Parse error: ${err.message}`, 'err')
      }
    }
    reader.readAsText(file)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  // ── Upload to Supabase ───────────────────────────────────────
  const handleImport = async () => {
    const valid = importRows.filter(r => r._valid)
    if (valid.length === 0) { notify('No valid rows to import', 'err'); return }
    setImpLoad(true)
    try {
      const res  = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: valid }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setImpResult({ inserted: data.inserted, skipped: data.skipped })
      notify(`Imported ${data.inserted} leads successfully`, 'ok')
      setImportRows([]); setImportFile('')
      loadLeads()
    } catch (err: any) {
      notify(`Import failed: ${err.message}`, 'err')
    } finally {
      setImpLoad(false)
    }
  }

  // ── Download CSV template ────────────────────────────────────
  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = 'mammba_leads_template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Single action trigger ────────────────────────────────────
  const trigger = async (lead: Lead, action: string) => {
    notify(`Sending ${action.toUpperCase()} to ${lead.name}…`)
    const res  = await fetch(`/api/agent/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: lead.id }),
    })
    const data = await res.json()
    if (res.ok) { notify(`${action.toUpperCase()} sent to ${lead.name}`); loadLeads() }
    else notify(`Error: ${data.error}`, 'err')
  }

  // ── Add single lead ──────────────────────────────────────────
  const addLead = async () => {
    if (!newLead.name || !newLead.company) { notify('Name and company required', 'err'); return }
    const res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newLead),
    })
    if (res.ok) {
      notify(`Lead added: ${newLead.company}`)
      setNewLead({ name:'', title:'', company:'', phone:'', email:'',
                   county:'Broward', tier:'Tier 1', monthly_value:'', priority:'High', notes:'' })
      loadLeads()
    }
  }

  const kpis = {
    total:   leads.length,
    engaged: leads.filter(l => ['Engaged','Proposal Sent'].includes(l.status)).length,
    closed:  leads.filter(l => l.status === 'Closed Won').length,
    newL:    leads.filter(l => l.status === 'New').length,
  }

  // ── Shared input style ───────────────────────────────────────
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

      {/* Toast */}
      {toast && (
        <div style={{ position:'fixed', top:20, right:20, zIndex:1000,
                      background: toastType==='err' ? '#A32D2D' : '#1A2540',
                      color:'#fff', padding:'10px 18px', borderRadius:8, fontSize:13,
                      boxShadow:'0 4px 12px rgba(0,0,0,.2)' }}>
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
        {[['leads','Pipeline'],['upload','Upload Leads'],['add','Add One'],['log','Activity']]
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
                  style={{ display:'grid', gridTemplateColumns:'1fr 120px 100px 180px',
                           gap:10, padding:'12px 16px', alignItems:'center',
                           borderTop: i > 0 ? '1px solid #f0f0f0' : 'none' }}>
                  <div>
                    <div style={{ fontWeight:500 }}>{lead.name}</div>
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
                  <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                    {[['rvm','RVM'],['call','Call'],['sms','SMS'],['email','Email']]
                      .map(([action, label]) => (
                      <button key={action} onClick={() => trigger(lead, action)}
                        style={btn({ fontSize:11, padding:'4px 8px' })}>
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

      {/* ── UPLOAD TAB ── */}
      {tab === 'upload' && (
        <div>

          {/* Instructions card */}
          <div style={{ background:'#F4F6FA', border:'1px solid #DDE3F0',
                        borderRadius:10, padding:'1rem 1.25rem', marginBottom:'1rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between',
                          alignItems:'center', flexWrap:'wrap', gap:8 }}>
              <div>
                <div style={{ fontWeight:500, marginBottom:4 }}>
                  Upload leads via CSV or JSON
                </div>
                <div style={{ fontSize:13, color:'#666', lineHeight:1.6 }}>
                  Accepted formats: <strong>.csv</strong>, <strong>.json</strong>, <strong>.txt</strong>
                  &nbsp;—&nbsp;Required columns: <code>name</code>, <code>company</code>.
                  All other columns are optional.
                </div>
              </div>
              <button onClick={downloadTemplate}
                style={btn({ background:'#0A1628', color:'#C9A84C',
                             borderColor:'#0A1628', fontWeight:500 })}>
                Download template CSV
              </button>
            </div>

            {/* Column reference */}
            <div style={{ marginTop:'1rem', display:'grid',
                          gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:6 }}>
              {[
                ['name *',        'Full name of contact'],
                ['company *',     'Company or facility name'],
                ['title',         'Job title'],
                ['phone',         'Phone number'],
                ['email',         'Email address'],
                ['county',        'Broward / Miami-Dade / Palm Beach'],
                ['tier',          'Tier 1 – Tier 5'],
                ['monthly_value', 'Est. monthly contract value'],
                ['priority',      'High / Medium / Low'],
                ['notes',         'Any notes'],
              ].map(([col, desc]) => (
                <div key={col} style={{ fontSize:12 }}>
                  <code style={{ background:'#E8ECF5', padding:'1px 6px',
                                  borderRadius:4, fontWeight:500 }}>{col}</code>
                  <span style={{ color:'#888', marginLeft:6 }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            style={{ border: `2px dashed ${dragOver ? '#0C447C' : '#CBD3E8'}`,
                     borderRadius:10, padding:'2.5rem',
                     textAlign:'center', cursor:'pointer',
                     background: dragOver ? '#EAF1FD' : '#FAFBFF',
                     transition:'all .15s', marginBottom:'1rem' }}>
            <div style={{ fontSize:32, marginBottom:8 }}>📂</div>
            <div style={{ fontWeight:500, marginBottom:4 }}>
              {importFile ? `📄 ${importFile}` : 'Drop your CSV or JSON file here'}
            </div>
            <div style={{ fontSize:13, color:'#888' }}>
              or click to browse — .csv, .json, .txt accepted
            </div>
            <input ref={fileRef} type="file" accept=".csv,.json,.txt"
              onChange={handleFileInput} style={{ display:'none' }} />
          </div>

          {/* Preview table */}
          {importRows.length > 0 && (
            <div style={{ background:'#fff', border:'1px solid #eee',
                          borderRadius:10, marginBottom:'1rem', overflow:'auto' }}>
              <div style={{ padding:'12px 16px', borderBottom:'1px solid #f0f0f0',
                            display:'flex', justifyContent:'space-between',
                            alignItems:'center', flexWrap:'wrap', gap:8 }}>
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
                  <button onClick={() => { setImportRows([]); setImportFile('') }}
                    style={btn({ color:'#A32D2D' })}>
                    Clear
                  </button>
                  <button onClick={handleImport} disabled={importLoading}
                    style={btn({ background:'#0A1628', color:'#C9A84C',
                                 borderColor:'#0A1628', fontWeight:500,
                                 opacity: importLoading ? 0.6 : 1 })}>
                    {importLoading
                      ? `Importing…`
                      : `Import ${importRows.filter(r=>r._valid).length} leads`}
                  </button>
                </div>
              </div>

              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ background:'#F4F6FA' }}>
                    {['','Name','Company','Title','Phone','Email','County','Priority','Value'].map(h => (
                      <th key={h} style={{ padding:'8px 10px', textAlign:'left',
                                           fontWeight:500, color:'#555',
                                           borderBottom:'1px solid #eee', whiteSpace:'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importRows.slice(0, 50).map((row, i) => (
                    <tr key={i} style={{ background: row._valid ? '#fff' : '#FFF5F5' }}>
                      <td style={{ padding:'7px 10px', borderBottom:'1px solid #f5f5f5' }}>
                        {row._valid
                          ? <span style={{ color:'#3B6D11', fontWeight:600 }}>✓</span>
                          : <span title={row._error} style={{ color:'#A32D2D', cursor:'help' }}>✗</span>}
                      </td>
                      {[row.name, row.company, row.title||'—', row.phone||'—',
                        row.email||'—', row.county||'Broward', row.priority||'Medium',
                        row.monthly_value||'—'].map((val, j) => (
                        <td key={j} style={{ padding:'7px 10px',
                                             borderBottom:'1px solid #f5f5f5',
                                             maxWidth:160, overflow:'hidden',
                                             textOverflow:'ellipsis', whiteSpace:'nowrap',
                                             color: row._valid ? '#222' : '#A32D2D' }}>
                          {val}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {importRows.length > 50 && (
                    <tr>
                      <td colSpan={9} style={{ padding:'8px 12px', color:'#888',
                                               fontSize:12, fontStyle:'italic' }}>
                        Showing first 50 of {importRows.length} rows…
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Success result */}
          {importResult && (
            <div style={{ background:'#EAF3DE', border:'1px solid #B8DFAD',
                          borderRadius:10, padding:'1rem 1.25rem' }}>
              <div style={{ fontWeight:500, color:'#3B6D11', fontSize:15 }}>
                ✓ Import complete
              </div>
              <div style={{ fontSize:13, color:'#555', marginTop:4 }}>
                <strong>{importResult.inserted}</strong> leads imported and added to your pipeline.
                {importResult.skipped > 0 && (
                  <> <strong>{importResult.skipped}</strong> rows skipped (missing name or company).</>
                )}
                <> The sequence will begin at the next cron run (Mon–Fri 8:30 AM ET).</>
              </div>
              <button onClick={() => setTab('leads')}
                style={btn({ marginTop:10, background:'#3B6D11',
                             color:'#fff', borderColor:'#3B6D11' })}>
                View leads →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── ADD SINGLE LEAD TAB ── */}
      {tab === 'add' && (
        <div style={{ background:'#fff', border:'1px solid #eee',
                      borderRadius:10, padding:'1.25rem' }}>
          <h3 style={{ margin:'0 0 1rem', fontWeight:500, fontSize:16 }}>Add a single lead</h3>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:12 }}>
            {([['name','Full name *'],['title','Job title'],['company','Company *'],
               ['phone','Phone'],['email','Email'],['monthly_value','Est. monthly value'],
               ['notes','Notes']] as [string,string][]).map(([key, label]) => (
              <div key={key} style={{ gridColumn: key==='notes' ? '1 / -1' : 'auto' }}>
                <label style={{ fontSize:12, color:'#666', display:'block', marginBottom:4 }}>
                  {label}
                </label>
                <input value={(newLead as any)[key]}
                  onChange={e => setNewLead(p => ({...p, [key]: e.target.value}))}
                  style={inp} />
              </div>
            ))}
            <div>
              <label style={{ fontSize:12, color:'#666', display:'block', marginBottom:4 }}>County</label>
              <select value={newLead.county}
                onChange={e => setNewLead(p => ({...p, county: e.target.value}))} style={inp as any}>
                {['Broward','Miami-Dade','Palm Beach'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:12, color:'#666', display:'block', marginBottom:4 }}>Priority</label>
              <select value={newLead.priority}
                onChange={e => setNewLead(p => ({...p, priority: e.target.value}))} style={inp as any}>
                {['High','Medium','Low'].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <button onClick={addLead}
            style={btn({ marginTop:'1rem', background:'#0A1628',
                         color:'#C9A84C', borderColor:'#0A1628', fontWeight:500 })}>
            Add lead + start sequence
          </button>
        </div>
      )}

      {/* ── ACTIVITY LOG TAB ── */}
      {tab === 'log' && (
        <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:10 }}>
          {log.length === 0 && (
            <p style={{ padding:'2rem', color:'#888', textAlign:'center' }}>No activity yet.</p>
          )}
          {log.map((entry, i) => {
            const colors: Record<string, string> = {
              call:'#EEEDFE', rvm:'#E6F1FB', sms:'#E1F5EE', email:'#FAEEDA', note:'#F4F6FA'
            }
            const icons: Record<string, string> = {
              call:'📞', rvm:'📳', sms:'💬', email:'✉️', note:'📝'
            }
            return (
              <div key={entry.id}
                style={{ display:'flex', gap:12, padding:'10px 16px', alignItems:'flex-start',
                         borderTop: i > 0 ? '1px solid #f0f0f0' : 'none' }}>
                <div style={{ width:32, height:32, borderRadius:'50%',
                               background: colors[entry.channel]||'#F4F6FA',
                               display:'flex', alignItems:'center',
                               justifyContent:'center', fontSize:14, flexShrink:0 }}>
                  {icons[entry.channel]||'📋'}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13 }}>{entry.summary}</div>
                  <div style={{ fontSize:11, color:'#888', marginTop:2 }}>
                    {new Date(entry.created_at).toLocaleString()} · {entry.result||''}
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
