import { Moon, Sun } from 'lucide-react';
import type { AppView } from '../types/task';

interface TopBarProps {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  counts: {
    active: number;
    today: number;
    reminders: number;
    completed: number;
  };
}

const NAV_ITEMS: { id: AppView; label: string }[] = [
  { id: 'matrix', label: 'Matrix' },
  { id: 'today', label: 'Today' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'completed', label: 'Completed' },
];

export function TopBar({
  activeView,
  onSelectView,
  theme,
  onToggleTheme,
  counts,
}: TopBarProps) {
  const isDark = theme === 'dark';

  const getCount = (id: AppView): number => {
    if (id === 'matrix') return counts.active;
    if (id === 'today') return counts.today;
    if (id === 'reminders') return counts.reminders;
    return counts.completed;
  };

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-neutral-200/80 bg-white/90 backdrop-blur-md transition-colors duration-200 dark:border-white/12 dark:bg-[#090B0F]/90">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-4 px-5 py-3.5 sm:gap-8 sm:px-8">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              onSelectView('matrix');
            }}
            className="font-display text-base font-semibold tracking-tight text-neutral-950 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-900 dark:text-white dark:focus-visible:outline-sky-400"
          >
            ArcMatrix
          </a>

          <nav aria-label="Primary views" className="hidden md:flex items-center gap-8">
            {NAV_ITEMS.map((item) => {
              const isActive = activeView === item.id;
              const count = getCount(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectView(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative flex items-center gap-1.5 py-1 text-sm transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-900 dark:focus-visible:outline-sky-400 ${
                    isActive
                      ? 'font-medium text-neutral-950 dark:text-white'
                      : 'font-normal text-neutral-400 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100'
                  }`}
                >
                  <span>{item.label}</span>
                  <span className="font-mono text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">
                    {count}
                  </span>
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 -bottom-[15px] h-[1.5px] bg-neutral-950 dark:bg-sky-400"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleTheme}
              aria-pressed={isDark}
              aria-label={isDark ? 'Switch to daylight mode' : 'Switch to night vision mode'}
              title={isDark ? 'Daylight mode' : 'Night vision mode'}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 sm:px-3 text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-950 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 dark:border-white/15 dark:bg-[#0F131A] dark:text-neutral-200 dark:hover:border-sky-400/50 dark:hover:text-white dark:focus-visible:outline-sky-400"
            >
              {isDark ? (
                <>
                  <Sun className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
                  <span className="hidden sm:inline">Day</span>
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5 text-neutral-600" aria-hidden="true" />
                  <span className="hidden sm:inline">Night</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <nav
        aria-label="Mobile views"
        className="flex md:hidden items-center justify-between gap-2 border-b border-neutral-200/80 bg-white px-4 py-2 overflow-x-auto transition-colors duration-200 dark:border-white/12 dark:bg-[#090B0F]"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          const count = getCount(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                  : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white'
              }`}
            >
              <span>{item.label}</span>
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  isActive ? 'text-neutral-300 dark:text-neutral-600' : 'text-neutral-400 dark:text-neutral-500'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
