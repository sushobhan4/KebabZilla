package security

import (
	"strings"
	"testing"

	"github.com/kebabzilla/go-backend/config"
	"github.com/kebabzilla/go-backend/models"
)

func TestPasswordHashingAndVerification(t *testing.T) {
	password := "SecurePassword123!"

	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("Failed to hash password: %v", err)
	}

	if !strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=1,p=4$") {
		t.Errorf("Unexpected hash prefix: %s", hash)
	}

	if !VerifyPassword(password, hash) {
		t.Errorf("VerifyPassword returned false for correct password")
	}

	if VerifyPassword("WrongPassword", hash) {
		t.Errorf("VerifyPassword returned true for incorrect password")
	}
}

func TestVerifyFastAPIBase64Password(t *testing.T) {
	// Standard FastAPI passlib/pwdlib Argon2id hash format with base64 encoded salt and hash
	// $argon2id$v=19$m=65536,t=1,p=4$c29tZXNhbHQ$dGVzdGhhc2h0ZXN0aGFzaA
	// We can test that decodeSaltOrHash correctly decodes base64
	salt, err := decodeSaltOrHash("c29tZXNhbHQ")
	if err != nil {
		t.Fatalf("Failed to decode base64 salt: %v", err)
	}
	if string(salt) != "somesalt" {
		t.Errorf("Expected salt 'somesalt', got '%s'", string(salt))
	}
}

func TestTokenGenerationAndHashing(t *testing.T) {
	tok1 := GenerateSecureToken(32)
	tok2 := GenerateSecureToken(32)

	if len(tok1) != 64 {
		t.Errorf("Expected hex length 64 for 32 bytes, got %d", len(tok1))
	}

	if tok1 == tok2 {
		t.Errorf("Generated tokens should be unique")
	}

	h1 := HashToken(tok1)
	h2 := HashToken(tok1)
	if h1 != h2 {
		t.Errorf("HashToken should be deterministic")
	}

	if h1 == HashToken(tok2) {
		t.Errorf("Different tokens should produce different hashes")
	}
}

func TestDeviceFingerprinting(t *testing.T) {
	ua1 := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.60 Safari/537.36"
	ua2 := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.9999.99 Safari/537.36"

	// Both patch versions of Chrome 124 should produce identical normalized UAs
	norm1 := normalizeUserAgent(ua1)
	norm2 := normalizeUserAgent(ua2)
	if norm1 != norm2 {
		t.Errorf("Normalized UAs should match across patch versions: %s vs %s", norm1, norm2)
	}

	fp1 := ComputeCompositeDeviceFingerprint("hardware-sig-123", ua1)
	fp2 := ComputeCompositeDeviceFingerprint("hardware-sig-123", ua2)
	if fp1 != fp2 {
		t.Errorf("Device fingerprints should match for identical hardware and normalized browser: %s vs %s", fp1, fp2)
	}

	fp3 := ComputeCompositeDeviceFingerprint("hardware-sig-different", ua1)
	if fp1 == fp3 {
		t.Errorf("Different hardware signatures should produce different fingerprints")
	}
}

func TestJWTAccessToken(t *testing.T) {
	cfg := &config.Config{
		JWTSecret:          "super-secret-test-key-32-bytes-long!",
		AccessTokenSeconds: 120,
	}

	token, err := CreateAccessToken(42, 101, models.RoleAdmin, cfg)
	if err != nil {
		t.Fatalf("Failed to create access token: %v", err)
	}

	claims, err := ParseAccessToken(token, cfg)
	if err != nil {
		t.Fatalf("Failed to parse valid access token: %v", err)
	}

	if claims.AccountID != 42 {
		t.Errorf("Expected AccountID 42, got %d", claims.AccountID)
	}
	if claims.SessionID != 101 {
		t.Errorf("Expected SessionID 101, got %d", claims.SessionID)
	}
	if claims.Role != string(models.RoleAdmin) {
		t.Errorf("Expected Role ADMIN, got %s", claims.Role)
	}
	if claims.Type != "access" {
		t.Errorf("Expected Type 'access', got %s", claims.Type)
	}

	// Test with invalid secret
	wrongCfg := &config.Config{
		JWTSecret: "completely-different-wrong-secret-key!",
	}
	_, err = ParseAccessToken(token, wrongCfg)
	if err == nil {
		t.Errorf("ParseAccessToken should fail with wrong secret")
	}
}

func Test2FASecurityHelpers(t *testing.T) {
	jwtSecret := "test-secret-key-for-2fa-testing"
	otp := GenerateOTP(6)
	if len(otp) != 6 {
		t.Errorf("Expected 6 digit OTP, got length %d", len(otp))
	}
	for _, c := range otp {
		if c < '0' || c > '9' {
			t.Errorf("OTP contains non-digit character: %c", c)
		}
	}

	hashed := Hash2FACode(otp, jwtSecret)
	if !Verify2FACode(otp, hashed, jwtSecret) {
		t.Errorf("Verify2FACode returned false for valid code")
	}

	if Verify2FACode("000000", hashed, jwtSecret) && otp != "000000" {
		t.Errorf("Verify2FACode returned true for invalid code")
	}

	tempTok := Generate2FATempToken()
	if tempTok == "" {
		t.Errorf("Generate2FATempToken returned empty string")
	}
	hashedTemp := Hash2FATempToken(tempTok)
	if hashedTemp != Hash2FATempToken(tempTok) {
		t.Errorf("Hash2FATempToken is not deterministic")
	}
}
