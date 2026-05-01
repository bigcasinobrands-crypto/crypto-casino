import type { FC } from 'react'
import Chart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'

interface MiniSparklineProps {
  data: number[]
  color?: string
  width?: number
  height?: number
}

const MiniSparkline: FC<MiniSparklineProps> = ({ data, color = '#0d6efd', width = 80, height = 28 }) => {
  const options: ApexOptions = {
    chart: { type: 'area', sparkline: { enabled: true } },
    stroke: { curve: 'smooth', width: 1.5 },
    fill: { type: 'gradient', gradient: { opacityFrom: 0.3, opacityTo: 0, stops: [0, 100] } },
    colors: [color],
    tooltip: { enabled: false },
  }

  return <Chart options={options} series={[{ data }]} type="area" width={width} height={height} />
}

export default MiniSparkline
