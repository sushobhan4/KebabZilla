import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import {
  ArrowRight,
  Check,
  ExternalLink,
  MapPin,
  Navigation,
  PackageCheck,
  Phone,
  Power,
  Route as RouteIcon,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import {
  api,
  formatINR,
  friendlyDate,
  type DriverDutyStatus,
  type Order,
  type RecommendedBatchesResponse,
} from "../api";
import {
  Badge,
  Button,
  EmptyState,
  Loading,
  MenuImageCarousel,
  Notice,
  PageTitle,
  StatusBadge,
} from "../components";

function DeliveryWaypointsMap({
  restaurantLat,
  restaurantLng,
  orders,
}: {
  restaurantLat: number | null;
  restaurantLng: number | null;
  orders: Order[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const orderMarkersRef = useRef<google.maps.Marker[]>([]);
  const restMarkerRef = useRef<google.maps.Marker | null>(null);
  const [mapError, setMapError] = useState("");

  const ordersKey = orders.map((o) => `${o.order_id}:${o.latitude}:${o.longitude}`).join("|");

  useEffect(() => {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
    if (!key) {
      setMapError("Google Maps API key is not configured.");
      return;
    }
    if (!containerRef.current) return;

    let disposed = false;
    setOptions({ key, language: "en", region: "IN" });

    (importLibrary("maps") as Promise<google.maps.MapsLibrary>)
      .then((mapsLib) => {
        if (disposed || !containerRef.current) return;

        // Initialize Google Map instance only once
        if (!mapInstanceRef.current) {
          const defaultCenter = {
            lat: restaurantLat || 22.365278,
            lng: restaurantLng || 88.269444,
          };

          mapInstanceRef.current = new mapsLib.Map(containerRef.current, {
            center: defaultCenter,
            zoom: 13,
            mapTypeControl: false,
            streetViewControl: false,
            gestureHandling: "greedy",
          });
        }

        const map = mapInstanceRef.current;
        const bounds = new google.maps.LatLngBounds();

        // 1. Restaurant marker
        if (restaurantLat != null && restaurantLng != null) {
          const restPos = { lat: restaurantLat, lng: restaurantLng };
          bounds.extend(restPos);
          if (restMarkerRef.current) {
            restMarkerRef.current.setPosition(restPos);
          } else {
            const restMarker = new google.maps.Marker({
              map,
              position: restPos,
              title: "KebabZilla (Restaurant)",
              label: {
                text: "R",
                color: "#ffffff",
                fontWeight: "bold",
              },
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 13,
                fillColor: "#b4483a",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2,
              },
            });
            const infoWindow = new google.maps.InfoWindow({
              content: `<div style="padding:4px;font-family:sans-serif;"><strong>KebabZilla Restaurant</strong><br/><small style="color:#666;">Pickup & dispatch origin</small></div>`,
            });
            restMarker.addListener("click", () => infoWindow.open(map, restMarker));
            restMarkerRef.current = restMarker;
          }
        }

        // 2. Clear old order markers and create fresh order markers
        orderMarkersRef.current.forEach((m) => m.setMap(null));
        orderMarkersRef.current = [];

        orders.forEach((order, index) => {
          const lat = order.latitude ?? restaurantLat;
          const lng = order.longitude ?? restaurantLng;
          if (lat != null && lng != null) {
            const offsetLat = order.latitude != null ? lat : lat + (index + 1) * 0.0018;
            const offsetLng = order.longitude != null ? lng : lng + (index + 1) * 0.0018;
            const pos = { lat: offsetLat, lng: offsetLng };
            bounds.extend(pos);

            const marker = new google.maps.Marker({
              map,
              position: pos,
              title: `Stop ${index + 1}: Order #${order.order_id} · ${order.customer_name}`,
              label: {
                text: String(index + 1),
                color: "#ffffff",
                fontWeight: "bold",
              },
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 14,
                fillColor: "#2b7a4b",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2,
              },
            });

            const contentString = `
              <div style="padding:6px;font-family:sans-serif;max-width:230px;">
                <div style="font-size:11px;color:#2b7a4b;font-weight:700;">WAYPOINT · STOP ${index + 1}</div>
                <div style="font-size:14px;font-weight:800;color:#111;margin:2px 0;">Order #${order.order_id}</div>
                <div style="font-size:12px;font-weight:600;color:#333;">Customer: ${order.customer_name}</div>
                <div style="font-size:11px;color:#555;margin-top:4px;">${order.address || "Address provided at checkout"}</div>
                ${order.customer_phone ? `<div style="font-size:11px;color:#2b7a4b;margin-top:4px;">📞 <a href="tel:${order.customer_phone}">${order.customer_phone}</a></div>` : ""}
              </div>
            `;
            const infoWindow = new google.maps.InfoWindow({ content: contentString });
            marker.addListener("click", () => infoWindow.open(map, marker));
            orderMarkersRef.current.push(marker);
          }
        });

        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { top: 45, right: 45, bottom: 45, left: 45 });
        }
      })
      .catch(() => {
        if (!disposed) {
          setMapError("Google Maps could not be loaded. Check your connection or API key.");
        }
      });

    return () => {
      disposed = true;
    };
  }, [restaurantLat, restaurantLng, ordersKey]);

  // Construct Google Maps destination & intermediate waypoints
  const destinationAndWaypoints = (() => {
    if (!orders.length) return null;
    const lastOrder = orders[orders.length - 1];
    const destination =
      lastOrder.latitude != null && lastOrder.longitude != null
        ? `${lastOrder.latitude},${lastOrder.longitude}`
        : encodeURIComponent(lastOrder.address || "");
    const intermediate = orders
      .slice(0, -1)
      .map((o) =>
        o.latitude != null && o.longitude != null
          ? `${o.latitude},${o.longitude}`
          : encodeURIComponent(o.address || ""),
      )
      .filter(Boolean);

    const waypointsParam = intermediate.length
      ? `&waypoints=${intermediate.join("|")}`
      : "";
    return { destination, waypointsParam };
  })();

  const handleOpenNavigation = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!destinationAndWaypoints) return;
    const { destination, waypointsParam } = destinationAndWaypoints;

    // Client-side only: Query device GPS location directly when clicking Open Navigation to set starting point
    // This runs strictly on the driver's device and does NOT report anything to the backend.
    if (navigator.geolocation) {
      e.preventDefault();
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const originParam = `&origin=${pos.coords.latitude},${pos.coords.longitude}`;
          window.open(
            `https://www.google.com/maps/dir/?api=1${originParam}&destination=${destination}${waypointsParam}`,
            "_blank",
            "noopener,noreferrer",
          );
        },
        () => {
          // If device GPS read fails or is denied, launch with Google Maps native device location (omitted origin)
          window.open(
            `https://www.google.com/maps/dir/?api=1&destination=${destination}${waypointsParam}`,
            "_blank",
            "noopener,noreferrer",
          );
        },
        { enableHighAccuracy: true, timeout: 3500 },
      );
    }
  };

  const navUrl = destinationAndWaypoints
    ? `https://www.google.com/maps/dir/?api=1&destination=${destinationAndWaypoints.destination}${destinationAndWaypoints.waypointsParam}`
    : null;

  return (
    <div
      className="delivery-map-card"
      style={{
        marginBottom: "1.25rem",
        border: "1px solid #e9e6de",
        borderRadius: "14px",
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          borderBottom: "1px solid #f0eee5",
          background: "#faf9f5",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div>
          <strong
            style={{
              fontSize: "14px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <MapPin size={16} color="#b4483a" /> Route Waypoints Map
          </strong>
          <small style={{ color: "var(--muted)", fontSize: "11px" }}>
            Origin: KebabZilla Restaurant · {orders.length} stop{orders.length === 1 ? "" : "s"} marked in delivery sequence
          </small>
        </div>
        {navUrl && (
          <a
            href={navUrl}
            target="_blank"
            rel="noreferrer"
            onClick={handleOpenNavigation}
            className="button button-sm button-secondary"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              textDecoration: "none",
            }}
          >
            <Navigation size={13} /> Open Navigation <ExternalLink size={12} />
          </a>
        )}
      </div>
      {mapError ? (
        <div style={{ padding: "24px", color: "#a55844", fontSize: "12px" }}>
          {mapError}
        </div>
      ) : (
        <div ref={containerRef} style={{ width: "100%", height: "300px" }} />
      )}
    </div>
  );
}

function PastDeliveries() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api<Order[]>("/delivery/history")
      .then(setOrders)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading label="Loading your past deliveries…" />;

  const filtered = orders.filter((o) =>
    `${o.order_id} ${o.customer_name} ${o.address || ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );

  const totalDeliveredRevenue = orders.reduce((sum, o) => sum + o.total_paise, 0);

  return (
    <>
      <div className="delivery-summary" style={{ marginBottom: "1.25rem" }}>
        <div>
          <span className="delivery-summary-icon">
            <PackageCheck size={20} />
          </span>
          <span>
            <strong>{orders.length}</strong>
            <small>completed deliveries</small>
          </span>
        </div>
        <div>
          <span className="delivery-summary-icon" style={{ color: "#2b7a4b", background: "#e8f4e6" }}>
            <Check size={20} />
          </span>
          <span>
            <strong>{formatINR(totalDeliveredRevenue)}</strong>
            <small>total delivered value</small>
          </span>
        </div>
        <span className="delivery-summary-note">Great work keeping our customers fed!</span>
      </div>

      <label className="menu-search delivery-search" style={{ marginBottom: "1rem" }}>
        <Search size={17} />
        <input
          type="search"
          aria-label="Search past deliveries"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search delivered order number, customer, or address"
        />
      </label>

      {!orders.length ? (
        <EmptyState
          icon={<PackageCheck size={21} />}
          title="No past deliveries yet"
          description="Completed deliveries will appear here with confirmation codes."
        />
      ) : !filtered.length ? (
        <EmptyState
          icon={<Search size={21} />}
          title="No matching past deliveries"
          description="Try searching with a different order number or name."
        />
      ) : (
        <div className="delivery-order-list">
          {filtered.map((order) => (
            <article className="delivery-order-card" key={order.order_id}>
              <div className="delivery-order-index" style={{ padding: "16px 8px" }}>
                <Check size={18} color="#2b7a4b" />
              </div>
              <div className="delivery-order-main">
                <div className="delivery-order-top">
                  <div>
                    <span className="delivery-time">
                      DELIVERED · {friendlyDate(order.created_at)}
                    </span>
                    <h3>Order #{order.order_id}</h3>
                  </div>
                  <StatusBadge status={order.status} />
                </div>
                <div className="delivery-customer-info">
                  <div className="customer-detail">
                    <span className="customer-detail-icon">
                      <UserRound size={16} />
                    </span>
                    <span>
                      <small>Delivered to</small>
                      <strong>{order.customer_name}</strong>
                    </span>
                  </div>
                  <div className="customer-detail customer-address">
                    <span className="customer-detail-icon">
                      <MapPin size={16} />
                    </span>
                    <span>
                      <small>Address</small>
                      <strong>{order.address || "Address on record"}</strong>
                    </span>
                  </div>
                  {order.customer_phone && (
                    <div className="customer-detail">
                      <span className="customer-detail-icon">
                        <Phone size={16} />
                      </span>
                      <span>
                        <small>Phone</small>
                        <strong>{order.customer_phone}</strong>
                      </span>
                    </div>
                  )}
                </div>
                <div className="delivery-order-items">
                  <div className="delivery-menu-lines">
                    {order.items.map((line) => (
                      <span key={`${line.menu_item_id}-${line.name}`} style={{ marginRight: "10px" }}>
                        {line.quantity}× {line.name}
                      </span>
                    ))}
                  </div>
                  <strong>{formatINR(order.total_paise)}</strong>
                  <Badge tone={order.payment_method === "CASH" ? "amber" : "success"}>
                    {order.payment_method === "CASH" ? "Cash collected" : "Paid online"}
                  </Badge>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

export default function Delivery() {
  const [deliveryTab, setDeliveryTab] = useState<"CURRENT" | "PAST">("CURRENT");
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState("");
  const [dutyStatus, setDutyStatus] = useState<DriverDutyStatus | null>(null);
  const [suggestedBatches, setSuggestedBatches] = useState<RecommendedBatchesResponse>({
    is_accepting_deliveries: false,
    active_riders: 0,
    is_restaurant_open: true,
    schedule_status: "",
    single_order: false,
    order: null,
    clusters: [],
    restaurant_latitude: null,
    restaurant_longitude: null,
  });
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [dutyBusy, setDutyBusy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewClusterId, setPreviewClusterId] = useState<string | null>(null);
  const [previewSingleOrder, setPreviewSingleOrder] = useState(false);

  const refresh = useCallback(
    () =>
      Promise.all([
        api<Order[]>("/delivery/queue"),
        api<DriverDutyStatus>("/delivery/duty-status"),
        api<RecommendedBatchesResponse>("/delivery/recommended-batches"),
      ])
        .then(([queue, duty, recommendations]) => {
          setOrders(queue);
          setDutyStatus(duty);
          setSuggestedBatches(recommendations);
        })
        .catch((err) =>
          setError(
            err instanceof Error ? err.message : "Could not load delivery data.",
          ),
        )
        .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function handleToggleDuty(nextState: boolean) {
    setDutyBusy(true);
    setError("");
    try {
      if (nextState) {
        // Enforce operating hours
        if (dutyStatus && !dutyStatus.is_restaurant_open) {
          throw new Error(
            `Cannot accept deliveries outside restaurant operating hours (${dutyStatus.schedule_status || "Closed"}).`,
          );
        }

        // If restaurant enforces geofence, verify location once when starting duty
        if (dutyStatus?.enforce_geofence) {
          if (!navigator.geolocation) {
            throw new Error(
              "Location services are required to verify you are at the restaurant before accepting deliveries.",
            );
          }
          const position = await new Promise<GeolocationPosition>(
            (resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 8000,
              });
            },
          ).catch(() => {
            throw new Error(
              "GPS location access is required to verify you are within allowed meters of the restaurant.",
            );
          });

          const updated = await api<DriverDutyStatus>("/delivery/duty-status", {
            method: "POST",
            body: JSON.stringify({
              accepting: true,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            }),
          });
          setDutyStatus(updated);
        } else {
          const updated = await api<DriverDutyStatus>("/delivery/duty-status", {
            method: "POST",
            body: JSON.stringify({ accepting: true }),
          });
          setDutyStatus(updated);
        }
      } else {
        const updated = await api<DriverDutyStatus>("/delivery/duty-status", {
          method: "POST",
          body: JSON.stringify({ accepting: false }),
        });
        setDutyStatus(updated);
      }
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update accepting delivery status.",
      );
    } finally {
      setDutyBusy(false);
    }
  }

  async function claimBatch(orderIds: string[]) {
    setBatchBusy(true);
    setError("");
    try {
      await api("/delivery/recommended-batches/claim", {
        method: "POST",
        body: JSON.stringify({ order_ids: orderIds }),
      });
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not claim this delivery batch.",
      );
    } finally {
      setBatchBusy(false);
    }
  }

  async function claimSingleOrder(orderId: string) {
    setBatchBusy(true);
    setError("");
    try {
      await api(`/delivery/orders/${orderId}/claim`, {
        method: "POST",
      });
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not claim this order.",
      );
    } finally {
      setBatchBusy(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>, order: Order) {
    event.preventDefault();
    const code = codes[order.order_id] || "";
    if (!/^\d{6}$/.test(code)) {
      setError("Please enter the customer’s 6-digit delivery verification code.");
      return;
    }
    setBusy(order.order_id);
    setError("");
    try {
      await api(`/delivery/orders/${order.order_id}/verify-otp`, {
        method: "POST",
        body: JSON.stringify({ otp: code }),
      });
      setCodes((prev) => ({ ...prev, [order.order_id]: "" }));
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "That delivery code could not be verified.",
      );
    } finally {
      setBusy(null);
    }
  }

  const matchesSearch = (order: Order) =>
    `${order.order_id} ${order.customer_name} ${order.customer_phone || ""} ${order.address || ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase());

  const visibleActiveOrders = orders.filter(matchesSearch);

  if (loading) return <Loading label="Opening your delivery workspace…" />;

  return (
    <>
      <PageTitle
        eyebrow="DRIVER WORKSPACE"
        title="Deliveries"
        description="Claim ready orders, view multi-stop waypoint routes, and complete deliveries."
        action={
          <span className="live-indicator">
            <span className="pulse-dot" /> {orders.length} in progress
          </span>
        }
      />

      {/* Two tabs only: Current delivery and Past deliveries */}
      <div
        className="filter-tabs delivery-view-tabs"
        style={{ marginBottom: "1.25rem", display: "flex", gap: "8px" }}
      >
        <button
          type="button"
          className={deliveryTab === "CURRENT" ? "active" : ""}
          onClick={() => setDeliveryTab("CURRENT")}
        >
          Current delivery
        </button>
        <button
          type="button"
          className={deliveryTab === "PAST" ? "active" : ""}
          onClick={() => setDeliveryTab("PAST")}
        >
          Past deliveries
        </button>
      </div>

      {error && <Notice onDismiss={() => setError("")}>{error}</Notice>}

      {deliveryTab === "PAST" ? (
        <PastDeliveries />
      ) : (
        <>
          {/* Duty status toggle card - only shown when not currently on an active delivery */}
          {orders.length === 0 && (
            <section
              className="delivery-duty-card"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "16px 20px",
                background: dutyStatus?.is_accepting_deliveries ? "#f0f7ed" : "#faf9f6",
                border: `1.5px solid ${dutyStatus?.is_accepting_deliveries ? "#a5d6a7" : "#e0ded4"}`,
                borderRadius: "14px",
                marginBottom: "1.5rem",
                boxShadow: "0 2px 8px rgba(0,0,0,0.03)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div
                  style={{
                    width: "42px",
                    height: "42px",
                    borderRadius: "12px",
                    background: dutyStatus?.is_accepting_deliveries ? "#c8e6c9" : "#eae8e0",
                    color: dutyStatus?.is_accepting_deliveries ? "#2b7a4b" : "#7d8076",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <Power size={22} />
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: "16px", color: "var(--foreground)" }}>
                      {dutyStatus?.is_accepting_deliveries
                        ? "Accepting deliveries"
                        : "Off-duty"}
                    </strong>
                    <span
                      style={{
                        fontSize: "10.5px",
                        fontWeight: 800,
                        letterSpacing: "0.5px",
                        padding: "2px 9px",
                        borderRadius: "12px",
                        background: dutyStatus?.is_accepting_deliveries ? "#2b7a4b" : "#84887d",
                        color: "#fff",
                      }}
                    >
                      {dutyStatus?.is_accepting_deliveries ? "ONLINE" : "OFFLINE"}
                    </span>
                  </div>
                  <div style={{ color: "#666", fontSize: "12px", marginTop: "3px" }}>
                    {dutyStatus?.schedule_status ? `${dutyStatus.schedule_status} · ` : ""}
                    <strong>{dutyStatus?.active_riders || 0}</strong> active driver
                    {dutyStatus?.active_riders === 1 ? "" : "s"} on duty
                    {dutyStatus?.enforce_geofence && (
                      <span style={{ marginLeft: "8px", color: "#896f3d" }}>
                        · Restaurant geofence active ({dutyStatus.geofence_meters}m)
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#444" }}>
                  {dutyBusy
                    ? "Updating…"
                    : !dutyStatus?.is_restaurant_open
                      ? "Restaurant closed"
                      : "Accepting delivery"}
                </span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    aria-label="Toggle accepting delivery"
                    checked={Boolean(dutyStatus?.is_accepting_deliveries && dutyStatus?.is_restaurant_open)}
                    disabled={dutyBusy || !dutyStatus?.is_restaurant_open}
                    onChange={(event) => void handleToggleDuty(event.target.checked)}
                  />
                  <span />
                </label>
              </div>
            </section>
          )}

          {/* If driver is offline */}
          {!dutyStatus?.is_accepting_deliveries || !dutyStatus?.is_restaurant_open ? (
            <EmptyState
              icon={<Power size={24} />}
              title={
                !dutyStatus?.is_restaurant_open
                  ? "Restaurant is currently closed"
                  : "You are currently off-duty"
              }
              description={
                !dutyStatus?.is_restaurant_open
                  ? `Operating hours ended or orders not currently active (${dutyStatus?.schedule_status || "Closed"}). Accepting deliveries will automatically unlock when open.`
                  : "Turn on 'Accepting delivery' toggle above to become available, view orders, and join dispatch clustering."
              }
            />
          ) : orders.length > 0 ? (
            /* ACTIVE CLAIMED BATCH (In-progress deliveries) */
            <section className="active-batch-section">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "1rem",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <div>
                  <h2 style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0 }}>
                    In-progress delivery batch · {orders.length} stop{orders.length === 1 ? "" : "s"}
                  </h2>
                  <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                    Follow waypoints in numbered sequence and verify delivery code with each customer.
                  </span>
                </div>
              </div>

              {/* Waypoints Map on Current delivery */}
              <DeliveryWaypointsMap
                restaurantLat={suggestedBatches.restaurant_latitude}
                restaurantLng={suggestedBatches.restaurant_longitude}
                orders={orders}
              />

              <label className="menu-search delivery-search" style={{ marginBottom: "1rem" }}>
                <Search size={17} />
                <input
                  type="search"
                  aria-label="Filter active deliveries"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search in-progress order number, customer, or phone"
                />
              </label>

              <div className="delivery-order-list">
                {visibleActiveOrders.map((order, index) => (
                  <article className="delivery-order-card" key={order.order_id}>
                    <div className="delivery-order-index">
                      <span>Stop {String(index + 1).padStart(2, "0")}</span>
                    </div>
                    <div className="delivery-order-main">
                      <div className="delivery-order-top">
                        <div>
                          <span className="delivery-time">
                            CLAIMED · {friendlyDate(order.created_at)}
                          </span>
                          <h3>Order #{order.order_id}</h3>
                        </div>
                        <StatusBadge status={order.status} />
                      </div>
                      <div className="delivery-customer-info">
                        <div className="customer-detail">
                          <span className="customer-detail-icon">
                            <UserRound size={16} />
                          </span>
                          <span>
                            <small>Deliver to</small>
                            <strong>{order.customer_name}</strong>
                          </span>
                        </div>
                        <div className="customer-detail customer-address">
                          <span className="customer-detail-icon">
                            <MapPin size={16} />
                          </span>
                          <span>
                            <small>Delivery Address</small>
                            <strong>{order.address || "Address provided at checkout"}</strong>
                          </span>
                        </div>
                        <div className="customer-detail">
                          <span className="customer-detail-icon">
                            <Phone size={16} />
                          </span>
                          <span>
                            <small>Customer Phone</small>
                            {order.customer_phone ? (
                              <a href={`tel:${order.customer_phone}`} style={{ fontWeight: 700 }}>
                                {order.customer_phone}
                              </a>
                            ) : (
                              <strong>Not provided</strong>
                            )}
                          </span>
                        </div>
                      </div>

                      <div className="delivery-order-items">
                        <div className="delivery-menu-lines">
                          {order.items.map((line) => (
                            <div
                              className="delivery-menu-line"
                              key={`${line.menu_item_id}-${line.name}`}
                            >
                              {(line.image_urls?.length || line.image_url) && (
                                <span className="delivery-menu-line-art">
                                  <MenuImageCarousel
                                    images={
                                      line.image_urls?.length
                                        ? line.image_urls
                                        : line.image_url
                                          ? [line.image_url]
                                          : []
                                    }
                                    alt={line.name}
                                    className="menu-gallery-order"
                                  />
                                </span>
                              )}
                              <span>
                                {line.quantity}× {line.name}
                              </span>
                            </div>
                          ))}
                        </div>
                        <strong>{formatINR(order.total_paise)}</strong>
                        <Badge
                          tone={order.payment_method === "CASH" ? "amber" : "success"}
                        >
                          {order.payment_method === "CASH" ? "Collect cash" : "Paid online"}
                        </Badge>
                      </div>

                      <div className="delivery-order-actions">
                        {order.address && (
                          <a
                            className="button button-secondary"
                            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                              order.latitude && order.longitude
                                ? `${order.latitude},${order.longitude}`
                                : order.address,
                            )}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Navigation size={15} /> Navigate to Stop {index + 1}{" "}
                            <ExternalLink size={13} />
                          </a>
                        )}

                        <form
                          className="delivery-otp-form"
                          onSubmit={(event) => void verifyOtp(event, order)}
                        >
                          <label className="otp-field">
                            <ShieldCheck size={16} />
                            <input
                              inputMode="numeric"
                              pattern="\d{6}"
                              maxLength={6}
                              placeholder="Customer's 6-digit code"
                              aria-label="Delivery verification code"
                              value={codes[order.order_id] || ""}
                              onChange={(event) =>
                                setCodes((prev) => ({
                                  ...prev,
                                  [order.order_id]: event.target.value
                                    .replace(/\D/g, "")
                                    .slice(0, 6),
                                }))
                              }
                            />
                          </label>
                          <Button
                            type="submit"
                            size="button-sm"
                            disabled={busy === order.order_id}
                          >
                            {busy === order.order_id ? (
                              "Checking…"
                            ) : (
                              <>
                                Verify & complete <Check size={14} />
                              </>
                            )}
                          </Button>
                        </form>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : (
            /* NO ACTIVE DELIVERIES -> SHOW AVAILABLE ORDERS / CLUSTERS */
            <section className="delivery-available-section">
              {/* Case 1: Single order at the moment -> show only that single order */}
              {suggestedBatches.single_order && (suggestedBatches.order || suggestedBatches.clusters[0]?.orders[0]) ? (
                (() => {
                  const single = suggestedBatches.order || suggestedBatches.clusters[0].orders[0];
                  return (
                    <div style={{ marginBottom: "1.5rem" }}>
                      <div className="section-header" style={{ marginBottom: "1rem" }}>
                        <div>
                          <h2>Single order ready for delivery</h2>
                          <span>
                            Only 1 order is ready for pickup right now. Claim it directly to deliver.
                          </span>
                        </div>
                      </div>

                      <article
                        className="delivery-order-card"
                        style={{ border: "2px solid #b8deaf", boxShadow: "0 3px 12px rgba(43,122,75,0.08)" }}
                      >
                        <div className="delivery-order-index" style={{ background: "#f2f9ef", color: "#2b7a4b" }}>
                          <span>01</span>
                        </div>
                        <div className="delivery-order-main">
                          <div className="delivery-order-top">
                            <div>
                              <span className="delivery-time">
                                READY FOR PICKUP · {friendlyDate(single.created_at)}
                              </span>
                              <h3>Order #{single.order_id}</h3>
                              {typeof (suggestedBatches.round_trip_km ?? suggestedBatches.clusters?.[0]?.round_trip_km) === "number" && (
                                <div
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    marginTop: "6px",
                                    padding: "3px 10px",
                                    borderRadius: "999px",
                                    background: "#e8f5e9",
                                    color: "#1b5e20",
                                    fontSize: "12px",
                                    fontWeight: 700,
                                  }}
                                >
                                  <RouteIcon size={14} />
                                  <span>Round-trip distance: {(suggestedBatches.round_trip_km ?? suggestedBatches.clusters?.[0]?.round_trip_km)?.toFixed(1)} km</span>
                                </div>
                              )}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <Button
                                size="button-sm"
                                variant="secondary"
                                onClick={() => setPreviewSingleOrder((prev) => !prev)}
                              >
                                <RouteIcon size={14} />
                                {previewSingleOrder ? "Hide route" : "Show route"}
                              </Button>
                              <Button
                                size="button-sm"
                                disabled={batchBusy}
                                onClick={() => void claimSingleOrder(single.order_id)}
                              >
                                {batchBusy ? "Claiming…" : <>Accept delivery <ArrowRight size={14} /></>}
                              </Button>
                            </div>
                          </div>

                          {previewSingleOrder && (
                            <div style={{ marginTop: "14px", width: "100%" }}>
                              <DeliveryWaypointsMap
                                restaurantLat={suggestedBatches.restaurant_latitude}
                                restaurantLng={suggestedBatches.restaurant_longitude}
                                orders={[single]}
                              />
                            </div>
                          )}

                          <div className="delivery-customer-info">
                            <div className="customer-detail">
                              <span className="customer-detail-icon">
                                <UserRound size={16} />
                              </span>
                              <span>
                                <small>Deliver to</small>
                                <strong>{single.customer_name}</strong>
                              </span>
                            </div>
                            <div className="customer-detail customer-address">
                              <span className="customer-detail-icon">
                                <MapPin size={16} />
                              </span>
                              <span>
                                <small>Address</small>
                                <strong>{single.address || "Address on record"}</strong>
                              </span>
                            </div>
                            {single.customer_phone && (
                              <div className="customer-detail">
                                <span className="customer-detail-icon">
                                  <Phone size={16} />
                                </span>
                                <span>
                                  <small>Phone</small>
                                  <strong>{single.customer_phone}</strong>
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="delivery-order-items">
                            <div className="delivery-menu-lines">
                              {single.items.map((line) => (
                                <span key={`${line.menu_item_id}-${line.name}`} style={{ marginRight: "10px" }}>
                                  {line.quantity}× {line.name}
                                </span>
                              ))}
                            </div>
                            <strong>{formatINR(single.total_paise)}</strong>
                            <Badge tone={single.payment_method === "CASH" ? "amber" : "success"}>
                              {single.payment_method === "CASH" ? "Collect cash" : "Paid online"}
                            </Badge>
                          </div>
                        </div>
                      </article>
                    </div>
                  );
                })()
              ) : suggestedBatches.clusters.length > 0 ? (
                /* Case 2: Multiple orders -> clustered into n groups based on active drivers */
                <div style={{ marginBottom: "1.5rem" }}>
                  <div className="section-header" style={{ marginBottom: "1rem" }}>
                    <div>
                      <h2>Available delivery clusters</h2>
                      <span>
                        Orders clustered into {suggestedBatches.clusters.length} delivery group{suggestedBatches.clusters.length === 1 ? "" : "s"} for {suggestedBatches.active_riders} active driver{suggestedBatches.active_riders === 1 ? "" : "s"}.
                      </span>
                    </div>
                  </div>

                    <div className="delivery-available-list" style={{ display: "flex", flexDirection: "column", gap: "14px", width: "100%" }}>
                    {suggestedBatches.clusters.map((cluster) => (
                      <article
                        className="delivery-available-card"
                        key={cluster.id}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "stretch",
                          gap: "14px",
                          padding: "18px 20px",
                          border: "1px solid #e9e6de",
                          borderRadius: "14px",
                          background: "#fff",
                          width: "100%",
                          textAlign: "left",
                        }}
                      >
                        {/* Header: Left-aligned route title and stats */}
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                            borderBottom: "1px solid #f0eee5",
                            paddingBottom: "12px",
                            textAlign: "left",
                            width: "100%",
                          }}
                        >
                          <strong style={{ fontSize: "16px", fontWeight: 800, textAlign: "left" }}>
                            {cluster.route_label}
                          </strong>
                          <div style={{ fontSize: "12.5px", color: "var(--muted)", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
                            <span>{cluster.orders.length} stop{cluster.orders.length === 1 ? "" : "s"} · Est. value: {formatINR(cluster.orders.reduce((sum, o) => sum + o.total_paise, 0))}</span>
                            {typeof cluster.round_trip_km === "number" && (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "5px",
                                  padding: "3px 10px",
                                  borderRadius: "999px",
                                  background: "#e8f5e9",
                                  color: "#1b5e20",
                                  fontWeight: 700,
                                  fontSize: "12px",
                                }}
                              >
                                <RouteIcon size={13} />
                                Round trip: {cluster.round_trip_km.toFixed(1)} km
                              </span>
                            )}
                          </div>
                        </div>

                        {/* List stops in cluster: Left-aligned and full width */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
                          {cluster.orders.map((o, stopIndex) => (
                            <div
                              key={o.order_id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "10px",
                                fontSize: "12.5px",
                                background: "#faf9f6",
                                padding: "9px 12px",
                                borderRadius: "8px",
                                width: "100%",
                                textAlign: "left",
                              }}
                            >
                              <span
                                style={{
                                  width: "22px",
                                  height: "22px",
                                  borderRadius: "50%",
                                  background: "#2b7a4b",
                                  color: "#fff",
                                  fontSize: "11px",
                                  fontWeight: 800,
                                  display: "grid",
                                  placeItems: "center",
                                  flexShrink: 0,
                                }}
                              >
                                {stopIndex + 1}
                              </span>
                              <strong style={{ minWidth: "90px" }}>Order #{o.order_id}</strong>
                              <span style={{ fontWeight: 600 }}>{o.customer_name}</span>
                              <span style={{ color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                · {o.address || "Address on record"}
                              </span>
                              <span style={{ marginLeft: "auto", fontWeight: 700 }}>
                                {formatINR(o.total_paise)}
                              </span>
                            </div>
                          ))}
                        </div>

                        {previewClusterId === cluster.id && (
                          <div style={{ width: "100%", marginTop: "8px" }}>
                            <DeliveryWaypointsMap
                              restaurantLat={suggestedBatches.restaurant_latitude}
                              restaurantLng={suggestedBatches.restaurant_longitude}
                              orders={cluster.orders}
                            />
                          </div>
                        )}

                        {/* Button positioned at the bottom right with Show route on left */}
                        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "10px", width: "100%", paddingTop: "4px" }}>
                          <Button
                            size="button-sm"
                            variant="secondary"
                            onClick={() =>
                              setPreviewClusterId((prev) => (prev === cluster.id ? null : cluster.id))
                            }
                          >
                            <RouteIcon size={14} />
                            {previewClusterId === cluster.id ? "Hide route" : "Show route"}
                          </Button>
                          <Button
                            size="button-sm"
                            disabled={batchBusy}
                            onClick={() =>
                              void claimBatch(cluster.orders.map((o) => o.order_id))
                            }
                          >
                            {batchBusy ? (
                              "Accepting…"
                            ) : (
                              <>
                                Accept delivery ({cluster.orders.length} stops) <ArrowRight size={14} />
                              </>
                            )}
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : (
                /* Case 3: 0 ready orders */
                <EmptyState
                  icon={<PackageCheck size={24} />}
                  title="No deliveries waiting for pickup"
                  description="The kitchen will notify you when fresh orders are prepared and ready for dispatch."
                />
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
