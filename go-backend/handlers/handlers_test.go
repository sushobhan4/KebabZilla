package handlers

import (
	"testing"
	"time"

	"github.com/kebabzilla/go-backend/models"
)

func TestFormatNextOrderID(t *testing.T) {
	prefix := "261024"

	// 1. Initial ID should be 261024001
	id1 := FormatNextOrderID(prefix, []string{})
	if id1 != "261024001" {
		t.Fatalf("expected 261024001, got %s", id1)
	}

	// 2. Increments from highest existing
	id2 := FormatNextOrderID(prefix, []string{"261024001"})
	if id2 != "261024002" {
		t.Fatalf("expected 261024002, got %s", id2)
	}

	id3 := FormatNextOrderID(prefix, []string{"261024001", "261024002", "261024045"})
	if id3 != "261024046" {
		t.Fatalf("expected 261024046, got %s", id3)
	}

	// 3. Dynamic padding past 999
	id1000 := FormatNextOrderID(prefix, []string{"261024999"})
	if id1000 != "2610241000" {
		t.Fatalf("expected 2610241000, got %s", id1000)
	}

	id10000 := FormatNextOrderID(prefix, []string{"2610249999"})
	if id10000 != "26102410000" {
		t.Fatalf("expected 26102410000, got %s", id10000)
	}
}

func TestFormatOrderResponseOpts(t *testing.T) {
	otp := "749201"
	driverName := "Rider Dave"
	driverPhone := "+919876543210"
	driver := &models.Account{
		ID:    42,
		Name:  driverName,
		Phone: &driverPhone,
		Role:  models.RoleDelivery,
	}

	custEmail := "customer@example.com"
	custName := "Rahul Bose"
	order := models.Order{
		OrderID:               "261024001",
		CustomerName:          &custName,
		Status:                models.OrderStatusOutForDelivery,
		DeliveryOTPCiphertext: &otp,
		AssignedDriver:        driver,
		Customer: &models.Account{
			Email: custEmail,
			Name:  custName,
		},
	}

	// Test case A: Driver view (no OTP, no customer email)
	driverResp := formatOrderResponseOpts(&order, custEmail, false, false)
	if driverResp.DeliveryOTP != nil {
		t.Fatalf("expected DeliveryOTP to be nil for driver view, got %v", *driverResp.DeliveryOTP)
	}
	if driverResp.CustomerEmail != "" {
		t.Fatalf("expected CustomerEmail to be omitted for driver view, got %s", driverResp.CustomerEmail)
	}
	if driverResp.DeliveryName == nil || *driverResp.DeliveryName != driverName {
		t.Fatalf("expected DeliveryName %s, got %v", driverName, driverResp.DeliveryName)
	}

	// Test case B: Customer view (with OTP and customer email)
	custResp := formatOrderResponseOpts(&order, custEmail, true, true)
	if custResp.DeliveryOTP == nil || *custResp.DeliveryOTP != otp {
		t.Fatalf("expected DeliveryOTP to be %s, got %v", otp, custResp.DeliveryOTP)
	}
	if custResp.CustomerEmail != custEmail {
		t.Fatalf("expected CustomerEmail to be %s, got %s", custEmail, custResp.CustomerEmail)
	}

	// Test case C: Status is not OUT_FOR_DELIVERY (OTP must be nil even if includeDeliveryOTP == true)
	order.Status = models.OrderStatusDelivered
	deliveredResp := formatOrderResponseOpts(&order, custEmail, true, true)
	if deliveredResp.DeliveryOTP != nil {
		t.Fatalf("expected DeliveryOTP to be nil for DELIVERED order, got %v", *deliveredResp.DeliveryOTP)
	}
}

func TestVerifyOTPCode(t *testing.T) {
	now := time.Now().UTC()
	future := now.Add(1 * time.Hour)
	past := now.Add(-1 * time.Minute)

	// 1. Correct OTP within expiration
	valid, nextAtt, shouldDel := VerifyOTPCode("482910", "482910", 0, future, now)
	if !valid || !shouldDel || nextAtt != 0 {
		t.Fatalf("expected valid=true, shouldDel=true, nextAtt=0, got valid=%v, shouldDel=%v, nextAtt=%d", valid, shouldDel, nextAtt)
	}

	// 2. Incorrect OTP increments attempt counter
	valid, nextAtt, shouldDel = VerifyOTPCode("111111", "482910", 0, future, now)
	if valid || shouldDel || nextAtt != 1 {
		t.Fatalf("expected valid=false, shouldDel=false, nextAtt=1, got valid=%v, shouldDel=%v, nextAtt=%d", valid, shouldDel, nextAtt)
	}

	// 3. 5th failed attempt should trigger shouldDelete = true
	valid, nextAtt, shouldDel = VerifyOTPCode("111111", "482910", 4, future, now)
	if valid || !shouldDel || nextAtt != 5 {
		t.Fatalf("expected valid=false, shouldDel=true, nextAtt=5, got valid=%v, shouldDel=%v, nextAtt=%d", valid, shouldDel, nextAtt)
	}

	// 4. Already locked out (attempts >= 5)
	valid, _, shouldDel = VerifyOTPCode("482910", "482910", 5, future, now)
	if valid || !shouldDel {
		t.Fatalf("expected locked out OTP to fail verification and delete, got valid=%v, shouldDel=%v", valid, shouldDel)
	}

	// 5. Expired OTP
	valid, _, shouldDel = VerifyOTPCode("482910", "482910", 0, past, now)
	if valid || !shouldDel {
		t.Fatalf("expected expired OTP to fail verification and delete, got valid=%v, shouldDel=%v", valid, shouldDel)
	}
}
