import { type FC, useMemo } from 'react'
import Chart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'
import ChartEmpty from './ChartEmpty'
import { CHART_COLORS, useApexChartOptions } from './apexAdminLTE'

interface AreaChartProps {
  series: { name: string; data: number[]; color?: string }[]
  categories: string[]
  height?: number
  yFormatter?: (val: number) => string
}

const AreaChart: FC<AreaChartProps> = ({ series, categories, height = 300, yFormatter }) => {
  const { base } = useApexChartOptions()
  const firstLen = series[0]?.data?.length ?? 0
  const isEmpty = categories.length === 0 || firstLen === 0

  const options: ApexOptions = useMemo(
    () => ({
      ...base,
      chart: { ...base.chart, type: 'area' },
      colors: series.map((s) => s.color ?? CHART_COLORS.primary),
      stroke: { curve: 'smooth', width: 2 },
      fill: {
        type: 'gradient',
        gradient: {
          shadeIntensity: 0.8,
          opacityFrom: 0.35,
          opacityTo: 0.05,
          stops: [0, 90, 100],
        },
      },
      xaxis: {
        ...base.xaxis,
        categories,
      },
      yaxis: {
        labels: {
          style: { fontSize: '11px' },
          formatter: yFormatter,
        },
      },
      tooltip: {
        ...base.tooltip,
        y: { formatter: yFormatter },
      },
      legend: {
        ...base.legend,
        show: series.length > 1,
        position: 'top',
        horizontalAlign: 'right',
      },
    }),
    [base, series, categories, yFormatter],
  )

  if (isEmpty) {
    return (
      <ChartEmpty
        height={height}
        message="No data in this range yet — KPIs will populate after payments, play, or registrations."
      />
    )
  }

  return (
    <Chart
      options={options}
      series={series.map(({ name, data }) => ({ name, data }))}
      type="area"
      height={height}
    />
  )
}

export default AreaChart
