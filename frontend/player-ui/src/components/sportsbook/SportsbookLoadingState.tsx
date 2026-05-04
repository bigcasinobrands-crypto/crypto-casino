export default function SportsbookLoadingState({ label = 'Loading sportsbook…' }: { label?: string }) {
  return (
    <div
      className="flex min-h-[200px] flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center"
      role="status"
      aria-live="polite"
    >
      <div
        className="h-9 w-9 animate-spin rounded-full border-2 border-casino-primary/30 border-t-casino-primary"
        aria-hidden
      />
      <p className="text-sm font-medium text-white/90">{label}</p>
    </div>
  )
}
