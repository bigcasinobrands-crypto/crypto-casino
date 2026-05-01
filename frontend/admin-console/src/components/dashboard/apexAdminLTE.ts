import type { ApexOptions } from 'apexcharts'
import { useMemo } from 'react'
import { useTheme } from '../../context/ThemeContext'

/** Bootstrap primary palette for charts (readable on light + dark AdminLTE). */
export const CHART_COLORS = {
  primary: '#0d6efd',
  success: '#198754',
  danger: '#dc3545',
  warning: '#ffc107',
  info: '#0dcaf0',
  secondary: '#6c757d',
  purple: '#6f42c1',
  teal: '#20c997',
}

export function useApexChartOptions(): { isDark: boolean; base: ApexOptions } {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const base = useMemo<ApexOptions>(
    () => ({
      chart: {
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
        toolbar: { show: false },
        zoom: { enabled: false },
        foreColor: isDark ? '#adb5bd' : '#6c757d',
      },
      grid: {
        borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        strokeDashArray: 4,
        padding: { left: 8, right: 8 },
      },
      xaxis: {
        axisBorder: { show: false },
        axisTicks: { show: false },
        labels: { style: { fontSize: '11px' } },
      },
      yaxis: {
        labels: { style: { fontSize: '11px' } },
      },
      legend: {
        fontSize: '12px',
        labels: { colors: isDark ? '#ced4da' : '#495057' },
      },
      tooltip: {
        theme: isDark ? 'dark' : 'light',
      },
      dataLabels: { enabled: false },
    }),
    [isDark],
  )

  return { isDark, base }
}
