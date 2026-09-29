import { useEffect, useState } from 'react';

export interface ChartTheme {
  series1: string;
  series2: string;
  text: string;
  muted: string;
  grid: string;
  surface: string;
}

function read(): ChartTheme {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    series1: v('--series-1', '#2a78d6'),
    series2: v('--series-2', '#eb6834'),
    text: v('--chart-text', '#0b0b0b'),
    muted: v('--chart-text-muted', '#52514e'),
    grid: v('--chart-grid', '#e6e5e1'),
    surface: v('--chart-surface', '#fcfcfb'),
  };
}

/** Resolved chart colors from CSS tokens; updates when the OS switches light/dark. */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(read());
    mq?.addEventListener('change', onChange);
    return () => mq?.removeEventListener('change', onChange);
  }, []);
  return theme;
}
