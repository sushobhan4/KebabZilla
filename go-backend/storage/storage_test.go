package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/kebabzilla/go-backend/config"
)

func TestDetectContentType(t *testing.T) {
	cases := []struct {
		filename string
		expected string
	}{
		{"photo.webp", "image/webp"},
		{"photo.png", "image/png"},
		{"photo.jpg", "image/jpeg"},
		{"photo.jpeg", "image/jpeg"},
		{"vector.svg", "image/svg+xml"},
		{"anim.gif", "image/gif"},
		{"photo.avif", "image/avif"},
	}

	for _, c := range cases {
		got := detectContentType(c.filename, nil)
		if got != c.expected {
			t.Errorf("detectContentType(%q) = %q, want %q", c.filename, got, c.expected)
		}
	}
}

func TestStorageManagerLocalFallback(t *testing.T) {
	cfg := &config.Config{
		GCSBucketName:       "kebabzilla_cloud_storage",
		GCSMenuImagesFolder: "menuImages",
	}
	sm := InitStorage(cfg)
	if sm == nil {
		t.Fatal("expected InitStorage to return non-nil manager")
	}

	// Create a temporary file in public/menuImages
	dir := filepath.Join("public", "menuImages")
	_ = os.MkdirAll(dir, 0755)
	testFile := "test-image-local-fallback.png"
	testPath := filepath.Join(dir, testFile)
	testData := []byte("fake-png-data")
	if err := os.WriteFile(testPath, testData, 0644); err != nil {
		t.Fatalf("failed to write test image: %v", err)
	}
	defer os.Remove(testPath)

	data, ct, err := sm.GetMenuImageBlob(context.Background(), testFile)
	if err != nil {
		t.Fatalf("expected local fallback to succeed, got %v", err)
	}
	if string(data) != string(testData) {
		t.Errorf("expected %q, got %q", string(testData), string(data))
	}
	if ct != "image/png" {
		t.Errorf("expected image/png, got %q", ct)
	}
}
