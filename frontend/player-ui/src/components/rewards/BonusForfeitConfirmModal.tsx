import { useId, type FC } from 'react'

type Props = {
  open: boolean
  bonusTitle: string
  onCancel: () => void
  onConfirm: () => void
  busy?: boolean
  /** Credited instance vs. activated-before-deposit (cancels stored deposit intent, no balance yet). */
  variant?: 'instance' | 'deposit_intent'
}

export const BonusForfeitConfirmModal: FC<Props> = ({
  open,
  bonusTitle,
  onCancel,
  onConfirm,
  busy,
  variant = 'instance',
}) => {
  const titleId = useId()
  if (!open) return null

  const isIntent = variant === 'deposit_intent'
  const heading = isIntent ? 'Cancel this activated offer?' : 'Forfeit this bonus?'

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label="Close" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md rounded-t-xl border border-white/[0.12] bg-casino-card shadow-2xl sm:rounded-xl"
      >
        <div className="border-b border-white/[0.08] px-4 py-3 sm:px-5">
          <h2 id={titleId} className="m-0 text-base font-extrabold text-casino-foreground">
            {heading}
          </h2>
          <p className="mt-1 text-xs font-semibold text-casino-muted">{bonusTitle}</p>
        </div>
        <div className="space-y-3 px-4 py-4 text-sm leading-relaxed text-casino-muted sm:px-5">
          {isIntent ? (
            <>
              <p className="m-0">
                You are about to <strong className="text-casino-foreground">remove this bonus selection</strong> from your account. Any deposit match, bonus credit, or
                other rewards <strong className="text-casino-foreground">tied to this offer will not be applied</strong> on a future deposit while this selection is
                gone.
              </p>
              <p className="m-0 text-xs">Your existing wallet balance is not changed by this action. You may choose a different available offer later if you qualify.</p>
            </>
          ) : (
            <>
              <p className="m-0">
                If you continue, this promotion ends immediately. Any remaining <strong className="text-casino-foreground">locked bonus</strong> balance from
                this offer is removed, and your <strong className="text-casino-foreground">wagering progress</strong> for this bonus is lost. You
                cannot undo this.
              </p>
              <p className="m-0 text-xs">
                Your cash wallet is not affected. After forfeiting, you may qualify for a new deposit offer if the site rules allow.
              </p>
            </>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-white/[0.08] px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-casino-md border border-white/[0.12] px-4 py-2 text-sm font-bold text-casino-foreground transition hover:bg-white/[0.04] disabled:opacity-50"
          >
            {isIntent ? 'Go back' : 'Cancel'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-casino-md bg-red-600/90 px-4 py-2 text-sm font-extrabold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? 'Working…' : isIntent ? 'Yes, cancel offer' : 'Yes, forfeit bonus'}
          </button>
        </div>
      </div>
    </div>
  )
}
