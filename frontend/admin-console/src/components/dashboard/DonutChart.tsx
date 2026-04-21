import { type FC, useMemo } from 'react'
import Chart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'

interface DonutChartProps {
  labels: string[]
  series: number[]
  colors?: string[]
  height?: number
  centerLabel?: string
}

const DonutChart: FC<DonutChartProps> = ({ labels, series, colors, height = 280, centerLabel }) => {
  const options: ApexOptions = useMemo(() => ({
    chart: { type: 'donut', fontFamily: 'inherit' },
    labels,
    colors: colors || ['#4318FF', '#6AD2FF', '#E1E9F8', '#EFF4FB', '#868CFF'],
    dataLabels: { enabled: false },
    legend: { position: 'bottom', fontFamily: 'inherit' },
    stroke: { width: 0 },
    plotOptions: {
      pie: {
        donut: {
          size: '70%',
          labels: {
            show: !!centerLabel,
            total: {
              show: !!centerLabel,
              label: centerLabel || 'Total',
              fontSize: '14px',
              fontWeight: '600',
            },
          },
        },
      },
    },
    tooltip: { theme: 'dark' },
  }), [labels, colors, centerLabel])

  return <Chart options={options} series={series} type="donut" height={height} />
}

export default DonutChart
