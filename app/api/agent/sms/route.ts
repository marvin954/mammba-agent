export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { supabaseAdmin } from '@/lib/supabase'

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
)

export async function POST(req: NextRequest) {
  try {
    const { lead_id, body_override } = await req.json()

    const { data: lead, error } = await supabaseAdmin
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single()

    if (error || !lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    if (!lead.phone || lead.phone === 'N/A') {
      return NextResponse.json({ error: 'No phone number for this lead' }, { status: 400 })
    }

    const smsBody = body_override || buildSMSBody(lead)

    // Send via Twilio
    const message = await twilioClient.messages.create({
      body: smsBody,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to:   lead.phone,
      statusCallback: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio`,
    })

    // Log activity
    await supabaseAdmin.from('activity_log').insert({
      lead_id:   lead.id,
      channel:   'sms',
      direction: 'outbound',
      summary:   `SMS sent to ${lead.name} at ${lead.company}`,
      body:      smsBody,
      result:    message.status,
    })

    // Update lead
    await supabaseAdmin.from('leads').update({
      status:       'Texted',
      touches:      (lead.touches || 0) + 1,
      last_contact: new Date().toISOString(),
      next_followup: new Date(Date.now() + 2 * 86400000).toISOString(),
    }).eq('id', lead.id)

    return NextResponse.json({ success: true, sid: message.sid })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Handle inbound SMS replies from Twilio webhook
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const from  = searchParams.get('From')
  const body  = searchParams.get('Body')

  if (!from || !body) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  // Find lead by phone number
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
      summary:   `Reply received from ${lead.name}: "${body.slice(0, 100)}"`,
      body,
      result:    'received',
    })

    // Move to Engaged if they replied
    await supabaseAdmin.from('leads').update({
      status:          'Engaged',
      last_contact:    new Date().toISOString(),
      sequence_paused: true,
    }).eq('id', lead.id)
  }

  // Twilio expects TwiML response
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    { headers: { 'Content-Type': 'text/xml' } })
}

function buildSMSBody(lead: any): string {
  const first = lead.name.split(' ')[0]
  return `Hi ${first}, this is M.A.M.M.B.A Enterprises LLC. We help ${lead.county} facilities like ${lead.company} with same-day medical courier routes — GPS tracked, backup driver included. Worth a 10-min call? Reply YES or call ${process.env.SLYBROADCAST_PHONE}. Reply STOP to opt out.`
}
