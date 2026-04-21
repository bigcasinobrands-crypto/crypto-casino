import { type FC, useMemo } from 'react'
import Chart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'

interface BarChartProps {
  labels: string[]
  data: number[]
  color?: string
  height?: number
  horizontal?: boolean
  yFormatter?: (val: number) => string
}

const BarChart: FC<BarChartProps> = ({ labels, data, color = '#4318FF', height = 300, horizontal = true, yFormatter }) => {
  const options: ApexOptions = useMemo(() => ({
    chart: { type: 'bar', toolbar: { show: false }, fontFamily: 'inherit' },
    plotOptions: {
      bar: { horizontal, borderRadius: 4, barHeight: '60%', columnWidth: '40%' },
    },
    colors: [color],
    dataLabels: { enabled: false },
    xaxis: {
      categories: labels,
      labels: { style: { colors: '#A3AED0', fontSize: '11px' } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        style: { colors: '#A3AED0', fontSize: '11px' },
        formatter: yFormatter,
      },
    },
    grid: { borderColor: '#F4F7FE', strokeDashArray: 4 },
    tooltip: { theme: 'dark', y: { formatter: yFormatter } },
  }), [labels, color, height, horizontal, yFormatter])

  return <Chart options={options} series={[{ name: 'Value', data }]} type="bar" height={height} />
}

export default BarChart
