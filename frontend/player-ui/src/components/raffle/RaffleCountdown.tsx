import { useEffect, useState } from 'react'

export type CountdownParts = {
  days: number
  hours: number
  minutes: number
  seconds: number
  expired: boolean
}

export function useRaffleCountdown(endMs: number): CountdownParts {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const remain = Math.max(0, endMs - now)
  if (remain <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true }
  }

  const days = Math.floor(remain / 86400000)
  let r = remain % 86400000
  const hours = Math.floor(r / 3600000)
  r %= 3600000
  const minutes = Math.floor(r / 60000)
  r %= 60000
  const seconds = Math.floor(r / 1000)

  return { days, hours, minutes, seconds, expired: false }
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

type RaffleCountdownProps = {
  endMs: number
  dayLabel: string
  hourLabel: string
  minLabel: string
  secLabel: string
}

export function RaffleCountdown({ endMs, dayLabel, hourLabel, minLabel, secLabel }: RaffleCountdownProps) {
  const { days, hours, minutes, seconds, expired } = useRaffleCountdown(endMs)

  const boxes = expired
    ? [
        { val: '00', label: dayLabel },
        { val: '00', label: hourLabel },
        { val: '00', label: minLabel },
        { val: '00', label: secLabel },
      ]
    : [
        { val: pad2(days), label: dayLabel },
        { val: pad2(hours), label: hourLabel },
        { val: pad2(minutes), label: minLabel },
        { val: pad2(seconds), label: secLabel },
      ]

  return (
    <div className="flex flex-wrap gap-2 sm:gap-3" aria-live="polite" aria-atomic="true">
      {boxes.map((box) => (
        <div
          key={box.label}
          className="flex h-[68px] w-[56px] shrink-0 flex-col items-center justify-center rounded-casino-md border border-white/[0.08] bg-casino-elevated sm:h-[72px] sm:w-16"
        >
          <span className="text-[20px] font-bold tabular-nums text-casino-foreground sm:text-2xl">{box.val}</span>
          <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-casino-muted sm:text-[11px]">
            {box.label}
          </span>
        </div>
      ))}
    </div>
  )
}
