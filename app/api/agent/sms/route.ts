export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { supabaseAdmin } from '@/lib/supabase'

function getTwilio() {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN env vars')
  return twilio(sid, token)
}

// ── Safe app URL — never returns "undefined/..." ───────────────
function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
}

function firstName(name: string | null | undefined): string {
  if (!name || name.trim() === '') return 'there'
  return name.trim().split(' ')[0]
}

function safe(val: string | null | undefined, fallback = ''): string {
  return val?.trim() || fallback
}

// ── Format phone to E.164: +15551234567 ─────────────────────────
function formatPhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  if (digits.length === 11) return `+1${digits.slice(1)}`
  return `+${digits}` // assume international if not 10 or 11 digits
}

export async function POST(req: NextRequest) {
  try {
    // ── Guard: Twilio configured? ──────────────────────────
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      return NextResponse.json(
        { error: 'Twilio not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to Vercel env vars.' },
        { status: 400 }
      )
    }

    const { lead_id, body_override } = await req.json()

    const { data: lead, error } = await supabaseAdmin
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single()

    if (error || !lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const phone = safe(lead.phone)
    if (!phone || phone === 'N/A') {
      return NextResponse.json(
        { error: `No phone number on file for ${safe(lead.name, 'this lead')}. Add a phone number first.` },
        { status: 400 }
      )
    }

    const smsBody = body_override || buildSMSBody(lead)

    const client  = getTwilio()
    const baseUrl = appUrl()
    const e164Phone = formatPhoneE164(phone)

    const msgParams: any = {
      body: smsBody,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to:   e164Phone,
    }

    // Only set statusCallback if we have a valid app URL
    if (baseUrl) {
      msgParams.statusCallback = `${baseUrl}/api/webhooks/twilio`
    }

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

// Inbound SMS replies from Twilio webhook
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('From')
  const body = searchParams.get('Body')

  if (!from || !body) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  const normalised = from.replace(/\D/g, '').slice(-10)
  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('*')
    .ilike('phone', `%${normalised}%`)
    .limit(1)

  if (leads && leads.length > 0) {
    const lead = leads[0]
    await supabaseAdmin.from('activity_log').insert({
      lead_id:   lead.id,
      channel:   'sms',
      direction: 'inbound',
      summary:   `Reply received from ${safe(lead.name, 'lead')}: "${body.slice(0, 100)}"`,
      body,
      result:    'received',
    })
    await supabaseAdmin.from('leads').update({
      status:          'Engaged',
      last_contact:    new Date().toISOString(),
      sequence_paused: true,
    }).eq('id', lead.id)
  }

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
}

function buildSMSBody(lead: any): string {
  const first   = firstName(lead.name)
  const county  = safe(lead.county, 'South Florida')
  const company = safe(lead.company, 'your organization')
  const phone   = safe(process.env.SLYBROADCAST_PHONE, '[YOUR PHONE]')
  return `Hi ${first}, this is M.A.M.M.B.A Enterprises LLC. We help ${county} facilities like ${company} with same-day medical courier routes — GPS tracked, backup driver included. Worth a 10-min call? Reply YES or call ${phone}. Reply STOP to opt out.`
}
