import type { ReactNode } from 'react';

type TabButtonProps = {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
};

const TabButton = ({ active, onClick, children }: TabButtonProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
        active
          ? 'border border-accent bg-accent text-ink shadow-lift'
          : 'border border-stroke bg-white text-ink/70 hover:text-ink hover:shadow-lift'
      }`}
    >
      {children}
    </button>
  );
};

export default TabButton;
