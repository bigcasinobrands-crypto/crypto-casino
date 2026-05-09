package blueocean

import (
	"fmt"
	"strings"
)

// NormalizeGetDailyReportParams maps legacy/wrong keys to BO public getDailyReport request fields.
// Docs: single calendar date `date` (Y-m-d), optional `associateid` (default 0). Date must not be "today" (enforced by BO).
// See Reports - Wallet → 7.2 getDailyReport().
func NormalizeGetDailyReportParams(params map[string]any) {
	if params == nil {
		return
	}
	if !paramNonemptyBOString(params["date"]) {
		if paramNonemptyBOString(params["date_start"]) {
			ds := strings.TrimSpace(fmt.Sprint(params["date_start"]))
			if len(ds) >= 10 {
				params["date"] = ds[:10]
			} else {
				params["date"] = ds
			}
		}
	}
	delete(params, "date_start")
	delete(params, "date_end")
	delete(params, "status")
	if _, has := params["associateid"]; !has {
		if v, has2 := params["associateId"]; has2 {
			params["associateid"] = v
			delete(params, "associateId")
		}
	}
}

// NormalizeGetGameHistoryParams aligns keys with BO REST examples for getGameHistory (Reports - Wallet → 5.4).
// Required on wire: user_username, user_password, date_start (Y-m-d H:i:s UTC). Example uses gameid (not game_id).
func NormalizeGetGameHistoryParams(params map[string]any) {
	if params == nil {
		return
	}
	if !paramNonemptyBOString(params["gameid"]) {
		if paramNonemptyBOString(params["game_id"]) {
			params["gameid"] = strings.TrimSpace(fmt.Sprint(params["game_id"]))
		}
	}
	delete(params, "game_id")
	// BO's REST sample uses `vendor`; param table uses `provider` (2-char). Send vendor when only provider is set.
	if paramNonemptyBOString(params["provider"]) && !paramNonemptyBOString(params["vendor"]) {
		params["vendor"] = strings.TrimSpace(fmt.Sprint(params["provider"]))
	}
	delete(params, "userid")
}
