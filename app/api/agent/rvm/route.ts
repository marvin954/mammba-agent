export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { lead_id } = await req.json()

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

    // Build RVM message text (Slybroadcast converts text-to-speech)
    const rvmMessage = buildRVMScript(lead)

    // Slybroadcast API call
    const formData = new URLSearchParams({
      c_uid:    process.env.SLYBROADCAST_EMAIL!,
      c_password: process.env.SLYBROADCAST_PASSWORD!,
      c_phone:  lead.phone.replace(/\D/g, ''),
      c_record_audio: '0',
      c_audio_file:   'tts',
      c_tts_message:  rvmMessage,
      c_date:   'now',
      c_from_number: process.env.SLYBROADCAST_PHONE!.replace(/\D/g, ''),
    })

    const slyRes = await fetch('https://www.mobile-sphere.com/gateway/vmb.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    })

    const slyText = await slyRes.text()

    // Log activity
    await supabaseAdmin.from('activity_log').insert({
      lead_id:   lead.id,
      channel:   'rvm',
      direction: 'outbound',
      summary:   `Ringless voicemail sent to ${lead.name} at ${lead.company}`,
      body:      rvmMessage,
      result:    slyText.includes('ok') ? 'delivered' : 'failed',
    })

    // Update lead
    await supabaseAdmin.from('leads').update({
      status:       'RVM Sent',
      touches:      (lead.touches || 0) + 1,
      last_contact: new Date().toISOString(),
    }).eq('id', lead.id)

    return NextResponse.json({ success: true, response: slyText })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

function buildRVMScript(lead: any): string {
  return `Hi, this message is for ${lead.name}. This is calling from M.A.M.M.B.A Enterprises LLC. 
We specialize in medical courier and same-day delivery routes for businesses across ${lead.county} County — 
specifically for facilities like ${lead.company}. 
I'd love to show you how we can eliminate your delivery headaches with a dedicated, reliable route — 
GPS tracked, backup driver included, and no setup fees. 
Please call us back at ${process.env.SLYBROADCAST_PHONE} — 
I'll keep it under 10 minutes and have a proposal ready. 
Again, this is M.A.M.M.B.A Enterprises LLC. Looking forward to speaking with you, ${lead.name.split(' ')[0]}. Have a great day.`
}
