package models

import (
	"log"
	"strings"

	"github.com/kebabzilla/go-backend/config"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func InitDB(cfg *config.Config) *gorm.DB {
	var dialector gorm.Dialector

	dbURL := cfg.DatabaseURL
	if strings.HasPrefix(dbURL, "postgres://") || strings.HasPrefix(dbURL, "postgresql://") {
		dialector = postgres.New(postgres.Config{
			DSN:                  dbURL,
			PreferSimpleProtocol: true, // Required for PgBouncer / Supabase transaction pooler
		})
	} else if strings.HasPrefix(dbURL, "sqlite:") {
		path := strings.TrimPrefix(dbURL, "sqlite:")
		dialector = sqlite.Open(path)
	} else {
		// Default SQLite
		dialector = sqlite.Open("kebabzilla.db")
	}

	gormConfig := &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	}

	database, err := gorm.Open(dialector, gormConfig)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	// Only auto-migrate auth & session tables that require GORM-level index synchronization
	err = database.AutoMigrate(
		&Account{},
		&UserSession{},
		&StaffInfo{},
		&AllOtp{},
		&AccountAddress{},
		&CartItem{},
		&DeliveryBatch{},
		&DeliveryBatchOrder{},
	)
	if err != nil {
		log.Printf("Warning during AutoMigrate: %v", err)
	}

	DB = database
	return database
}
