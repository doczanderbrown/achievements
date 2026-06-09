import './ReportCard.css'
import { useId } from 'react'
import type { MetricKey, PillarTotals, UserRecord } from '../utils/metrics'

// ─── palette (data-driven colors only — structural colors live in CSS) ────────

const P = {
  assembly:  '#e3870a',
  decon:     '#2b58ff',
  sterilize: '#0f9a6a',
  ink:       '#1a1714',
  muted1:    '#7c7468',
} as const

// ─── helpers ──────────────────────────────────────────────────────────────────

const ordinal = (n: number) => {
  const r = Math.round(n)
  const m = r % 100
  if (m >= 11 && m <= 13) return 'th'
  switch (r % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US')

// matches formatMetricValue: values already >1 are percentages, ≤1 are fractions
const fmtPct = (v: number, digits = 2) => {
  const display = v <= 1 ? v * 100 : v
  return `${display.toFixed(digits)}%`
}

const fmtSigned = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}`
const trendCls = (v: number) => v > 0.5 ? 'rc-trend-up' : v < -0.5 ? 'rc-trend-down' : 'rc-trend-flat'
const trendArrow = (v: number) => v > 0.5 ? '▲' : v < -0.5 ? '▼' : '•'

const STOPWORDS = new Set(['the','a','an','of','and','or','you','in','it','on','at','for','to','is','are'])

const monogramFor = (label: string) => {
  if (!label) return '??'
  const cleaned = label.replace(/'s\b/gi, '').replace(/[^A-Za-z0-9\s-]/g, ' ')
  const words = cleaned.split(/[\s-]+/).filter((w) => w && !STOPWORDS.has(w.toLowerCase()))
  if (!words.length) return label.slice(0, 2).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

// CSS custom property helper — TypeScript doesn't know about CSS vars in CSSProperties
const cv = (val: string) => ({ '--c': val }) as React.CSSProperties

// ─── SVG rings ────────────────────────────────────────────────────────────────

const Ring = ({
  cx, cy, r, stroke, value, color,
}: {
  cx: number; cy: number; r: number; stroke: number; value: number; color: string
}) => {
  const C = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value)) / 100
  const filled = C * pct
  const empty = C - filled
  return (
    <g transform={`rotate(-90 ${cx} ${cy})`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" opacity="0.14" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${filled} ${empty + 0.0001}`} />
    </g>
  )
}

const RingTick = ({
  cx, cy, r, value, color,
}: {
  cx: number; cy: number; r: number; value: number; color: string
}) => {
  const ang = (value / 100) * Math.PI * 2 - Math.PI / 2
  return (
    <circle
      cx={cx + Math.cos(ang) * r}
      cy={cy + Math.sin(ang) * r}
      r={3.4} fill="#fff" stroke={color} strokeWidth="2"
    />
  )
}

const PillarRings = ({
  assembly, decon, sterilize, filterId,
}: {
  assembly: number; decon: number; sterilize: number; filterId: string
}) => (
  <svg viewBox="0 0 400 400" aria-label="Pillar percentile rings">
    <defs>
      <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
        <feOffset dx="0" dy="1" result="off" />
        <feComponentTransfer><feFuncA type="linear" slope="0.18" /></feComponentTransfer>
        <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
    <g filter={`url(#${filterId})`}>
      <Ring cx={200} cy={200} r={168} stroke={20} value={assembly}  color={P.assembly} />
      <Ring cx={200} cy={200} r={132} stroke={20} value={decon}     color={P.decon} />
      <Ring cx={200} cy={200} r={96}  stroke={20} value={sterilize} color={P.sterilize} />
    </g>
    <RingTick cx={200} cy={200} r={168} value={assembly}  color={P.assembly} />
    <RingTick cx={200} cy={200} r={132} value={decon}     color={P.decon} />
    <RingTick cx={200} cy={200} r={96}  value={sterilize} color={P.sterilize} />
  </svg>
)

// ─── component ────────────────────────────────────────────────────────────────

type ReportCardProps = {
  user: UserRecord
  medians: Record<MetricKey, number>
  pillarMedians: PillarTotals
  anonymize: boolean
  hoursWorkedAvailable: boolean
  showArchetypeDescription?: boolean
  shortPillarLabels?: boolean
  onClick?: () => void
  interactive?: boolean
  className?: string
  period?: string
}

const ReportCard = ({
  user,
  medians,
  hoursWorkedAvailable,
  shortPillarLabels = false,
  onClick,
  interactive = false,
  className = '',
  period,
  anonymize,
}: ReportCardProps) => {
  const uid = useId().replace(/:/g, '')
  const displayName = anonymize ? user.techLabel : user.name

  const totalPillar = user.pillarTotals.decon + user.pillarTotals.assembly + user.pillarTotals.sterilize

  // UOS consistent with workedHoursPerUnit denominator (sinkInst * 0.5 + assembledInst)
  const uos = Math.round(user.metrics.sinkInst * 0.5 + user.metrics.assembledInst)

  const workMixRaw = {
    assembly:  totalPillar ? (user.pillarTotals.assembly  / totalPillar) * 100 : 0,
    decon:     totalPillar ? (user.pillarTotals.decon     / totalPillar) * 100 : 0,
    sterilize: totalPillar ? (user.pillarTotals.sterilize / totalPillar) * 100 : 0,
  }
  const workMix = {
    assembly:  Math.round(workMixRaw.assembly),
    decon:     Math.round(workMixRaw.decon),
    sterilize: 100 - Math.round(workMixRaw.assembly) - Math.round(workMixRaw.decon),
  }

  const overallPct  = Math.round(user.scores.overallPercentile)
  const prodPct     = Math.round(user.scores.productivityPercentile)
  const qualPct     = Math.round(user.scores.qualityPercentile)
  const versPct     = Math.round(user.scores.versatilityPercentile)
  const assemblyPct = Math.round(user.pillarPercentiles.assembly)
  const deconPct    = Math.round(user.pillarPercentiles.decon)
  const sterilPct   = Math.round(user.pillarPercentiles.sterilize)

  const deconLabel = shortPillarLabels ? 'Decon' : 'Decontamination'

  const pillarRows = [
    {
      key: 'assembly',
      label: 'Assembly',
      sub: 'Trays · packs · instruments',
      color: P.assembly,
      pct: assemblyPct,
      total: user.pillarTotals.assembly,
      unit: 'instruments',
      trend: assemblyPct - 50,
    },
    {
      key: 'decon',
      label: deconLabel,
      sub: 'Scans · sink instruments · sink trays',
      color: P.decon,
      pct: deconPct,
      total: user.pillarTotals.decon,
      unit: 'scans',
      trend: deconPct - 50,
    },
    {
      key: 'sterilize',
      label: 'Sterilization',
      sub: 'Loads · items · deliver scans',
      color: P.sterilize,
      pct: sterilPct,
      total: user.pillarTotals.sterilize,
      unit: 'loads',
      trend: sterilPct - 50,
    },
  ]

  const weakestPillar = pillarRows.reduce((a, b) => (a.pct < b.pct ? a : b))

  const dominantMix =
    workMix.assembly >= workMix.decon && workMix.assembly >= workMix.sterilize
      ? { name: 'Assembly', pct: workMix.assembly }
      : workMix.decon >= workMix.sterilize
        ? { name: 'Decon', pct: workMix.decon }
        : { name: 'Sterilize', pct: workMix.sterilize }

  const archGlyph = monogramFor(user.archetype.label)

  return (
    <article
      className={`rc-card${interactive ? ' rc-interactive' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!interactive) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() }
      }}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <div className="rc-card-inner">

        {/* ── top strap ─────────────────────────────────────────────── */}
        <div className="rc-strap">
          <span className="rc-strap-wordmark">
            <span className="rc-strap-seal" aria-hidden="true" />
            SPD Report Card{period ? ` · ${period}` : ''}
          </span>
          <span className="rc-strap-meta">
            <span>{user.facility || 'SPD'}</span>
            <span className="rc-strap-dot" aria-hidden="true" />
            <b>{user.techLabel}</b>
          </span>
        </div>

        {/* ── hero ──────────────────────────────────────────────────── */}
        <section className="rc-hero">

          {/* identity + stats */}
          <div>
            <div className="rc-eyebrow">Tech file · personal record</div>
            <h1 className="rc-name">{displayName}</h1>
            <div className="rc-role">
              {user.role}{user.facility ? ` · ${user.facility} SPD` : ''}
            </div>

            {/* archetype chip */}
            <div className="rc-archetype" aria-label={`Archetype: ${user.archetype.label}`}>
              <div className="rc-arch-glyph">
                {archGlyph}
                <span className="rc-arch-glyph-sub">Archetype</span>
              </div>
              <div className="rc-arch-body">
                <div className="rc-arch-label">{user.archetype.label}</div>
                <div className="rc-arch-tagline">{user.archetype.description}</div>
              </div>
            </div>

            {/* stats stripe */}
            <div className="rc-stripe">
              {[
                {
                  label: 'Hours worked',
                  value: hoursWorkedAvailable ? user.hoursWorked.toFixed(1) : '—',
                  unit: hoursWorkedAvailable ? 'h' : '',
                },
                { label: 'Total activity', value: fmtInt(totalPillar), unit: '' },
                { label: 'Quality score',  value: String(qualPct),     unit: 'th pct' },
                { label: 'Defect rate',    value: fmtPct(user.metrics.defectRate, 2), unit: '' },
              ].map((stat) => (
                <div key={stat.label} className="rc-stat">
                  {stat.label}
                  <span className="rc-stat-v">
                    {stat.value}
                    {stat.unit ? <small>{stat.unit}</small> : null}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* rings panel */}
          <div className="rc-rings-frame">
            <div className="rc-rings-head">
              <span>Overall · Pillar percentiles</span>
              <span className="rc-score-tag">
                <small>Score</small>
                <b>{Math.round(user.scores.overall)}</b>
                <small>/ 200</small>
              </span>
            </div>

            <div className="rc-rings-stage">
              <PillarRings
                assembly={assemblyPct}
                decon={deconPct}
                sterilize={sterilPct}
                filterId={`ringShadow-${uid}`}
              />
              <div className="rc-rings-center">
                <div>
                  <div className="rc-pct">
                    {overallPct}
                    <span className="rc-pct-suf">{ordinal(overallPct)}</span>
                  </div>
                  <div className="rc-pct-label">Overall percentile</div>
                </div>
              </div>
            </div>

            <div className="rc-rings-legend">
              {([
                { label: 'Assembly', color: P.assembly, pct: assemblyPct },
                { label: 'Decon',    color: P.decon,    pct: deconPct },
                { label: 'Sterilize',color: P.sterilize,pct: sterilPct },
              ] as const).map((leg) => (
                <div key={leg.label} className="rc-lg">
                  <span className="rc-lg-dot" style={cv(leg.color)}>{leg.label}</span>
                  <span className="rc-lg-val">
                    {leg.pct}
                    <span className="rc-lg-val-suf">{ordinal(leg.pct)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── rule ──────────────────────────────────────────────────── */}
        <div className="rc-rule" />

        {/* ── score grid ────────────────────────────────────────────── */}
        <section className="rc-scores">
          {[
            {
              label: 'Productivity',
              pct: prodPct,
              trend: prodPct - 50,
              micro: hoursWorkedAvailable
                ? `Per-hour output across all pillars. ${fmtInt(totalPillar)} total activity units across ${user.hoursWorked.toFixed(1)}h worked.`
                : `Ranked on pillar totals — hours not available. ${fmtInt(totalPillar)} total activity this period.`,
            },
            {
              label: 'Quality',
              pct: qualPct,
              trend: qualPct - 50,
              micro: `Defect rate ${fmtPct(user.metrics.defectRate)}, missing inst ${fmtPct(user.metrics.assemblyMissingInst)}.${user.qualityContext.eventCount > 0 ? ` ${user.qualityContext.eventCount} attributable event${user.qualityContext.eventCount !== 1 ? 's' : ''}.` : ''}`,
            },
            {
              label: 'Versatility',
              pct: versPct,
              trend: versPct - 50,
              micro: `Average pillar percentile. ${weakestPillar.label} at ${weakestPillar.pct}${ordinal(weakestPillar.pct)} is your swing dimension — closing that gap unlocks the next archetype.`,
            },
          ].map((s) => (
            <div key={s.label} className="rc-score-cell">
              <div className="rc-score-lab">{s.label}</div>
              <div className="rc-score-v">
                {s.pct}
                <span className="rc-score-v-suf">{ordinal(s.pct)}</span>
              </div>
              <div className="rc-score-sub">
                <span className={trendCls(s.trend)}>{trendArrow(s.trend)} {fmtSigned(s.trend)}</span>
                <span>vs median</span>
              </div>
              <p className="rc-score-micro">{s.micro}</p>
            </div>
          ))}
        </section>

        {/* ── pillar breakdown ──────────────────────────────────────── */}
        <section className="rc-pillars">
          <div className="rc-section-head">
            <h3>Pillar breakdown</h3>
            <div className="rc-section-legend">Bar shows percentile · marker shows cohort median</div>
          </div>
          {pillarRows.map((row) => (
            <div key={row.key} className="rc-pillar-row">
              <div className="rc-p-name">
                <span className="rc-p-swatch" style={cv(row.color)} />
                <div>
                  <div className="rc-p-label">{row.label}</div>
                  <div className="rc-p-sub">{row.sub}</div>
                </div>
              </div>
              <div className="rc-p-bar">
                <div className="rc-p-bar-fill" style={{ ...cv(row.color), width: `${row.pct}%` }} />
                <div className="rc-p-bar-median" />
              </div>
              <div className="rc-p-pct">
                {row.pct}
                <span className="rc-p-pct-suf">{ordinal(row.pct)}</span>
              </div>
              <div className="rc-p-total">
                {fmtInt(row.total)}
                <span className="rc-p-total-unit">{row.unit}</span>
              </div>
              <div className="rc-p-trend">
                <span className="rc-p-trend-label">vs median</span>
                <span className={trendCls(row.trend)}>{trendArrow(row.trend)} {fmtSigned(row.trend)}</span>
              </div>
            </div>
          ))}
        </section>

        {/* ── work mix + context ────────────────────────────────────── */}
        <section className="rc-grid-split">
          <div className="rc-panel">
            <h4>
              Work mix
              <span className="rc-panel-mini">share of pillar activity</span>
            </h4>
            <div className="rc-mix-bar">
              {([
                { pct: workMix.assembly,  color: P.assembly },
                { pct: workMix.decon,     color: P.decon },
                { pct: workMix.sterilize, color: P.sterilize },
              ] as const).map((seg, i) => (
                <div key={i} className="rc-mix-seg" style={{ ...cv(seg.color), width: `${seg.pct}%` }}>
                  {seg.pct > 10 ? `${seg.pct}%` : ''}
                </div>
              ))}
            </div>
            <div className="rc-mix-key">
              {([
                ['Assembly', P.assembly, workMix.assembly],
                ['Decon',    P.decon,    workMix.decon],
                ['Sterilize',P.sterilize,workMix.sterilize],
              ] as const).map(([name, color, pct]) => (
                <span key={name} style={cv(color)}>{name} {pct}%</span>
              ))}
            </div>
            <p className="rc-mix-foot">
              You spent{' '}
              <b>{dominantMix.pct}%</b> of pillar work in{' '}
              <b>{dominantMix.name}</b> this period.{' '}
              {weakestPillar.pct < 60
                ? `Picking up more ${weakestPillar.label} work would move your Versatility score fastest.`
                : 'A well-rounded mix across all three pillars.'}
            </p>
          </div>

          <div className="rc-panel">
            <h4>
              Context
              <span className="rc-panel-mini">timekeeping &amp; quality</span>
            </h4>
            <div className="rc-ctx-grid">
              {[
                {
                  k: hoursWorkedAvailable ? 'Worked / unit' : 'Hours worked',
                  v: hoursWorkedAvailable ? user.metrics.workedHoursPerUnit.toFixed(2) : '—',
                  unit: hoursWorkedAvailable ? 'hr' : '',
                  d: hoursWorkedAvailable
                    ? (user.metrics.workedHoursPerUnit < medians.workedHoursPerUnit
                        ? 'Efficient — below cohort median.'
                        : 'Above cohort median hrs/unit.')
                    : 'Hours not available.',
                },
                {
                  k: 'Defect rate',
                  v: fmtPct(user.metrics.defectRate, 2),
                  unit: '',
                  d: user.qualityContext.eventCount > 0
                    ? `${user.qualityContext.eventCount} attributable event${user.qualityContext.eventCount !== 1 ? 's' : ''} this period.`
                    : 'Zero attributable events.',
                },
                {
                  k: 'PTO / Unpaid',
                  v: user.timekeepingContext.ptoHours.toFixed(1),
                  unit: 'h',
                  d: [
                    user.timekeepingContext.unpaidHours > 0 ? `${user.timekeepingContext.unpaidHours.toFixed(1)}h unpaid.` : '',
                    user.timekeepingContext.overtimeHours > 0 ? `${user.timekeepingContext.overtimeHours.toFixed(1)}h overtime.` : 'No overtime.',
                  ].filter(Boolean).join(' '),
                },
                {
                  k: 'Coaching',
                  v: String(user.qualityContext.coachingCount),
                  unit: 'sess',
                  d: user.qualityContext.coachingCount === 0
                    ? 'No coaching sessions.'
                    : `${user.qualityContext.coachingCount} session${user.qualityContext.coachingCount !== 1 ? 's' : ''} this period.`,
                },
              ].map((tile) => (
                <div key={tile.k} className="rc-ctx-tile">
                  <div className="rc-ctx-k">{tile.k}</div>
                  <div className="rc-ctx-v">
                    {tile.v}
                    {tile.unit ? <small>{tile.unit}</small> : null}
                  </div>
                  <div className="rc-ctx-d">{tile.d}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── badges ────────────────────────────────────────────────── */}
        {user.badges.length > 0 ? (
          <section className="rc-badges-bar">
            <div className="rc-section-head">
              <h3>Badges earned</h3>
              <div className="rc-section-legend">{user.badges.length} this period</div>
            </div>
            <div className="rc-badges-row">
              {user.badges.map((badge) => (
                <div
                  key={`${badge.category}-${badge.label}`}
                  className="rc-badge"
                  data-tier={badge.tier}
                >
                  <div className="rc-badge-mark">{monogramFor(badge.label)}</div>
                  <div className="rc-badge-name">{badge.label}</div>
                  <div className="rc-badge-meta">{badge.tier} · {badge.category}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ── coach note ────────────────────────────────────────────── */}
        {user.coachingSummary ? (
          <section className="rc-coach">
            <div className="rc-coach-label">Coach note · for {displayName.split(' ')[0]}</div>
            <p className="rc-coach-quote">{user.coachingSummary}</p>
            <div className="rc-coach-signoff">
              <span>— SPD Educator</span>
              {user.opportunity ? (
                <span><b>Next goal:</b> {user.opportunity}</span>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* ── foot strap ────────────────────────────────────────────── */}
        <div className="rc-foot">
          {[
            {
              k: 'Units of service',
              v: fmtInt(uos),
              unit: 'uos',
            },
            {
              k: 'Worked hrs / unit',
              v: hoursWorkedAvailable ? user.metrics.workedHoursPerUnit.toFixed(2) : '—',
              unit: hoursWorkedAvailable ? 'hr' : '',
            },
            {
              k: 'Missing inst rate',
              v: fmtPct(user.metrics.assemblyMissingInst, 2),
              unit: '',
            },
            {
              k: 'Defect rate',
              v: fmtPct(user.metrics.defectRate, 2),
              unit: '',
            },
          ].map((ft) => (
            <div key={ft.k}>
              <div className="rc-ft-k">{ft.k}</div>
              <div className="rc-ft-v">
                {ft.v}
                {ft.unit ? <small>{ft.unit}</small> : null}
              </div>
            </div>
          ))}
        </div>

      </div>
    </article>
  )
}

export default ReportCard
