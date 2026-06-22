export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { supabaseAdmin } from '@/lib/supabase'

function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) throw new Error('Missing Twilio env vars')
  return twilio(sid, token)
}
function appUrl(): string { return (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '') }
function firstName(name: string | null | undefined): string {
  if (!name || name.trim() === '') return 'there'
  return name.trim().split(' ')[0]
}
function safe(val: string | null | undefined, fallback = ''): string { return val?.trim() || fallback }

export async function POST(req: NextRequest) {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      return NextResponse.json({ error: 'Twilio not configured.' }, { status: 400 })
    }

    const { lead_id, body_override } = await req.json()
    const { data: lead, error } = await supabaseAdmin.from('leads').select('*').eq('id', lead_id).single()
    if (error || !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const phone = safe(lead.phone)
    if (!phone || phone === 'N/A') {
      return NextResponse.json(
        { error: `No phone number on file for ${safe(lead.name, 'this lead')}.` },
        { status: 400 }
      )
    }

    // ── Load persona ───────────────────────────────────────
    const { data: rows } = await supabaseAdmin.from('settings').select('key, value')
    const s: Record<string, string> = {}
    for (const r of rows || []) s[r.key] = r.value
    const persona = {
      name:    s.agent_name   || 'Marcus',
      company: s.company_name || 'Mamba Enterprises',
    }

    const smsBody  = body_override || buildSMSBody(lead, persona)
    const client   = getTwilio()
    const baseUrl  = appUrl()

    const msgParams: any = {
      body: smsBody,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to:   phone,
    }
    // Status callbacks go to the dedicated webhook route
    if (baseUrl) msgParams.statusCallback = `${baseUrl}/api/webhooks/twilio`

    const message = await client.messages.create(msgParams)

    await supabaseAdmin.from('activity_log').insert({
      lead_id:   lead.id,
      channel:   'sms',
      direction: 'outbound',
      summary:   `SMS sent to ${safe(lead.name, 'lead')} at ${safe(lead.company)}`,
      body:      smsBody,
      result:    message.status,
    })
    await supabaseAdmin.from('leads').update({
      status:        'Texted',
      touches:       (lead.touches || 0) + 1,
      last_contact:  new Date().toISOString(),
      next_followup: new Date(Date.now() + 2 * 86400000).toISOString(),
    }).eq('id', lead.id)

    return NextResponse.json({ success: true, sid: message.sid })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

function buildSMSBody(lead: any, p: { name: string; company: string }): string {
  const first   = firstName(lead.name)
  const county  = safe(lead.county,  'South Florida')
  const company = safe(lead.company, 'your organization')
  const phone   = safe(process.env.SLYBROADCAST_PHONE, '')
  return `Hi ${first}, this is ${p.name} from ${p.company}. We help ${county} facilities like ${company} with same-day medical courier routes — GPS tracked, backup driver included. Worth a 10-min call? Reply YES or call ${phone}. Reply STOP to opt out.`
}
