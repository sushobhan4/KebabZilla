package clustering

import (
	"math"
	"testing"
)

func TestRoadDistanceKm(t *testing.T) {
	// Amtala DH Road coordinates roughly 22.3762, 88.2917
	originLat, originLon := 22.3762, 88.2917
	destLat, destLon := 22.3862, 88.3017

	dist := RoadDistanceKm(originLat, originLon, destLat, destLon, 1.3627)
	if dist <= 0 {
		t.Fatalf("expected positive distance, got %f", dist)
	}

	// Verify haversine identity with 0 distance
	zeroDist := RoadDistanceKm(originLat, originLon, originLat, originLon, 1.3627)
	if zeroDist != 0 {
		t.Fatalf("expected 0 distance for same origin/destination, got %f", zeroDist)
	}

	// Verify distance symmetry
	revDist := RoadDistanceKm(destLat, destLon, originLat, originLon, 1.3627)
	if math.Abs(dist-revDist) > 0.001 {
		t.Fatalf("expected symmetric distance, got %f vs %f", dist, revDist)
	}
}
