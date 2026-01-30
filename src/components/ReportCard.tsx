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
import type { MetricDefinition, MetricKey, PillarTotals, UserRecord } from '../utils/metrics'

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

const ScoreBlock = ({
  label,
  score,
  percentile,
  accentClass,
}: {
  label: string
  score: number
  percentile: number
  accentClass: string
}) => {
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
    <div className="rounded-2xl border border-ink/10 bg-white/85 px-4 py-3 shadow-sm">
      <div className="text-xs uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-2 flex items-end justify-between">
        <div className={`text-3xl font-semibold ${accentClass}`}>{score.toFixed(0)}</div>
        <div className="text-xs font-medium text-muted">
          {rounded}
          {suffix} Percentile
        </div>
      </div>
    </div>
  )
}

const metricHelper = (metric: MetricDefinition) => {
  if (metric.helper) return metric.helper
  return ''
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

  const comparisonItems = DEFAULT_METRICS.map((metric) => {
    const value = user.metrics[metric.key]
    const median = medians[metric.key]
    return {
      metric,
      value,
      median,
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

  const itemsPerLoad = user.metrics.sterilizerLoads
    ? user.metrics.itemsSterilized / Math.max(user.metrics.sterilizerLoads, 1)
    : 0

  const productivityDrivers = [
    { key: 'assembly', label: 'Assembly', value: user.productivityDrivers.assembly },
    { key: 'sterilize', label: 'Sterilize', value: user.productivityDrivers.sterilize },
    { key: 'decon', label: 'Decontamination', value: user.productivityDrivers.decon },
  ].sort((a, b) => b.value - a.value)

  const interactiveClasses = interactive
    ? 'cursor-pointer transition hover:-translate-y-0.5 hover:shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60'
    : ''

  return (
    <article
      className={`relative flex h-full flex-col gap-5 overflow-hidden rounded-3xl border border-brand/20 bg-panel/95 p-6 shadow-lg ${interactiveClasses} ${className}`}
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
      <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-brand via-accent to-brand/60" />
      <div className="flex flex-wrap items-start justify-between gap-3 pt-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted">Report Card</div>
          <h3 className="mt-2 text-2xl font-semibold text-ink">{displayName}</h3>
          <div className="mt-1 text-sm text-muted">
            {hoursWorkedAvailable
              ? `Hours Worked: ${user.hoursWorked.toFixed(1)}`
              : 'Hours Worked not found'}
          </div>
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

      <div className="grid gap-3 md:grid-cols-3">
        <ScoreBlock
          label="Productivity"
          score={user.scores.productivity}
          percentile={user.scores.productivityPercentile}
          accentClass="text-brand"
        />
        <ScoreBlock
          label="Quality"
          score={user.scores.quality}
          percentile={user.scores.qualityPercentile}
          accentClass="text-accent"
        />
        <ScoreBlock
          label="Versatility"
          score={user.scores.versatility}
          percentile={user.scores.versatilityPercentile}
          accentClass="text-ink"
        />
      </div>

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
                <div className="text-lg font-semibold text-ink">
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
            {user.badges.slice(0, 4).map((badge) => (
              <span key={badge} className="tag">
                {badge}
              </span>
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
              <div className="text-xs text-muted">
                Based on {user.productivityDrivers.basis === 'rates' ? 'per-hour pillar rates' : 'pillar totals'}.
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
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            User vs median
          </div>
          <div className="mt-3 h-32">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} barSize={18} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
                <Bar dataKey="Median" fill="#94a3b8" radius={[6, 6, 0, 0]} />
                <Bar dataKey="User" fill="#f59e0b" radius={[6, 6, 0, 0]} />
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

      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-ink">Operational adds</h4>
        <div className="grid gap-2 sm:grid-cols-1">
          <div className="metric-chip">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Items per Load</span>
            </div>
            <div className="mt-2 text-lg font-semibold text-ink">
              {itemsPerLoad.toFixed(1)}
            </div>
            <div className="text-[10px] text-muted">Items sterilized / load</div>
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
