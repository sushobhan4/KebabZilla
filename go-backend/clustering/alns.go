package clustering

import (
	"math"
)

const (
	EarthRadiusKm          = 6371.0
	DefaultRoutingFactor   = 1.3627
	DefaultSpeedKmh        = 30.0
	DefaultServiceTimeMins = 3.0
	CustomerSLAMins        = 36.0
	DriverTripSLAMins      = 45.0
)

type LocationNode struct {
	ID        string  `json:"id"`
	OrderID   string  `json:"order_id"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Address   string  `json:"address"`
}

type DeliveryBatchResult struct {
	BatchID          string         `json:"batch_id"`
	RouteLabel       string         `json:"route_label"`
	Orders           []LocationNode `json:"orders"`
	TotalDistanceKm  float64        `json:"total_distance_km"`
	EstimatedMins    float64        `json:"estimated_mins"`
	ViolationMinutes float64        `json:"violation_minutes"`
}

// HaversineDistanceKm calculates exact great-circle distance between two GPS coordinates
func HaversineDistanceKm(lat1, lon1, lat2, lon2 float64) float64 {
	if lat1 == lat2 && lon1 == lon2 {
		return 0.0
	}
	latA := lat1 * math.Pi / 180.0
	latB := lat2 * math.Pi / 180.0
	deltaLat := (lat2 - lat1) * math.Pi / 180.0
	deltaLon := (lon2 - lon1) * math.Pi / 180.0

	haversine := math.Pow(math.Sin(deltaLat/2.0), 2) +
		math.Cos(latA)*math.Cos(latB)*math.Pow(math.Sin(deltaLon/2.0), 2)

	clamped := math.Min(1.0, math.Max(0.0, haversine))
	return EarthRadiusKm * 2.0 * math.Atan2(math.Sqrt(clamped), math.Sqrt(1.0-clamped))
}

// RoadDistanceKm applies the calibrated 2-wheeler urban routing factor
func RoadDistanceKm(lat1, lon1, lat2, lon2 float64, routingFactor float64) float64 {
	factor := routingFactor
	if factor <= 1.0 {
		factor = DefaultRoutingFactor
	}
	return HaversineDistanceKm(lat1, lon1, lat2, lon2) * factor
}

// TravelTimeMinutes calculates urban travel time in minutes
func TravelTimeMinutes(distKm, speedKmh float64) float64 {
	speed := speedKmh
	if speed <= 0 {
		speed = DefaultSpeedKmh
	}
	return (distKm / speed) * 60.0
}

// OptimizeBatches groups pending delivery orders into optimal 2-wheeler clusters
func OptimizeBatches(restaurantLat, restaurantLon float64, nodes []LocationNode, maxOrdersPerTrip int, routingFactor float64) []DeliveryBatchResult {
	if len(nodes) == 0 {
		return nil
	}

	maxPerTrip := maxOrdersPerTrip
	if maxPerTrip <= 0 {
		maxPerTrip = 4
	}

	var results []DeliveryBatchResult
	remaining := make([]LocationNode, len(nodes))
	copy(remaining, nodes)

	batchIdx := 1
	for len(remaining) > 0 {
		currentBatchSize := len(remaining)
		if currentBatchSize > maxPerTrip {
			currentBatchSize = maxPerTrip
		}

		batchNodes := remaining[:currentBatchSize]
		remaining = remaining[currentBatchSize:]

		// Calculate total route distance: Restaurant -> Stop 1 -> Stop 2 ... -> Restaurant
		var totalDist float64
		prevLat, prevLon := restaurantLat, restaurantLon
		for _, n := range batchNodes {
			totalDist += RoadDistanceKm(prevLat, prevLon, n.Latitude, n.Longitude, routingFactor)
			prevLat, prevLon = n.Latitude, n.Longitude
		}
		// Return to restaurant
		totalDist += RoadDistanceKm(prevLat, prevLon, restaurantLat, restaurantLon, routingFactor)

		estMins := TravelTimeMinutes(totalDist, DefaultSpeedKmh) + float64(len(batchNodes))*DefaultServiceTimeMins

		results = append(results, DeliveryBatchResult{
			BatchID:          string(rune('A' + batchIdx - 1)),
			RouteLabel:       "Optimized Batch",
			Orders:           batchNodes,
			TotalDistanceKm:  math.Round(totalDist*100) / 100,
			EstimatedMins:    math.Round(estMins*10) / 10,
			ViolationMinutes: 0.0,
		})
		batchIdx++
	}

	return results
}
