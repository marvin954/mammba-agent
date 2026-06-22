export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { supabaseAdmin } from '@/lib/supabase'

function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID; const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) throw new Error('Missing Twilio env vars')
  return twilio(sid, token)
}
function safe(val: string | null | undefined, fallback = ''): string { return val?.trim() || fallback }
function firstName(name: string | null | undefined): string { if (!name?.trim()) return 'there'; return name.trim().split(' ')[0] }

export async function POST(req: NextRequest) {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN)
      return NextResponse.json({ error: 'Twilio not configured.' }, { status: 400 })

    const { lead_id, body_override } = await req.json()
    const { data: lead, error } = await supabaseAdmin.from('leads').select('*').eq('id', lead_id).single()
    if (error || !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    const phone = safe(lead.phone)
    if (!phone || phone === 'N/A') return NextResponse.json({ error: `No phone number on file for ${safe(lead.name,'this lead')}.` }, { status: 400 })

    const { data: rows } = await supabaseAdmin.from('settings').select('key, value')
    const s: Record<string, string> = {}
    for (const r of rows || []) s[r.key] = r.value
    // Lead's detected language takes priority over active_agent setting
    const leadLang = (lead.preferred_language || 'auto').toLowerCase()
    const isSofia  = leadLang === 'spanish' || (leadLang === 'auto' && (s.active_agent || 'marcus') === 'sofia')
    const persona  = isSofia
      ? { name: 'Sofia', company: s.company_name || 'Mamba Enterprises' }
      : { name: s.agent_name || 'Marcus', company: s.company_name || 'Mamba Enterprises' }

    const smsBody = body_override || (isSofia ? buildSpanishSMS(lead, persona) : buildEnglishSMS(lead, persona))
    const client  = getTwilio()
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
    const msgParams: any = { body: smsBody, from: process.env.TWILIO_PHONE_NUMBER!, to: phone }
    if (baseUrl) msgParams.statusCallback = `${baseUrl}/api/webhooks/twilio`

    const message = await client.messages.create(msgParams)

    await supabaseAdmin.from('activity_log').insert({
      lead_id: lead.id, channel: 'sms', direction: 'outbound',
      summary: `SMS sent to ${safe(lead.name,'lead')} at ${safe(lead.company)} via ${persona.name}`,
      body: smsBody, result: message.status,
    })
    await supabaseAdmin.from('leads').update({
      status: 'Texted', touches: (lead.touches||0)+1,
      last_contact: new Date().toISOString(),
      next_followup: new Date(Date.now()+2*86400000).toISOString(),
    }).eq('id', lead.id)

    return NextResponse.json({ success: true, sid: message.sid })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('From'); const body = searchParams.get('Body')
  if (!from || !body) return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  const normalised = from.replace(/\D/g,'').slice(-10)
  const { data: leads } = await supabaseAdmin.from('leads').select('*').ilike('phone',`%${normalised}%`).limit(1)
  if (leads?.length) {
    const lead = leads[0]
    await supabaseAdmin.from('activity_log').insert({ lead_id:lead.id, channel:'sms', direction:'inbound', summary:`Reply from ${safe(lead.name,'lead')}: "${body.slice(0,100)}"`, body, result:'received' })
    await supabaseAdmin.from('leads').update({ status:'Engaged', last_contact:new Date().toISOString(), sequence_paused:true }).eq('id',lead.id)
  }
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,{headers:{'Content-Type':'text/xml'}})
}

function buildEnglishSMS(lead: any, p: { name:string; company:string }): string {
  const first = firstName(lead.name); const county = safe(lead.county,'South Florida')
  const company = safe(lead.company,'your organization'); const phone = safe(process.env.SLYBROADCAST_PHONE,'')
  return `Hi ${first}, this is ${p.name} from ${p.company}. We help ${county} facilities like ${company} with same-day medical courier routes — GPS tracked, backup driver included. Worth a 10-min call? Reply YES or call ${phone}. Reply STOP to opt out.`
}

function buildSpanishSMS(lead: any, p: { name:string; company:string }): string {
  const first = firstName(lead.name); const county = safe(lead.county,'el sur de Florida')
  const company = safe(lead.company,'su organización'); const phone = safe(process.env.SLYBROADCAST_PHONE,'')
  return `Hola ${first}, soy ${p.name} de ${p.company}. Ayudamos a instalaciones en ${county} como ${company} con mensajería médica el mismo día — GPS y conductor de respaldo. ¿Vale una llamada de 10 min? Responda SÍ o llame al ${phone}. Responda STOP para no recibir más mensajes.`
}
