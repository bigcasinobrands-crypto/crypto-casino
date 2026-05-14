package ledger

// NGRReportingFilterSQL returns AND-predicates for ledger alias leAlias so that
// production dashboard NGR/GGR excludes:
//   - ledger test entry types (e.g. contract tests writing test.seed)
//   - BlueOcean S2S compatibility "debit reset" balance corrections posted as game.credit
//     (idempotency_key contains :debit_reset: — not player win economics)
//   - users flagged exclude_from_dashboard_analytics (BO sandbox / internal testers)
//
// House provider.fee rows must remain visible even if a misconfigured house user
// were ever flagged, so those lines bypass the user exclusion.
//
// Time window must still be applied separately (typically le.created_at).
func NGRReportingFilterSQL(leAlias string) string {
	return `(
		` + leAlias + `.entry_type <> 'test.seed'
		AND NOT (` + leAlias + `.entry_type = 'game.credit' AND ` + leAlias + `.idempotency_key LIKE '%:debit_reset:%')
		AND (
			` + leAlias + `.entry_type = 'provider.fee'
			OR NOT EXISTS (
				SELECT 1 FROM users u_ngr_ex
				WHERE u_ngr_ex.id = ` + leAlias + `.user_id
				AND COALESCE(u_ngr_ex.exclude_from_dashboard_analytics, false)
			)
		)
	)`
}
