import { useId } from 'react'
import {
  Bar,
  BarChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { DEFAULT_METRICS, formatMetricValue } from '../utils/metrics'
import type { BadgeTier, MetricDefinition, MetricKey, PillarTotals, UserRecord } from '../utils/metrics'

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
}

const getPercentileColor = (percentile: number) => {
  if (percentile >= 75) return 'text-green-600'
  if (percentile >= 25) return 'text-blue-600'
  return 'text-red-600'
}

const ScoreBlock = ({
  label,
  percentile,
}: {
  label: string
  percentile: number
}) => {
  const rounded = Math.round(percentile)
  const colorClass = getPercentileColor(rounded)
  const suffix = (() => {
    const mod100 = rounded % 100
    if (mod100 >= 11 && mod100 <= 13) return 'th'
    switch (rounded % 10) {
      case 1:
        return 'st'
      case 2:
        return 'nd'
      case 3:
        return 'rd'
      default:
        return 'th'
    }
  })()
  return (
    <div className="rounded-2xl border border-ink/10 bg-white/85 px-4 py-3 shadow-sm">
      <div className="text-xs uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-2 flex items-end justify-between">
        <div className={`text-3xl font-semibold ${colorClass}`}>
          {rounded}
          <span className="ml-1 text-sm font-medium text-muted">
            {suffix} Percentile
          </span>
        </div>
      </div>
    </div>
  )
}

const OverallScoreBlock = ({ score, percentile }: { score: number; percentile: number }) => {
  const colorClass = getPercentileColor(percentile)
  const rounded = Math.round(percentile)
  const suffix = (() => {
    const mod100 = rounded % 100
    if (mod100 >= 11 && mod100 <= 13) return 'th'
    switch (rounded % 10) {
      case 1:
        return 'st'
      case 2:
        return 'nd'
      case 3:
        return 'rd'
      default:
        return 'th'
    }
  })()
  return (
    <div className="rounded-2xl border border-ink/10 bg-white/85 px-4 py-3 text-center shadow-sm">
      <div className="text-xs uppercase tracking-[0.18em] text-muted">
        Overall Processing Score
      </div>
      <div className="mt-3 flex flex-col items-center gap-1">
        <div className={`text-5xl font-semibold leading-none ${colorClass}`}>
          {rounded}
          <span className="ml-1 text-lg font-medium text-muted">{suffix}</span>
        </div>
        <div className="text-sm font-medium text-muted">Percentile</div>
        <div className="mt-1 text-2xl font-semibold text-ink/80">{score.toFixed(0)}</div>
        <div className="text-xs uppercase tracking-[0.18em] text-muted">Overall score</div>
      </div>
    </div>
  )
}

const MetricScoreBlock = ({
  label,
  percentile,
}: {
  label: string
  percentile: number
}) => {
  const rounded = Math.round(percentile)
  const colorClass = getPercentileColor(rounded)
  const suffix = (() => {
    const mod100 = rounded % 100
    if (mod100 >= 11 && mod100 <= 13) return 'th'
    switch (rounded % 10) {
      case 1:
        return 'st'
      case 2:
        return 'nd'
      case 3:
        return 'rd'
      default:
        return 'th'
    }
  })()
  return (
    <div className="rounded-2xl border border-ink/10 bg-white/85 px-4 py-3 shadow-sm">
      <div className="text-xs uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-2 flex items-end">
        <div className={`text-3xl font-semibold ${colorClass}`}>
          {rounded}
          <span className="ml-1 text-sm font-medium text-muted">
            {suffix} Percentile
          </span>
        </div>
      </div>
    </div>
  )
}

const metricHelper = (metric: MetricDefinition) => {
  if (metric.helper) return metric.helper
  return ''
}

const TIER_STYLES: Record<BadgeTier, { bg: string; border: string; text: string; icon: string }> = {
  bronze: {
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    text: 'text-amber-800',
    icon: '🥉',
  },
  silver: {
    bg: 'bg-slate-50',
    border: 'border-slate-300',
    text: 'text-slate-700',
    icon: '🥈',
  },
  gold: {
    bg: 'bg-yellow-50',
    border: 'border-yellow-400',
    text: 'text-yellow-800',
    icon: '🥇',
  },
}

const BadgeChip = ({ badge }: { badge: import('../utils/metrics').Badge }) => {
  const styles = TIER_STYLES[badge.tier]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${styles.bg} ${styles.border} ${styles.text}`}
    >
      <span>{styles.icon}</span>
      {badge.label}
    </span>
  )
}

const ReportCard = ({
  user,
  medians,
  pillarMedians,
  anonymize,
  hoursWorkedAvailable,
  showArchetypeDescription = false,
  shortPillarLabels = false,
  onClick,
  interactive = false,
  className = '',
}: ReportCardProps) => {
  const displayName = anonymize ? user.techLabel : user.name
  const deconLabel = shortPillarLabels ? 'Decon' : 'Decontamination'
  const hasNoHoursWorked = hoursWorkedAvailable && user.hoursWorked <= 0
  const chartPatternId = useId().replace(/:/g, '')
  const medianPatternId = `${chartPatternId}-median-bar`
  const userPatternId = `${chartPatternId}-user-bar`

  const comparisonItems = DEFAULT_METRICS.filter(
    (metric) => hoursWorkedAvailable || metric.key !== 'workedHoursPerUnit',
  ).map((metric) => {
    const value = user.metrics[metric.key]
    const median = medians[metric.key]
    return {
      metric,
      value,
      median,
      delta: value - median,
    }
  })

  const barData = [
    {
      name: deconLabel,
      User: user.pillarTotals.decon,
      Median: pillarMedians.decon,
    },
    {
      name: 'Assembly',
      User: user.pillarTotals.assembly,
      Median: pillarMedians.assembly,
    },
    {
      name: 'Sterilize',
      User: user.pillarTotals.sterilize,
      Median: pillarMedians.sterilize,
    },
  ]

  const radarData = [
    { pillar: deconLabel, value: user.pillarPercentiles.decon },
    { pillar: 'Assembly', value: user.pillarPercentiles.assembly },
    { pillar: 'Sterilize', value: user.pillarPercentiles.sterilize },
    { pillar: 'Quality', value: user.scores.qualityPercentile },
  ]

  const totalPillarActivity =
    user.pillarTotals.decon + user.pillarTotals.assembly + user.pillarTotals.sterilize
  const deconShare = totalPillarActivity ? (user.pillarTotals.decon / totalPillarActivity) * 100 : 0
  const assemblyShare = totalPillarActivity
    ? (user.pillarTotals.assembly / totalPillarActivity) * 100
    : 0
  const sterilizeShare = totalPillarActivity
    ? (user.pillarTotals.sterilize / totalPillarActivity) * 100
    : 0


  const productivityDrivers = [
    { key: 'assembly', label: 'Assembly', value: user.productivityDrivers.assembly },
    { key: 'sterilize', label: 'Sterilize', value: user.productivityDrivers.sterilize },
    { key: 'decon', label: 'Decontamination', value: user.productivityDrivers.decon },
  ].sort((a, b) => b.value - a.value)

  const timekeepingChips = [
    {
      key: 'pto',
      label: 'PTO',
      value: user.timekeepingContext.ptoHours,
    },
    {
      key: 'unpaid',
      label: 'Unpaid',
      value: user.timekeepingContext.unpaidHours,
    },
    {
      key: 'on-call',
      label: 'On-call',
      value: user.timekeepingContext.onCallHours,
    },
    {
      key: 'ot',
      label: 'OT',
      value: user.timekeepingContext.overtimeHours,
    },
  ].filter((item) => item.value > 0)

  const qualityChips = [
    {
      key: 'events',
      label: 'Quality hits',
      value: user.qualityContext.eventCount,
    },
    {
      key: 'audits',
      label: 'Audit fails / checks',
      value:
        user.qualityContext.auditChecks > 0
          ? `${user.qualityContext.auditFails}/${user.qualityContext.auditChecks}`
          : null,
    },
    {
      key: 'coaching',
      label: 'Coaching',
      value: user.qualityContext.coachingCount,
    },
  ].filter((item) => item.value !== null && item.value !== 0)

  const interactiveClasses = interactive
    ? 'cursor-pointer transition hover:-translate-y-0.5 hover:shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60'
    : ''

  return (
    <article
      className={`relative flex h-full flex-col gap-5 overflow-hidden rounded-3xl border p-6 shadow-lg ${
        hasNoHoursWorked ? 'border-warning/50 bg-warning/10' : 'border-brand/20 bg-panel/95'
      } ${interactiveClasses} ${className}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!interactive) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick?.()
        }
      }}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <div
        className={`absolute inset-x-0 top-0 h-1.5 ${
          hasNoHoursWorked
            ? 'bg-gradient-to-r from-warning via-warning/80 to-warning/50'
            : 'bg-gradient-to-r from-brand via-accent to-brand/60'
        }`}
      />
      <div className="flex flex-wrap items-start justify-between gap-3 pt-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted">Report Card</div>
          <h3 className="mt-2 text-2xl font-semibold text-ink">{displayName}</h3>
          {user.role ? (
            <div className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-muted">
              {user.role}
            </div>
          ) : null}
          <div className="mt-1 text-sm text-muted">
            {hoursWorkedAvailable
              ? `Hours Worked: ${user.hoursWorked.toFixed(1)}`
              : 'Hours Worked not found'}
          </div>
          {hasNoHoursWorked ? (
            <div className="mt-1 text-xs font-medium text-warning">
              {user.productivityRanked
                ? 'Hours Worked is 0 or missing for this user.'
                : 'Excluded from productivity peer ranking (Hours Worked missing or 0).'}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-2 text-sm font-medium text-ink">
          <span className="text-lg">{user.archetype.icon}</span>
          <div>
            <div className="text-sm font-semibold">{user.archetype.label}</div>
            {showArchetypeDescription ? (
              <div className="text-xs text-muted">{user.archetype.description}</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <OverallScoreBlock
          score={user.scores.overall}
          percentile={user.scores.overallPercentile}
        />
        <div className="grid gap-3 md:grid-cols-3">
          <ScoreBlock
            label="Productivity"
            percentile={user.scores.productivityPercentile}
          />
          <MetricScoreBlock
            label="Defect Rate"
            percentile={user.percentiles.defectRate}
          />
          <MetricScoreBlock
            label="Missing Instruments"
            percentile={user.percentiles.assemblyMissingInst}
          />
        </div>
      </div>

      {timekeepingChips.length > 0 || qualityChips.length > 0 ? (
        <section className="space-y-3">
          <h4 className="text-sm font-semibold text-ink">Context</h4>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-ink/10 bg-white/85 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                Timekeeping
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {timekeepingChips.length > 0 ? (
                  timekeepingChips.map((chip) => (
                    <span
                      key={chip.key}
                      className="rounded-full border border-ink/10 bg-brand/10 px-2.5 py-1 text-xs font-medium text-ink"
                    >
                      {chip.label} {chip.value.toFixed(1)}h
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted">No additional timekeeping context.</span>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-ink/10 bg-white/85 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                Quality Inputs
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {qualityChips.length > 0 ? (
                  qualityChips.map((chip) => (
                    <span
                      key={chip.key}
                      className="rounded-full border border-ink/10 bg-accent/10 px-2.5 py-1 text-xs font-medium text-ink"
                    >
                      {chip.label} {chip.value}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted">No person-level quality context found.</span>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-ink">Peer comparison</h4>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {comparisonItems.map((item) => (
            <div key={item.metric.key} className="metric-chip">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{item.metric.label}</span>
                {metricHelper(item.metric) ? (
                  <span className="text-[10px] uppercase tracking-[0.12em]">
                    {metricHelper(item.metric)}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex items-end justify-between">
                <div
                  className={`text-lg font-semibold ${
                    item.metric.format === 'rate'
                      ? item.delta < 0
                        ? 'text-green-600'
                        : item.delta > 0
                          ? 'text-red-600'
                          : 'text-ink'
                      : 'text-ink'
                  }`}
                >
                  {formatMetricValue(item.value, item.metric)}
                </div>
                <div className="text-right text-[10px] text-muted">
                  Median {formatMetricValue(item.median, item.metric)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-ink">Badges</h4>
        {user.badges.length ? (
          <div className="flex flex-wrap gap-2">
            {user.badges.map((badge) => (
              <BadgeChip key={`${badge.category}-${badge.tier}`} badge={badge} />
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted">No badges yet.</div>
        )}
      </section>

      {showArchetypeDescription ? (
        <section className="rounded-2xl border border-ink/10 bg-white/85 p-3 text-sm text-muted">
          <details>
            <summary className="cursor-pointer font-semibold text-ink">
              Why your productivity score looks this way
            </summary>
            <div className="mt-2 space-y-2">
              {user.productivityDrivers.basis === 'excluded' ? (
                <div>
                  This user is excluded from productivity peer ranking because Hours Worked is
                  missing or 0.
                </div>
              ) : (
                <div>
                  Your productivity is driven mostly by{' '}
                  <span className="font-semibold text-ink">
                    {productivityDrivers[0].value.toFixed(0)}% {productivityDrivers[0].label}
                  </span>{' '}
                  and{' '}
                  <span className="font-semibold text-ink">
                    {productivityDrivers[1].value.toFixed(0)}% {productivityDrivers[1].label}
                  </span>
                  , with{' '}
                  <span className="font-semibold text-ink">
                    {productivityDrivers[2].value.toFixed(0)}% {productivityDrivers[2].label}
                  </span>{' '}
                  contributing as well.
                </div>
              )}
              <div className="text-xs text-muted">
                {user.productivityDrivers.basis === 'rates'
                  ? 'Based on per-hour pillar rates.'
                  : user.productivityDrivers.basis === 'totals'
                    ? 'Based on pillar totals.'
                    : 'No productivity percentile is assigned until Hours Worked is provided.'}
              </div>
            </div>
          </details>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-ink">Work mix</h4>
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted">
            % of total pillar activity
          </div>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full border border-ink/10 bg-white/80">
          <div
            className="h-full bg-accent"
            style={{ width: `${deconShare}%` }}
            title={`Decon ${deconShare.toFixed(1)}%`}
          />
          <div
            className="h-full bg-brand"
            style={{ width: `${assemblyShare}%` }}
            title={`Assembly ${assemblyShare.toFixed(1)}%`}
          />
          <div
            className="h-full bg-success"
            style={{ width: `${sterilizeShare}%` }}
            title={`Sterilize ${sterilizeShare.toFixed(1)}%`}
          />
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-accent" />
            Decon {deconShare.toFixed(0)}%
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-brand" />
            Assembly {assemblyShare.toFixed(0)}%
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-success" />
            Sterilize {sterilizeShare.toFixed(0)}%
          </span>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-ink/10 bg-white/85 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
              User vs median
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3 text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
              <span className="inline-flex items-center gap-2">
                <span
                  className="h-3 w-5 rounded-sm border border-ink/70"
                  style={{ background: '#334155' }}
                />
                User
              </span>
              <span className="inline-flex items-center gap-2">
                <span
                  className="h-3 w-5 rounded-sm border border-ink/70"
                  style={{
                    backgroundColor: '#f8fafc',
                    backgroundImage:
                      'repeating-linear-gradient(135deg, rgba(71, 85, 105, 0.9) 0 2px, transparent 2px 5px)',
                  }}
                />
                Median
              </span>
            </div>
          </div>
          <div className="mt-3 h-32">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} barSize={18} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <pattern
                    id={userPatternId}
                    width="6"
                    height="6"
                    patternUnits="userSpaceOnUse"
                  >
                    <rect width="6" height="6" fill="#334155" />
                  </pattern>
                  <pattern
                    id={medianPatternId}
                    width="8"
                    height="8"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(135)"
                  >
                    <rect width="8" height="8" fill="#f8fafc" />
                    <line x1="0" y1="0" x2="0" y2="8" stroke="#475569" strokeWidth="3" />
                  </pattern>
                </defs>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  cursor={{ fill: 'rgba(15, 23, 42, 0.05)' }}
                  formatter={(value, name) => {
                    const numeric = typeof value === 'number' ? value : Number(value)
                    const formatted = Number.isFinite(numeric) ? numeric.toFixed(0) : value
                    return [formatted, name]
                  }}
                />
                <Bar
                  dataKey="Median"
                  fill={`url(#${medianPatternId})`}
                  stroke="#475569"
                  strokeWidth={1}
                  radius={[6, 6, 0, 0]}
                />
                <Bar
                  dataKey="User"
                  fill={`url(#${userPatternId})`}
                  stroke="#334155"
                  strokeWidth={1}
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl border border-ink/10 bg-white/85 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            Pillar radar
          </div>
          <div className="mt-2 h-32">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius={45}>
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="pillar" tick={{ fontSize: 9 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 8 }} />
                <Radar dataKey="value" stroke="#2563eb" fill="#2563eb" fillOpacity={0.35} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

<footer className="rounded-2xl border border-ink/10 bg-white/85 p-4 text-sm text-muted">
        {user.coachingSummary}
      </footer>
    </article>
  )
}

export default ReportCard
