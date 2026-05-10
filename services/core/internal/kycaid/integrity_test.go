package kycaid

import "testing"

func TestVerifyCallbackIntegrity_KYCAIDDocVector(t *testing.T) {
	raw := []byte(`{"request_id":"61a7dbcc012d9042e909cf006e7b412d6ba5","type":"VERIFICATION_STATUS_CHANGED","applicant_id":"4141cc1b18dba048470b2961cb4592f480fe","verification_id":"2cf795e713be1040e50b202164ee17bfdfbe","form_id":"58bed87600dd9944f02ba0c9cd8b32d6bd4c","verification_status":"pending"}`)
	token := "28c6f7cc0345a04eee0b535039b1c5a62547"
	hdr := "f7681b097b77928fc031d614709976796057c306cf77fdd449bb414937bd87678d908d7efaa65e9b1dd65b9eeea2121ea75bd9007f44fe8fcd7c9ac6cdeeef0e"
	if !VerifyCallbackIntegrity(raw, token, hdr) {
		t.Fatal("expected KYCAID documentation vector to verify")
	}
	if VerifyCallbackIntegrity(raw, token, hdr+"aa") {
		t.Fatal("tampered header must fail")
	}
}
