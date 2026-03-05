type FlowIndicatorProps = {
  mode: 'transit' | 'away';
  fromLabel: string;
  toLabel: string;
  compact?: boolean;
};

const FlowIndicator = ({ mode, fromLabel, toLabel, compact = false }: FlowIndicatorProps) => {
  const lineClass = mode === 'transit' ? 'flow-line' : 'flow-line flow-line--away';
  const rightDotClass = mode === 'transit' ? 'flow-dot flow-dot--active' : 'flow-dot flow-dot--away';
  const statusLabel = mode === 'transit' ? 'Actively flowing' : 'Not home';

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      <div
        className={`flex items-center gap-2 ${
          compact ? 'text-[10px]' : 'text-[11px]'
        } text-muted`}
      >
        <span className="max-w-[120px] truncate">{fromLabel || 'Unknown'}</span>
        <div className="relative flex-1">
          <div className={lineClass}></div>
          <span className="flow-dot flow-dot--start"></span>
          <span className={rightDotClass}></span>
          {mode === 'transit' ? <span className="flow-pulse"></span> : null}
        </div>
        <span className="max-w-[120px] truncate">{toLabel || 'Unknown'}</span>
      </div>
      {!compact ? (
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted">{statusLabel}</div>
      ) : null}
    </div>
  );
};

export default FlowIndicator;
