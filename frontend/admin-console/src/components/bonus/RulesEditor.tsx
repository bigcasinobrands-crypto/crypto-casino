import { useMemo } from 'react'
import { SliderField, adminInputCls, ImageUrlField, adminHintCls } from '../admin-ui'
import { isDepositFamily, isScheduleFamily } from './bonusRuleTemplates'
import GameExcludePicker from './GameExcludePicker'
import SegmentTargetingSection from './SegmentTargetingSection'
import FreeSpinsRewardSection from './FreeSpinsRewardSection'

const inputCls = adminInputCls
const moneyPreviewFmt = {
  USD: new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }),
  EUR: new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }),
  GBP: new Intl.NumberFormat(undefined, { style: 'currency', currency: 'GBP' }),
}

function asRec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function asTrig(r: Record<string, unknown>) {
  return asRec(r.trigger)
}

function asRew(r: Record<string, unknown>) {
  return asRec(r.reward)
}

function asWag(r: Record<string, unknown>) {
  return asRec(r.wagering)
}

function asFreeSpins(r: Record<string, unknown>) {
  const d = { rounds: 20, game_id: '', bet_per_round_minor: 1 }
  const fs = r.free_spins
  if (!fs || typeof fs !== 'object' || Array.isArray(fs)) return d
  const o = fs as Record<string, unknown>
  return {
    rounds: typeof o.rounds === 'number' ? o.rounds : d.rounds,
    game_id: typeof o.game_id === 'string' ? o.game_id : d.game_id,
    bet_per_round_minor:
      typeof o.bet_per_round_minor === 'number' ? o.bet_per_round_minor : d.bet_per_round_minor,
  }
}

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

type Props = {
  bonusTypeId: string
  rules: unknown
  onRulesChange: (r: unknown) => void
  termsText: string
  onTermsTextChange: (t: string) => void
  /** Player My Bonuses card image for this version (optional). */
  playerHeroImageUrl?: string
  onPlayerHeroImageUrlChange?: (url: string) => void
  uploadFile?: (file: File) => Promise<string | null>
  showTerms?: boolean
  /** Load games / VIP tiers for targeting UI (wizard, operations, rules page). */
  apiFetch?: ApiFetch
}

function PromoHeroImageBlock({
  value,
  onChange,
  uploadFile,
}: {
  value: string
  onChange: (url: string) => void
  uploadFile?: (file: File) => Promise<string | null>
}) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Promotion image
      </h4>
      <p className={`${adminHintCls} mb-3 max-w-2xl`}>
        Optional hero for player-facing bonus cards (My Bonuses). Paste a URL or upload.
      </p>
      <div className="max-w-2xl">
        <ImageUrlField
          id="bonus-promo-hero"
          label="Image URL"
          hint={
            uploadFile
              ? 'PNG or JPG recommended. Stored on the promotion version.'
              : 'Enter a full HTTPS image URL.'
          }
          value={value}
          onChange={onChange}
          uploadFile={uploadFile}
        />
      </div>
    </div>
  )
}

function minorToMajor(minor: number): string {
  return (minor / 100).toFixed(2)
}

function majorToMinor(raw: string): number {
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100)
}

function MoneyMinorField({
  label,
  hint,
  valueMinor,
  onChangeMinor,
}: {
  label: string
  hint?: string
  valueMinor: number
  onChangeMinor: (minor: number) => void
}) {
  const major = valueMinor / 100
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{label}</span>
      <input
        type="number"
        min={0}
        step="0.01"
        className={inputCls}
        value={minorToMajor(valueMinor)}
        onChange={(e) => onChangeMinor(majorToMinor(e.target.value))}
      />
      <p className={`${adminHintCls} mt-1 mb-0`}>
        {hint ?? 'Decimal input is converted to minor units on save.'}
        <br />
        Preview: {moneyPreviewFmt.USD.format(major)} · {moneyPreviewFmt.EUR.format(major)} ·{' '}
        {moneyPreviewFmt.GBP.format(major)}
      </p>
    </div>
  )
}

export default function RulesEditor({
  bonusTypeId,
  rules,
  onRulesChange,
  termsText,
  onTermsTextChange,
  playerHeroImageUrl = '',
  onPlayerHeroImageUrlChange = () => {},
  uploadFile,
  showTerms = true,
  apiFetch,
}: Props) {
  const r = useMemo(() => asRec(rules), [rules])

  const patch = (next: Record<string, unknown>) => {
    onRulesChange({ ...r, ...next })
  }

  if (bonusTypeId === 'custom') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <strong>Custom</strong> offers cannot use the visual rule builder. Pick a standard bonus type, or duplicate an
        existing version from Operations.
      </div>
    )
  }

  if (isDepositFamily(bonusTypeId)) {
    const t = asTrig(r)
    const rw = asRew(r)
    const w = asWag(r)
    const excluded = Array.isArray(r.excluded_game_ids) ? (r.excluded_game_ids as string[]) : []
    const allowed = Array.isArray(r.allowed_game_ids) ? (r.allowed_game_ids as string[]) : []

    const setTrigger = (k: string, v: unknown) =>
      patch({ trigger: { ...t, type: 'deposit', channels: Array.isArray(t.channels) ? t.channels : [], [k]: v } })
    const setReward = (k: string, v: unknown) => patch({ reward: { ...rw, [k]: v } })
    const setWagering = (k: string, v: unknown) => patch({ wagering: { ...w, [k]: v } })

    return (
      <div className="space-y-6">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Deposit trigger
          </h4>
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            {bonusTypeId === 'deposit_match' ? (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={!!t.first_deposit_only}
                  onChange={(e) => setTrigger('first_deposit_only', e.target.checked)}
                />
                First deposit only
              </label>
            ) : null}
            <div>
              <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Nth deposit (0 = any)</span>
              <input
                type="number"
                min={0}
                className={inputCls}
                value={typeof t.nth_deposit === 'number' ? t.nth_deposit : 0}
                onChange={(e) => setTrigger('nth_deposit', parseInt(e.target.value, 10) || 0)}
              />
            </div>
            <div>
              <MoneyMinorField
                label="Min deposit"
                hint="Minimum qualifying deposit."
                valueMinor={typeof t.min_minor === 'number' ? t.min_minor : 0}
                onChangeMinor={(n) => setTrigger('min_minor', n)}
              />
            </div>
            <div>
              <MoneyMinorField
                label="Max deposit"
                hint="Set 0 for no maximum."
                valueMinor={typeof t.max_minor === 'number' ? t.max_minor : 0}
                onChangeMinor={(n) => setTrigger('max_minor', n)}
              />
            </div>
            <p className={`${adminHintCls} sm:col-span-2`}>
              Deposit bonuses qualify when a deposit is <strong>credited to the player ledger</strong> (PassimPay
              settlement). Trigger filters below apply to that event.
            </p>
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Reward</h4>
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            {bonusTypeId === 'composite_match_and_fs' ? (
              <>
                <div className="sm:col-span-2">
                  <SliderField
                    label="Match %"
                    hint="Percentage of qualifying deposit credited as bonus."
                    min={0}
                    max={200}
                    value={typeof rw.percent === 'number' ? rw.percent : 0}
                    onChange={(n) => setReward('percent', n)}
                    formatDisplay={(n) => `${n}%`}
                  />
                </div>
                <div>
                  <MoneyMinorField
                    label="Bonus cap"
                    valueMinor={typeof rw.cap_minor === 'number' ? rw.cap_minor : 0}
                    onChangeMinor={(n) => setReward('cap_minor', n)}
                  />
                </div>
              </>
            ) : bonusTypeId !== 'free_spins_only' ? (
              <>
                <div className="sm:col-span-2">
                  <SliderField
                    label="Match %"
                    hint="Percentage of qualifying deposit credited as bonus."
                    min={0}
                    max={200}
                    value={typeof rw.percent === 'number' ? rw.percent : 0}
                    onChange={(n) => setReward('percent', n)}
                    formatDisplay={(n) => `${n}%`}
                  />
                </div>
                <div>
                  <MoneyMinorField
                    label="Bonus cap"
                    valueMinor={typeof rw.cap_minor === 'number' ? rw.cap_minor : 0}
                    onChangeMinor={(n) => setReward('cap_minor', n)}
                  />
                </div>
              </>
            ) : null}
          </div>
        </div>

        {bonusTypeId === 'free_spins_only' && apiFetch ? (
          <FreeSpinsRewardSection
            apiFetch={apiFetch}
            variant="reward"
            rounds={typeof rw.rounds === 'number' ? rw.rounds : 20}
            gameId={typeof rw.game_id === 'string' ? rw.game_id : ''}
            betPerRoundMinor={typeof rw.bet_per_round_minor === 'number' ? rw.bet_per_round_minor : 1}
            onChange={(p) =>
              patch({
                reward: {
                  ...rw,
                  type: 'freespins',
                  percent: 0,
                  cap_minor: 0,
                  fixed_minor: 0,
                  rounds: p.rounds ?? (typeof rw.rounds === 'number' ? rw.rounds : 20),
                  game_id: p.game_id ?? (typeof rw.game_id === 'string' ? rw.game_id : ''),
                  bet_per_round_minor:
                    p.bet_per_round_minor ??
                    (typeof rw.bet_per_round_minor === 'number' ? rw.bet_per_round_minor : 1),
                },
              })
            }
          />
        ) : bonusTypeId === 'free_spins_only' && !apiFetch ? (
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Free spins editor requires catalog access. Open rules from the bonus wizard or catalog with a logged-in admin
            session.
          </p>
        ) : null}

        {bonusTypeId === 'composite_match_and_fs' && apiFetch ? (
          <FreeSpinsRewardSection
            apiFetch={apiFetch}
            variant="free_spins_block"
            rounds={asFreeSpins(r).rounds}
            gameId={asFreeSpins(r).game_id}
            betPerRoundMinor={asFreeSpins(r).bet_per_round_minor}
            onChange={(p) => {
              const cur = asFreeSpins(r)
              patch({
                free_spins: {
                  rounds: p.rounds ?? cur.rounds,
                  game_id: p.game_id ?? cur.game_id,
                  bet_per_round_minor: p.bet_per_round_minor ?? cur.bet_per_round_minor,
                },
              })
            }}
          />
        ) : bonusTypeId === 'composite_match_and_fs' && !apiFetch ? (
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Composite free spins editor requires catalog access (game list API).
          </p>
        ) : null}

        <div className="space-y-8">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Wagering
            </h4>
            <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <SliderField
                  label="Wagering multiplier"
                  hint="Bonus + deposit must be wagered this many times (typical 20–50)."
                  min={1}
                  max={80}
                  value={typeof w.multiplier === 'number' ? w.multiplier : 1}
                  onChange={(n) => setWagering('multiplier', n)}
                />
              </div>
              <div className="sm:col-span-2">
                <MoneyMinorField
                  label="Max bet while wagering"
                  valueMinor={typeof w.max_bet_minor === 'number' ? w.max_bet_minor : 0}
                  onChangeMinor={(n) => setWagering('max_bet_minor', n)}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-8 dark:border-gray-700">
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
              Blocklist — excluded from wagering
            </h4>
            <p className="mb-3 max-w-2xl text-xs text-gray-500 dark:text-gray-400">
              These titles never count toward clearing the bonus. Configure this first if you use both blocklist and
              allow-only lists.
            </p>
            {apiFetch ? (
              <GameExcludePicker
                apiFetch={apiFetch}
                selectedIds={excluded}
                onChange={(ids) => patch({ excluded_game_ids: ids })}
                mode="exclude"
              />
            ) : (
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Game picker unavailable (missing api client). Use Operations from a page that loads the editor with catalog
                access.
              </p>
            )}
          </div>

          <div className="border-t border-gray-200 pt-8 dark:border-gray-700">
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
              Allow-only list — restrict wagering to selected games
            </h4>
            <p className="mb-3 max-w-2xl text-xs text-gray-500 dark:text-gray-400">
              Optional. When this list is non-empty, <strong>only</strong> checked games advance wagering; everything else
              does not. Leave empty to use “any game except blocklist” behavior.
            </p>
            {apiFetch ? (
              <GameExcludePicker
                apiFetch={apiFetch}
                selectedIds={allowed}
                onChange={(ids) => patch({ allowed_game_ids: ids })}
                mode="allow_only"
              />
            ) : (
              <p className="text-xs text-amber-800 dark:text-amber-300">Game picker unavailable (missing api client).</p>
            )}
          </div>
        </div>

        {apiFetch ? (
          <SegmentTargetingSection
            apiFetch={apiFetch}
            rules={rules}
            onPatch={(partial) => patch(partial)}
            onPatchTrigger={(tp) =>
              patch({
                trigger: {
                  ...t,
                  type: 'deposit',
                  channels: Array.isArray(t.channels) ? t.channels : [],
                  ...tp,
                },
              })
            }
          />
        ) : null}

        {showTerms ? (
          <>
            <PromoHeroImageBlock
              value={playerHeroImageUrl}
              onChange={onPlayerHeroImageUrlChange}
              uploadFile={uploadFile}
            />
            <div>
              <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Terms (optional)</span>
              <textarea
                className={`${inputCls} min-h-[80px]`}
                value={termsText}
                onChange={(e) => onTermsTextChange(e.target.value)}
                placeholder="Short player-facing terms for this version"
              />
            </div>
          </>
        ) : null}
      </div>
    )
  }

  if (isScheduleFamily(bonusTypeId)) {
    const rw = asRew(r)
    const w = asWag(r)
    const setReward = (k: string, v: unknown) => patch({ reward: { ...rw, [k]: v } })
    const setWagering = (k: string, v: unknown) => patch({ wagering: { ...w, [k]: v } })
    return (
      <div className="space-y-6">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Scheduled offer — trigger uses the <code className="rounded bg-gray-100 px-1 text-xs dark:bg-white/10">schedule</code>{' '}
          type. Timing is controlled elsewhere; amounts below set the reward shape.
        </p>
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <SliderField
              label={bonusTypeId === 'cashback_net_loss' ? 'Cashback %' : 'Rebate %'}
              min={0}
              max={100}
              value={typeof rw.percent === 'number' ? rw.percent : 0}
              onChange={(n) => setReward('percent', n)}
              formatDisplay={(n) => `${n}%`}
            />
          </div>
          <div>
            <MoneyMinorField
              label="Cap"
              valueMinor={typeof rw.cap_minor === 'number' ? rw.cap_minor : 0}
              onChangeMinor={(n) => setReward('cap_minor', n)}
            />
          </div>
          <div className="sm:col-span-2">
            <SliderField
              label="Wagering multiplier"
              min={1}
              max={80}
              value={typeof w.multiplier === 'number' ? w.multiplier : 1}
              onChange={(n) => setWagering('multiplier', n)}
            />
          </div>
          <div>
            <MoneyMinorField
              label="Max bet while wagering"
              valueMinor={typeof w.max_bet_minor === 'number' ? w.max_bet_minor : 0}
              onChangeMinor={(n) => setWagering('max_bet_minor', n)}
            />
          </div>
        </div>
        {showTerms ? (
          <>
            <PromoHeroImageBlock
              value={playerHeroImageUrl}
              onChange={onPlayerHeroImageUrlChange}
              uploadFile={uploadFile}
            />
            <div>
              <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Terms (optional)</span>
              <textarea
                className={`${inputCls} min-h-[80px]`}
                value={termsText}
                onChange={(e) => onTermsTextChange(e.target.value)}
              />
            </div>
          </>
        ) : null}
      </div>
    )
  }

  if (bonusTypeId === 'no_deposit') {
    const rw = asRew(r)
    const w = asWag(r)
    const setReward = (k: string, v: unknown) => patch({ reward: { ...rw, [k]: v } })
    const setWagering = (k: string, v: unknown) => patch({ wagering: { ...w, [k]: v } })
    return (
      <div className="space-y-6">
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <div>
            <MoneyMinorField
              label="Fixed credit"
              valueMinor={typeof rw.fixed_minor === 'number' ? rw.fixed_minor : 0}
              onChangeMinor={(n) => setReward('fixed_minor', n)}
            />
          </div>
          <div className="sm:col-span-2">
            <SliderField
              label="Wagering multiplier"
              min={1}
              max={80}
              value={typeof w.multiplier === 'number' ? w.multiplier : 1}
              onChange={(n) => setWagering('multiplier', n)}
            />
          </div>
          <div>
            <MoneyMinorField
              label="Max bet while wagering"
              valueMinor={typeof w.max_bet_minor === 'number' ? w.max_bet_minor : 0}
              onChangeMinor={(n) => setWagering('max_bet_minor', n)}
            />
          </div>
        </div>
        {showTerms ? (
          <>
            <PromoHeroImageBlock
              value={playerHeroImageUrl}
              onChange={onPlayerHeroImageUrlChange}
              uploadFile={uploadFile}
            />
            <div>
              <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Terms (optional)</span>
              <textarea
                className={`${inputCls} min-h-[80px]`}
                value={termsText}
                onChange={(e) => onTermsTextChange(e.target.value)}
              />
            </div>
          </>
        ) : null}
      </div>
    )
  }

  return (
    <p className="text-sm text-gray-600 dark:text-gray-300">
      Unknown bonus type <code className="rounded bg-gray-100 px-1 text-xs dark:bg-white/10">{bonusTypeId}</code>. Select a
      type in the wizard or reload this page.
    </p>
  )
}
