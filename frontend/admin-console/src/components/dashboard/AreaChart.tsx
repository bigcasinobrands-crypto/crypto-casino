import { type FC, useMemo } from 'react'
import Chart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'

interface AreaChartProps {
  series: { name: string; data: number[]; color?: string }[]
  categories: string[]
  height?: number
  yFormatter?: (val: number) => string
}

const AreaChart: FC<AreaChartProps> = ({ series, categories, height = 300, yFormatter }) => {
  const options: ApexOptions = useMemo(() => ({
    chart: {
      type: 'area',
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: 'inherit',
    },
    colors: series.map((s) => s.color || '#4318FF'),
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2 },
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 100] },
    },
    xaxis: {
      categories,
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
    tooltip: {
      theme: 'dark',
      y: { formatter: yFormatter },
    },
    legend: { show: series.length > 1, position: 'top', horizontalAlign: 'right' },
  }), [series, categories, yFormatter])

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
