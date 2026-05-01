import { type FC, useMemo } from 'react'
import Chart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'
import ChartEmpty from './ChartEmpty'
import { CHART_COLORS, useApexChartOptions } from './apexAdminLTE'

interface DonutChartProps {
  labels: string[]
  series: number[]
  colors?: string[]
  height?: number
  centerLabel?: string
}

const DEFAULT_DONUT_COLORS = [
  CHART_COLORS.primary,
  CHART_COLORS.success,
  CHART_COLORS.warning,
  CHART_COLORS.info,
  CHART_COLORS.secondary,
]

const DonutChart: FC<DonutChartProps> = ({
  labels,
  series,
  colors,
  height = 280,
  centerLabel,
}) => {
  const { base, isDark } = useApexChartOptions()
  const total = useMemo(
    () => series.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0),
    [series],
  )

  const palette = colors?.length ? colors : DEFAULT_DONUT_COLORS

  const options: ApexOptions = useMemo(
    () => ({
      ...base,
      chart: { ...base.chart, type: 'donut' },
      labels,
      colors: palette,
      stroke: { width: 2, colors: [isDark ? '#212529' : '#fff'] },
      plotOptions: {
        pie: {
          donut: {
            size: '68%',
            labels: {
              show: !!centerLabel,
              name: { show: false },
              value: {
                fontSize: '22px',
                fontWeight: 600,
                color: isDark ? '#f8f9fa' : '#212529',
              },
              total: {
                show: !!centerLabel,
                label: centerLabel || 'Total',
                fontSize: '12px',
                color: isDark ? '#adb5bd' : '#6c757d',
              },
            },
          },
        },
      },
      legend: {
        ...base.legend,
        position: 'bottom',
      },
    }),
    [base, labels, palette, centerLabel, isDark],
  )

  if (total <= 0) {
    return (
      <ChartEmpty
        height={height}
        message="No funnel volume yet — totals are zero until players register and deposit."
      />
    )
  }

  return <Chart options={options} series={series} type="donut" height={height} />
}

export default DonutChart
