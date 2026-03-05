import { useState } from 'react'
import InTransitDashboardApp from './apps/inTransit/InTransitDashboardApp'
import ProcessingLocationReportApp from './apps/ProcessingLocationReportApp'
import RtlsAccuracyApp from './apps/RtlsAccuracyApp'
import SpdReportCardApp from './apps/SpdReportCardApp'

type SuiteAppId =
  | 'spd-report-card'
  | 'processing-location'
  | 'in-transit-dashboard'
  | 'rtls-accuracy'

type SuiteAppDefinition = {
  id: SuiteAppId
  title: string
  subtitle: string
  description: string
  status: string
  ctaLabel: string
}

const suiteApps: SuiteAppDefinition[] = [
  {
    id: 'spd-report-card',
    title: 'SPD Report Card',
    subtitle: 'Individual technician performance cards',
    description:
      'Upload SPD activity exports to generate report cards, compare percentile ranks, and export selected cards.',
    status: 'Live',
    ctaLabel: 'Open app',
  },
  {
    id: 'processing-location',
    title: 'Processing Location Dashboard',
    subtitle: 'On-site vs off-site processing mix',
    description:
      'Analyze where trays are processed by day of week, compare leave vs stay rates, and review No-Go compliance.',
    status: 'Live',
    ctaLabel: 'Open app',
  },
  {
    id: 'in-transit-dashboard',
    title: 'In Transit Dashboard',
    subtitle: 'Inventory transit and away monitoring',
    description:
      'Upload transit/away workbooks to view movement insights, aging trends, lane details, and filtered exports.',
    status: 'Live',
    ctaLabel: 'Open app',
  },
  {
    id: 'rtls-accuracy',
    title: 'RTLS Accuracy Analyzer',
    subtitle: 'ilocs vs human scan correspondence',
    description:
      'Upload scan history to match ilocs room-change events against human scans, measure lag windows, and review path transitions.',
    status: 'Live',
    ctaLabel: 'Open app',
  },
]

const App = () => {
  const [activeApp, setActiveApp] = useState<SuiteAppId | null>(null)

  if (activeApp === 'spd-report-card') {
    return <SpdReportCardApp onBack={() => setActiveApp(null)} />
  }

  if (activeApp === 'processing-location') {
    return <ProcessingLocationReportApp onBack={() => setActiveApp(null)} />
  }

  if (activeApp === 'in-transit-dashboard') {
    return <InTransitDashboardApp onBack={() => setActiveApp(null)} />
  }

  if (activeApp === 'rtls-accuracy') {
    return <RtlsAccuracyApp onBack={() => setActiveApp(null)} />
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -top-36 left-8 h-72 w-72 rounded-full bg-brand/25 blur-3xl" />
      <div className="pointer-events-none absolute top-16 right-10 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-10 left-1/3 h-80 w-80 rounded-full bg-brand/15 blur-[120px]" />

      <main className="relative mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12">
        <header className="rounded-3xl border border-brand/20 bg-white/80 p-8 shadow-sm backdrop-blur">
          <p className="text-xs uppercase tracking-[0.28em] text-muted">Ascendco Analytics</p>
          <h1 className="mt-4 font-display text-4xl font-semibold text-ink">Alex&apos;s SPD Toolbox</h1>
          <p className="mt-3 max-w-3xl text-sm text-muted">
            Select an analytics app to launch. This landing page will host additional reports as
            they are added.
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          {suiteApps.map((suiteApp) => (
            <article
              key={suiteApp.id}
              className="flex h-full flex-col rounded-3xl border border-ink/10 bg-white/90 p-6 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink">
                  {suiteApp.status}
                </span>
                <span className="text-xs uppercase tracking-[0.16em] text-muted">
                  {suiteApp.subtitle}
                </span>
              </div>
              <h2 className="mt-5 text-2xl font-semibold text-ink">{suiteApp.title}</h2>
              <p className="mt-3 flex-1 text-sm text-muted">{suiteApp.description}</p>
              <button
                type="button"
                onClick={() => setActiveApp(suiteApp.id)}
                className="mt-6 inline-flex items-center justify-center rounded-full border border-brand/40 bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90"
              >
                {suiteApp.ctaLabel}
              </button>
            </article>
          ))}
        </section>
      </main>
    </div>
  )
}

export default App
