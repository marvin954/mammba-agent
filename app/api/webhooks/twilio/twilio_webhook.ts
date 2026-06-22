export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

function safe(val: string | null | undefined, fallback = ''): string {
  return val?.trim() || fallback
}

// Twilio sends ALL webhooks (inbound SMS + status callbacks) as POST
// with application/x-www-form-urlencoded body.
export async function POST(req: NextRequest) {
  try {
    const text   = await req.text()
    const params = new URLSearchParams(text)

    const from          = params.get('From')          || ''
    const body          = params.get('Body')          || ''
    const messageSid    = params.get('MessageSid')    || ''
    const messageStatus = params.get('MessageStatus') || ''

    // ── Inbound SMS reply (Body is present) ───────────────
    if (body) {
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

      // Twilio requires a TwiML response for inbound SMS webhooks
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
        { headers: { 'Content-Type': 'text/xml' } }
      )
    }

    // ── Delivery status callback (no Body, has MessageStatus) ─
    if (messageStatus && messageSid) {
      const terminalStatuses = ['delivered', 'failed', 'undelivered', 'canceled']
      if (terminalStatuses.includes(messageStatus)) {
        // Find the activity log entry by matching the Twilio SID stored in result
        // and update it with the final delivery status
        await supabaseAdmin
          .from('activity_log')
          .update({ result: messageStatus })
          .eq('channel', 'sms')
          .like('result', '%' + messageSid.slice(-8) + '%')
          // Fallback: just log — the upsert above is best-effort
      }
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('Twilio webhook error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
