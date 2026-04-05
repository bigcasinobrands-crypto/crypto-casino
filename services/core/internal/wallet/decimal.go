package wallet

import "strconv"

// minorToDecimalString renders integer minor units as a decimal string with fixed fractional digits.
func minorToDecimalString(min int64, decimals int) string {
	if decimals <= 0 {
		return strconv.FormatInt(min, 10)
	}
	neg := min < 0
	if neg {
		min = -min
	}
	var pow int64 = 1
	for i := 0; i < decimals; i++ {
		pow *= 10
	}
	whole := min / pow
	frac := min % pow
	fs := strconv.FormatInt(frac, 10)
	for len(fs) < decimals {
		fs = "0" + fs
	}
	out := strconv.FormatInt(whole, 10) + "." + fs
	if neg {
		return "-" + out
	}
	return out
}
