export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Twilio posts delivery status updates here (statusCallback).
// Statuses: queued → sent → delivered, or failed / undelivered.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const messageStatus = String(form.get('MessageStatus') || form.get('SmsStatus') || '')
    const to            = String(form.get('To') || '')
    const errorCode     = String(form.get('ErrorCode') || '')
    const errorMessage  = String(form.get('ErrorMessage') || '')

    if (!to) return new Response('', { status: 200 })

    // Find the lead by phone (last 10 digits)
    const normalised = to.replace(/\D/g, '').slice(-10)
    const { data: leads } = await supabaseAdmin
      .from('leads').select('*').ilike('phone', `%${normalised}%`).limit(1)

    if (leads && leads.length > 0) {
      const lead = leads[0]
      const detail = errorCode
        ? `${messageStatus} (${errorCode}: ${errorMessage})`
        : messageStatus

      // Log the delivery status so it shows in the Activity Log
      await supabaseAdmin.from('activity_log').insert({
        lead_id:   lead.id,
        channel:   'sms',
        direction: 'outbound',
        summary:   `SMS delivery status: ${detail}`,
        body:      '',
        result:    messageStatus,
      })
    }

    return new Response('', { status: 200 })
  } catch (err: any) {
    console.error('Twilio webhook error:', err)
    return new Response('', { status: 200 })
  }
}

// Twilio may send a GET to verify the endpoint
export async function GET() {
  return NextResponse.json({ ok: true })
}
