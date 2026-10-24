package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/storage"
	"github.com/google/uuid"
	"github.com/kebabzilla/go-backend/config"
	"golang.org/x/oauth2"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

type StorageManager struct {
	cfg        *config.Config
	client     *storage.Client
	clientTime time.Time
	mu         sync.RWMutex
	cacheMu    sync.RWMutex
	imageCache map[string]cachedBlob
}

type cachedBlob struct {
	data        []byte
	contentType string
	expiresAt   time.Time
}

var (
	globalStorage *StorageManager
	storageOnce   sync.Once
)

func InitStorage(cfg *config.Config) *StorageManager {
	storageOnce.Do(func() {
		globalStorage = &StorageManager{
			cfg:        cfg,
			imageCache: make(map[string]cachedBlob),
		}
	})
	return globalStorage
}

func GetStorage() *StorageManager {
	return globalStorage
}

func (m *StorageManager) getClient(ctx context.Context) (*storage.Client, error) {
	m.mu.RLock()
	if m.client != nil && time.Since(m.clientTime) < 45*time.Minute {
		c := m.client
		m.mu.RUnlock()
		return c, nil
	}
	m.mu.RUnlock()

	m.mu.Lock()
	defer m.mu.Unlock()

	if m.client != nil && time.Since(m.clientTime) < 45*time.Minute {
		return m.client, nil
	}

	// 1. Cloud Run / Production or explicit credentials
	if os.Getenv("K_SERVICE") != "" || os.Getenv("GOOGLE_APPLICATION_CREDENTIALS") != "" {
		client, err := storage.NewClient(ctx)
		if err == nil {
			m.client = client
			m.clientTime = time.Now()
			log.Printf("Initialized Google Cloud Storage client with application default credentials.")
			return client, nil
		}
	}

	// 2. Local development fallback: try acquiring token from local gcloud CLI
	cmd := exec.Command("gcloud", "auth", "print-access-token")
	if out, err := cmd.Output(); err == nil {
		tok := strings.TrimSpace(string(out))
		if tok != "" {
			client, err := storage.NewClient(ctx, option.WithTokenSource(oauth2.StaticTokenSource(&oauth2.Token{
				AccessToken: tok,
				Expiry:      time.Now().Add(45 * time.Minute),
			})))
			if err == nil {
				m.client = client
				m.clientTime = time.Now()
				log.Printf("Initialized Google Cloud Storage client via local gcloud access token.")
				return client, nil
			}
		}
	}

	// 3. Fallback standard client
	client, err := storage.NewClient(ctx)
	if err == nil {
		m.client = client
		m.clientTime = time.Now()
		return client, nil
	}

	return nil, err
}

func (m *StorageManager) setCache(key string, data []byte, contentType string) {
	m.cacheMu.Lock()
	defer m.cacheMu.Unlock()
	// Cache in RAM for 1 hour
	m.imageCache[key] = cachedBlob{
		data:        data,
		contentType: contentType,
		expiresAt:   time.Now().Add(1 * time.Hour),
	}
}

func (m *StorageManager) getCache(key string) ([]byte, string, bool) {
	m.cacheMu.RLock()
	defer m.cacheMu.RUnlock()
	if item, found := m.imageCache[key]; found && time.Now().Before(item.expiresAt) {
		return item.data, item.contentType, true
	}
	return nil, "", false
}

func detectContentType(filename string, data []byte) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".webp":
		return "image/webp"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".svg":
		return "image/svg+xml"
	case ".avif":
		return "image/avif"
	}
	if len(data) > 512 {
		return http.DetectContentType(data[:512])
	}
	return http.DetectContentType(data)
}

// -------------------------------------------------------------
// MENU IMAGES
// -------------------------------------------------------------

func (m *StorageManager) GetMenuImageBlob(ctx context.Context, filename string) ([]byte, string, error) {
	cleanFile := filepath.Base(filename)
	if cleanFile == "." || cleanFile == "/" || cleanFile == "" {
		return nil, "", errors.New("invalid filename")
	}

	cacheKey := "menu:" + cleanFile
	if data, ct, ok := m.getCache(cacheKey); ok {
		return data, ct, nil
	}

	// 1. Check local disk fallback paths
	paths := []string{
		filepath.Join("public", "menuImages", cleanFile),
		filepath.Join("..", "frontend", "public", "menuImages", cleanFile),
		filepath.Join("public", cleanFile),
		filepath.Join("..", "frontend", "public", cleanFile),
	}
	for _, p := range paths {
		if data, err := os.ReadFile(p); err == nil {
			ct := detectContentType(cleanFile, data)
			m.setCache(cacheKey, data, ct)
			return data, ct, nil
		}
	}

	// 2. Fetch from Google Cloud Storage
	client, err := m.getClient(ctx)
	if err != nil {
		return nil, "", fmt.Errorf("storage client error: %w", err)
	}

	bucketName := m.cfg.GCSBucketName
	folder := strings.Trim(m.cfg.GCSMenuImagesFolder, "/\\")
	blobPath := cleanFile
	if folder != "" {
		blobPath = folder + "/" + cleanFile
	}

	bucket := client.Bucket(bucketName)
	obj := bucket.Object(blobPath)

	r, err := obj.NewReader(ctx)
	if err != nil {
		// Transparent fallback: if a .jpg was requested but converted to .webp, check .webp blob
		base := strings.TrimSuffix(cleanFile, filepath.Ext(cleanFile))
		webpFile := base + ".webp"
		webpPath := webpFile
		if folder != "" {
			webpPath = folder + "/" + webpFile
		}
		webpObj := bucket.Object(webpPath)
		if webpR, webpErr := webpObj.NewReader(ctx); webpErr == nil {
			defer webpR.Close()
			if data, readErr := io.ReadAll(webpR); readErr == nil {
				ct := "image/webp"
				m.setCache(cacheKey, data, ct)
				return data, ct, nil
			}
		}
		return nil, "", os.ErrNotExist
	}
	defer r.Close()

	data, err := io.ReadAll(r)
	if err != nil {
		return nil, "", err
	}

	ct := r.Attrs.ContentType
	if ct == "" {
		ct = detectContentType(cleanFile, data)
	}

	m.setCache(cacheKey, data, ct)
	return data, ct, nil
}

func (m *StorageManager) UploadMenuImage(ctx context.Context, fileBytes []byte, originalFilename, contentType string) (map[string]any, error) {
	ext := strings.ToLower(filepath.Ext(originalFilename))
	if ext == "" {
		switch contentType {
		case "image/png":
			ext = ".png"
		case "image/webp":
			ext = ".webp"
		case "image/gif":
			ext = ".gif"
		case "image/avif":
			ext = ".avif"
		default:
			ext = ".jpg"
		}
	}

	uniqueName := strings.ReplaceAll(uuid.New().String(), "-", "") + ext
	folder := strings.Trim(m.cfg.GCSMenuImagesFolder, "/\\")
	blobPath := uniqueName
	if folder != "" {
		blobPath = folder + "/" + uniqueName
	}

	bucketName := m.cfg.GCSBucketName

	// 1. Upload to GCS
	if client, err := m.getClient(ctx); err == nil {
		bucket := client.Bucket(bucketName)
		obj := bucket.Object(blobPath)
		w := obj.NewWriter(ctx)
		w.CacheControl = "public, max-age=31536000, immutable"
		w.ContentType = contentType
		if _, writeErr := w.Write(fileBytes); writeErr == nil {
			_ = w.Close()
			log.Printf("Successfully uploaded menu image to gs://%s/%s", bucketName, blobPath)
		} else {
			_ = w.Close()
			log.Printf("GCS upload write failed: %v", writeErr)
		}
	} else {
		log.Printf("Warning: GCS client not available for menu image upload: %v", err)
	}

	// 2. Local fallback cache
	localDir := filepath.Join("public", "menuImages")
	_ = os.MkdirAll(localDir, 0755)
	_ = os.WriteFile(filepath.Join(localDir, uniqueName), fileBytes, 0644)

	m.setCache("menu:"+uniqueName, fileBytes, contentType)

	return map[string]any{
		"url":          "/menu/images/gcs/" + uniqueName,
		"gcs_uri":      fmt.Sprintf("gs://%s/%s", bucketName, blobPath),
		"filename":     uniqueName,
		"content_type": contentType,
		"size_bytes":   len(fileBytes),
	}, nil
}

func (m *StorageManager) DeleteMenuImage(ctx context.Context, filename string) error {
	cleanFile := filepath.Base(filename)
	folder := strings.Trim(m.cfg.GCSMenuImagesFolder, "/\\")
	blobPath := cleanFile
	if folder != "" {
		blobPath = folder + "/" + cleanFile
	}

	if client, err := m.getClient(ctx); err == nil {
		bucket := client.Bucket(m.cfg.GCSBucketName)
		obj := bucket.Object(blobPath)
		_ = obj.Delete(ctx)
	}

	localPath := filepath.Join("public", "menuImages", cleanFile)
	_ = os.Remove(localPath)

	m.cacheMu.Lock()
	delete(m.imageCache, "menu:"+cleanFile)
	m.cacheMu.Unlock()

	return nil
}

// -------------------------------------------------------------
// EMAIL IMAGES
// -------------------------------------------------------------

func (m *StorageManager) UploadEmailImage(ctx context.Context, fileBytes []byte, filename, contentType string) (map[string]any, error) {
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" {
		ext = ".jpg"
	}
	cleanExt := strings.TrimPrefix(ext, ".")
	uniqueName := strings.ReplaceAll(uuid.New().String(), "-", "") + "." + cleanExt

	folder := strings.Trim(m.cfg.GCSEmailImagesFolder, "/\\")
	blobPath := uniqueName
	if folder != "" {
		blobPath = folder + "/" + uniqueName
	}

	bucketName := m.cfg.GCSBucketName

	// 1. Upload to GCS
	if client, err := m.getClient(ctx); err == nil {
		bucket := client.Bucket(bucketName)
		obj := bucket.Object(blobPath)
		w := obj.NewWriter(ctx)
		w.CacheControl = "public, max-age=31536000, immutable"
		w.ContentType = contentType
		if _, writeErr := w.Write(fileBytes); writeErr == nil {
			_ = w.Close()
			log.Printf("Successfully uploaded email image to gs://%s/%s", bucketName, blobPath)
		} else {
			_ = w.Close()
			log.Printf("GCS upload write failed: %v", writeErr)
		}
	} else {
		log.Printf("Warning: GCS client not available for email image upload: %v", err)
	}

	// 2. Local fallback
	localDir := filepath.Join("uploads", "emailImages")
	_ = os.MkdirAll(localDir, 0755)
	_ = os.WriteFile(filepath.Join(localDir, uniqueName), fileBytes, 0644)

	m.setCache("email:"+uniqueName, fileBytes, contentType)

	relativeURL := "/api/v1/public/email-images/" + uniqueName
	baseURL := strings.TrimRight(m.cfg.PublicBackendURL, "/")
	publicURL := baseURL + relativeURL

	return map[string]any{
		"url":          relativeURL,
		"public_url":   publicURL,
		"gcs_uri":      fmt.Sprintf("gs://%s/%s", bucketName, blobPath),
		"filename":     uniqueName,
		"content_type": contentType,
		"size_bytes":   len(fileBytes),
	}, nil
}

func (m *StorageManager) ListEmailImages(ctx context.Context) ([]map[string]any, error) {
	folder := strings.Trim(m.cfg.GCSEmailImagesFolder, "/\\")
	prefix := ""
	if folder != "" {
		prefix = folder + "/"
	}

	baseURL := strings.TrimRight(m.cfg.PublicBackendURL, "/")
	imagesMap := make(map[string]map[string]any)

	// 1. Query GCS
	if client, err := m.getClient(ctx); err == nil {
		bucket := client.Bucket(m.cfg.GCSBucketName)
		it := bucket.Objects(ctx, &storage.Query{Prefix: prefix})
		for {
			attrs, err := it.Next()
			if err == iterator.Done {
				break
			}
			if err != nil {
				break
			}
			fname := filepath.Base(attrs.Name)
			if fname == "" || attrs.Size < 100 || strings.HasPrefix(fname, "kebabzilla-email-logo") {
				continue
			}
			relURL := "/api/v1/public/email-images/" + fname
			imagesMap[fname] = map[string]any{
				"filename":   fname,
				"url":        relURL,
				"public_url": baseURL + relURL,
				"size_bytes": attrs.Size,
				"created_at": attrs.Created.Format(time.RFC3339),
			}
		}
	}

	// 2. Local fallback directory
	localDir := filepath.Join("uploads", "emailImages")
	if entries, err := os.ReadDir(localDir); err == nil {
		for _, entry := range entries {
			fname := entry.Name()
			if _, exists := imagesMap[fname]; !exists && !strings.HasPrefix(fname, ".") && !strings.HasPrefix(fname, "kebabzilla-email-logo") {
				info, err := entry.Info()
				if err == nil && info.Size() >= 100 {
					relURL := "/api/v1/public/email-images/" + fname
					imagesMap[fname] = map[string]any{
						"filename":   fname,
						"url":        relURL,
						"public_url": baseURL + relURL,
						"size_bytes": info.Size(),
						"created_at": info.ModTime().Format(time.RFC3339),
					}
				}
			}
		}
	}

	result := make([]map[string]any, 0, len(imagesMap))
	for _, v := range imagesMap {
		result = append(result, v)
	}

	sort.Slice(result, func(i, j int) bool {
		ti, _ := result[i]["created_at"].(string)
		tj, _ := result[j]["created_at"].(string)
		return ti > tj
	})

	return result, nil
}

func (m *StorageManager) GetEmailImageBlob(ctx context.Context, filename string) ([]byte, string, error) {
	cleanFile := filepath.Base(filename)
	cacheKey := "email:" + cleanFile
	if data, ct, ok := m.getCache(cacheKey); ok {
		return data, ct, nil
	}

	// 1. Check GCS
	folder := strings.Trim(m.cfg.GCSEmailImagesFolder, "/\\")
	blobPath := cleanFile
	if folder != "" {
		blobPath = folder + "/" + cleanFile
	}

	if client, err := m.getClient(ctx); err == nil {
		bucket := client.Bucket(m.cfg.GCSBucketName)
		obj := bucket.Object(blobPath)
		if r, err := obj.NewReader(ctx); err == nil {
			defer r.Close()
			if data, err := io.ReadAll(r); err == nil {
				ct := r.Attrs.ContentType
				if ct == "" {
					ct = detectContentType(cleanFile, data)
				}
				m.setCache(cacheKey, data, ct)
				return data, ct, nil
			}
		}
	}

	// 2. Check local fallback
	paths := []string{
		filepath.Join("uploads", "emailImages", cleanFile),
		filepath.Join("public", cleanFile),
		filepath.Join("public", "emailImages", cleanFile),
	}
	for _, p := range paths {
		if data, err := os.ReadFile(p); err == nil {
			ct := detectContentType(cleanFile, data)
			m.setCache(cacheKey, data, ct)
			return data, ct, nil
		}
	}

	return nil, "", os.ErrNotExist
}

func (m *StorageManager) DeleteEmailImage(ctx context.Context, filename string) error {
	cleanFile := filepath.Base(filename)
	folder := strings.Trim(m.cfg.GCSEmailImagesFolder, "/\\")
	blobPath := cleanFile
	if folder != "" {
		blobPath = folder + "/" + cleanFile
	}

	if client, err := m.getClient(ctx); err == nil {
		bucket := client.Bucket(m.cfg.GCSBucketName)
		obj := bucket.Object(blobPath)
		_ = obj.Delete(ctx)
	}

	localPath := filepath.Join("uploads", "emailImages", cleanFile)
	_ = os.Remove(localPath)

	m.cacheMu.Lock()
	delete(m.imageCache, "email:"+cleanFile)
	m.cacheMu.Unlock()

	return nil
}
