package raffle

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const drawAlgorithmVersion = "v1.weighted_hmac_sha256"

type participant struct {
	UserID  string
	Tickets int64
}

type prizeSlot struct {
	PrizeID   string
	PrizeType string
	Amount    int64
	Currency  string
	AutoPay   bool
	NeedsApr  bool
	RankOrder int
}

// LockDraw freezes ticket earning by moving campaign to drawing and creates a pending draw row with hashed seed material in proof_metadata.
func LockDraw(ctx context.Context, pool *pgxpool.Pool, campaignID string, staffID string) (drawID string, err error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var status string
	var endAt time.Time
	err = tx.QueryRow(ctx, `SELECT status, end_at FROM raffle_campaigns WHERE id = $1::uuid FOR UPDATE`, campaignID).Scan(&status, &endAt)
	if err != nil {
		return "", err
	}
	if status != "active" {
		return "", fmt.Errorf("campaign_not_active")
	}
	if time.Now().UTC().Before(endAt.UTC()) {
		return "", fmt.Errorf("raffle_not_ended")
	}

	var pendingID string
	err = tx.QueryRow(ctx, `
		SELECT id::text FROM raffle_draws
		WHERE campaign_id = $1::uuid AND status = 'pending'
		ORDER BY created_at DESC LIMIT 1
	`, campaignID).Scan(&pendingID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if pendingID != "" {
		drawID = pendingID
	} else {
		seed := make([]byte, 32)
		if _, err := rand.Read(seed); err != nil {
			return "", err
		}
		sum := sha256.Sum256(seed)
		proof := map[string]any{"server_seed_hex": hex.EncodeToString(seed)}
		pj, _ := json.Marshal(proof)
		hashHex := hex.EncodeToString(sum[:])
		var execStaff any
		if strings.TrimSpace(staffID) != "" {
			execStaff = staffID
		}
		err = tx.QueryRow(ctx, `
			INSERT INTO raffle_draws (
			  campaign_id, status, server_seed_hash, proof_metadata, executed_by_staff_id, algorithm_version
			) VALUES (
			  $1::uuid, 'pending', $2, $3::jsonb, $4::uuid, $5
			) RETURNING id::text
		`, campaignID, hashHex, pj, execStaff, drawAlgorithmVersion).Scan(&drawID)
		if err != nil {
			return "", err
		}
	}

	if _, err := tx.Exec(ctx, `UPDATE raffle_campaigns SET status = 'drawing', updated_at = now() WHERE id = $1::uuid`, campaignID); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return drawID, nil
}

func uniformTicketPick(finalSeed []byte, drawID string, pickIdx int, ceil int64) int64 {
	if ceil <= 0 {
		return 0
	}
	mac := hmac.New(sha256.New, finalSeed)
	fmt.Fprintf(mac, "v1|%s|%d", drawID, pickIdx)
	sum := mac.Sum(nil)
	var buf [8]byte
	copy(buf[:], sum)
	v := binary.BigEndian.Uint64(buf[:])
	return int64(v%uint64(ceil)) + 1
}

func pickWeighted(participants []participant, ticketPick int64) string {
	var acc int64
	for _, p := range participants {
		if p.Tickets <= 0 {
			continue
		}
		acc += p.Tickets
		if ticketPick <= acc {
			return p.UserID
		}
	}
	if len(participants) == 0 {
		return ""
	}
	return participants[len(participants)-1].UserID
}

// RunDraw executes weighted winner selection and persists raffle_winners (same transaction).
func RunDraw(ctx context.Context, pool *pgxpool.Pool, campaignID, drawID string, staffID string) error {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var campStatus string
	var endAt time.Time
	var maxWinsPerUser int
	err = tx.QueryRow(ctx, `
		SELECT status, end_at, max_wins_per_user FROM raffle_campaigns WHERE id = $1::uuid FOR UPDATE
	`, campaignID).Scan(&campStatus, &endAt, &maxWinsPerUser)
	if err != nil {
		return err
	}
	if campStatus != "drawing" {
		return fmt.Errorf("campaign_not_drawing")
	}
	if time.Now().UTC().Before(endAt.UTC()) {
		return fmt.Errorf("raffle_not_ended")
	}

	var drawStatus string
	var proofRaw []byte
	var externalEntropy string
	err = tx.QueryRow(ctx, `
		SELECT status, COALESCE(proof_metadata, '{}'::jsonb), COALESCE(external_entropy, '')
		FROM raffle_draws WHERE id = $1::uuid AND campaign_id = $2::uuid FOR UPDATE
	`, drawID, campaignID).Scan(&drawStatus, &proofRaw, &externalEntropy)
	if err != nil {
		return err
	}
	if drawStatus != "pending" {
		return fmt.Errorf("draw_not_pending")
	}

	var proof map[string]any
	if json.Unmarshal(proofRaw, &proof) != nil {
		return fmt.Errorf("invalid_draw_proof")
	}
	seedHex, _ := proof["server_seed_hex"].(string)
	seedBytes, err := hex.DecodeString(strings.TrimSpace(seedHex))
	if err != nil || len(seedBytes) == 0 {
		return fmt.Errorf("invalid_server_seed")
	}

	noise := make([]byte, 16)
	if _, err := rand.Read(noise); err != nil {
		return err
	}
	externalEntropy = hex.EncodeToString(noise)

	rows, err := tx.Query(ctx, `
		SELECT user_id::text, total_tickets FROM raffle_user_totals
		WHERE campaign_id = $1::uuid AND total_tickets > 0
	`, campaignID)
	if err != nil {
		return err
	}
	var base []participant
	var grandTotal int64
	for rows.Next() {
		var uid string
		var tot int64
		if err := rows.Scan(&uid, &tot); err != nil {
			rows.Close()
			return err
		}
		base = append(base, participant{UserID: uid, Tickets: tot})
		grandTotal += tot
	}
	rows.Close()
	sort.Slice(base, func(i, j int) bool { return base[i].UserID < base[j].UserID })

	if grandTotal <= 0 || len(base) == 0 {
		var execStaff any
		if strings.TrimSpace(staffID) != "" {
			execStaff = staffID
		}
		_, _ = tx.Exec(ctx, `
			UPDATE raffle_draws SET status = 'failed', failed_at = now(), failure_reason = 'no_tickets',
			  external_entropy = $3, updated_at = now(), executed_by_staff_id = COALESCE($4::uuid, executed_by_staff_id)
			WHERE id = $1::uuid AND campaign_id = $2::uuid
		`, drawID, campaignID, externalEntropy, execStaff)
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		return fmt.Errorf("no_tickets")
	}

	prows, err := tx.Query(ctx, `
		SELECT id::text, prize_type, amount_minor, currency, winner_slots, rank_order, auto_payout, requires_approval
		FROM raffle_prizes WHERE campaign_id = $1::uuid ORDER BY rank_order ASC, id ASC
	`, campaignID)
	if err != nil {
		return err
	}
	var slots []prizeSlot
	for prows.Next() {
		var id, ptype, ccy string
		var amount int64
		var slotsN, rank int
		var autoPay, reqApr bool
		if err := prows.Scan(&id, &ptype, &amount, &ccy, &slotsN, &rank, &autoPay, &reqApr); err != nil {
			prows.Close()
			return err
		}
		for i := 0; i < slotsN; i++ {
			slots = append(slots, prizeSlot{
				PrizeID: id, PrizeType: ptype, Amount: amount, Currency: ccy,
				AutoPay: autoPay, NeedsApr: reqApr, RankOrder: rank,
			})
		}
	}
	prows.Close()
	if len(slots) == 0 {
		_, _ = tx.Exec(ctx, `
			UPDATE raffle_draws SET status = 'failed', failed_at = now(), failure_reason = 'no_prizes',
			  external_entropy = $3, updated_at = now()
			WHERE id = $1::uuid AND campaign_id = $2::uuid
		`, drawID, campaignID, externalEntropy)
		_ = tx.Commit(ctx)
		return fmt.Errorf("no_prizes")
	}

	hFinal := sha256.New()
	hFinal.Write(seedBytes)
	fmt.Fprintf(hFinal, "|%s|%s|%d|%s", campaignID, drawID, grandTotal, externalEntropy)
	finalSeed := hFinal.Sum(nil)

	winCounts := map[string]int{}
	rankSlot := 1
	for i := range slots {
		eligible := make([]participant, 0)
		var poolTotal int64
		for _, p := range base {
			if p.Tickets <= 0 {
				continue
			}
			wc := winCounts[p.UserID]
			if maxWinsPerUser <= 1 {
				if wc >= 1 {
					continue
				}
			} else if maxWinsPerUser > 1 && wc >= maxWinsPerUser {
				continue
			}
			eligible = append(eligible, p)
			poolTotal += p.Tickets
		}
		if poolTotal <= 0 {
			return fmt.Errorf("no_eligible_participants")
		}
		ticketNo := uniformTicketPick(finalSeed, drawID, i, poolTotal)
		uid := pickWeighted(eligible, ticketNo)
		if uid == "" {
			return fmt.Errorf("pick_failed")
		}
		winCounts[uid]++

		ps := slots[i]
		payoutSt := "pending"
		if ps.PrizeType != "cash" || ps.NeedsApr || !ps.AutoPay {
			payoutSt = "manual"
		}
		ledgerIdem := fmt.Sprintf("raffle:prize:%s:%s:%d", campaignID, drawID, rankSlot)
		metaWinner := map[string]any{
			"pick_index": i, "ticket_no": ticketNo, "pool_total": poolTotal,
			"algorithm": drawAlgorithmVersion,
		}
		mj, _ := json.Marshal(metaWinner)
		_, err = tx.Exec(ctx, `
			INSERT INTO raffle_winners (
			  campaign_id, draw_id, user_id, rank_slot, prize_id, prize_type,
			  prize_amount_minor, prize_currency, payout_status, ledger_idempotency_key, published, metadata
			) VALUES (
			  $1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6,
			  $7, $8, $9, $10, false, $11::jsonb
			)
		`, campaignID, drawID, uid, rankSlot, ps.PrizeID, ps.PrizeType, ps.Amount, ps.Currency, payoutSt, ledgerIdem, mj)
		if err != nil {
			return err
		}
		rankSlot++
	}

	proof["final_seed_hex"] = hex.EncodeToString(finalSeed)
	proof["total_tickets_at_draw"] = grandTotal
	proof["participants"] = len(base)
	pj, _ := json.Marshal(proof)

	var execStaff any
	if strings.TrimSpace(staffID) != "" {
		execStaff = staffID
	}
	_, err = tx.Exec(ctx, `
		UPDATE raffle_draws SET
		  status = 'completed',
		  started_at = COALESCE(started_at, now()),
		  completed_at = now(),
		  total_tickets = $3,
		  total_participants = $4,
		  external_entropy = $5,
		  final_seed_hash = $6,
		  server_seed_revealed = $7,
		  algorithm_version = $8,
		  proof_metadata = $9::jsonb,
		  updated_at = now(),
		  executed_by_staff_id = COALESCE($10::uuid, executed_by_staff_id)
		WHERE id = $1::uuid AND campaign_id = $2::uuid
	`, drawID, campaignID, grandTotal, len(base), externalEntropy, hex.EncodeToString(finalSeed),
		seedHex, drawAlgorithmVersion, pj, execStaff)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// PublishWinners marks winners visible and transitions draw/campaign to terminal states.
func PublishWinners(ctx context.Context, pool *pgxpool.Pool, campaignID, drawID string, staffID string) error {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var st string
	err = tx.QueryRow(ctx, `SELECT status FROM raffle_draws WHERE id = $1::uuid AND campaign_id = $2::uuid FOR UPDATE`, drawID, campaignID).Scan(&st)
	if err != nil {
		return err
	}
	if st != "completed" {
		return fmt.Errorf("draw_not_completed")
	}
	if _, err := tx.Exec(ctx, `UPDATE raffle_winners SET published = true WHERE draw_id = $1::uuid`, drawID); err != nil {
		return err
	}
	var execStaff any
	if strings.TrimSpace(staffID) != "" {
		execStaff = staffID
	}
	if _, err := tx.Exec(ctx, `
		UPDATE raffle_draws SET status = 'published', updated_at = now(),
		  executed_by_staff_id = COALESCE($3::uuid, executed_by_staff_id)
		WHERE id = $1::uuid AND campaign_id = $2::uuid
	`, drawID, campaignID, execStaff); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE raffle_campaigns SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
		WHERE id = $1::uuid
	`, campaignID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
