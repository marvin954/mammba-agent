export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  // Debug: log for troubleshooting (remove in production)
  console.log('Auth header received:', authHeader?.substring(0, 20) + '...' || 'none')
  console.log('Expected format:', expected?.substring(0, 20) + '...')
  console.log('CRON_SECRET env var set:', !!process.env.CRON_SECRET)

  if (authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized', debug: { received: authHeader?.substring(0, 30), expected: expected?.substring(0, 30) } }, { status: 401 })
  }

  try {
    const now = new Date().toISOString()

    // Fetch leads ready for next step: active, not paused, and due for follow-up
    const { data: leads, error } = await supabaseAdmin
      .from('leads')
      .select('*')
      .in('status', ['New', 'RVM Sent', 'Called', 'Texted', 'Emailed'])
      .eq('sequence_paused', false)
      .limit(100)

    if (error) {
      throw new Error(`Supabase query failed: ${error.message}`)
    }

    if (!leads || leads.length === 0) {
      return NextResponse.json({
        success: true,
        ranAt: now,
        processed: 0,
        message: 'No leads ready for follow-up',
      })
    }

    // Filter to only leads due for follow-up (next_followup is null or in the past)
    const dueLeads = leads.filter(lead => {
      if (!lead.next_followup) return true // null = never sent anything, ready to go
      return new Date(lead.next_followup) <= new Date()
    })

    if (dueLeads.length === 0) {
      return NextResponse.json({
        success: true,
        ranAt: now,
        processed: 0,
        message: 'No leads due for follow-up at this time',
      })
    }

    // Define sequence steps (0-4 cycle)
    const sequenceMap: Record<number, string> = {
      0: 'rvm',      // New → RVM
      1: 'call',     // RVM Sent → Call
      2: 'sms',      // Called → SMS
      3: 'email',    // Texted → Email (email 1)
      4: 'email',    // Emailed → Email (email 2) then cycle
    }

    let processed = 0
    let succeeded = 0
    let failed = 0

    // Process each lead
    for (const lead of dueLeads) {
      try {
        // Determine next action based on sequence_step (mod 5)
        const stepIndex = (lead.sequence_step || 0) % 5
        const action = sequenceMap[stepIndex]

        if (!action) {
          console.warn(`No action defined for step ${stepIndex}, lead ${lead.id}`)
          failed++
          continue
        }

        // Determine which email number (1-2) for email actions
        let emailNumber = 1
        if (action === 'email') {
          emailNumber = (lead.sequence_step || 0) === 3 ? 1 : 2
        }

        // Skip if no phone for RVM/Call/SMS
        if (['rvm', 'call', 'sms'].includes(action)) {
          if (!lead.phone || lead.phone === 'N/A' || lead.phone.trim() === '') {
            console.log(`Skipping ${action} for lead ${lead.id} (no phone)`, lead.name)
            failed++
            continue
          }
        }

        // Skip if no email for email actions
        if (action === 'email' && (!lead.email || lead.email.trim() === '')) {
          console.log(`Skipping email for lead ${lead.id} (no email)`, lead.name)
          failed++
          continue
        }

        // Call the appropriate agent endpoint
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')

        if (!baseUrl) {
          throw new Error('No app URL configured for cron callbacks')
        }

        const endpoint =
          action === 'email'
            ? `${baseUrl}/api/agent/email`
            : `${baseUrl}/api/agent/${action}`

        const payload =
          action === 'email'
            ? { lead_id: lead.id, email_number: emailNumber }
            : { lead_id: lead.id }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        const data = await res.json()

        if (!res.ok) {
          console.error(
            `${action.toUpperCase()} failed for lead ${lead.id}:`,
            data.error || data.message
          )
          failed++
          continue
        }

        // Increment sequence step
        const nextStep = (lead.sequence_step || 0) + 1
        const nextFollowup =
          nextStep >= 10
            ? new Date(Date.now() + 30 * 86400000).toISOString() // After 10 steps, wait 30 days
            : new Date(Date.now() + 2 * 86400000).toISOString() // Standard 2-day wait

        await supabaseAdmin.from('leads').update({
          sequence_step: nextStep,
          next_followup: nextFollowup,
        }).eq('id', lead.id)

        succeeded++
        processed++
        console.log(
          `✓ ${action.toUpperCase()} sent to ${lead.name || lead.company} (step ${nextStep}/10)`
        )
      } catch (err: any) {
        console.error(`Error processing lead ${lead.id}:`, err.message)
        failed++
      }
    }

    return NextResponse.json({
      success: true,
      ranAt: now,
      processed,
      succeeded,
      failed,
      message: `Processed ${processed} leads: ${succeeded} succeeded, ${failed} failed`,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message, timestamp: new Date().toISOString() },
      { status: 500 }
    )
  }
}
