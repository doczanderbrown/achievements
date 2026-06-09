import { useId } from 'react'
import type { MetricKey, PillarTotals, UserRecord } from '../utils/metrics'

// ─── palette ──────────────────────────────────────────────────────────────────

const P = {
  assembly:     '#e3870a',
  decon:        '#2b58ff',
  sterilize:    '#0f9a6a',
  ink:          '#1a1714',
  ink2:         '#2e2823',
  card:         '#fbf8f1',
  cardEdge:     '#ece4d2',
  muted1:       '#7c7468',
  rule:         '#e3dac6',
  ruleStrong:   '#cabfa6',
  paper2:       '#ece4d2',
  good:         '#0f7a4e',
  bad:          '#b53326',
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
const fmtPct = (v: number, digits = 2) => `${(v * 100).toFixed(digits)}%`
const fmtSigned = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}`
const trendColor = (v: number) => (v > 0.5 ? P.good : v < -0.5 ? P.bad : P.muted1)
const trendArrow = (v: number) => (v > 0.5 ? '▲' : v < -0.5 ? '▼' : '•')

const STOPWORDS = new Set(['the','a','an','of','and','or','you','in','it','on','at','for','to','is','are'])

const monogramFor = (label: string) => {
  if (!label) return '??'
  const cleaned = label.replace(/'s\b/gi, '').replace(/[^A-Za-z0-9\s-]/g, ' ')
  const words = cleaned.split(/[\s-]+/).filter((w) => w && !STOPWORDS.has(w.toLowerCase()))
  if (!words.length) return label.slice(0, 2).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

// font shorthand objects for spreading into style props
const fD: React.CSSProperties = { fontFamily: '"Space Grotesk", system-ui, sans-serif' }
const fM: React.CSSProperties = { fontFamily: '"IBM Plex Mono", "Courier New", monospace' }

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
  <svg
    viewBox="0 0 400 400"
    style={{ width: '100%', height: '100%', display: 'block' }}
    aria-label="Pillar percentile rings"
  >
    <defs>
      <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
        <feOffset dx="0" dy="1" result="off" />
        <feComponentTransfer><feFuncA type="linear" slope="0.18" /></feComponentTransfer>
        <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
    <g filter={`url(#${filterId})`}>
      <Ring cx={200} cy={200} r={168} stroke={20} value={assembly} color={P.assembly} />
      <Ring cx={200} cy={200} r={132} stroke={20} value={decon}    color={P.decon} />
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

  const workMixRaw = {
    assembly:  totalPillar ? (user.pillarTotals.assembly  / totalPillar) * 100 : 0,
    decon:     totalPillar ? (user.pillarTotals.decon     / totalPillar) * 100 : 0,
    sterilize: totalPillar ? (user.pillarTotals.sterilize / totalPillar) * 100 : 0,
  }
  // round and fix to exactly 100
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
      style={{
        position: 'relative',
        background: P.card,
        border: `1px solid ${P.cardEdge}`,
        borderRadius: '22px',
        overflow: 'hidden',
        boxShadow:
          '0 1px 0 rgba(26,23,20,0.06), 0 2px 6px rgba(26,23,20,0.04), 0 30px 60px -30px rgba(26,23,20,0.32)',
        color: P.ink,
        cursor: interactive ? 'pointer' : undefined,
      }}
      className={`${interactive ? 'transition hover:-translate-y-0.5 hover:shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2' : ''} ${className}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!interactive) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() }
      }}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
    >

      {/* ── top strap ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 32px',
        borderBottom: `1px dashed ${P.ruleStrong}`,
        ...fM,
        fontSize: '11px',
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: P.ink2,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', fontWeight: 600 }}>
          <span style={{
            width: 16, height: 16, borderRadius: 4, flexShrink: 0,
            background: `conic-gradient(from 220deg at 50% 50%, ${P.assembly} 0deg, ${P.decon} 140deg, ${P.sterilize} 260deg, ${P.assembly} 360deg)`,
            boxShadow: `inset 0 0 0 2px ${P.card}`,
            display: 'inline-block',
          }} aria-hidden="true" />
          SPD Report Card{period ? ` · ${period}` : ''}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '14px', color: P.muted1 }}>
          <span>{user.facility || 'SPD'}</span>
          <span style={{ width: 4, height: 4, background: P.ruleStrong, borderRadius: '50%', display: 'inline-block' }} aria-hidden="true" />
          <span style={{ color: P.ink, fontWeight: 600 }}>{user.techLabel}</span>
        </span>
      </div>

      {/* ── hero ──────────────────────────────────────────────────────── */}
      <section style={{
        display: 'grid',
        gridTemplateColumns: '1fr 400px',
        gap: '32px',
        padding: '36px 32px 24px',
        alignItems: 'stretch',
      }}>
        {/* identity */}
        <div>
          <div style={{ ...fM, fontSize: '11px', letterSpacing: '0.18em', textTransform: 'uppercase', color: P.muted1 }}>
            Tech file · personal record
          </div>
          <h1 style={{
            ...fD,
            fontSize: 'clamp(36px, 4.5vw, 62px)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            lineHeight: 0.96,
            margin: '10px 0 6px',
            color: P.ink,
          }}>
            {displayName}
          </h1>
          <div style={{ fontSize: '14px', color: P.muted1 }}>
            {user.role}{user.facility ? ` · ${user.facility} SPD` : ''}
          </div>

          {/* archetype badge */}
          <div style={{
            marginTop: '24px',
            display: 'inline-flex',
            alignItems: 'stretch',
            background: P.ink,
            color: P.card,
            borderRadius: '14px',
            overflow: 'hidden',
            maxWidth: '100%',
          }} aria-label={`Archetype: ${user.archetype.label}`}>
            <div style={{
              display: 'grid',
              placeItems: 'center',
              padding: '0 16px',
              background: `linear-gradient(160deg, ${P.assembly} 0%, #ffb84a 90%)`,
              color: P.ink,
              ...fD,
              fontWeight: 700,
              fontSize: '19px',
              letterSpacing: '0.02em',
              minWidth: '58px',
              textAlign: 'center',
            }}>
              <div>{archGlyph}</div>
              <div style={{ ...fM, fontSize: '9px', fontWeight: 500, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(26,23,20,0.65)', marginTop: '2px' }}>
                Archetype
              </div>
            </div>
            <div style={{ padding: '13px 18px' }}>
              <div style={{ ...fD, fontSize: '19px', fontWeight: 600, letterSpacing: '-0.005em', lineHeight: 1.05 }}>
                {user.archetype.label}
              </div>
              <div style={{ marginTop: '4px', fontSize: '12px', color: 'rgba(251,248,241,0.7)', maxWidth: '340px' }}>
                {user.archetype.description}
              </div>
            </div>
          </div>

          {/* stats stripe */}
          <div style={{
            marginTop: '24px',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: '8px',
            paddingTop: '16px',
            borderTop: `1px solid ${P.rule}`,
            ...fM,
            fontSize: '10px',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: P.muted1,
          }}>
            {[
              {
                label: 'Hours worked',
                value: hoursWorkedAvailable ? user.hoursWorked.toFixed(1) : '—',
                unit: hoursWorkedAvailable ? 'h' : '',
              },
              { label: 'Units of service', value: fmtInt(totalPillar), unit: '' },
              { label: 'Quality score',    value: String(qualPct),     unit: 'th pct' },
              { label: 'Defect rate',      value: fmtPct(user.metrics.defectRate, 2), unit: '' },
            ].map((stat) => (
              <div key={stat.label} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {stat.label}
                <span style={{ ...fD, fontSize: '21px', fontWeight: 600, letterSpacing: '-0.015em', color: P.ink, textTransform: 'none', lineHeight: 1, display: 'inline-flex', alignItems: 'baseline', gap: '2px' }}>
                  {stat.value}
                  {stat.unit ? <small style={{ ...fM, fontSize: '10px', fontWeight: 500, color: P.muted1, letterSpacing: '0.04em' }}>{stat.unit}</small> : null}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* rings panel */}
        <div style={{
          background: 'radial-gradient(120% 80% at 50% 0%, #fff 0%, #fbf8f1 70%)',
          border: `1px solid ${P.rule}`,
          borderRadius: '18px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            ...fM,
            fontSize: '10px',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: P.muted1,
          }}>
            <span>Overall · Pillar percentiles</span>
            <span style={{
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: '4px',
              padding: '3px 10px',
              border: `1px solid ${P.ruleStrong}`,
              borderRadius: '999px',
              background: P.card,
              color: P.ink,
              whiteSpace: 'nowrap',
            }}>
              <small style={{ fontSize: '9px', letterSpacing: '0.12em', color: P.muted1 }}>Score</small>
              <span style={{ ...fD, fontSize: '13px', fontWeight: 600, letterSpacing: '-0.01em' }}>{Math.round(user.scores.overall)}</span>
              <small style={{ fontSize: '9px', letterSpacing: '0.12em', color: P.muted1 }}>/ 200</small>
            </span>
          </div>

          {/* ring stage */}
          <div style={{ position: 'relative', aspectRatio: '1 / 1', margin: '0 auto', width: '100%', maxWidth: '320px' }}>
            <PillarRings
              assembly={assemblyPct}
              decon={deconPct}
              sterilize={sterilPct}
              filterId={`ringShadow-${uid}`}
            />
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', pointerEvents: 'none' }}>
              <div>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'baseline',
                  gap: '2px',
                  ...fD,
                  fontSize: 'clamp(48px, 7vw, 72px)',
                  fontWeight: 600,
                  letterSpacing: '-0.04em',
                  lineHeight: 0.85,
                  color: P.ink,
                }}>
                  {overallPct}
                  <span style={{ fontSize: '19px', fontWeight: 500, color: P.muted1, letterSpacing: '0.01em', alignSelf: 'flex-start', marginTop: '13px' }}>
                    {ordinal(overallPct)}
                  </span>
                </div>
                <div style={{ ...fM, fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: P.muted1, marginTop: '6px' }}>
                  Overall percentile
                </div>
              </div>
            </div>
          </div>

          {/* legend */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', paddingTop: '4px', borderTop: `1px dashed ${P.rule}` }}>
            {([
              { label: 'Assembly', color: P.assembly, pct: assemblyPct },
              { label: 'Decon',    color: P.decon,    pct: deconPct },
              { label: 'Sterilize',color: P.sterilize,pct: sterilPct },
            ] as const).map((leg) => (
              <div key={leg.label} style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '6px 4px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', ...fM, fontSize: '9px', letterSpacing: '0.14em', textTransform: 'uppercase', color: P.muted1 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: leg.color, flexShrink: 0 }} />
                  {leg.label}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '2px', ...fD, fontWeight: 600, fontSize: '18px', letterSpacing: '-0.01em', color: P.ink }}>
                  {leg.pct}
                  <span style={{ ...fM, fontSize: '9px', color: P.muted1, fontWeight: 500, alignSelf: 'flex-start', marginTop: '3px', letterSpacing: '0.06em' }}>
                    {ordinal(leg.pct)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── rule ──────────────────────────────────────────────────────── */}
      <div style={{ height: 1, background: P.rule, margin: '0 32px' }} />

      {/* ── score grid ────────────────────────────────────────────────── */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', padding: '20px 32px 24px' }}>
        {[
          {
            label: 'Productivity',
            pct: prodPct,
            trend: prodPct - 50,
            micro: hoursWorkedAvailable
              ? `Per-hour output across all pillars. ${fmtInt(totalPillar)} total units across ${user.hoursWorked.toFixed(1)}h worked.`
              : `Ranked on pillar totals — hours not available. ${fmtInt(totalPillar)} total units this period.`,
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
        ].map((s, i) => (
          <div key={s.label} style={{
            padding: i === 0 ? '0 20px 0 0' : '0 20px',
            borderLeft: i === 0 ? 'none' : `1px dashed ${P.ruleStrong}`,
          }}>
            <div style={{ ...fM, fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: P.muted1 }}>
              {s.label}
            </div>
            <div style={{
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: '3px',
              ...fD,
              fontSize: 'clamp(40px, 4vw, 54px)',
              fontWeight: 600,
              letterSpacing: '-0.035em',
              lineHeight: 0.95,
              margin: '6px 0 5px',
              color: P.ink,
            }}>
              {s.pct}
              <span style={{ fontSize: '16px', fontWeight: 500, color: P.muted1, letterSpacing: '0.02em', alignSelf: 'flex-start', marginTop: '9px' }}>
                {ordinal(s.pct)}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', ...fM, fontSize: '10px', letterSpacing: '0.06em', color: P.muted1 }}>
              <span style={{ color: trendColor(s.trend) }}>{trendArrow(s.trend)} {fmtSigned(s.trend)}</span>
              <span>vs median</span>
            </div>
            <p style={{ marginTop: '10px', fontSize: '12px', color: P.ink2, lineHeight: 1.35, maxWidth: '260px', margin: '10px 0 0' }}>
              {s.micro}
            </p>
          </div>
        ))}
      </section>

      {/* ── pillar breakdown ──────────────────────────────────────────── */}
      <section style={{ padding: '4px 32px 22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
          <h3 style={{ ...fD, fontWeight: 600, fontSize: '15px', letterSpacing: '-0.005em', color: P.ink, margin: 0 }}>
            Pillar breakdown
          </h3>
          <div style={{ ...fM, fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: P.muted1 }}>
            Bar shows percentile · marker shows cohort median
          </div>
        </div>
        {pillarRows.map((row, i) => (
          <div key={row.key} style={{
            display: 'grid',
            gridTemplateColumns: '160px 1fr 80px 96px 88px',
            alignItems: 'center',
            gap: '16px',
            padding: '12px 0',
            borderTop: i === 0 ? `1px solid ${P.ruleStrong}` : `1px dashed ${P.rule}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ width: 10, height: 18, borderRadius: 3, background: row.color, flexShrink: 0 }} />
              <div>
                <div style={{ ...fD, fontSize: '16px', fontWeight: 600, lineHeight: 1, letterSpacing: '-0.005em' }}>
                  {row.label}
                </div>
                <div style={{ ...fM, fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: P.muted1, marginTop: '3px' }}>
                  {row.sub}
                </div>
              </div>
            </div>
            {/* percentile bar */}
            <div style={{ position: 'relative', height: 14, background: P.paper2, borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${row.pct}%`, borderRadius: 999, background: row.color }} />
              <div style={{ position: 'absolute', top: -4, bottom: -4, left: '50%', width: 2, background: P.ink, opacity: 0.55 }} />
            </div>
            {/* percentile label */}
            <div style={{ ...fD, fontSize: '20px', fontWeight: 600, letterSpacing: '-0.02em', display: 'inline-flex', alignItems: 'baseline', gap: '2px', justifyContent: 'flex-end' }}>
              {row.pct}
              <span style={{ ...fM, fontSize: '9px', color: P.muted1, fontWeight: 500, alignSelf: 'flex-start', marginTop: '4px', letterSpacing: '0.06em' }}>
                {ordinal(row.pct)}
              </span>
            </div>
            {/* total */}
            <div style={{ ...fM, fontSize: '12px', letterSpacing: '0.02em', textAlign: 'right', color: P.ink2 }}>
              {fmtInt(row.total)}
              <span style={{ display: 'block', fontSize: '9px', color: P.muted1, textTransform: 'uppercase', letterSpacing: '0.14em', marginTop: '2px' }}>
                {row.unit}
              </span>
            </div>
            {/* trend */}
            <div style={{ ...fM, fontSize: '11px', letterSpacing: '0.04em', textAlign: 'right' }}>
              <span style={{ display: 'block', fontSize: '9px', color: P.muted1, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: '2px' }}>
                vs median
              </span>
              <span style={{ color: trendColor(row.trend) }}>
                {trendArrow(row.trend)} {fmtSigned(row.trend)}
              </span>
            </div>
          </div>
        ))}
      </section>

      {/* ── work mix + context ────────────────────────────────────────── */}
      <section style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: '20px', padding: '0 32px 22px' }}>
        {/* work mix */}
        <div style={{ background: '#fff', border: `1px solid ${P.rule}`, borderRadius: '14px', padding: '16px 18px' }}>
          <h4 style={{ ...fD, fontWeight: 600, fontSize: '13px', letterSpacing: '-0.005em', margin: '0 0 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            Work mix
            <span style={{ ...fM, fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: P.muted1, fontWeight: 500 }}>
              share of pillar activity
            </span>
          </h4>
          <div style={{ display: 'flex', height: '22px', borderRadius: '6px', overflow: 'hidden', border: `1px solid ${P.rule}` }}>
            {([
              { pct: workMix.assembly,  color: P.assembly },
              { pct: workMix.decon,     color: P.decon },
              { pct: workMix.sterilize, color: P.sterilize },
            ] as const).map((seg, i) => (
              <div key={i} style={{
                width: `${seg.pct}%`,
                background: seg.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(255,255,255,0.95)',
                ...fM,
                fontSize: '10px',
                letterSpacing: '0.1em',
                fontWeight: 600,
              }}>
                {seg.pct > 10 ? `${seg.pct}%` : ''}
              </div>
            ))}
          </div>
          <div style={{ marginTop: '10px', display: 'flex', gap: '16px', flexWrap: 'wrap', ...fM, fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: P.muted1 }}>
            {([
              ['Assembly', P.assembly, workMix.assembly],
              ['Decon',    P.decon,    workMix.decon],
              ['Sterilize',P.sterilize,workMix.sterilize],
            ] as const).map(([name, color, pct]) => (
              <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
                {name} {pct}%
              </span>
            ))}
          </div>
          <p style={{ marginTop: '12px', paddingTop: '10px', borderTop: `1px dashed ${P.rule}`, fontSize: '12px', color: P.ink2, lineHeight: 1.45, margin: '12px 0 0' }}>
            You spent{' '}
            <strong style={{ color: P.ink, fontWeight: 600 }}>{dominantMix.pct}%</strong> of pillar work in{' '}
            <strong style={{ color: P.ink, fontWeight: 600 }}>{dominantMix.name}</strong> this period.{' '}
            {weakestPillar.pct < 60
              ? `Picking up more ${weakestPillar.label} work would move your Versatility score fastest.`
              : 'A well-rounded mix across all three pillars.'}
          </p>
        </div>

        {/* context tiles */}
        <div style={{ background: '#fff', border: `1px solid ${P.rule}`, borderRadius: '14px', padding: '16px 18px' }}>
          <h4 style={{ ...fD, fontWeight: 600, fontSize: '13px', letterSpacing: '-0.005em', margin: '0 0 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            Context
            <span style={{ ...fM, fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: P.muted1, fontWeight: 500 }}>
              timekeeping &amp; quality
            </span>
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
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
              <div key={tile.k} style={{ padding: '10px 11px', border: `1px solid ${P.rule}`, borderRadius: '10px', background: P.card }}>
                <div style={{ ...fM, fontSize: '9px', letterSpacing: '0.16em', textTransform: 'uppercase', color: P.muted1 }}>
                  {tile.k}
                </div>
                <div style={{ ...fD, fontSize: '21px', fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.05, marginTop: '5px' }}>
                  {tile.v}
                  {tile.unit ? <small style={{ ...fM, fontSize: '10px', color: P.muted1, fontWeight: 500, marginLeft: '3px', letterSpacing: '0.04em' }}>{tile.unit}</small> : null}
                </div>
                <div style={{ marginTop: '3px', fontSize: '11px', color: P.ink2 }}>{tile.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── badges ────────────────────────────────────────────────────── */}
      {user.badges.length > 0 ? (
        <section style={{ padding: '18px 32px 4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
            <h3 style={{ ...fD, fontWeight: 600, fontSize: '15px', letterSpacing: '-0.005em', color: P.ink, margin: 0 }}>
              Badges earned
            </h3>
            <div style={{ ...fM, fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: P.muted1 }}>
              {user.badges.length} this period
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
            {user.badges.map((badge) => {
              const markStyle: React.CSSProperties =
                badge.tier === 'gold'
                  ? { background: 'linear-gradient(160deg, #ffc24a, #c98306)', color: '#2b1a00' }
                  : badge.tier === 'silver'
                    ? { background: 'linear-gradient(160deg, #d9d3c4, #8d8779)', color: '#1f1c16' }
                    : { background: 'linear-gradient(160deg, #e8a774, #a45a23)', color: '#2b1500' }
              return (
                <div
                  key={`${badge.category}-${badge.label}`}
                  style={{ position: 'relative', padding: '13px 13px 13px 48px', border: `1px solid ${P.rule}`, borderRadius: '12px', background: P.card }}
                >
                  <div style={{
                    position: 'absolute', top: 11, left: 11,
                    width: 28, height: 28, borderRadius: 8,
                    display: 'grid', placeItems: 'center',
                    ...fD, fontWeight: 700, fontSize: '11px', letterSpacing: '0.02em',
                    ...markStyle,
                  }}>
                    {monogramFor(badge.label)}
                  </div>
                  <div style={{ ...fD, fontWeight: 600, fontSize: '13px', letterSpacing: '-0.005em', lineHeight: 1.15 }}>
                    {badge.label}
                  </div>
                  <div style={{ marginTop: '3px', ...fM, fontSize: '9px', letterSpacing: '0.14em', textTransform: 'uppercase', color: P.muted1 }}>
                    {badge.tier} · {badge.category}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {/* ── coach note ────────────────────────────────────────────────── */}
      {user.coachingSummary ? (
        <section style={{
          margin: '22px 32px 0',
          padding: '24px 26px',
          background: P.ink,
          color: P.card,
          borderRadius: '16px',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: `radial-gradient(420px 240px at -10% 110%, rgba(227,135,10,0.30), transparent 60%), radial-gradient(360px 200px at 110% -10%, rgba(43,88,255,0.28), transparent 60%)`,
          }} aria-hidden="true" />
          <div style={{ position: 'relative', ...fM, fontSize: '10px', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(251,248,241,0.6)' }}>
            Coach note · for {displayName.split(' ')[0]}
          </div>
          <p style={{
            position: 'relative',
            margin: '10px 0 0',
            ...fD,
            fontWeight: 500,
            fontSize: 'clamp(16px, 2vw, 24px)',
            lineHeight: 1.22,
            letterSpacing: '-0.01em',
          }}>
            {user.coachingSummary}
          </p>
          <div style={{
            position: 'relative',
            marginTop: '14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            ...fM,
            fontSize: '10px',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'rgba(251,248,241,0.55)',
          }}>
            <span>— SPD Educator</span>
            {user.opportunity ? (
              <span>
                <strong style={{ color: P.card, fontWeight: 600 }}>Next goal:</strong> {user.opportunity}
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ── foot strap ────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        padding: '20px 32px 26px',
        marginTop: '22px',
        borderTop: `1px dashed ${P.ruleStrong}`,
        ...fM,
        fontSize: '11px',
        letterSpacing: '0.04em',
        color: P.ink2,
      }}>
        {[
          { k: 'Units of service',  v: fmtInt(totalPillar),                                                                  unit: 'uos' },
          { k: 'Worked hrs / unit', v: hoursWorkedAvailable ? user.metrics.workedHoursPerUnit.toFixed(2) : '—',              unit: hoursWorkedAvailable ? 'hr' : '' },
          { k: 'Missing inst rate', v: fmtPct(user.metrics.assemblyMissingInst, 2),                                          unit: '' },
          { k: 'Defect rate',       v: fmtPct(user.metrics.defectRate, 2),                                                    unit: '' },
        ].map((ft) => (
          <div key={ft.k}>
            <div style={{ fontSize: '9px', letterSpacing: '0.18em', textTransform: 'uppercase', color: P.muted1, marginBottom: '5px' }}>
              {ft.k}
            </div>
            <div style={{ ...fD, fontWeight: 600, fontSize: '17px', letterSpacing: '-0.01em', color: P.ink }}>
              {ft.v}
              {ft.unit ? (
                <small style={{ ...fM, fontSize: '10px', fontWeight: 500, color: P.muted1, marginLeft: '3px', letterSpacing: '0.06em' }}>
                  {ft.unit}
                </small>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </article>
  )
}

export default ReportCard
