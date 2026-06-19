export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { leads } = body as { leads: any[] }

    if (!Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json({ error: 'No leads provided' }, { status: 400 })
    }

    const VALID_COUNTIES   = ['Broward', 'Miami-Dade', 'Palm Beach']
    const VALID_PRIORITIES = ['High', 'Medium', 'Low']

    const rows = leads.map((l) => ({
      name:            (l.name          || l.Name          || '').toString().trim(),
      title:           (l.title         || l.Title         || l.job_title || '').toString().trim(),
      company:         (l.company       || l.Company       || l.business  || '').toString().trim(),
      phone:           (l.phone         || l.Phone         || l.phone_number || '').toString().trim(),
      email:           (l.email         || l.Email         || '').toString().trim(),
      county:          VALID_COUNTIES.includes(l.county || l.County)
                         ? (l.county || l.County)
                         : 'Broward',
      tier:            (l.tier          || l.Tier          || 'Tier 1').toString().trim(),
      industry:        (l.industry      || l.Industry      || '').toString().trim(),
      monthly_value:   (l.monthly_value || l.value         || l['Monthly Value'] || '').toString().trim(),
      priority:        VALID_PRIORITIES.includes(l.priority || l.Priority)
                         ? (l.priority || l.Priority)
                         : 'Medium',
      notes:           (l.notes         || l.Notes         || '').toString().trim(),
      status:          'New',
      touches:         0,
      sequence_step:   0,
      sequence_paused: false,
    }))

    const valid   = rows.filter(r => r.name && r.company)
    const skipped = rows.length - valid.length

    if (valid.length === 0) {
      return NextResponse.json({
        error: 'No valid rows found. Every row needs at least "name" and "company".'
      }, { status: 400 })
    }

    // Insert in batches of 50
    let inserted = 0
    const BATCH  = 50
    for (let i = 0; i < valid.length; i += BATCH) {
      const { error } = await supabaseAdmin.from('leads').insert(valid.slice(i, i + BATCH))
      if (error) throw error
      inserted += valid.slice(i, i + BATCH).length
    }

    return NextResponse.json({ success: true, inserted, skipped })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
