export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

function safe(val: string | null | undefined, fallback = ''): string { return val?.trim() || fallback }
function firstName(name: string | null | undefined): string {
  if (!name || name.trim() === '') return 'there'
  return name.trim().split(' ')[0]
}

export async function POST(req: NextRequest) {
  try {
    const slyEmail = process.env.SLYBROADCAST_EMAIL
    const slyPass  = process.env.SLYBROADCAST_PASSWORD
    const slyPhone = process.env.SLYBROADCAST_PHONE
    if (!slyEmail || !slyPass || !slyPhone) {
      return NextResponse.json({ error: 'Slybroadcast not configured.' }, { status: 400 })
    }

    const { lead_id } = await req.json()
    const { data: lead, error } = await supabaseAdmin.from('leads').select('*').eq('id', lead_id).single()
    if (error || !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const phone = safe(lead.phone)
    if (!phone || phone === 'N/A') {
      return NextResponse.json({ error: `No phone number on file for ${safe(lead.name, 'this lead')}.` }, { status: 400 })
    }

    // ── Load persona ───────────────────────────────────────
    const { data: rows } = await supabaseAdmin.from('settings').select('key, value')
    const s: Record<string, string> = {}
    for (const r of rows || []) s[r.key] = r.value
    const persona = {
      name:    s.agent_name   || 'Marcus',
      role:    s.agent_role   || 'Logistics Coordinator',
      company: s.company_name || 'MAMMBA Enterprises',
    }

    const rvmMessage = buildRVMScript(lead, persona)
    const toDigits   = (n: string) => { const d = n.replace(/\D/g, ''); return d.length === 11 && d.startsWith('1') ? d.slice(1) : d }

    const formData = new URLSearchParams({
      c_uid:          slyEmail,
      c_password:     slyPass,
      c_phone:        toDigits(phone),
      c_record_audio: '0',
      c_audio_file:   'tts',
      c_tts_message:  rvmMessage,
      c_date:         'now',
      c_from_number:  toDigits(slyPhone),
    })

    const slyRes  = await fetch('https://www.mobile-sphere.com/gateway/vmb.php', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formData.toString(),
    })
    const slyText = await slyRes.text()
    const rvmOk   = slyText.toLowerCase().includes('ok') || slyText.toLowerCase().includes('success')

    await supabaseAdmin.from('activity_log').insert({
      lead_id: lead.id, channel: 'rvm', direction: 'outbound',
      summary: `RVM sent to ${safe(lead.name, 'lead')} at ${safe(lead.company)}`,
      body:    rvmMessage,
      result:  rvmOk ? 'delivered' : `failed: ${slyText.slice(0, 120)}`,
    })
    await supabaseAdmin.from('leads').update({
      status: 'RVM Sent', touches: (lead.touches || 0) + 1, last_contact: new Date().toISOString(),
    }).eq('id', lead.id)

    return NextResponse.json({ success: true, response: slyText })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

function buildRVMScript(lead: any, p: { name: string; role: string; company: string }): string {
  const first   = firstName(lead.name)
  const name    = safe(lead.name,    'there')
  const company = safe(lead.company, 'your organization')
  const county  = safe(lead.county,  'South Florida')
  const phone   = safe(process.env.SLYBROADCAST_PHONE, '')
  return `Hi, this message is for ${name}. This is ${p.name}, ${p.role} at ${p.company}. We specialize in same-day medical courier routes for businesses across ${county} County — specifically for facilities like ${company}. I'd love to show you how we eliminate delivery headaches with a dedicated, reliable route — GPS tracked, backup driver included, no setup fees. Please call us back at ${phone} — I'll keep it under 10 minutes and have a proposal ready. Again, this is ${p.name} from ${p.company}. Looking forward to connecting, ${first}. Have a great day.`
}
