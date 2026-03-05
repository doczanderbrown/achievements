import type { ReactNode } from 'react';

type DrawerProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

const Drawer = ({ open, title, onClose, children }: DrawerProps) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        className="absolute inset-0 bg-amber-950/20"
      ></button>
      <aside className="relative z-50 flex h-full w-full max-w-lg flex-col border-l border-stroke bg-card p-6 shadow-lift">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-stroke px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:border-accent hover:text-ink"
          >
            Close
          </button>
        </div>
        <div className="mt-4 overflow-auto pr-2">{children}</div>
      </aside>
    </div>
  );
};

export default Drawer;
