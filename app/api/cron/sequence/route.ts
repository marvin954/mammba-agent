export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// ── Vercel Cron — runs daily at 8:30 AM ET ────────────────────
// Add to vercel.json:
// { "crons": [{ "path": "/api/cron/sequence", "schedule": "30 13 * * 1-5" }] }

export async function GET(req: NextRequest) {
  // Verify cron secret to prevent unauthorized triggers
  const secret = req.headers.get('authorization')
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results = { processed: 0, skipped: 0, errors: 0 }

  try {
    // Check if agent is active
    const { data: setting } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'agent_active')
      .single()

    if (setting?.value !== 'true') {
      return NextResponse.json({ message: 'Agent is paused', results })
    }

    const { data: delayRow } = await supabaseAdmin
      .from('settings').select('value').eq('key', 'seq_delay_days').single()
    const delayDays = parseInt(delayRow?.value || '2')

    // Find leads due for follow-up
    const now = new Date().toISOString()
    const { data: leads, error } = await supabaseAdmin
      .from('leads')
      .select('*')
      .eq('sequence_paused', false)
      .not('status', 'in', '("Closed Won","Closed Lost","On Hold")')
      .or(`next_followup.is.null,next_followup.lte.${now}`)
      .order('next_followup', { ascending: true })
      .limit(50)

    if (error) throw error

    for (const lead of leads || []) {
      try {
        const step = (lead.sequence_step || 0) + 1
        await runSequenceStep(lead, step, delayDays)
        results.processed++
      } catch (e) {
        console.error(`Error processing lead ${lead.id}:`, e)
        results.errors++
      }
    }

    return NextResponse.json({ success: true, results })

  } catch (err: any) {
    return NextResponse.json({ error: err.message, results }, { status: 500 })
  }
}

// ── Sequence logic ─────────────────────────────────────────────
// Step 1:  RVM
// Step 2:  Email 1 (cold intro)
// Step 3:  AI Call
// Step 4:  SMS
// Step 5:  Email 2 (value follow-up)
// Step 6:  AI Call (second attempt)
// Step 7:  Email 3 (pain point)
// Step 8:  SMS (final)
// Step 9:  Email 4 (social proof)
// Step 10: Email 5 (breakup)
// Step 11: Move to On Hold

async function runSequenceStep(lead: any, step: number, delayDays: number) {
  const base = `${process.env.NEXT_PUBLIC_APP_URL}/api/agent`

  const stepMap: Record<number, () => Promise<Response>> = {
    1:  () => fetch(`${base}/rvm`,   post({ lead_id: lead.id })),
    2:  () => fetch(`${base}/email`, post({ lead_id: lead.id, email_number: 1 })),
    3:  () => fetch(`${base}/call`,  post({ lead_id: lead.id })),
    4:  () => fetch(`${base}/sms`,   post({ lead_id: lead.id })),
    5:  () => fetch(`${base}/email`, post({ lead_id: lead.id, email_number: 2 })),
    6:  () => fetch(`${base}/call`,  post({ lead_id: lead.id })),
    7:  () => fetch(`${base}/email`, post({ lead_id: lead.id, email_number: 3 })),
    8:  () => fetch(`${base}/sms`,   post({ lead_id: lead.id })),
    9:  () => fetch(`${base}/email`, post({ lead_id: lead.id, email_number: 4 })),
    10: () => fetch(`${base}/email`, post({ lead_id: lead.id, email_number: 5 })),
  }

  if (step > 10) {
    // Sequence complete — move to On Hold
    await supabaseAdmin.from('leads').update({
      status:          'On Hold',
      sequence_paused: true,
      next_followup:   new Date(Date.now() + 30 * 86400000).toISOString(),
    }).eq('id', lead.id)
    return
  }

  const action = stepMap[step]
  if (action) {
    await action()
    // Update sequence step and next follow-up
    await supabaseAdmin.from('leads').update({
      sequence_step: step,
      next_followup: new Date(Date.now() + delayDays * 86400000).toISOString(),
    }).eq('id', lead.id)
  }
}

function post(body: object): RequestInit {
  return {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'authorization': `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify(body),
  }
}
