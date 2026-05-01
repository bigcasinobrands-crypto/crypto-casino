import { type FC, useMemo } from 'react'
import Chart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'
import ChartEmpty from './ChartEmpty'
import { CHART_COLORS, useApexChartOptions } from './apexAdminLTE'

interface BarChartProps {
  labels: string[]
  data: number[]
  color?: string
  height?: number
  horizontal?: boolean
  yFormatter?: (val: number) => string
}

const BarChart: FC<BarChartProps> = ({
  labels,
  data,
  color = CHART_COLORS.primary,
  height = 300,
  horizontal = true,
  yFormatter,
}) => {
  const { base } = useApexChartOptions()

  const options: ApexOptions = useMemo(
    () => ({
      ...base,
      chart: { ...base.chart, type: 'bar' },
      colors: [color],
      plotOptions: {
        bar: {
          horizontal,
          borderRadius: horizontal ? 4 : 2,
          barHeight: horizontal ? '72%' : undefined,
          columnWidth: horizontal ? undefined : '55%',
        },
      },
      xaxis: {
        ...base.xaxis,
        categories: labels,
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
    }),
    [base, labels, color, horizontal, yFormatter],
  )

  if (labels.length === 0) {
    return (
      <ChartEmpty
        height={height}
        message="No rows in this range — sync data or widen the time window."
      />
    )
  }

  return <Chart options={options} series={[{ name: 'Value', data }]} type="bar" height={height} />
}

export default BarChart
