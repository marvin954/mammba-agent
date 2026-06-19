export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Bland.ai calls this URL after every call completes
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json()
    const {
      call_id,
      metadata,
      status,
      call_length,
      recording_url,
      concatenated_transcript,
      analysis,
    } = payload

    const lead_id = metadata?.lead_id
    if (!lead_id) return NextResponse.json({ ok: true })

    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single()

    if (!lead) return NextResponse.json({ ok: true })

    // Determine outcome
    const agreed     = analysis?.agreed_to_meeting === true
    const proposal   = analysis?.requested_proposal === true
    const summary    = analysis?.outcome_summary || 'Call completed'
    const objection  = analysis?.objection_raised || ''

    let newStatus = lead.status
    let seqPaused = false

    if (agreed || proposal) {
      newStatus  = 'Engaged'
      seqPaused  = true
    } else if (status === 'completed' && (call_length || 0) > 30) {
      newStatus = 'Called'
    }

    // Log the call outcome
    await supabaseAdmin.from('activity_log').insert({
      lead_id,
      channel:    'call',
      direction:  'outbound',
      summary:    `AI call completed — ${summary}`,
      body:       concatenated_transcript?.slice(0, 1000),
      result:     agreed ? 'meeting_booked' : proposal ? 'proposal_requested' : status,
      duration_s: Math.round((call_length || 0) * 60),
    })

    // Update lead
    const update: any = {
      status:       newStatus,
      last_contact: new Date().toISOString(),
      sequence_paused: seqPaused,
    }
    if (objection) update.notes = `Objection: ${objection}`

    await supabaseAdmin.from('leads').update(update).eq('id', lead_id)

    return NextResponse.json({ ok: true })

  } catch (err: any) {
    console.error('Bland webhook error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
