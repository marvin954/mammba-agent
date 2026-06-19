export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '@/lib/supabase'

// ── Lazy Resend client — never instantiated at build time ─────
function getResend() {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('Missing RESEND_API_KEY env var')
  return new Resend(key)
}

// ── Generate + Send email ──────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // ── Guard: Resend configured? ──────────────────────────
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { error: 'Resend not configured. Add RESEND_API_KEY to Vercel env vars.' },
        { status: 400 }
      )
    }

    const { lead_id, email_number = 1, subject_override, body_override } = await req.json()

    const { data: lead, error } = await supabaseAdmin
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single()

    if (error || !lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    if (!lead.email) {
      return NextResponse.json({ error: 'No email for this lead' }, { status: 400 })
    }

    // Generate email with Claude if no override
    let subject = subject_override
    let htmlBody = body_override

    if (!subject || !htmlBody) {
      const generated = await generateEmailWithClaude(lead, email_number)
      subject  = subject  || generated.subject
      htmlBody = htmlBody || generated.html
    }

    // Send via Resend (lazy — only instantiated here at runtime)
    const resend = getResend()
    const result = await resend.emails.send({
      from:    `${process.env.FROM_NAME} <${process.env.FROM_EMAIL}>`,
      to:      lead.email,
      subject,
      html:    htmlBody,
      tags: [
        { name: 'lead_id',      value: lead.id },
        { name: 'email_number', value: String(email_number) },
      ],
    })

    // Log activity
    await supabaseAdmin.from('activity_log').insert({
      lead_id:   lead.id,
      channel:   'email',
      direction: 'outbound',
      summary:   `Email ${email_number} sent to ${lead.name} — "${subject}"`,
      body:      subject,
      result:    'sent',
    })

    // Update lead
    const nextFollowup = new Date(Date.now() + 3 * 86400000).toISOString()
    await supabaseAdmin.from('leads').update({
      status:        'Emailed',
      touches:       (lead.touches || 0) + 1,
      last_contact:  new Date().toISOString(),
      next_followup: nextFollowup,
      sequence_step: email_number,
    }).eq('id', lead.id)

    return NextResponse.json({ success: true, email_id: result.data?.id })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Claude email generator ─────────────────────────────────────
async function generateEmailWithClaude(lead: any, emailNumber: number) {
  const emailTypes = [
    'a cold introduction email — introduce M.A.M.M.B.A, ask one discovery question, end with a CTA for a 10-minute call',
    'a value follow-up email — focus on the backup driver guarantee and cost savings vs in-house delivery',
    'a pain point email — ask directly if they have any weak links in their current delivery setup',
    'a social proof email — describe the reliability benefits other South Florida facilities experience',
    'a final breakup email — respectful close, leave door open, ask for a referral',
  ]
  const emailType = emailTypes[Math.min(emailNumber - 1, emailTypes.length - 1)]

  const name    = (lead.name    ?? 'the contact').trim() || 'the contact'
  const title   = (lead.title   ?? 'decision maker').trim() || 'decision maker'
  const company = (lead.company ?? 'the organization').trim() || 'the organization'
  const county  = (lead.county  ?? 'South Florida').trim()   || 'South Florida'
  const prompt = `Write ${emailType} for ${name}, ${title} at ${company} in ${county} County, Florida.

Company context: M.A.M.M.B.A Enterprises LLC is South Florida's premier medical courier specializing in same-day delivery, scheduled routes, STAT dispatch, and HIPAA-compliant medical specimen transport across Broward, Miami-Dade, and Palm Beach counties.

Their estimated monthly contract value: ${lead.monthly_value ?? 'TBD'}/mo.

Requirements:
- Subject line: compelling, under 8 words, no clickbait
- Body: professional, direct, under 150 words
- Single CTA only
- Sign off as: [Your Name], M.A.M.M.B.A Enterprises LLC

Respond ONLY with valid JSON in this exact format, no markdown:
{"subject": "...", "body_plain": "...", "body_html": "..."}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 800,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })

  const data = await res.json()
  const text = data.content?.[0]?.text || '{}'

  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
    return {
      subject: parsed.subject || `Courier services for ${lead.company ?? 'your organization'}`,
      html:    parsed.body_html || `<p>${parsed.body_plain || ''}</p>`,
    }
  } catch {
    return {
      subject: `Reliable courier routes — ${lead.company ?? 'your organization'}`,
      html:    `<p>Hi ${(lead.name ?? 'there').trim().split(' ')[0]},<br><br>This is M.A.M.M.B.A Enterprises LLC. We help South Florida facilities with same-day courier routes. Would you be open to a 10-minute call?<br><br>Best,<br>[Your Name]<br>M.A.M.M.B.A Enterprises LLC</p>`,
    }
  }
}
