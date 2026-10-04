import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  ClipboardList,
  ExternalLink,
  MapPin,
  Navigation,
  PackageCheck,
  Phone,
  Route as RouteIcon,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Link, Route, Routes } from "react-router-dom";
import { api, formatINR, friendlyDate, type Order } from "../api";
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

function Queue() {
  const [deliveryTab, setDeliveryTab] = useState<"NOW" | "PAST">("NOW");
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [routeLabel, setRouteLabel] = useState("Nearby route");
  const [search, setSearch] = useState("");
  const [batches, setBatches] = useState<
    {
      id: number;
      route_label: string;
      order_ids: string[];
      created_at: string;
    }[]
  >([]);
  const [suggestedBatches, setSuggestedBatches] = useState<{ active_riders: number; restaurant_latitude: number | null; restaurant_longitude: number | null; clusters: { id: string; route_label: string; orders: Order[] }[] }>({ active_riders: 0, restaurant_latitude: null, restaurant_longitude: null, clusters: [] });
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(
    () =>
      Promise.all([
        api<Order[]>("/delivery/queue"),
        api<typeof batches>("/delivery/batches"),
        api<typeof suggestedBatches>("/delivery/recommended-batches"),
      ])
        .then(([queue, routeBatches, recommendations]) => {
          setOrders(queue);
          setBatches(routeBatches);
          setSuggestedBatches(recommendations);
          setSelected((previous) =>
            previous.filter((id) => queue.some((order) => order.order_id === id)),
          );
        })
        .catch((err) =>
          setError(
            err instanceof Error
              ? err.message
              : "Could not load your delivery queue.",
          ),
        )
        .finally(() => setLoading(false)),
    [],
  );
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const sameRoute = true;
  const matchesSearch = (order: Order) =>
    `${order.order_id} ${order.customer_name} ${order.customer_phone || ""}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase());
  const visibleOrders = orders.filter(matchesSearch);
  function toggle(id: string) {
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id],
    );
  }

  async function takeBatch(orderIds: string[]) {
    setBatchBusy(true);
    setError("");
    try {
      await api("/delivery/recommended-batches/claim", { method: "POST", body: JSON.stringify({ order_ids: orderIds }) });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not take this delivery batch.");
    } finally {
      setBatchBusy(false);
    }
  }

  async function makeRoute() {
    setBatchBusy(true);
    setError("");
    try {
      await api("/delivery/batches", {
        method: "POST",
        body: JSON.stringify({ order_ids: selected, route_label: routeLabel }),
      });
      setSelected([]);
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not create this route batch.",
      );
    } finally {
      setBatchBusy(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>, order: Order) {
    event.preventDefault();
    const code = codes[order.order_id] || "";
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the customer’s six-digit delivery code.");
      return;
    }
    setBusy(order.order_id);
    setError("");
    try {
      await api(`/delivery/orders/${order.order_id}/verify-otp`, {
        method: "POST",
        body: JSON.stringify({ otp: code }),
      });
      setCodes((previous) => ({ ...previous, [order.order_id]: "" }));
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That delivery code could not be verified.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Loading label="Finding your deliveries…" />;
  return (
    <>
      <PageTitle
        eyebrow="YOUR NEXT STOP"
        title="Delivery queue"
        description="Your active deliveries, customer details and route tools in one place."
        action={
          <span className="live-indicator">
            <span className="pulse-dot" /> {orders.length} active
          </span>
        }
      />
      <div className="filter-tabs delivery-view-tabs"><button type="button" className={deliveryTab === "NOW" ? "active" : ""} onClick={() => setDeliveryTab("NOW")}>Deliveries now</button><button type="button" className={deliveryTab === "PAST" ? "active" : ""} onClick={() => setDeliveryTab("PAST")}>Past deliveries</button></div>
      {error && <Notice onDismiss={() => setError("")}>{error}</Notice>}
      {deliveryTab === "PAST" ? <PastDeliveries /> : <>
      <label className="menu-search delivery-search">
        <Search size={17} />
        <input
          type="search"
          aria-label="Search deliveries"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search customer, address, or phone number"
        />
      </label>
      {!!suggestedBatches.clusters.length && (
        <section className="delivery-available">
          <div className="section-header">
            <div>
              <h2>Ready for pickup</h2>
              <span>
                {suggestedBatches.active_riders || 1} active rider{suggestedBatches.active_riders === 1 ? "" : "s"} · claim a route before another rider does.
              </span>
            </div>
          </div>
          <div className="delivery-available-list">
            {suggestedBatches.clusters.map((cluster) => (
              <article className="delivery-available-card" key={cluster.id}>
                <div>
                  <strong>{cluster.route_label} · {cluster.orders.length} stop{cluster.orders.length === 1 ? "" : "s"}</strong>
                  <span>{cluster.orders.map((order) => order.order_id).join("  |  ")}</span>
                </div>
                <Button
                  size="button-sm"
                  disabled={batchBusy}
                  onClick={() => void takeBatch(cluster.orders.map((order) => order.order_id))}
                >
                  {batchBusy ? "Taking…" : <>Take route <ArrowRight size={14} /></>}
                </Button>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="delivery-summary">
        <div>
          <span className="delivery-summary-icon">
            <PackageCheck size={20} />
          </span>
          <span>
            <strong>{orders.length}</strong>
            <small>orders to deliver</small>
          </span>
        </div>
        <div>
          <span className="delivery-summary-icon">
            <RouteIcon size={20} />
          </span>
          <span>
            <strong>{batches.length}</strong>
            <small>routes planned</small>
          </span>
        </div>
        <span className="delivery-summary-note">
          Take the shortest route, make someone’s day.
        </span>
      </div>
      {!orders.length ? (
        <EmptyState
          icon={<PackageCheck size={21} />}
          title="No deliveries in your queue"
          description="Take an order from Ready for pickup when you’re ready to go."
        />
      ) : !visibleOrders.length ? (
        <EmptyState
          icon={<Search size={21} />}
          title="No matching deliveries"
          description="Try a customer name, address, or phone number."
        />
      ) : (
        <>
          <div className="delivery-route-builder">
            <div className="route-builder-copy">
              <span className="route-builder-icon">
                <Navigation size={18} />
              </span>
              <div>
                <strong>Plan a neighborhood route</strong>
                <small>
                  Choose deliveries going to the same pin code or nearby
                  locality.
                </small>
              </div>
            </div>
            <div className="route-builder-controls">
              <input
                maxLength={120}
                aria-label="Route name"
                value={routeLabel}
                onChange={(event) => setRouteLabel(event.target.value)}
              />
              <Button
                size="button-sm"
                disabled={!selected.length || !sameRoute || batchBusy}
                onClick={() => void makeRoute()}
              >
                {batchBusy
                  ? "Saving…"
                  : `Plan route${selected.length ? ` · ${selected.length}` : ""}`}{" "}
                <ArrowRight size={14} />
              </Button>
            </div>
            {!sameRoute && (
              <span className="route-warning">
                Pick orders in the same neighborhood.
              </span>
            )}
          </div>
          <div className="delivery-order-list">
            {visibleOrders.map((order, index) => (
              <article className="delivery-order-card" key={order.order_id}>
                <div className="delivery-order-index">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <label className="route-select">
                    <input
                      type="checkbox"
                      aria-label={`Add ${order.order_id} to route`}
                      checked={selected.includes(order.order_id)}
                      onChange={() => toggle(order.order_id)}
                    />
                    <span />
                  </label>
                </div>
                <div className="delivery-order-main">
                  <div className="delivery-order-top">
                    <div>
                      <span className="delivery-time">
                        TAKEN · {friendlyDate(order.created_at)}
                      </span>
                      <h3>{order.order_id}</h3>
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
                        <small>Address</small>
                        <strong>Address provided at checkout</strong>
                      </span>
                    </div>
                    <div className="customer-detail">
                      <span className="customer-detail-icon">
                        <Phone size={16} />
                      </span>
                      <span>
                        <small>Phone</small>
                        {order.customer_phone ? (
                          <a href={`tel:${order.customer_phone}`}>
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
                        <div className="delivery-menu-line" key={`${line.menu_item_id}-${line.name}`}>
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
                      tone={
                        order.payment_method === "CASH" ? "amber" : "success"
                      }
                    >
                      {order.payment_method === "CASH"
                        ? "Collect cash"
                        : "Paid online"}
                    </Badge>
                  </div>
                  <div className="delivery-order-actions">
                    <a
                      className="button button-secondary"
                      href={undefined}
                      target="_blank"
                      rel="noreferrer"
                      aria-disabled="true"
                    >
                      <Navigation size={15} /> Navigate{" "}
                      <ExternalLink size={13} />
                    </a>
                    <form
                      className="delivery-otp-form"
                      onSubmit={(event) => void verify(event, order)}
                    >
                      <label className="otp-field">
                        <ShieldCheck size={16} />
                        <input
                          inputMode="numeric"
                          pattern="\d{6}"
                          maxLength={6}
                          placeholder="Customer’s 6-digit code"
                          aria-label="Delivery verification code"
                          value={codes[order.order_id] || ""}
                          onChange={(event) =>
                            setCodes((previous) => ({
                              ...previous,
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
        </>
      )}
      {!!batches.length && (
        <div className="recent-routes">
          <div className="section-header">
            <div>
              <h2>Planned routes</h2>
              <span>Routes you’ve grouped together</span>
            </div>
            <Link className="reorder-link" to="/delivery/routes">
              View all <ArrowRight size={15} />
            </Link>
          </div>
          {batches.slice(0, 3).map((batch) => (
            <div className="recent-route-row" key={batch.id}>
              <span className="route-icon-small">
                <RouteIcon size={15} />
              </span>
              <strong>{batch.route_label}</strong>
              <span>{batch.order_ids.length} stops</span>
              <small>{friendlyDate(batch.created_at)}</small>
            </div>
          ))}
        </div>
      )}
      </>}
    </>
  );
}

function PastDeliveries() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api<Order[]>("/delivery/history").then(setOrders).finally(() => setLoading(false)); }, []);
  if (loading) return <Loading label="Loading past deliveries…" />;
  return !orders.length ? <EmptyState icon={<PackageCheck size={21} />} title="No past deliveries yet" description="Completed deliveries will appear here." /> : <div className="delivery-order-list">{orders.map((order) => <article className="delivery-order-card" key={order.order_id}><div className="delivery-order-main"><div className="delivery-order-top"><div><span className="delivery-time">DELIVERED · {friendlyDate(order.created_at)}</span><h3>{order.order_id}</h3></div><StatusBadge status={order.status} /></div><div className="delivery-customer-info"><div className="customer-detail"><span className="customer-detail-icon"><UserRound size={16} /></span><span><small>Delivered to</small><strong>{order.customer_name}</strong></span></div></div></div></article>)}</div>;
}

function RoutesPage() {
  const [batches, setBatches] = useState<
    {
      id: number;
      route_label: string;
      order_ids: number[];
      created_at: string;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<typeof batches>("/delivery/batches")
      .then(setBatches)
      .finally(() => setLoading(false));
  }, []);
  return (
    <>
      <PageTitle
        eyebrow="ROUTES WITH A RHYTHM"
        title="Route batches"
        description="Your neighborhood delivery runs, grouped in sensible stops."
        action={
          <Link className="button button-secondary" to="/delivery">
            <ClipboardList size={15} /> Delivery queue
          </Link>
        }
      />
      {loading ? (
        <Loading label="Loading route history…" />
      ) : !batches.length ? (
        <EmptyState
          icon={<RouteIcon size={20} />}
          title="No routes planned yet"
          description="Group a couple of nearby deliveries from your queue to get started."
          action={
            <Link to="/delivery" className="button button-dark">
              Go to my queue <ArrowRight size={15} />
            </Link>
          }
        />
      ) : (
        <div className="route-history-list">
          {batches.map((batch, index) => (
            <article className="route-history-card" key={batch.id}>
              <span className="route-history-n">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="route-history-main">
                <span className="eyebrow">
                  ROUTE · {friendlyDate(batch.created_at)}
                </span>
                <h2>{batch.route_label}</h2>
                <div className="route-history-stops">
                  {batch.order_ids.map((id, stop) => (
                    <span key={id}>
                      <i>{stop + 1}</i> Order #{id}
                    </span>
                  ))}
                </div>
              </div>
              <Badge tone="soft">{batch.order_ids.length} stops</Badge>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

export default function Delivery() {
  return (
    <Routes>
      <Route index element={<Queue />} />
      <Route path="routes" element={<RoutesPage />} />
      <Route
        path="*"
        element={
          <EmptyState
            title="This route isn’t on the map"
            description="Choose an option from your delivery workspace."
            action={
              <Link className="button button-secondary" to="/delivery">
                Back to my queue
              </Link>
            }
          />
        }
      />
    </Routes>
  );
}
