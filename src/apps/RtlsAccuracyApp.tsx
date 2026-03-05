import { useState } from 'react'
import type { RtlsAnalysisConfig, RtlsAnalysisResult, RtlsParseProgress, RtlsScanDataset } from './rtlsAccuracy/types'
import { analyzeRtlsDataset } from './rtlsAccuracy/utils/analyzeRtlsDataset'
import { parseRtlsScanWorkbook } from './rtlsAccuracy/utils/parseRtlsScanWorkbook'

type RtlsAccuracyAppProps = {
  onBack?: () => void
}

const DEFAULT_CONFIG: RtlsAnalysisConfig = {
  ilocsKeyword: 'ilocs',
  humanBeforeHours: 4,
  humanAfterHours: 8,
}

const formatPercent = (value: number) => `${value.toFixed(1)}%`
const formatHours = (value: number) => `${value.toFixed(2)}h`

const SummaryCard = ({ label, value, hint }: { label: string; value: string; hint?: string }) => {
  return (
    <article className="rounded-2xl border border-ink/10 bg-white/90 p-4 shadow-sm">
      <div className="text-xs uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </article>
  )
}

const RtlsAccuracyApp = ({ onBack }: RtlsAccuracyAppProps) => {
  const [dataset, setDataset] = useState<RtlsScanDataset | null>(null)
  const [analysis, setAnalysis] = useState<RtlsAnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [config, setConfig] = useState<RtlsAnalysisConfig>(DEFAULT_CONFIG)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<RtlsParseProgress | null>(null)

  const runAnalysis = async (sourceDataset: RtlsScanDataset, nextConfig: RtlsAnalysisConfig) => {
    setBusy(true)
    setProgress({
      phase: 'complete',
      message: 'Analyzing ilocs vs human correspondence and path transitions...',
      rowsParsed: sourceDataset.parsedRows,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const computed = analyzeRtlsDataset(sourceDataset, nextConfig)
    setAnalysis(computed)
    setBusy(false)
  }

  const handleUpload = async (file: File | null) => {
    if (!file) return
    setError(null)
    setFileName(file.name)
    setDataset(null)
    setAnalysis(null)
    setBusy(true)

    try {
      const parsed = await parseRtlsScanWorkbook(file, (nextProgress) => {
        setProgress(nextProgress)
      })
      setDataset(parsed)
      await runAnalysis(parsed, config)
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : 'Unable to parse the scan workbook. Confirm it is a valid .xlsx export.',
      )
      setBusy(false)
    }
  }

  const reanalyze = async () => {
    if (!dataset) return
    setError(null)
    await runAnalysis(dataset, config)
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -top-32 right-0 h-80 w-80 rounded-full bg-brand/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-10 h-72 w-72 rounded-full bg-accent/15 blur-3xl" />

      <main className="relative mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
        <header className="rounded-3xl border border-ink/10 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="inline-flex items-center rounded-full border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink"
                >
                  Back to app suite
                </button>
              ) : null}
              <div className="mt-3 text-[11px] uppercase tracking-[0.35em] text-muted">
                Ascendo Analytics
              </div>
              <h1 className="mt-2 font-display text-3xl font-semibold text-ink md:text-4xl">
                RTLS Accuracy Analyzer
              </h1>
              <p className="mt-3 max-w-3xl text-sm text-muted">
                Upload the scan history export, detect ilocs and human room-change events by
                `InvID`, match them within a time window, and inspect ilocs path transitions.
              </p>
            </div>

            <label className="inline-flex cursor-pointer items-center justify-center rounded-full border border-brand/40 bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand/90">
              Upload Scan Export (.xlsx)
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(event) => handleUpload(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        </header>

        <section className="rounded-3xl border border-ink/10 bg-white/90 p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-4">
            <label className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                ilocs keyword
              </div>
              <input
                type="text"
                value={config.ilocsKeyword}
                onChange={(event) =>
                  setConfig((current) => ({ ...current, ilocsKeyword: event.target.value }))
                }
                className="w-full rounded-xl border border-ink/20 px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Human before ilocs (hrs)
              </div>
              <input
                type="number"
                min={0}
                max={72}
                step={0.25}
                value={config.humanBeforeHours}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    humanBeforeHours: Number.parseFloat(event.target.value) || 0,
                  }))
                }
                className="w-full rounded-xl border border-ink/20 px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Human after ilocs (hrs)
              </div>
              <input
                type="number"
                min={0}
                max={72}
                step={0.25}
                value={config.humanAfterHours}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    humanAfterHours: Number.parseFloat(event.target.value) || 0,
                  }))
                }
                className="w-full rounded-xl border border-ink/20 px-3 py-2 text-sm text-ink"
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={reanalyze}
                disabled={!dataset || busy}
                className="w-full rounded-xl border border-ink/20 bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Recalculate
              </button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted">
            <span className="rounded-full border border-ink/15 px-3 py-1">
              File: {fileName || 'None'}
            </span>
            <span className="rounded-full border border-ink/15 px-3 py-1">
              Rows analyzed: {analysis?.parsedRows.toLocaleString() ?? 0}
            </span>
            {analysis?.beaconFilterApplied ? (
              <>
                <span className="rounded-full border border-ink/15 px-3 py-1">
                  Rows before beacon filter: {analysis.rawParsedRows.toLocaleString()}
                </span>
                <span className="rounded-full border border-ink/15 px-3 py-1">
                  Beaconed assets: {analysis.beaconedAssetsCount.toLocaleString()}
                </span>
                <span className="rounded-full border border-ink/15 px-3 py-1">
                  Excluded (non-beaconed): {analysis.excludedNonBeaconRows.toLocaleString()}
                </span>
              </>
            ) : null}
            {progress ? (
              <span className="rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-ink">
                {progress.message}
              </span>
            ) : null}
            {busy ? (
              <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-ink">
                Working...
              </span>
            ) : null}
          </div>
          {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        </section>

        {analysis ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="ilocs Room Changes"
                value={analysis.ilocsRoomChanges.toLocaleString()}
              />
              <SummaryCard
                label="Human Room Changes"
                value={analysis.humanRoomChanges.toLocaleString()}
              />
              <SummaryCard
                label="Matched Room Changes"
                value={analysis.matchedRoomChanges.toLocaleString()}
              />
              <SummaryCard
                label="Rows Excluded (Non-Beaconed)"
                value={analysis.excludedNonBeaconRows.toLocaleString()}
                hint={analysis.beaconFilterApplied ? 'Filtered using beaconed assets sheet.' : 'No beacon list applied.'}
              />
              <SummaryCard label="ilocs Match Rate" value={formatPercent(analysis.ilocsMatchRate)} />
              <SummaryCard
                label="Human Coverage Rate"
                value={formatPercent(analysis.humanCoverageRate)}
              />
              <SummaryCard
                label="Median Lag (Human - ilocs)"
                value={formatHours(analysis.lagHours.median)}
              />
              <SummaryCard label="P90 Lag" value={formatHours(analysis.lagHours.p90)} />
              <SummaryCard
                label="Unmatched ilocs / Human"
                value={`${analysis.unmatchedIlocsRoomChanges.toLocaleString()} / ${analysis.unmatchedHumanRoomChanges.toLocaleString()}`}
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-3xl border border-ink/10 bg-white/90 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-ink">Lag Bucket Distribution</h2>
                <p className="mt-1 text-xs text-muted">
                  Based on matched events using the configured time window.
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted">
                        <th className="border-b border-ink/10 py-2 pr-4">Bucket</th>
                        <th className="border-b border-ink/10 py-2 text-right">Matches</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.lagBuckets.map((bucket) => (
                        <tr key={bucket.label}>
                          <td className="border-b border-ink/5 py-2 pr-4">{bucket.label}</td>
                          <td className="border-b border-ink/5 py-2 text-right">
                            {bucket.count.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="rounded-3xl border border-ink/10 bg-white/90 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-ink">ilocs Stage Distribution</h2>
                <p className="mt-1 text-xs text-muted">
                  Stage buckets inferred from location, substate, workflow rule, and state.
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted">
                        <th className="border-b border-ink/10 py-2 pr-4">Stage</th>
                        <th className="border-b border-ink/10 py-2 text-right">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.stageSummaries.map((stage) => (
                        <tr key={stage.stage}>
                          <td className="border-b border-ink/5 py-2 pr-4">{stage.stage}</td>
                          <td className="border-b border-ink/5 py-2 text-right">
                            {stage.count.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-3xl border border-ink/10 bg-white/90 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-ink">Top ilocs Transitions</h2>
                <p className="mt-1 text-xs text-muted">
                  Most frequent stage-to-stage moves seen from ilocs room-change events.
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted">
                        <th className="border-b border-ink/10 py-2 pr-4">From</th>
                        <th className="border-b border-ink/10 py-2 pr-4">To</th>
                        <th className="border-b border-ink/10 py-2 pr-4">Path Flag</th>
                        <th className="border-b border-ink/10 py-2 text-right">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.transitionSummaries.slice(0, 20).map((transition) => (
                        <tr key={`${transition.from}-${transition.to}`}>
                          <td className="border-b border-ink/5 py-2 pr-4">{transition.from}</td>
                          <td className="border-b border-ink/5 py-2 pr-4">{transition.to}</td>
                          <td className="border-b border-ink/5 py-2 pr-4">
                            {transition.offPath ? 'Off-path' : 'Expected'}
                          </td>
                          <td className="border-b border-ink/5 py-2 text-right">
                            {transition.count.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="rounded-3xl border border-ink/10 bg-white/90 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-ink">Top Off-Path Transitions</h2>
                <p className="mt-1 text-xs text-muted">
                  Stage jumps outside the expected cycle (Assembly → Sterilize → Transport →
                  Storage → Case → Decon → Assembly).
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted">
                        <th className="border-b border-ink/10 py-2 pr-4">From</th>
                        <th className="border-b border-ink/10 py-2 pr-4">To</th>
                        <th className="border-b border-ink/10 py-2 text-right">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.offPathTransitions.slice(0, 20).map((transition) => (
                        <tr key={`${transition.from}-${transition.to}`}>
                          <td className="border-b border-ink/5 py-2 pr-4">{transition.from}</td>
                          <td className="border-b border-ink/5 py-2 pr-4">{transition.to}</td>
                          <td className="border-b border-ink/5 py-2 text-right">
                            {transition.count.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                      {analysis.offPathTransitions.length === 0 ? (
                        <tr>
                          <td className="py-3 text-sm text-muted" colSpan={3}>
                            No off-path transitions detected under current stage mapping.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </article>
            </section>
          </>
        ) : (
          <section className="rounded-3xl border border-ink/10 bg-white/90 p-8 text-sm text-muted shadow-sm">
            Upload a scan-history workbook to generate RTLS correspondence and path analytics.
          </section>
        )}
      </main>
    </div>
  )
}

export default RtlsAccuracyApp
