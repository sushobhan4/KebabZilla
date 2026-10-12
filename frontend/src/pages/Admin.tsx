import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { usePreference } from "../cookies";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  ArrowUpRight,
  BarChart3,
  Check,
  CircleDollarSign,
  Clock,
  CookingPot,
  CreditCard,
  Edit3,
  Flame,
  LayoutDashboard,
  Plus,
  Percent,
  RefreshCw,
  RotateCw,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Truck,
  UploadCloud,
  Image as ImageIcon,
  Users,
  X,
  ZoomIn,
  ZoomOut,
  Crop,
  Star,
} from "lucide-react";
import { Link, Route, Routes } from "react-router-dom";
import {
  api,
  formatINR,
  formatStatus,
  friendlyDate,
  deleteMenuImage,
  getCustomItemLowestPrice,
  getMenuItemLowestPrice,
  resolveImageUrl,
  uploadMenuImage,
  type Account,
  type CustomMenuItem,
  type CustomMenuSection,
  type MenuItem,
  type Order,
  type ProvisionedAccount,
  type Restaurant,
  type Role,
} from "../api";
import { useAuth } from "../state";
import {
  Badge,
  Button,
  EmptyState,
  Loading,
  MenuImageCarousel,
  Notice,
  PageTitle,
  RoundedDatePicker,
  RoundedSelect,
  RoundedTimePicker,
  StatusBadge,
} from "../components";

type Report = {
  period: string;
  revenue_paise: number;
  paid_orders: number;
  total_orders: number;
  average_order_paise: number;
  statuses: Record<string, number>;
  series: { label: string; revenue_paise: number; orders: number }[];
  top_items: { name: string; quantity: number }[];
};
type PageData<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  status_counts?: Record<string, number>;
  role_counts?: Record<string, number>;
  paid_revenue_paise?: number;
};
const roles: Role[] = ["ADMIN", "EMPLOYEE", "DELIVERY", "USER"];
const provisionableRoles: Role[] = ["ADMIN", "EMPLOYEE", "DELIVERY"];
const orderNext: Record<string, string[]> = {
  PLACED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["PREPARING"],
  PREPARING: ["READY"],
  READY: [],
  OUT_FOR_DELIVERY: [],
};
const adminPageSize = 25;
const amtalaMapCenter: google.maps.LatLngLiteral = { lat: 22.365278, lng: 88.269444 };
let restaurantMapsPromise: Promise<google.maps.MapsLibrary> | null = null;

function loadRestaurantMaps(key: string) {
  if (!restaurantMapsPromise) { setOptions({ key, language: "en", region: "IN" }); restaurantMapsPromise = importLibrary("maps") as Promise<google.maps.MapsLibrary>; }
  return restaurantMapsPromise;
}

function PageControls({
  limit,
  offset,
  total,
  onChange,
}: {
  limit: number;
  offset: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="pagination">
      <span>
        Showing {from}–{to} of {total}
      </span>
      <div>
        <Button
          variant="secondary"
          size="button-sm"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="button-sm"
          disabled={to >= total}
          onClick={() => onChange(offset + limit)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function Overview() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [orderSummary, setOrderSummary] = useState<PageData<Order> | null>(
    null,
  );
  const [accountSummary, setAccountSummary] =
    useState<PageData<Account> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<
    { id: number; message: string; actor_name: string; created_at: string }[]
  >([]);
  const refresh = useCallback(
    () =>
      Promise.all([
        api<PageData<Order>>("/admin/orders?limit=5"),
        api<PageData<Account>>("/admin/accounts?limit=5"),
        api<Report>("/admin/reports/sales?period=week"),
        api<typeof events>("/admin/events?limit=12"),
      ])
        .then(([ordersData, people, sales, log]) => {
          setOrders(ordersData.items);
          setOrderSummary(ordersData);
          setAccountSummary(people);
          setReport(sales);
          setEvents(log);
        })
        .catch((err) =>
          setError(
            err instanceof Error
              ? err.message
              : "Could not load your restaurant overview.",
          ),
        )
        .finally(() => setLoading(false)),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (loading) return <Loading label="Setting the table…" />;
  const openOrders = [
    "PLACED",
    "ACCEPTED",
    "PREPARING",
    "READY",
    "OUT_FOR_DELIVERY",
  ].reduce(
    (sum, status) => sum + (orderSummary?.status_counts?.[status] || 0),
    0,
  );
  const maxRevenue = Math.max(
    1,
    ...(report?.series || []).map((item) => item.revenue_paise),
  );
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return (
    <>
      <PageTitle
        eyebrow="A LITTLE LOOK AROUND"
        title={`${greeting}.`}
        description="Here’s what’s cooking at KebabZilla today."
        action={
          <Button
            variant="secondary"
            onClick={() => {
              setLoading(true);
              void refresh();
            }}
          >
            <RefreshCw size={15} /> <span>Refresh</span>
          </Button>
        }
      />
      {error && <Notice>{error}</Notice>}
      <section className="admin-stat-grid">
        <div className="admin-stat-card admin-stat-revenue">
          <div className="admin-stat-top">
            <span className="admin-stat-icon">
              <CircleDollarSign size={18} />
            </span>
            <span className="admin-stat-period">THIS WEEK</span>
          </div>
          <div className="admin-stat-number">
            {formatINR(report?.revenue_paise || 0)}
          </div>
          <div className="admin-stat-foot">
            <span>Paid revenue</span>
            <span className="stat-up">
              <ArrowUpRight size={13} /> Sales
            </span>
          </div>
          <div className="stat-ribbon" />
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-icon stat-icon-soft-red">
              <ShoppingBag size={18} />
            </span>
            <Link className="stat-open-link" to="/admin/orders">
              <ArrowRight size={15} />
            </Link>
          </div>
          <div className="admin-stat-number">
            {orderSummary?.status_counts
              ? Object.values(orderSummary.status_counts).reduce(
                  (sum, count) => sum + count,
                  0,
                )
              : 0}
          </div>
          <div className="admin-stat-foot">
            <span>Orders recorded</span>
            <span className="stat-highlight">{openOrders} active now</span>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-icon stat-icon-soft-green">
              <Users size={18} />
            </span>
            <Link className="stat-open-link" to="/admin/team">
              <ArrowRight size={15} />
            </Link>
          </div>
          <div className="admin-stat-number">
            {accountSummary?.total || 0}
          </div>
          <div className="admin-stat-foot">
            <span>Active accounts</span>
            <span className="stat-highlight">
              {accountSummary?.role_counts?.EMPLOYEE || 0} employees
            </span>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-top">
            <span className="admin-stat-icon stat-icon-soft-amber">
              <Truck size={18} />
            </span>
            <Link className="stat-open-link" to="/admin/orders">
              <ArrowRight size={15} />
            </Link>
          </div>
          <div className="admin-stat-number">
            {orderSummary?.status_counts?.OUT_FOR_DELIVERY || 0}
          </div>
          <div className="admin-stat-foot">
            <span>Out with a rider</span>
            <span className="stat-highlight">Being delivered</span>
          </div>
        </div>
      </section>
      <div className="admin-overview-grid">
        <section className="admin-panel sales-overview">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">THE WEEK SO FAR</span>
              <h2>Sales at a glance</h2>
            </div>
            <Link to="/admin/reports" className="panel-link">
              Full report <ArrowRight size={14} />
            </Link>
          </div>
          <div className="sales-chart">
            <div className="chart-axis">
              <span>{formatINR(maxRevenue)}</span>
              <span>{formatINR(Math.round(maxRevenue / 2))}</span>
              <span>₹0</span>
            </div>
            <div className="chart-bars">
              {(report?.series || []).map((point, index) => (
                <div className="chart-bar-wrap" key={`${point.label}-${index}`}>
                  <span className="chart-tip">
                    {formatINR(point.revenue_paise)}
                    <small>{point.orders} orders</small>
                  </span>
                  <div
                    className={`chart-bar ${index === (report?.series.length || 1) - 1 ? "bar-highlight" : ""}`}
                    style={{
                      height: `${Math.max(point.revenue_paise ? 8 : 3, (point.revenue_paise / maxRevenue) * 100)}%`,
                    }}
                  />
                  <span className="chart-label">{point.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="sales-chart-foot">
            <span>
              <i className="legend-dot" /> Paid sales
            </span>
            <strong>
              {formatINR(report?.average_order_paise || 0)}
              <small> avg. paid order</small>
            </strong>
          </div>
        </section>
        <section className="admin-panel top-items-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">PEOPLE KEEP COMING BACK FOR</span>
              <h2>Top of the grill</h2>
            </div>
            <span className="mini-panel-icon">
              <Flame size={16} />
            </span>
          </div>
          {report?.top_items.length ? (
            <div className="top-items-list">
              {report.top_items.map((item, index) => (
                <div className="top-item-row" key={item.name}>
                  <span className={`top-item-n top-item-n-${index}`}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>Hot off the grill</small>
                  </div>
                  <Badge tone="soft">{item.quantity} sold</Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Waiting for the first orders"
              description="Menu favorites will show up here."
            />
          )}
          <Link to="/admin/menu" className="manage-menu-link">
            <CookingPot size={15} /> Manage the menu <ArrowRight size={14} />
          </Link>
        </section>
      </div>
      <section className="admin-panel recent-orders-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">THE LATEST FROM THE PASS</span>
            <h2>Recent orders</h2>
          </div>
          <Link to="/admin/orders" className="panel-link">
            See all orders <ArrowRight size={14} />
          </Link>
        </div>
        {orders.slice(0, 5).length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ORDER</th>
                  <th>GUEST</th>
                  <th>WHEN</th>
                  <th>TOTAL</th>
                  <th>STATUS</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 5).map((order) => (
                  <tr key={order.order_id}>
                    <td>
                      <strong className="mono-id">{order.order_id}</strong>
                    </td>
                    <td>
                      <span className="table-person">
                        {order.customer_name}
                      </span>
                    </td>
                    <td>{friendlyDate(order.created_at)}</td>
                    <td>
                      <strong>{formatINR(order.total_paise)}</strong>
                    </td>
                    <td>
                      <StatusBadge status={order.status} />
                    </td>
                    <td>
                      <Link className="table-arrow" to="/admin/orders">
                        <ArrowRight size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No orders yet"
            description="Once someone places an order, you’ll find it here."
          />
        )}
      </section>
      <section className="admin-panel recent-orders-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">RESTAURANT ACTIVITY</span>
            <h2>Notifications & event log</h2>
          </div>
          <Link className="panel-link" to="/admin/activity">
            All updates <ArrowRight size={14} />
          </Link>
        </div>
        {events.map((event) => (
          <div className="status-break-row" key={event.id}>
            <span>{event.message}</span>
            <small>
              {event.actor_name} · {friendlyDate(event.created_at)}
            </small>
          </div>
        ))}
      </section>
      <div className="admin-quick-actions">
        <div>
          <span className="quick-action-icon">
            <Users size={17} />
          </span>
          <span>
            <strong>Grow your crew</strong>
            <small>Add an employee or delivery partner.</small>
          </span>
          <Link to="/admin/team" aria-label="Manage team">
            <ArrowRight size={16} />
          </Link>
        </div>
        <div>
          <span className="quick-action-icon quick-action-coral">
            <Settings size={17} />
          </span>
          <span>
            <strong>Restaurant details</strong>
            <small>Opening hours, taxes and delivery fee.</small>
          </span>
          <Link to="/admin/settings" aria-label="Restaurant settings">
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </>
  );
}

function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [pageData, setPageData] = useState<PageData<Order> | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = usePreference<string>("admin_orders_filter", "ALL");
  const [period, setPeriod] = usePreference<string>("admin_orders_period", "all");
  const [q, setQ] = useState("");
  const refresh = useCallback(() => {
    const statusQuery = filter === "ALL" ? "" : `&status_filter=${filter}`;
    return api<PageData<Order>>(
      `/admin/orders?limit=${adminPageSize}&offset=${page * adminPageSize}${statusQuery}&period=${period}&q=${encodeURIComponent(q)}`,
    )
      .then((result) => {
        setPageData(result);
        setOrders(result.items);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load orders."),
      )
      .finally(() => setLoading(false));
  }, [filter, page, period, q]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const filtered = orders;
  function selectFilter(value: string) {
    setFilter(value);
    setPage(0);
    setLoading(true);
  }
  async function update(order: Order, status: string) {
    setBusyId(order.order_id);
    setError("");
    try {
      await api(`/admin/orders/${order.order_id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update order.");
    } finally {
      setBusyId(null);
    }
  }

  const [refundOrder, setRefundOrder] = useState<Order | null>(null);
  async function executeRefund(order: Order) {
    setBusyId(order.order_id);
    setError("");
    try {
      await api(`/admin/orders/${order.order_id}/refund`, { method: "POST" });
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not issue this refund.",
      );
    } finally {
      setBusyId(null);
    }
  }
  if (loading) return <Loading label="Getting the order book…" />;
  return (
    <>
      <PageTitle
        eyebrow="EVERY ORDER, ONE VIEW"
        title="Order management"
        description="Review each ticket and keep it moving across the restaurant."
        action={
          <Button
            variant="secondary"
            onClick={() => {
              setLoading(true);
              void refresh();
            }}
          >
            <RefreshCw size={15} /> <span>Refresh</span>
          </Button>
        }
      />
      {error && <Notice>{error}</Notice>}
      <div className="orders-kpi-row">
        <div>
          <strong>
            {pageData?.status_counts
              ? Object.values(pageData.status_counts).reduce(
                  (sum, count) => sum + count,
                  0,
                )
              : 0}
          </strong>
          <span>Total tickets</span>
        </div>
        <div>
          <strong>
            {["PLACED", "ACCEPTED", "PREPARING", "READY"].reduce(
              (sum, status) => sum + (pageData?.status_counts?.[status] || 0),
              0,
            )}
          </strong>
          <span>In the kitchen</span>
        </div>
        <div>
          <strong>{pageData?.status_counts?.OUT_FOR_DELIVERY || 0}</strong>
          <span>Out for delivery</span>
        </div>
        <div>
          <strong>{formatINR(pageData?.paid_revenue_paise || 0)}</strong>
          <span>Paid sales</span>
        </div>
      </div>
      <section className="admin-panel">
        <div className="order-filter-bar">
          <div className="admin-search-sort-controls">
            <label className="admin-search-field"><Search size={16} /><input value={q} onChange={(event) => { setQ(event.target.value); setPage(0); setLoading(true); }} placeholder="Search order number, name or phone" aria-label="Search orders" /></label>
            <RoundedSelect icon={<ArrowUpDown size={15} />} ariaLabel="Filter orders by time" value={period} onChange={(next) => { setPeriod(next); setPage(0); setLoading(true); }} options={[{ value: "all", label: "All time" }, { value: "day", label: "Today" }, { value: "week", label: "This week" }, { value: "month", label: "This month" }, { value: "year", label: "This year" }]} className="orders-period-select activity-sort-select" />
          </div>
          <div className="filter-tabs">
            <button
              className={filter === "ALL" ? "active" : ""}
              onClick={() => selectFilter("ALL")}
            >
              All{" "}
              <b>
                {pageData?.status_counts
                  ? Object.values(pageData.status_counts).reduce(
                      (sum, count) => sum + count,
                      0,
                    )
                  : 0}
              </b>
            </button>
            {[
              "PLACED",
              "PREPARING",
              "READY",
              "OUT_FOR_DELIVERY",
              "DELIVERED",
            ].map((status) => (
              <button
                className={filter === status ? "active" : ""}
                key={status}
                onClick={() => selectFilter(status)}
              >
                {formatStatus(status)}{" "}
                <b>{pageData?.status_counts?.[status] || 0}</b>
              </button>
            ))}
          </div>
        </div>
        {filtered.length ? (
          <div className="admin-order-list">
            {filtered.map((order) => (
              <article className="admin-order-row" key={order.order_id}>
                <div className="admin-order-summary">
                  <div className="admin-order-id">
                    <strong>{order.order_id}</strong>
                    <small>{friendlyDate(order.created_at)}</small>
                  </div>
                  <div className="admin-order-customer">
                    <span className="mini-person">
                      <Users size={14} />
                    </span>
                    <span>
                      <strong>{order.customer_name}</strong>
                      <small>{order.customer_phone || "Phone not provided"}</small>
                    </span>
                  </div>
                  <div className="admin-order-products">
                    <strong>
                      {order.items.reduce(
                        (count, item) => count + item.quantity,
                        0,
                      )}{" "}
                      items
                    </strong>
                    <small>
                      {order.items
                        .slice(0, 2)
                        .map((item) => item.name)
                        .join(", ")}
                      {order.items.length > 2 ? "…" : ""}
                    </small>
                  </div>
                  <div className="admin-order-price">
                    <strong>{formatINR(order.total_paise)}</strong>
                    <small>
                      {formatStatus(order.payment_method)} ·{" "}
                      {formatStatus(order.payment_status)}
                    </small>
                  </div>
                  <StatusBadge status={order.status} />
                </div>
                <div className="admin-order-detail">
                  <span>
                    <Truck size={14} />{" "}
                    {order.order_type === "DELIVERY" ? "Delivery order" : "Restaurant counter pickup"}
                  </span>
                  {order.notes && <span>“{order.notes}”</span>}
                  <div className="admin-order-line-list">
                    {order.items.map((item) => (
                      <div className="admin-order-line" key={`${item.menu_item_id}-${item.name}`}>
                        {(item.image_urls?.length || item.image_url) && (
                          <span className="admin-order-line-art">
                            <MenuImageCarousel
                              images={
                                item.image_urls?.length
                                  ? item.image_urls
                                  : item.image_url
                                    ? [item.image_url]
                                    : []
                              }
                              alt={item.name}
                              className="menu-gallery-order"
                            />
                          </span>
                        )}
                        <span>
                          {item.quantity}× {item.name}
                        </span>
                        <b>{formatINR(item.line_total_paise)}</b>
                      </div>
                    ))}
                  </div>
                  <div className="admin-order-tools">
                    {orderNext[order.status]?.map((status) => (
                      <Button
                        key={status}
                        variant={status === "REJECTED" ? "danger" : "ghost"}
                        size="button-sm"
                        disabled={busyId === order.order_id}
                        onClick={() => void update(order, status)}
                      >
                        {formatStatus(status)}{" "}
                        {status === "ACCEPTED" && <Check size={14} />}
                      </Button>
                    ))}
                    {order.payment_status === "PAID" &&
                      order.payment_method === "RAZORPAY" && (
                        <Button
                          variant="danger"
                          size="button-sm"
                          disabled={busyId === order.order_id}
                          onClick={() => setRefundOrder(order)}
                        >
                          Refund payment <ArrowRight size={13} />
                        </Button>
                      )}
                    {order.payment_status === "REFUND_PENDING" && (
                      <Badge tone="amber">Refund processing</Badge>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<ShoppingBag size={20} />}
            title="No orders in this view"
            description="Choose another order status or check back in a moment."
          />
        )}
        <PageControls
          limit={pageData?.limit || adminPageSize}
          offset={pageData?.offset || 0}
          total={pageData?.total || 0}
          onChange={(next) => {
            setPage(Math.floor(next / adminPageSize));
            setLoading(true);
          }}
        />
      </section>

      {refundOrder && (
        <div
          className="address-map-backdrop"
          style={{
            zIndex: 10005,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRefundOrder(null);
          }}
        >
          <div
            className="address-map-card"
            style={{
              maxWidth: 440,
              padding: "1.75rem",
              textAlign: "center",
              borderRadius: "16px",
              boxShadow: "0 20px 45px rgba(0,0,0,0.22)",
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: "#fef2f2",
                color: "#dc2626",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 1.1rem",
              }}
            >
              <AlertTriangle size={26} />
            </div>
            <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.2rem", color: "#1f2937", fontWeight: 700 }}>
              Issue Razorpay refund?
            </h3>
            <p style={{ margin: "0 0 1.5rem 0", color: "var(--muted)", fontSize: "0.92rem", lineHeight: 1.45 }}>
              Issue a full refund of <strong>{formatINR(refundOrder.total_paise)}</strong> for order{" "}
              <strong>#{refundOrder.order_id}</strong>?
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: "0.85rem" }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRefundOrder(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busyId === refundOrder.order_id}
                onClick={async () => {
                  const target = refundOrder;
                  setRefundOrder(null);
                  if (target) await executeRefund(target);
                }}
              >
                Confirm refund
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Team() {
  const { account } = useAuth();
  const [people, setPeople] = useState<Account[]>([]);
  const [q, setQ] = useState("");
  const [role, setRole] = usePreference<string>("admin_team_role", "ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [history, setHistory] = useState<Order[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [roleCounts, setRoleCounts] = useState<Record<string, number>>({});
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "EMPLOYEE" as Role,
  });
  const [expiryPreset, setExpiryPreset] = useState("30");
  const [customExpiryValue, setCustomExpiryValue] = useState(30);
  const [customExpiryUnit, setCustomExpiryUnit] = useState<"minutes" | "hours">("minutes");

  const effectiveExpiryMinutes = useMemo(() => {
    if (expiryPreset !== "custom") {
      return parseInt(expiryPreset, 10) || 30;
    }
    const val = Number(customExpiryValue) || 30;
    if (customExpiryUnit === "hours") {
      return Math.max(30, Math.round(val * 60));
    }
    return Math.max(30, Math.round(val));
  }, [expiryPreset, customExpiryValue, customExpiryUnit]);

  const durationDescription = useMemo(() => {
    if (effectiveExpiryMinutes % 60 === 0) {
      const h = effectiveExpiryMinutes / 60;
      return h === 1 ? "1 hour" : `${h} hours`;
    }
    return `${effectiveExpiryMinutes} minutes`;
  }, [effectiveExpiryMinutes]);

  const [provisioned, setProvisioned] = useState<ProvisionedAccount | null>(null);
  const refresh = useCallback(
    () =>
      api<PageData<Account>>(
        `/admin/accounts?limit=${adminPageSize}&offset=${page * adminPageSize}&q=${encodeURIComponent(q)}${role !== "ALL" ? `&role=${role}` : ""}&exclude_users=${role === "ALL" && !q.trim()}`,
      )
        .then((result) => {
          setPeople(result.items);
          setTotal(result.total);
          setRoleCounts(result.role_counts || {});
        })
        .catch((err) =>
          setError(
            err instanceof Error ? err.message : "Could not load accounts.",
          ),
        )
        .finally(() => setLoading(false)),
    [page, q, role],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), q ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [refresh, q]);
  async function changeRole(person: Account, next: Role) {
    setBusyId(person.id);
    setError("");
    try {
      await api<Account>(`/admin/accounts/${person.id}/role?role=${next}`, {
        method: "PATCH",
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change role.");
    } finally {
      setBusyId(null);
    }
  }
  async function createPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusyId(-1);
    try {
      const created = await api<ProvisionedAccount>("/admin/accounts", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          invite_expiry_minutes: effectiveExpiryMinutes,
        }),
      });
      setCreating(false);
      setProvisioned(created);
      setForm({
        name: "",
        email: "",
        phone: "",
        role: "EMPLOYEE",
      });
      setExpiryPreset("30");
      setCustomExpiryValue(30);
      setCustomExpiryUnit("minutes");
      setQ("");
      setRole("ALL");
      setPage(0);
      setPeople((old) => [created, ...old].slice(0, adminPageSize));
      setTotal((old) => old + 1);
      setRoleCounts((old) => ({
        ...old,
        [created.role]: (old[created.role] || 0) + 1,
      }));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create account.",
      );
    } finally {
      setBusyId(null);
    }
  }
  async function viewHistory(person: Account) {
    setHistoryId(historyId === person.id ? null : person.id);
    if (historyId === person.id) return;
    try {
      setHistory(await api<Order[]>(`/admin/accounts/${person.id}/orders`));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not load this user’s order history.",
      );
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="PEOPLE MAKE THE PLACE"
        title="People & permissions"
        description="Create and manage restaurant admins, employees, and delivery partners. Customer accounts are created through customer sign-up."
        action={
          <Button className="team-create-btn" onClick={() => setCreating(true)}>
            <Plus size={16} /> <span>Create account</span>
          </Button>
        }
      />
      {error && <Notice onDismiss={() => setError("")}>{error}</Notice>}
      {provisioned && <Notice tone="info" onDismiss={() => setProvisioned(null)}>
        {provisioned.notification_status === "EMAIL_SENT" ? (
          <><strong>{provisioned.name}&apos;s account is ready.</strong> A secure activation link was sent to <strong>{provisioned.email}</strong>. The link is active for the requested duration. They can set their password or sign in with Google.</>
        ) : (
          <><strong>{provisioned.name}&apos;s account was created.</strong> However, the activation email could not be sent (SMTP not configured or delivery error). For security reasons, the activation link was expired immediately. You can re-invite them or reset their password once email delivery is active.</>
        )}
      </Notice>}
      <div className="team-metrics">
        <div>
          <strong>{roleCounts.ADMIN || 0}</strong>
          <span>Admin accounts</span>
        </div>
        <div>
          <strong>{roleCounts.EMPLOYEE || 0}</strong>
          <span>Employee accounts</span>
        </div>
        <div>
          <strong>{roleCounts.DELIVERY || 0}</strong>
          <span>Delivery accounts</span>
        </div>
        <div>
          <strong>{roleCounts.USER || 0}</strong>
          <span>User accounts</span>
        </div>
      </div>
      <section className="admin-panel team-panel">
        <div className="team-filter-row">
          <label className="search-field">
            <Search size={17} />
            <input
              value={q}
              onChange={(event) => {
                setQ(event.target.value);
                setPage(0);
                setLoading(true);
              }}
              placeholder="Search name, email or phone…"
            />
          </label>
          <RoundedSelect className="role-filter-select activity-sort-select" icon={<Users size={15} />} ariaLabel="Sort people by role" value={role} onChange={(next) => { setRole(next); setPage(0); setLoading(true); }} options={[{ value: "ALL", label: "All roles" }, ...roles.map((r) => ({ value: r, label: formatStatus(r) }))]} />
        </div>
        {loading ? (
          <Loading label="Finding people…" />
        ) : people.length ? (
          <div className="table-wrap">
            <table className="data-table people-table">
              <thead>
                <tr>
                  <th>PERSON</th>
                  <th>ROLE</th>
                  <th>JOINED</th>
                  <th>ORDERS</th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <Fragment key={person.id}>
                    <tr>
                      <td>
                        <div className="person-cell">
                          <span
                            className={`person-avatar person-avatar-${person.role.toLowerCase()}`}
                          >
                            {person.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span>
                            <strong>
                              {person.name}
                              {person.id === account?.id && (
                                <small className="you-label">YOU</small>
                              )}
                            </strong>
                            <small>
                              {person.email}
                              {person.phone ? ` · ${person.phone}` : ""}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <RoundedSelect className="role-select" ariaLabel={`Change ${person.name}'s role`} value={person.role} disabled={busyId === person.id || person.id === account?.id} onChange={(next) => void changeRole(person, next as Role)} options={roles.map((r) => ({ value: r, label: formatStatus(r) }))} />
                      </td>
                      <td>
                        {new Intl.DateTimeFormat("en-IN", {
                          dateStyle: "medium",
                        }).format(new Date(person.created_at))}
                      </td>
                      <td>
                        <button
                          className="history-button"
                          onClick={() => void viewHistory(person)}
                        >
                          <ShoppingBag size={14} /> View
                        </button>
                      </td>
                    </tr>
                    {historyId === person.id && (
                      <tr className="history-expanded">
                        <td colSpan={4}>
                          <div className="history-title">
                            <strong>Order history · {person.name}</strong>
                            <button
                              className="text-button"
                              onClick={() => setHistoryId(null)}
                            >
                              Close
                            </button>
                          </div>
                          {history.length ? (
                            <div className="history-orders">
                              {history.map((order) => (
                                <div key={order.order_id}>
                                  <span>{order.order_id}</span>
                                  <span>{friendlyDate(order.created_at)}</span>
                                  <StatusBadge status={order.status} />
                                  <strong>
                                    {formatINR(order.total_paise)}
                                  </strong>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <small>
                              No orders recorded for this customer yet.
                            </small>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Users size={20} />}
            title="No people found"
            description={
              q
                ? "Try another name, email, phone number or role."
                : "Accounts will appear here as guests and team members join."
            }
          />
        )}
        <PageControls
          limit={adminPageSize}
          offset={page * adminPageSize}
          total={total}
          onChange={(next) => {
            setPage(Math.floor(next / adminPageSize));
            setLoading(true);
          }}
        />
      </section>
      {creating && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCreating(false);
          }}
        >
          <section className="modal-card">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">ADD SOMEONE TO THE TABLE</span>
                <h2>Create an account</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setCreating(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <form
              className="modal-form"
              onSubmit={(event) => void createPerson(event)}
            >
              <label className="field-label">
                Full name
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  placeholder="e.g. Asha Kumar"
                />
              </label>
              <label className="field-label">
                Email address
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                  placeholder="asha@example.com"
                />
              </label>
              <label className="field-label">
                Mobile number
                <input
                  type="tel"
                  required
                  value={form.phone}
                  onChange={(event) =>
                    setForm({ ...form, phone: event.target.value })
                  }
                  placeholder="+91 98765 43210"
                />
              </label>
              <div className="modal-two-col">
                <label className="field-label">
                  Role
                  <RoundedSelect value={form.role} onChange={(next) => setForm({ ...form, role: next as Role })} options={provisionableRoles.map((r) => ({ value: r, label: formatStatus(r) }))} />
                </label>
                <label className="field-label">
                  Link active duration
                  <RoundedSelect
                    value={expiryPreset}
                    onChange={(next) => setExpiryPreset(next)}
                    options={[
                      { value: "30", label: "30 minutes (Default / Lowest)" },
                      { value: "60", label: "1 hour" },
                      { value: "120", label: "2 hours" },
                      { value: "360", label: "6 hours" },
                      { value: "1440", label: "24 hours (1 day)" },
                      { value: "2880", label: "48 hours (2 days)" },
                      { value: "custom", label: "Custom duration…" },
                    ]}
                  />
                </label>
              </div>
              {expiryPreset === "custom" && (
                <div className="modal-two-col">
                  <label className="field-label">
                    Custom duration
                    <input
                      type="number"
                      required
                      min={customExpiryUnit === "minutes" ? 30 : 1}
                      step={customExpiryUnit === "minutes" ? 1 : 0.5}
                      value={customExpiryValue}
                      onChange={(e) => setCustomExpiryValue(Math.max(1, Number(e.target.value)))}
                      placeholder={customExpiryUnit === "minutes" ? "Min 30" : "Min 1"}
                    />
                  </label>
                  <label className="field-label">
                    Unit
                    <RoundedSelect
                      value={customExpiryUnit}
                      onChange={(next) => {
                        const unit = next as "minutes" | "hours";
                        setCustomExpiryUnit(unit);
                        if (unit === "minutes" && customExpiryValue < 30) {
                          setCustomExpiryValue(30);
                        } else if (unit === "hours" && customExpiryValue < 1) {
                          setCustomExpiryValue(1);
                        }
                      }}
                      options={[
                        { value: "minutes", label: "Minutes (min 30)" },
                        { value: "hours", label: "Hours" },
                      ]}
                    />
                  </label>
                </div>
              )}
              <Notice tone="info">
                A secure account activation link will be sent to the person&apos;s email address. They will be able to set their password or sign in directly with Google. The link will remain active for <strong>{durationDescription}</strong> (minimum 30 minutes).
              </Notice>
              <div className="modal-actions">
                <Button variant="secondary" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busyId === -1}>
                  {busyId === -1 ? "Creating…" : "Create account"}{" "}
                  <ArrowRight size={15} />
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

async function exportCroppedBlobUnder1MB(
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sWidth: number,
  sHeight: number,
): Promise<Blob> {
  const targetSize = 1000;
  const canvas = document.createElement("canvas");
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context is unavailable.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // White base fill in case source has transparent regions
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetSize, targetSize);

  ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, targetSize, targetSize);

  const maxBytes = 1024 * 1024; // 1MB strictly
  let quality = 0.92;
  let finalBlob: Blob | null = null;

  while (quality >= 0.4) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (blob && blob.size <= maxBytes) {
      finalBlob = blob;
      break;
    }
    quality -= 0.1;
  }

  if (!finalBlob) {
    // Fallback: 800x800 resolution to guarantee under 1MB
    const smallCanvas = document.createElement("canvas");
    smallCanvas.width = 800;
    smallCanvas.height = 800;
    const sCtx = smallCanvas.getContext("2d");
    if (sCtx) {
      sCtx.imageSmoothingEnabled = true;
      sCtx.imageSmoothingQuality = "high";
      sCtx.fillStyle = "#ffffff";
      sCtx.fillRect(0, 0, 800, 800);
      sCtx.drawImage(canvas, 0, 0, 800, 800);
      finalBlob = await new Promise<Blob | null>((resolve) =>
        smallCanvas.toBlob(resolve, "image/jpeg", 0.8),
      );
    }
  }

  if (!finalBlob) {
    throw new Error("Unable to compress image under 1MB limit.");
  }

  return finalBlob;
}

function rotateImage90Degrees(img: HTMLImageElement): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalHeight;
  canvas.height = img.naturalWidth;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(img.src);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((90 * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return Promise.resolve(canvas.toDataURL("image/jpeg", 0.95));
}

function OneToOneCropper({
  imageSrc,
  fileName,
  uploading,
  onCancel,
  onCropAndUpload,
}: {
  imageSrc: string;
  fileName: string;
  uploading: boolean;
  onCancel: () => void;
  onCropAndUpload: (file: File) => void;
}) {
  const VIEWPORT_SIZE = 300;
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [activeSrc, setActiveSrc] = useState(imageSrc);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const [processing, setProcessing] = useState(false);
  const [cropError, setCropError] = useState("");

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setImageSize({ width: w, height: h });
    const minScale = Math.max(VIEWPORT_SIZE / w, VIEWPORT_SIZE / h);
    setZoom(1);
    setPos({
      x: (VIEWPORT_SIZE - w * minScale) / 2,
      y: (VIEWPORT_SIZE - h * minScale) / 2,
    });
  }

  const minScale = imageSize
    ? Math.max(VIEWPORT_SIZE / imageSize.width, VIEWPORT_SIZE / imageSize.height)
    : 1;
  const currentScale = minScale * zoom;

  function clampPos(newX: number, newY: number, scale = currentScale) {
    if (!imageSize) return { x: newX, y: newY };
    const w = imageSize.width * scale;
    const h = imageSize.height * scale;
    const minX = VIEWPORT_SIZE - w;
    const minY = VIEWPORT_SIZE - h;
    return {
      x: Math.min(0, Math.max(minX, newX)),
      y: Math.min(0, Math.max(minY, newY)),
    };
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (uploading || processing) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    isDragging.current = true;
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      posX: pos.x,
      posY: pos.y,
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPos(clampPos(dragStart.current.posX + dx, dragStart.current.posY + dy));
  }

  function handlePointerUp(e: React.PointerEvent) {
    isDragging.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    if (uploading || processing) return;
    const delta = e.deltaY < 0 ? 0.08 : -0.08;
    handleZoomChange(Math.min(3, Math.max(1, zoom + delta)));
  }

  function handleZoomChange(newZoom: number) {
    if (!imageSize) return;
    const oldScale = minScale * zoom;
    const newScale = minScale * newZoom;
    const centerX = (VIEWPORT_SIZE / 2 - pos.x) / oldScale;
    const centerY = (VIEWPORT_SIZE / 2 - pos.y) / oldScale;
    const nextX = VIEWPORT_SIZE / 2 - centerX * newScale;
    const nextY = VIEWPORT_SIZE / 2 - centerY * newScale;
    setZoom(newZoom);
    setPos(clampPos(nextX, nextY, newScale));
  }

  async function handleRotate() {
    if (!imgRef.current || !imageSize) return;
    try {
      const rotated = await rotateImage90Degrees(imgRef.current);
      setActiveSrc(rotated);
    } catch (err) {
      console.error(err);
    }
  }

  function handleReset() {
    if (!imageSize) return;
    setZoom(1);
    setPos({
      x: (VIEWPORT_SIZE - imageSize.width * minScale) / 2,
      y: (VIEWPORT_SIZE - imageSize.height * minScale) / 2,
    });
  }

  async function handleCropClick() {
    if (!imgRef.current || !imageSize || uploading || processing) return;
    setCropError("");
    setProcessing(true);
    try {
      const sx = Math.max(0, -pos.x / currentScale);
      const sy = Math.max(0, -pos.y / currentScale);
      const sWidth = Math.min(imageSize.width - sx, VIEWPORT_SIZE / currentScale);
      const sHeight = Math.min(imageSize.height - sy, VIEWPORT_SIZE / currentScale);

      const blob = await exportCroppedBlobUnder1MB(imgRef.current, sx, sy, sWidth, sHeight);
      const cleanBase = fileName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
      const croppedFile = new File([blob], `${cleanBase}_1x1.jpg`, {
        type: "image/jpeg",
      });
      onCropAndUpload(croppedFile);
    } catch (err) {
      setCropError(err instanceof Error ? err.message : "Failed to crop image.");
      setProcessing(false);
    }
  }

  return (
    <div className="image-cropper-container">
      <div className="image-cropper-topbar">
        <span className="image-cropper-badge">
          <Crop size={13} /> 1:1 Aspect Ratio
        </span>
        <span className="image-cropper-limit-pill">
          Max 1MB limit enforced
        </span>
      </div>

      {cropError && <Notice onDismiss={() => setCropError("")}>{cropError}</Notice>}

      <div
        className="image-cropper-viewport-wrap"
        style={{ width: VIEWPORT_SIZE, height: VIEWPORT_SIZE }}
      >
        <div
          className="image-cropper-viewport"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
        >
          <img
            ref={imgRef}
            src={activeSrc}
            alt="Dish preview to crop"
            onLoad={handleImageLoad}
            draggable={false}
            style={{
              transform: `translate3d(${pos.x}px, ${pos.y}px, 0px) scale(${currentScale})`,
              transformOrigin: "0 0",
              userSelect: "none",
            }}
          />
          <div className="image-cropper-grid" aria-hidden="true">
            <div className="cropper-grid-line cropper-h1" />
            <div className="cropper-grid-line cropper-h2" />
            <div className="cropper-grid-line cropper-v1" />
            <div className="cropper-grid-line cropper-v2" />
          </div>
        </div>
      </div>

      <p className="image-cropper-hint">
        Drag image to center dish · Scroll or use slider to zoom
      </p>

      <div className="image-cropper-controls">
        <div className="image-cropper-zoom-row">
          <button
            type="button"
            className="icon-button-sm"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => handleZoomChange(Math.max(1, zoom - 0.15))}
            disabled={zoom <= 1 || uploading || processing}
          >
            <ZoomOut size={16} />
          </button>
          <input
            type="range"
            min="1"
            max="3"
            step="0.05"
            value={zoom}
            aria-label="Zoom level"
            onChange={(e) => handleZoomChange(Number(e.target.value))}
            className="image-cropper-slider"
            disabled={uploading || processing}
          />
          <button
            type="button"
            className="icon-button-sm"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => handleZoomChange(Math.min(3, zoom + 0.15))}
            disabled={zoom >= 3 || uploading || processing}
          >
            <ZoomIn size={16} />
          </button>
        </div>

        <div className="image-cropper-btn-row">
          <button
            type="button"
            className="text-button-sm"
            onClick={handleRotate}
            disabled={uploading || processing}
          >
            <RotateCw size={13} /> Rotate 90°
          </button>
          <button
            type="button"
            className="text-button-sm"
            onClick={handleReset}
            disabled={uploading || processing}
          >
            <RefreshCw size={13} /> Reset
          </button>
        </div>
      </div>

      <div className="modal-actions" style={{ marginTop: "16px" }}>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={uploading || processing}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleCropClick}
          disabled={uploading || processing}
        >
          {uploading || processing ? (
            <>
              <RefreshCw size={15} className="spin" /> Uploading to GCS…
            </>
          ) : (
            <>
              <UploadCloud size={15} /> Crop & Upload (≤ 1MB)
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function ImageUploadModal({
  isOpen,
  title,
  initialUrl,
  onSave,
  onClose,
}: {
  isOpen: boolean;
  title: string;
  initialUrl: string;
  onSave: (url: string, file?: File) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"upload" | "url">("upload");
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [uploadedUrl, setUploadedUrl] = useState("");
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [cropperSrc, setCropperSrc] = useState<string | null>(null);
  const [isCropping, setIsCropping] = useState(false);
  const [uploadedSize, setUploadedSize] = useState<number | null>(null);
  const [showDiscardWarning, setShowDiscardWarning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTab("upload");
      setUrlInput(initialUrl || "");
      setUploadedUrl("");
      setStagedFile(null);
      setSelectedFile(null);
      setUploadedSize(null);
      setCropperSrc(null);
      setIsCropping(false);
      setUploadError("");
      setUploading(false);
      setShowDiscardWarning(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [isOpen, initialUrl]);

  if (!isOpen) return null;

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");

    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
    if (!allowed.includes(file.type)) {
      setUploadError("Please select a valid image (JPEG, PNG, or WebP).");
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      setUploadError("Original photo is too large to process (maximum 25MB).");
      return;
    }

    const objUrl = URL.createObjectURL(file);
    setCropperSrc(objUrl);
    setSelectedFile(file);
    setIsCropping(true);
  }

  async function handleCropAndUpload(croppedFile: File) {
    if (croppedFile.size > 1024 * 1024) {
      setUploadError(
        `Cropped image size (${(croppedFile.size / 1024 / 1024).toFixed(2)}MB) exceeds 1MB limit.`,
      );
      return;
    }

    setUploadError("");
    // Staged locally in browser memory without sending to Cloud Storage yet!
    if (uploadedUrl && uploadedUrl.startsWith("blob:")) {
      URL.revokeObjectURL(uploadedUrl);
    }
    const localUrl = URL.createObjectURL(croppedFile);
    setUploadedUrl(localUrl);
    setStagedFile(croppedFile);
    setUploadedSize(croppedFile.size);
    setIsCropping(false);
    if (cropperSrc) {
      URL.revokeObjectURL(cropperSrc);
      setCropperSrc(null);
    }
  }

  function handleCancelCropping() {
    setIsCropping(false);
    if (cropperSrc) {
      URL.revokeObjectURL(cropperSrc);
      setCropperSrc(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function forceCloseModal() {
    if (uploadedUrl && uploadedUrl.startsWith("blob:")) {
      URL.revokeObjectURL(uploadedUrl);
    }
    handleCancelCropping();
    setUploadedUrl("");
    setStagedFile(null);
    setSelectedFile(null);
    setUploadedSize(null);
    setShowDiscardWarning(false);
    onClose();
  }

  function handleModalCloseAttempt() {
    if (stagedFile || isCropping) {
      setShowDiscardWarning(true);
      return;
    }
    forceCloseModal();
  }

  function handlePickDifferent() {
    if (uploadedUrl && uploadedUrl.startsWith("blob:")) {
      URL.revokeObjectURL(uploadedUrl);
    }
    setUploadedUrl("");
    setStagedFile(null);
    setSelectedFile(null);
    setUploadedSize(null);
    handleCancelCropping();
    fileInputRef.current?.click();
  }

  function handleSave() {
    if (tab === "upload") {
      if (!uploadedUrl || !stagedFile) {
        setUploadError("Please select and crop an image first.");
        return;
      }
      onSave(uploadedUrl, stagedFile);
    } else {
      const trimmed = urlInput.trim();
      if (!trimmed) {
        setUploadError("Please enter an image URL.");
        return;
      }
      onSave(trimmed, undefined);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleModalCloseAttempt();
      }}
    >
      <section
        className="modal-card image-url-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-modal-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">GOOGLE CLOUD STORAGE</span>
            <h2 id="image-modal-title">{title}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close"
            onClick={handleModalCloseAttempt}
          >
            <X size={18} />
          </button>
        </div>

        <div className="image-modal-tabs">
          <button
            type="button"
            className={`image-modal-tab ${tab === "upload" ? "active" : ""}`}
            onClick={() => {
              setTab("upload");
              setUploadError("");
            }}
          >
            <UploadCloud size={15} /> Upload to Cloud Storage
          </button>
          <button
            type="button"
            className={`image-modal-tab ${tab === "url" ? "active" : ""}`}
            onClick={() => {
              setTab("url");
              setUploadError("");
            }}
          >
            <ImageIcon size={15} /> Image URL / Link
          </button>
        </div>

        <div className="modal-form">
          {uploadError && (
            <Notice onDismiss={() => setUploadError("")}>{uploadError}</Notice>
          )}

          {tab === "upload" ? (
            <div className="image-upload-section">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                style={{ display: "none" }}
                onChange={handleFileSelected}
              />

              {isCropping && cropperSrc ? (
                <OneToOneCropper
                  imageSrc={cropperSrc}
                  fileName={selectedFile?.name || "menu_item.jpg"}
                  uploading={uploading}
                  onCancel={handleCancelCropping}
                  onCropAndUpload={handleCropAndUpload}
                />
              ) : uploadedUrl ? (
                <div className="image-upload-preview-wrap">
                  <div className="image-upload-preview">
                    <img
                      src={resolveImageUrl(uploadedUrl)}
                      alt="Uploaded preview"
                    />
                  </div>
                  <div className="image-upload-meta">
                    <span className="image-gcs-badge">
                      <Check size={13} /> Photo ready (saved locally, will upload on Save)
                    </span>
                    <span className="image-cropper-badge" style={{ marginTop: 2 }}>
                      <Crop size={12} /> 1:1 Square · {uploadedSize ? `${(uploadedSize / 1024).toFixed(0)} KB (≤ 1MB)` : "≤ 1MB"}
                    </span>
                    {selectedFile && (
                      <small className="image-upload-filename">
                        {selectedFile.name}
                      </small>
                    )}
                    <div style={{ display: "flex", gap: "10px", marginTop: "6px" }}>
                      <button
                        type="button"
                        className="text-button"
                        style={{ fontSize: "12px" }}
                        onClick={handlePickDifferent}
                        disabled={uploading}
                      >
                        Choose a different photo
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className={`image-dropzone ${uploading ? "uploading" : ""}`}
                  onClick={() => !uploading && fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) {
                      const eventObj = { target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>;
                      handleFileSelected(eventObj);
                    }
                  }}
                >
                  <div className="image-dropzone-icon">
                    <UploadCloud size={30} />
                  </div>
                  <strong>Click or drag dish photo to upload</strong>
                  <small>Crop to 1:1 square · Output strictly under 1MB</small>
                  <span className="image-dropzone-pill">
                    Stored in GCS menuImages/
                  </span>
                </div>
              )}
            </div>
          ) : (
            <label className="field-label">
              Image URL
              <input
                autoFocus
                type="url"
                required
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://..."
              />
            </label>
          )}

          {!isCropping && (
            <div className="modal-actions">
              <Button type="button" variant="secondary" onClick={handleModalCloseAttempt}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={
                  uploading ||
                  (tab === "upload" && !uploadedUrl) ||
                  (tab === "url" && !urlInput.trim())
                }
              >
                Use image <ArrowRight size={15} />
              </Button>
            </div>
          )}
        </div>
      </section>

      {showDiscardWarning && (
        <div
          className="address-map-backdrop"
          style={{
            zIndex: 10005,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            className="admin-panel"
            role="dialog"
            aria-modal="true"
            style={{
              maxWidth: "420px",
              width: "90%",
              padding: "1.6rem",
              borderRadius: "14px",
              textAlign: "center",
              boxShadow: "0 16px 40px rgba(0, 0, 0, 0.45)",
            }}
          >
            <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "1.15rem", fontWeight: 700 }}>
              Discard this photo?
            </h3>
            <p style={{ margin: "0 0 1.5rem 0", color: "var(--muted)", fontSize: "0.92rem", lineHeight: 1.45 }}>
              Are you sure you want to discard this photo? Any cropping adjustments will not be saved.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: "0.85rem" }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowDiscardWarning(false)}
              >
                Keep editing
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={forceCloseModal}
              >
                Discard photo
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuManagement() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [menuCategories, setMenuCategories] = useState<
    { id: number; name: string }[]
  >([]);
  const [newCategory, setNewCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [creatingCustom, setCreatingCustom] = useState(false);
  const [editingCustom, setEditingCustom] = useState<CustomMenuItem | null>(null);
  const [customItems, setCustomItems] = useState<CustomMenuItem[]>([]);

  // Pending files staging maps (URL -> File) and snapshot refs
  const pendingFilesRef = useRef<Map<string, File>>(new Map());
  const deletedGcsUrlsRef = useRef<Set<string>>(new Set());
  const initialMenuSnapshot = useRef<string>("");
  const [discardModalOpen, setDiscardModalOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<MenuItem | null>(null);

  const pendingCustomFilesRef = useRef<Map<string, File>>(new Map());
  const deletedCustomGcsUrlsRef = useRef<Set<string>>(new Set());
  const initialCustomSnapshot = useRef<string>("");
  const [discardCustomModalOpen, setDiscardCustomModalOpen] = useState(false);
  const [archiveCustomTarget, setArchiveCustomTarget] = useState<CustomMenuItem | null>(null);

  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("All");
  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [menuSearch, setMenuSearch] = useState("");
  const [menuSort, setMenuSort] = useState("default");

  function itemHasCategory(
    item: { category?: string; categories?: string[]; category_id?: number | null; category_ids?: number[] },
    categoryIdentifier: { id: number; name: string } | string,
  ): boolean {
    const catName = typeof categoryIdentifier === "string" ? categoryIdentifier : categoryIdentifier.name;
    const catId = typeof categoryIdentifier === "string" ? undefined : categoryIdentifier.id;

    if (item.categories && item.categories.length > 0) {
      if (item.categories.includes(catName)) return true;
    }
    if (catId != null && item.category_ids && item.category_ids.length > 0) {
      if (item.category_ids.includes(catId)) return true;
    }
    return item.category === catName || (catId != null && item.category_id === catId);
  }

  function getCategoryMenuCount(cat: { id: number; name: string }): number {
    const reg = items.filter((i) => itemHasCategory(i, cat)).length;
    const cus = customItems.filter((ci) => itemHasCategory(ci, cat)).length;
    return reg + cus;
  }

  const blankCustom = {
    name: "",
    description: "",
    category: "",
    categories: [] as string[],
    category_id: null as number | null,
    category_ids: [] as number[],
    base_price_paise: 0,
    image_urls: [] as string[],
    is_vegetarian: false,
    is_available: true,
    is_featured: false,
    sections: [] as { name: string; required: boolean; options: { name: string; extra_paise: number }[] }[],
  };
  const [customForm, setCustomForm] = useState(blankCustom);
  const [customImagePrompt, setCustomImagePrompt] = useState<{ index: number; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [imagePrompt, setImagePrompt] = useState<{ index: number; value: string } | null>(null);
  const blank = {
    name: "",
    description: "",
    category: "",
    categories: [] as string[],
    category_id: null as number | null,
    category_ids: [] as number[],
    price_paise: 0,
    image_url: "",
    image_urls: [] as string[],
    is_vegetarian: false,
    is_available: true,
    is_featured: false,
    variations: [] as { name: string; price_paise: number }[],
  };
  const [form, setForm] = useState(blank);

  function isNormalDirty(): boolean {
    if (!creating && !editing) return false;
    if (pendingFilesRef.current.size > 0) return true;
    return JSON.stringify(form) !== initialMenuSnapshot.current;
  }

  function handleRequestCloseNormal() {
    if (isNormalDirty()) {
      setDiscardModalOpen(true);
    } else {
      forceCloseNormal();
    }
  }

  function forceCloseNormal() {
    for (const url of pendingFilesRef.current.keys()) {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    }
    pendingFilesRef.current.clear();
    deletedGcsUrlsRef.current.clear();
    localStorage.removeItem("kz_menu_item_draft");
    setEditing(null);
    setCreating(false);
    setDiscardModalOpen(false);
  }

  function isCustomDirty(): boolean {
    if (!creatingCustom && !editingCustom) return false;
    if (pendingCustomFilesRef.current.size > 0) return true;
    return JSON.stringify(customForm) !== initialCustomSnapshot.current;
  }

  function handleRequestCloseCustom() {
    if (isCustomDirty()) {
      setDiscardCustomModalOpen(true);
    } else {
      forceCloseCustom();
    }
  }

  function forceCloseCustom() {
    for (const url of pendingCustomFilesRef.current.keys()) {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    }
    pendingCustomFilesRef.current.clear();
    deletedCustomGcsUrlsRef.current.clear();
    localStorage.removeItem("kz_custom_menu_draft");
    setCreatingCustom(false);
    setEditingCustom(null);
    setDiscardCustomModalOpen(false);
  }

  // Local storage draft auto-sync while creating
  useEffect(() => {
    if (creating) {
      const sanitized = {
        ...form,
        image_urls: form.image_urls.filter((u) => !u.startsWith("blob:")),
      };
      localStorage.setItem("kz_menu_item_draft", JSON.stringify(sanitized));
    }
  }, [creating, form]);

  useEffect(() => {
    if (creatingCustom) {
      const sanitized = {
        ...customForm,
        image_urls: customForm.image_urls.filter((u) => !u.startsWith("blob:")),
      };
      localStorage.setItem("kz_custom_menu_draft", JSON.stringify(sanitized));
    }
  }, [creatingCustom, customForm]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isNormalDirty() || isCustomDirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  });

  const refresh = useCallback(
    () =>
      Promise.all([
        api<MenuItem[]>("/menu/manage"),
        api<{ id: number; name: string }[]>("/menu/categories"),
        api<CustomMenuItem[]>("/custom-menu/manage"),
      ])
        .then(([menu, categories, custom]) => {
          setItems(menu);
          setMenuCategories(categories);
          setCustomItems(custom);
        })
        .catch((err) =>
          setError(
            err instanceof Error ? err.message : "Could not load the menu.",
          ),
        )
        .finally(() => setLoading(false)),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openEdit(item: MenuItem) {
    pendingFilesRef.current.clear();
    deletedGcsUrlsRef.current.clear();
    setEditing(item);
    const imageUrls = item.image_urls?.length
      ? item.image_urls
      : item.image_url
        ? [item.image_url]
        : [];
    const itemCats = item.categories && item.categories.length > 0
      ? item.categories
      : (item.category ? [item.category] : []);
    const formatted = {
      ...item,
      category: itemCats[0] || "",
      categories: itemCats,
      category_id: item.category_id,
      category_ids: item.category_ids || [],
      price_paise: item.price_paise / 100,
      image_url: imageUrls[0] || "",
      image_urls: imageUrls,
      variations: (item.variations || []).map((v) => ({
        name: v.name,
        price_paise: v.price_paise / 100,
      })),
    };
    setForm(formatted);
    initialMenuSnapshot.current = JSON.stringify(formatted);
    setCreating(false);
  }
  function addVariation() {
    setForm((f) => ({
      ...f,
      variations: [...f.variations, { name: "", price_paise: 0 }],
    }));
  }
  function removeVariation(index: number) {
    setForm((f) => ({
      ...f,
      variations: f.variations.filter((_, i) => i !== index),
    }));
  }
  function updateVariation(index: number, field: "name" | "price_paise", value: string) {
    setForm((f) => {
      const vars = [...f.variations];
      vars[index] = {
        ...vars[index],
        [field]: field === "price_paise" ? Number(value) : value,
      };
      return { ...f, variations: vars };
    });
  }
  function openCreate() {
    setShowTypePicker(true);
    setEditing(null);
    setCreating(false);
    setCreatingCustom(false);
    setEditingCustom(null);
  }
  function openCreateNormal() {
    setShowTypePicker(false);
    pendingFilesRef.current.clear();
    deletedGcsUrlsRef.current.clear();
    const draftRaw = localStorage.getItem("kz_menu_item_draft");
    let initForm = blank;
    if (draftRaw) {
      try {
        const parsed = JSON.parse(draftRaw);
        if (parsed && typeof parsed === "object") {
          initForm = {
            ...blank,
            ...parsed,
            categories: parsed.categories || (parsed.category ? [parsed.category] : []),
            image_urls: (parsed.image_urls || []).filter((u: string) => !u.startsWith("blob:")),
          };
        }
      } catch {}
    }
    setForm(initForm);
    initialMenuSnapshot.current = JSON.stringify(blank);
    setCreating(true);
    setEditing(null);
  }
  function openCreateCustom() {
    setShowTypePicker(false);
    pendingCustomFilesRef.current.clear();
    deletedCustomGcsUrlsRef.current.clear();
    const draftRaw = localStorage.getItem("kz_custom_menu_draft");
    let initCustom = blankCustom;
    if (draftRaw) {
      try {
        const parsed = JSON.parse(draftRaw);
        if (parsed && typeof parsed === "object") {
          initCustom = {
            ...blankCustom,
            ...parsed,
            categories: parsed.categories || (parsed.category ? [parsed.category] : []),
            image_urls: (parsed.image_urls || []).filter((u: string) => !u.startsWith("blob:")),
          };
        }
      } catch {}
    }
    setCustomForm(initCustom);
    initialCustomSnapshot.current = JSON.stringify(blankCustom);
    setCreatingCustom(true);
    setEditingCustom(null);
  }
  function openEditCustom(item: CustomMenuItem) {
    pendingCustomFilesRef.current.clear();
    deletedCustomGcsUrlsRef.current.clear();
    setEditingCustom(item);
    setCreatingCustom(false);
    setShowTypePicker(false);
    setCreating(false);
    setEditing(null);
    const itemCats = item.categories && item.categories.length > 0
      ? item.categories
      : (item.category ? [item.category] : []);
    const formatted = {
      name: item.name,
      description: item.description,
      category: itemCats[0] || "",
      categories: itemCats,
      category_id: item.category_id,
      category_ids: item.category_ids || [],
      base_price_paise: item.base_price_paise / 100,
      image_urls: item.image_urls,
      is_vegetarian: item.is_vegetarian,
      is_available: item.is_available,
      is_featured: item.is_featured,
      sections: item.sections.map((s: CustomMenuSection) => ({
        name: s.name,
        required: s.required !== false,
        options: s.options.map((o) => ({ name: o.name, extra_paise: o.extra_paise / 100 })),
      })),
    };
    setCustomForm(formatted);
    initialCustomSnapshot.current = JSON.stringify(formatted);
  }
  async function submitCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      // Sequentially upload any pending custom images to GCS upon Save
      const finalImageUrls: string[] = [];
      for (const url of customForm.image_urls) {
        const staged = pendingCustomFilesRef.current.get(url);
        if (staged) {
          const res = await uploadMenuImage(staged);
          finalImageUrls.push(res.url);
          if (url.startsWith("blob:")) URL.revokeObjectURL(url);
        } else {
          finalImageUrls.push(url);
        }
      }

      // Cleanup any removed GCS photos
      for (const removedUrl of deletedCustomGcsUrlsRef.current) {
        if (!finalImageUrls.includes(removedUrl)) {
          void deleteMenuImage(removedUrl);
        }
      }
      deletedCustomGcsUrlsRef.current.clear();
      pendingCustomFilesRef.current.clear();
      localStorage.removeItem("kz_custom_menu_draft");

      const matchedCategories = menuCategories.filter((c) => customForm.categories.includes(c.name));
      const payload = {
        name: customForm.name,
        description: customForm.description,
        categories: customForm.categories,
        category_ids: matchedCategories.map((c) => c.id),
        category: customForm.categories[0] || null,
        category_id: matchedCategories[0]?.id ?? null,
        base_price_paise: Math.round(Number(customForm.base_price_paise) * 100),
        image_urls: finalImageUrls,
        is_vegetarian: customForm.is_vegetarian,
        is_available: customForm.is_available,
        is_featured: customForm.is_featured,
        sections: customForm.sections.map((s) => ({
          name: s.name,
          required: s.required !== false,
          options: s.options.map((o) => ({ name: o.name, extra_paise: Math.round(Number(o.extra_paise) * 100) })),
        })),
      };

      await api<CustomMenuItem>(
        editingCustom ? `/custom-menu/${editingCustom.id}` : "/custom-menu",
        { method: editingCustom ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      await refresh();
      setEditingCustom(null);
      setCreatingCustom(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this custom item.");
    } finally {
      setBusy(false);
    }
  }
  async function archiveCustom(item: CustomMenuItem) {
    try {
      await api(`/custom-menu/${item.id}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove this item.");
    }
  }
  function addSection() {
    setCustomForm((f) => ({
      ...f,
      sections: [...f.sections, { name: "", required: true, options: [{ name: "", extra_paise: 0 }] }],
    }));
  }
  function setSectionRequired(si: number, required: boolean) {
    setCustomForm((f) => {
      const sections = [...f.sections];
      sections[si] = { ...sections[si], required };
      return { ...f, sections };
    });
  }
  function removeSection(si: number) {
    setCustomForm((f) => ({ ...f, sections: f.sections.filter((_, i) => i !== si) }));
  }
  function updateSection(si: number, name: string) {
    setCustomForm((f) => { const sections = [...f.sections]; sections[si] = { ...sections[si], name }; return { ...f, sections }; });
  }
  function addOption(si: number) {
    setCustomForm((f) => { const sections = [...f.sections]; sections[si] = { ...sections[si], options: [...sections[si].options, { name: "", extra_paise: 0 }] }; return { ...f, sections }; });
  }
  function removeOption(si: number, oi: number) {
    setCustomForm((f) => { const sections = [...f.sections]; sections[si] = { ...sections[si], options: sections[si].options.filter((_, i) => i !== oi) }; return { ...f, sections }; });
  }
  function updateOption(si: number, oi: number, field: "name" | "extra_paise", value: string) {
    setCustomForm((f) => {
      const sections = [...f.sections];
      const options = [...sections[si].options];
      options[oi] = { ...options[oi], [field]: field === "extra_paise" ? Number(value) : value };
      sections[si] = { ...sections[si], options };
      return { ...f, sections };
    });
  }
  function handleSaveCustomImage(url: string, file?: File) {
    if (!customImagePrompt) return;
    const trimmed = url.trim();
    if (!trimmed) { setError("Please enter an image URL."); return; }
    let imageUrl = trimmed;
    if (file) {
      pendingCustomFilesRef.current.set(imageUrl, file);
    } else {
      try {
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
          const parsed = new URL(trimmed);
          const driveFileId = parsed.hostname === "drive.google.com"
            ? parsed.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || parsed.searchParams.get("id")
            : parsed.hostname === "docs.google.com" ? parsed.searchParams.get("id") : null;
          if (driveFileId) {
            imageUrl = `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w1200`;
          }
        }
      } catch {
        // Keep trimmed as-is
      }
    }
    const imageUrls = [...customForm.image_urls];
    if (customImagePrompt.index === -1) imageUrls.push(imageUrl);
    else imageUrls[customImagePrompt.index] = imageUrl;
    setCustomForm((f) => ({ ...f, image_urls: imageUrls }));
    setError("");
    setCustomImagePrompt(null);
  }
  function removeCustomImage(index: number) {
    const targetUrl = customForm.image_urls[index];
    if (targetUrl) {
      if (pendingCustomFilesRef.current.has(targetUrl)) {
        pendingCustomFilesRef.current.delete(targetUrl);
        if (targetUrl.startsWith("blob:")) URL.revokeObjectURL(targetUrl);
      } else if (targetUrl.includes("storage.googleapis.com") || targetUrl.includes("menuImages/")) {
        deletedCustomGcsUrlsRef.current.add(targetUrl);
      }
    }
    setCustomForm((f) => ({ ...f, image_urls: f.image_urls.filter((_, i) => i !== index) }));
  }
  function setMainCustomImage(index: number) {
    if (index <= 0 || index >= customForm.image_urls.length) return;
    const target = customForm.image_urls[index];
    const remaining = customForm.image_urls.filter((_, i) => i !== index);
    const updated = [target, ...remaining];
    setCustomForm((f) => ({ ...f, image_urls: updated }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      // Sequentially upload any pending files to Cloud Storage upon Save
      const finalImageUrls: string[] = [];
      for (const url of form.image_urls) {
        const staged = pendingFilesRef.current.get(url);
        if (staged) {
          const res = await uploadMenuImage(staged);
          finalImageUrls.push(res.url);
          if (url.startsWith("blob:")) URL.revokeObjectURL(url);
        } else {
          finalImageUrls.push(url);
        }
      }

      // Cleanup any removed GCS photos
      for (const removedUrl of deletedGcsUrlsRef.current) {
        if (!finalImageUrls.includes(removedUrl)) {
          void deleteMenuImage(removedUrl);
        }
      }
      deletedGcsUrlsRef.current.clear();
      pendingFilesRef.current.clear();
      localStorage.removeItem("kz_menu_item_draft");

      const variationsPayload = form.variations
        .filter((v) => v.name.trim())
        .map((v) => ({
          name: v.name.trim(),
          price_paise: Math.round(Number(v.price_paise) * 100),
        }));

      const calculatedPricePaise = variationsPayload.length > 0
        ? Math.min(...variationsPayload.map((v) => v.price_paise))
        : Math.round(Number(form.price_paise) * 100);

      const matchedCategories = menuCategories.filter((c) => form.categories.includes(c.name));
      const data = {
        ...form,
        categories: form.categories,
        category_ids: matchedCategories.map((c) => c.id),
        category: form.categories[0] || "",
        category_id: matchedCategories[0]?.id || null,
        price_paise: calculatedPricePaise,
        variations: variationsPayload,
        image_urls: finalImageUrls,
        image_url: finalImageUrls[0] || null,
      };

      const updated = await api<MenuItem>(
        editing ? `/menu/${editing.id}` : "/menu",
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(data),
        },
      );
      setItems((old) =>
        editing
          ? old.map((item) => (item.id === updated.id ? updated : item))
          : [...old, updated].sort((a, b) =>
              a.category.localeCompare(b.category),
            ),
      );
      setEditing(null);
      setCreating(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save this menu item.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function archive(item: MenuItem) {
    try {
      await api(`/menu/${item.id}`, { method: "DELETE" });
      setItems((old) =>
        old.map((entry) =>
          entry.id === item.id ? { ...entry, is_available: false } : entry,
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not remove this item from the live menu.",
      );
    }
  }
  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newCategory.trim();
    if (!name) return;
    try {
      const created = await api<{ id: number; name: string }>(
        "/menu/categories",
        { method: "POST", body: JSON.stringify({ name }) },
      );
      setMenuCategories((old) =>
        [...old, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setNewCategory("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not add this category.",
      );
    }
  }
  async function executeDeleteCategory(category: { id: number; name: string }) {
    if (category.id === 0) {
      setError(
        "This category is attached to existing menu data. Run the database migration before editing categories.",
      );
      return;
    }
    try {
      await api(`/menu/categories/${category.id}`, { method: "DELETE" });
      setItems((old) =>
        old.map((item) => {
          const newCats = (item.categories || []).filter((c) => c !== category.name);
          const newIds = (item.category_ids || []).filter((id) => id !== category.id);
          return {
            ...item,
            categories: newCats,
            category_ids: newIds,
            category: item.category === category.name ? (newCats[0] || "") : item.category,
            category_id: item.category_id === category.id ? (newIds[0] || null) : item.category_id,
          };
        }),
      );
      setCustomItems((old) =>
        old.map((item) => {
          const newCats = (item.categories || []).filter((c) => c !== category.name);
          const newIds = (item.category_ids || []).filter((id) => id !== category.id);
          return {
            ...item,
            categories: newCats,
            category_ids: newIds,
            category: item.category === category.name ? (newCats[0] || "") : item.category,
            category_id: item.category_id === category.id ? (newIds[0] || null) : item.category_id,
          };
        }),
      );
      setMenuCategories((old) =>
        old.filter((entry) => entry.id !== category.id),
      );
      if (selectedCategoryFilter === category.name) {
        setSelectedCategoryFilter("All");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete this category.",
      );
    }
  }
  function editImage(index: number) {
    setImagePrompt({ index, value: form.image_urls[index] || "" });
  }
  function handleSaveImage(url: string, file?: File) {
    if (!imagePrompt) return;
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Please enter an image URL.");
      return;
    }
    let imageUrl = trimmed;
    if (file) {
      pendingFilesRef.current.set(imageUrl, file);
    } else {
      try {
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
          const parsed = new URL(trimmed);
          const driveFileId =
            parsed.hostname === "drive.google.com"
              ? parsed.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ||
                parsed.searchParams.get("id")
              : parsed.hostname === "docs.google.com"
                ? parsed.searchParams.get("id")
                : null;
          if (driveFileId) {
            imageUrl = `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w1200`;
          }
        }
      } catch {
        // Keep trimmed as-is
      }
    }
    const imageUrls = [...form.image_urls];
    if (imagePrompt.index === -1) imageUrls.push(imageUrl);
    else imageUrls[imagePrompt.index] = imageUrl;
    setForm({ ...form, image_urls: imageUrls, image_url: imageUrls[0] || "" });
    setError("");
    setImagePrompt(null);
  }
  function removeImage(index: number) {
    const targetUrl = form.image_urls[index];
    if (targetUrl) {
      if (pendingFilesRef.current.has(targetUrl)) {
        pendingFilesRef.current.delete(targetUrl);
        if (targetUrl.startsWith("blob:")) URL.revokeObjectURL(targetUrl);
      } else if (targetUrl.includes("storage.googleapis.com") || targetUrl.includes("menuImages/")) {
        deletedGcsUrlsRef.current.add(targetUrl);
      }
    }
    const imageUrls = form.image_urls.filter(
      (_, imageIndex) => imageIndex !== index,
    );
    setForm({ ...form, image_urls: imageUrls, image_url: imageUrls[0] || "" });
  }
  function setMainImage(index: number) {
    if (index <= 0 || index >= form.image_urls.length) return;
    const target = form.image_urls[index];
    const remaining = form.image_urls.filter((_, i) => i !== index);
    const updated = [target, ...remaining];
    setForm({ ...form, image_urls: updated, image_url: updated[0] || "" });
  }
  const categories = menuCategories.length;
  const showModal = creating || Boolean(editing);

  const totalMenuItems = items.length + customItems.length;
  const availableMenuItems =
    items.filter((item) => item.is_available).length +
    customItems.filter((item) => item.is_available).length;

  const searchQuery = menuSearch.trim().toLowerCase();

  let displayNormalItems = items.filter((item) => {
    if (item.is_custom) return false;
    if (selectedCategoryFilter !== "All" && !itemHasCategory(item, selectedCategoryFilter)) {
      return false;
    }
    if (searchQuery) {
      const matchName = item.name.toLowerCase().includes(searchQuery);
      const matchDesc = (item.description || "").toLowerCase().includes(searchQuery);
      const matchCats = (item.categories || []).some((c) => c.toLowerCase().includes(searchQuery)) ||
        (item.category || "").toLowerCase().includes(searchQuery);
      const matchVars = (item.variations || []).some((v) => v.name.toLowerCase().includes(searchQuery));
      if (!matchName && !matchDesc && !matchCats && !matchVars) return false;
    }
    return true;
  });

  let displayCustomItems = customItems.filter((item) => {
    if (selectedCategoryFilter !== "All" && !itemHasCategory(item, selectedCategoryFilter)) {
      return false;
    }
    if (searchQuery) {
      const matchName = item.name.toLowerCase().includes(searchQuery);
      const matchDesc = (item.description || "").toLowerCase().includes(searchQuery);
      const matchCats = (item.categories || []).some((c) => c.toLowerCase().includes(searchQuery)) ||
        (item.category || "").toLowerCase().includes(searchQuery);
      const matchSections = (item.sections || []).some(
        (s) =>
          s.name.toLowerCase().includes(searchQuery) ||
          s.options.some((o) => o.name.toLowerCase().includes(searchQuery)),
      );
      if (!matchName && !matchDesc && !matchCats && !matchSections) return false;
    }
    return true;
  });

  displayNormalItems = [...displayNormalItems].sort((a, b) => {
    switch (menuSort) {
      case "name_asc":
        return a.name.localeCompare(b.name);
      case "name_desc":
        return b.name.localeCompare(a.name);
      case "price_asc":
        return getMenuItemLowestPrice(a) - getMenuItemLowestPrice(b);
      case "price_desc":
        return getMenuItemLowestPrice(b) - getMenuItemLowestPrice(a);
      case "available":
        return (b.is_available ? 1 : 0) - (a.is_available ? 1 : 0);
      default:
        return (a.category || "").localeCompare(b.category || "");
    }
  });

  displayCustomItems = [...displayCustomItems].sort((a, b) => {
    switch (menuSort) {
      case "name_asc":
        return a.name.localeCompare(b.name);
      case "name_desc":
        return b.name.localeCompare(a.name);
      case "price_asc":
        return getCustomItemLowestPrice(a) - getCustomItemLowestPrice(b);
      case "price_desc":
        return getCustomItemLowestPrice(b) - getCustomItemLowestPrice(a);
      case "available":
        return (b.is_available ? 1 : 0) - (a.is_available ? 1 : 0);
      default:
        return (a.category || "").localeCompare(b.category || "");
    }
  });

  return (
    <>
      <PageTitle
        eyebrow="SET THE MENU, SET THE MOOD"
        title="Menu management"
        description="Keep the good stuff up to date, one plate at a time."
        action={
          <Button onClick={openCreate}>
            <Plus size={16} /> <span>Add a menu item</span>
          </Button>
        }
      />
      {error && <Notice onDismiss={() => setError("")}>{error}</Notice>}
      <div className="menu-admin-stats">
        <div>
          <span>
            <CookingPot size={17} />
          </span>
          <strong>{totalMenuItems}</strong>
          <small>Total menu items</small>
        </div>
        <div>
          <span>
            <Check size={17} />
          </span>
          <strong>{availableMenuItems}</strong>
          <small>Available now</small>
        </div>
        <div>
          <span>
            <BadgeTag />
          </span>
          <strong>{categories}</strong>
          <small>Menu categories</small>
        </div>
      </div>
      <section className="admin-panel category-manager">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ORGANIZE THE MENU</span>
            <h2>Categories</h2>
          </div>
        </div>
        <form
          className="category-add-form"
          onSubmit={(event) => void addCategory(event)}
        >
          <input
            required
            minLength={2}
            maxLength={80}
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            placeholder="New category name"
            aria-label="New category name"
          />
          <Button type="submit" size="button-sm">
            <Plus size={14} /> Add category
          </Button>
        </form>
        <div className="category-list">
          <div
            className={`category-chip ${selectedCategoryFilter === "All" ? "category-chip-active" : ""}`}
            onClick={() => setSelectedCategoryFilter("All")}
            style={{ cursor: "pointer" }}
            role="button"
            tabIndex={0}
          >
            <span>All</span>
            <small>{totalMenuItems} menus</small>
          </div>
          {menuCategories.map((category) => {
            const count = getCategoryMenuCount(category);
            const isSelected = selectedCategoryFilter === category.name;
            return (
              <div
                className={`category-chip ${isSelected ? "category-chip-active" : ""}`}
                key={`${category.id}-${category.name}`}
                onClick={() =>
                  setSelectedCategoryFilter(isSelected ? "All" : category.name)
                }
                style={{ cursor: "pointer" }}
                role="button"
                tabIndex={0}
              >
                <span>{category.name}</span>
                <small>{count} menus</small>
                <button
                  type="button"
                  className="icon-button danger-icon"
                  title={`Delete ${category.name}`}
                  aria-label={`Delete ${category.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCategoryDeleteTarget(category);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <div className="admin-search-sort-controls" style={{ margin: "20px 0 14px" }}>
        <label className="admin-search-field">
          <Search size={16} />
          <input
            value={menuSearch}
            onChange={(e) => setMenuSearch(e.target.value)}
            placeholder="Search menu items by name, description, or ingredients…"
            aria-label="Search menu items"
          />
          {menuSearch && (
            <button
              type="button"
              className="icon-button"
              onClick={() => setMenuSearch("")}
              style={{ padding: 4, flexShrink: 0 }}
              title="Clear search"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </label>
        <RoundedSelect
          icon={<ArrowUpDown size={15} />}
          ariaLabel="Sort menu items"
          value={menuSort}
          onChange={(val) => setMenuSort(val)}
          options={[
            { value: "default", label: "Default order" },
            { value: "name_asc", label: "Name: A → Z" },
            { value: "name_desc", label: "Name: Z → A" },
            { value: "price_asc", label: "Price: Low to High" },
            { value: "price_desc", label: "Price: High to Low" },
            { value: "available", label: "Available first" },
          ]}
          className="orders-period-select"
        />
      </div>

      {(selectedCategoryFilter !== "All" || menuSearch) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            margin: "0 0 16px",
            padding: "10px 16px",
            background: "rgba(43, 57, 51, 0.06)",
            borderRadius: "10px",
            fontSize: "13px",
            fontWeight: 500,
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <span>
            {selectedCategoryFilter !== "All" && (
              <>Category: <strong>{selectedCategoryFilter}</strong> </>
            )}
            {selectedCategoryFilter !== "All" && menuSearch && "· "}
            {menuSearch && (
              <>Search: <strong>“{menuSearch}”</strong> </>
            )}
            ({displayNormalItems.length + displayCustomItems.length} {displayNormalItems.length + displayCustomItems.length === 1 ? "item" : "items"} found)
          </span>
          <button
            type="button"
            className="button button-secondary button-sm"
            onClick={() => {
              setSelectedCategoryFilter("All");
              setMenuSearch("");
            }}
          >
            Clear filters
          </button>
        </div>
      )}
      {loading ? (
        <Loading label="Laying out the menu…" />
      ) : displayNormalItems.length === 0 && displayCustomItems.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 20px", color: "#666" }}>
          <p style={{ margin: "0 0 12px", fontSize: "15px" }}>
            {menuSearch
              ? `No menu items matching “${menuSearch}”.`
              : `No menu items found under “${selectedCategoryFilter}”.`}
          </p>
          {(selectedCategoryFilter !== "All" || menuSearch) && (
            <Button
              variant="secondary"
              size="button-sm"
              onClick={() => {
                setSelectedCategoryFilter("All");
                setMenuSearch("");
              }}
            >
              Clear search &amp; filter
            </Button>
          )}
        </div>
      ) : (
        <div className="menu-admin-list">
          {displayNormalItems.map((item) => (
            <article
              className={`menu-admin-card ${!item.is_available ? "menu-item-muted" : ""}`}
              key={item.id}
            >
              <div
                className={`menu-admin-art ${item.is_vegetarian ? "admin-art-green" : "admin-art-red"}`}
              >
                {item.image_urls?.length || item.image_url ? (
                  <MenuImageCarousel
                    images={
                      item.image_urls?.length
                        ? item.image_urls
                        : item.image_url
                          ? [item.image_url]
                          : []
                    }
                    alt={item.name}
                    className="menu-gallery-admin"
                  />
                ) : (
                  <span>{item.is_vegetarian ? "🥬" : "🍢"}</span>
                )}
                {item.is_featured && <i>✦</i>}
              </div>
              <div className="menu-admin-main">
                <div className="menu-admin-tags">
                  {item.categories && item.categories.length > 0 ? (
                    item.categories.map((c) => (
                      <Badge key={c} tone="soft">{c}</Badge>
                    ))
                  ) : (
                    <Badge tone="soft">{item.category || "Uncategorized"}</Badge>
                  )}
                  {item.is_vegetarian && <span className="veg-label">VEG</span>}
                  {!item.is_available && (
                    <Badge tone="danger">Unavailable</Badge>
                  )}
                </div>
                <h3>{item.name}</h3>
                <p>
                  {item.description || "A KebabZilla favorite, made fresh."}
                </p>
                <div className="menu-admin-price">
                  {(item.variations?.length || 0) > 0 ? (
                    <>From {formatINR(getMenuItemLowestPrice(item))} <small>tax included</small></>
                  ) : (
                    <>{formatINR(item.price_paise)} <small>tax included</small></>
                  )}
                </div>
                {(item.variations?.length || 0) > 0 && (
                  <div className="custom-sections-preview">
                    {item.variations!.map((v) => (
                      <span key={v.name} className="custom-section-chip">
                        {v.name} · {formatINR(v.price_paise)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="menu-admin-actions">
                <button
                  className="button button-secondary button-sm"
                  onClick={() => openEdit(item)}
                >
                  <Edit3 size={14} /> Edit
                </button>
                {item.is_available && (
                  <button
                    className="icon-button danger-icon"
                    title="Remove from live menu"
                    onClick={() => setArchiveTarget(item)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {displayCustomItems.length > 0 && (
        <section className="admin-panel custom-menu-admin-section">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">BUILD-YOUR-OWN</span>
              <h2>{selectedCategoryFilter === "All" && !menuSearch ? "Custom menu items" : `Custom menu items (${displayCustomItems.length})`}</h2>
            </div>
          </div>
          <div className="menu-admin-list">
            {displayCustomItems.map((item) => (
              <article
                className={`menu-admin-card custom-menu-card ${!item.is_available ? "menu-item-muted" : ""}`}
                key={`custom-${item.id}`}
              >
                <div
                  className={`menu-admin-art ${item.is_vegetarian ? "admin-art-green" : "admin-art-red"}`}
                >
                  {item.image_urls?.length || item.image_url ? (
                    <MenuImageCarousel
                      images={
                        item.image_urls?.length
                          ? item.image_urls
                          : item.image_url
                            ? [item.image_url]
                            : []
                      }
                      alt={item.name}
                      className="menu-gallery-admin"
                    />
                  ) : (
                    <span>{item.is_vegetarian ? "🥬" : "🍢"}</span>
                  )}
                  {item.is_featured && <i>✦</i>}
                </div>
                <div className="menu-admin-main">
                  <div className="menu-admin-tags">
                    {item.categories && item.categories.length > 0 ? (
                      item.categories.map((c) => (
                        <Badge key={c} tone="soft">{c}</Badge>
                      ))
                    ) : (
                      <Badge tone="soft">{item.category || "Uncategorized"}</Badge>
                    )}
                    <Badge tone="amber">Custom</Badge>
                    {item.is_vegetarian && <span className="veg-label">VEG</span>}
                    {!item.is_available && (
                      <Badge tone="danger">Unavailable</Badge>
                    )}
                  </div>
                  <h3>{item.name}</h3>
                  <p>
                    {item.description || "A build-your-own KebabZilla favorite."}
                  </p>
                  <div className="menu-admin-price">
                    From {formatINR(getCustomItemLowestPrice(item))} <small>base + mandatory addons</small>
                  </div>
                  <div className="custom-sections-preview">
                    {item.sections?.map((s) => (
                      <span key={s.id || s.name} className="custom-section-chip">
                        {s.name} · {s.required !== false ? "Must choose" : "Optional"} · {s.options?.length || 0} options
                      </span>
                    ))}
                  </div>
                </div>
                <div className="menu-admin-actions">
                  <button
                    className="button button-secondary button-sm"
                    onClick={() => openEditCustom(item)}
                  >
                    <Edit3 size={14} /> Edit
                  </button>
                  {item.is_available && (
                    <button
                      className="icon-button danger-icon"
                      title="Remove from live menu"
                      onClick={() => setArchiveCustomTarget(item)}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {showModal && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              handleRequestCloseNormal();
            }
          }}
        >
          <section className="modal-card menu-modal">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">
                  {editing
                    ? "REFINE THE RECIPE CARD"
                    : "ADD SOMETHING DELICIOUS"}
                </span>
                <h2>{editing ? "Edit menu item" : "New menu item"}</h2>
              </div>
              <button
                className="icon-button"
                onClick={handleRequestCloseNormal}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <form
              className="modal-form"
              onSubmit={(event) => void submit(event)}
            >
              <label className="field-label">
                Item name
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  placeholder="Smoky chicken tikka"
                />
              </label>
              <label className="field-label">
                A tasty description
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={form.description}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                  placeholder="What makes this one a favorite?"
                />
              </label>
              <div className="field-label" style={{ marginBottom: 12 }}>
                Categories (select all that apply)
                {menuCategories.length === 0 ? (
                  <span style={{ fontSize: "12px", color: "#888", display: "block", marginTop: 4 }}>
                    No categories created yet. Add one in the Category Manager.
                  </span>
                ) : (
                  <div className="category-multi-select-list">
                    {menuCategories.map((category) => {
                      const isSelected = form.categories.includes(category.name);
                      return (
                        <button
                          key={category.id}
                          type="button"
                          className={`category-toggle-pill ${isSelected ? "selected" : ""}`}
                          onClick={() => {
                            const newCategories = isSelected
                              ? form.categories.filter((c) => c !== category.name)
                              : [...form.categories, category.name];
                            const newCategory = newCategories[0] || "";
                            setForm({
                              ...form,
                              categories: newCategories,
                              category: newCategory,
                            });
                          }}
                        >
                          {isSelected ? "✓ " : "+ "}
                          {category.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <label className="field-label">
                Price · INR
                <input
                  required={form.variations.length === 0}
                  type="number"
                  min="1"
                  step="1"
                  disabled={form.variations.length > 0}
                  value={
                    form.variations.length > 0
                      ? (Math.min(...form.variations.map((v) => Number(v.price_paise) || 0)) || "")
                      : form.price_paise
                  }
                  onChange={(event) =>
                    setForm({
                      ...form,
                      price_paise: Number(event.target.value),
                    })
                  }
                  placeholder="299"
                />
                {form.variations.length > 0 && (
                  <span className="field-optional">Auto-set to lowest portion price</span>
                )}
              </label>
              <div className="custom-sections-builder" style={{ marginTop: 4, marginBottom: 12 }}>
                <div className="custom-sections-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexDirection: "row" }}>
                  <div>
                    <strong>Portions &amp; Variations (optional)</strong>
                    <small>e.g., Half / Full portions with different prices</small>
                  </div>
                  <button
                    type="button"
                    className="custom-add-option-btn"
                    onClick={addVariation}
                  >
                    <Plus size={14} /> Add portion
                  </button>
                </div>
                {form.variations.length > 0 && (
                  <div className="custom-section-options" style={{ marginTop: 8 }}>
                    {form.variations.map((v, vi) => (
                      <div className="custom-option-row" key={vi}>
                        <input
                          type="text"
                          required
                          placeholder="Portion name (e.g. Half, Full)"
                          value={v.name}
                          onChange={(e) => updateVariation(vi, "name", e.target.value)}
                        />
                        <div className="custom-option-price">
                          <span>₹</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            required
                            placeholder="Price"
                            value={v.price_paise || ""}
                            onChange={(e) => updateVariation(vi, "price_paise", e.target.value)}
                          />
                        </div>
                        <button
                          type="button"
                          className="icon-button danger-icon"
                          onClick={() => removeVariation(vi)}
                          title="Remove portion"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                    <small style={{ color: "#c54d2f", fontWeight: 500 }}>
                      Lowest portion price will automatically be the base display price: ₹
                      {Math.min(...form.variations.map((v) => Number(v.price_paise) || 0))}
                    </small>
                  </div>
                )}
              </div>
              <div className="field-label">
                Menu images{" "}
                <span className="field-optional">
                  First image is the main photo
                </span>
                <div className="menu-image-grid">
                  {form.image_urls.map((url, index) => (
                    <div className="menu-image-tile" key={`${index}-${url}`}>
                      <img
                        src={resolveImageUrl(url)}
                        alt={`Menu image ${index + 1}`}
                        onError={(event) =>
                          event.currentTarget
                            .closest(".menu-image-tile")
                            ?.classList.add("menu-image-failed")
                        }
                      />
                      {index === 0 ? (
                        <span className="menu-image-order menu-image-main-badge" title="Main dish photo">
                          <Star size={10} fill="currentColor" /> MAIN
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="menu-image-order menu-image-order-btn"
                          title="Click to set as main image"
                          onClick={() => setMainImage(index)}
                        >
                          #{index + 1}
                        </button>
                      )}
                      <div className="menu-image-actions">
                        {index !== 0 && (
                          <button
                            type="button"
                            className="menu-image-set-main-btn"
                            aria-label="Set as main image"
                            title="Set as main photo (moves to front)"
                            onClick={() => setMainImage(index)}
                          >
                            <Star size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label="Change image"
                          title="Change image"
                          onClick={() => void editImage(index)}
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete image"
                          title="Delete image"
                          onClick={() => removeImage(index)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="menu-image-add"
                    onClick={() => void editImage(-1)}
                  >
                    <Plus size={25} />
                    <span>Add image</span>
                  </button>
                </div>
              </div>
              <div className="checkbox-settings">
                <label>
                  <input
                    type="checkbox"
                    checked={form.is_vegetarian}
                    onChange={(event) =>
                      setForm({ ...form, is_vegetarian: event.target.checked })
                    }
                  />
                  <span>
                    <strong>Vegetarian</strong>
                    <small>Show a green veg marker.</small>
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={form.is_available}
                    onChange={(event) =>
                      setForm({ ...form, is_available: event.target.checked })
                    }
                  />
                  <span>
                    <strong>Available</strong>
                    <small>Show on the customer menu.</small>
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={form.is_featured}
                    onChange={(event) =>
                      setForm({ ...form, is_featured: event.target.checked })
                    }
                  />
                  <span>
                    <strong>KZ pick</strong>
                    <small>Feature this menu favorite.</small>
                  </span>
                </label>
              </div>
              <div className="modal-actions">
                <Button
                  variant="secondary"
                  onClick={handleRequestCloseNormal}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : editing ? "Save changes" : "Add to menu"}{" "}
                  <ArrowRight size={15} />
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
      {imagePrompt && (
        <ImageUploadModal
          key={`menu-img-modal-${imagePrompt.index}-${imagePrompt.value || "new"}`}
          isOpen={true}
          title={imagePrompt.index === -1 ? "Add menu image" : "Replace menu image"}
          initialUrl={imagePrompt.value || ""}
          onSave={handleSaveImage}
          onClose={() => setImagePrompt(null)}
        />
      )}
      {showTypePicker && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowTypePicker(false);
          }}
        >
          <section className="modal-card type-picker-modal">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">ADD SOMETHING DELICIOUS</span>
                <h2>What type of item?</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowTypePicker(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="type-picker-cards">
              <button
                type="button"
                className="type-picker-card"
                onClick={openCreateNormal}
              >
                <span className="type-picker-icon">
                  <CookingPot size={28} />
                </span>
                <strong>Standard item</strong>
                <small>A single item with a fixed price (e.g. Chicken Tikka, Masala Fries).</small>
              </button>
              <button
                type="button"
                className="type-picker-card"
                onClick={openCreateCustom}
              >
                <span className="type-picker-icon type-picker-icon-amber">
                  <Plus size={28} />
                </span>
                <strong>Custom menu item</strong>
                <small>Base item with customizable sections & addon prices (e.g. Roll with kebab choices).</small>
              </button>
            </div>
          </section>
        </div>
      )}
      {(creatingCustom || Boolean(editingCustom)) && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              handleRequestCloseCustom();
            }
          }}
        >
          <section className="modal-card menu-modal custom-menu-modal">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">
                  {editingCustom ? "EDIT CUSTOM ITEM" : "BUILD YOUR OWN"}
                </span>
                <h2>{editingCustom ? "Edit custom menu item" : "New custom menu item"}</h2>
              </div>
              <button
                className="icon-button"
                onClick={handleRequestCloseCustom}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <form
              className="modal-form"
              onSubmit={(e) => void submitCustom(e)}
            >
              <label className="field-label">
                Item name
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  value={customForm.name}
                  onChange={(e) =>
                    setCustomForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="e.g. Roll, Thali, Bowl"
                />
              </label>
              <label className="field-label">
                Description
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={customForm.description}
                  onChange={(e) =>
                    setCustomForm((f) => ({ ...f, description: e.target.value }))
                  }
                  placeholder="What makes this customizable dish special?"
                />
              </label>
              <div className="field-label" style={{ marginBottom: 12 }}>
                Categories (select all that apply)
                {menuCategories.length === 0 ? (
                  <span style={{ fontSize: "12px", color: "#888", display: "block", marginTop: 4 }}>
                    No categories created yet. Add one in the Category Manager.
                  </span>
                ) : (
                  <div className="category-multi-select-list">
                    {menuCategories.map((cat) => {
                      const isSelected = customForm.categories.includes(cat.name);
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          className={`category-toggle-pill ${isSelected ? "selected" : ""}`}
                          onClick={() => {
                            const newCategories = isSelected
                              ? customForm.categories.filter((c) => c !== cat.name)
                              : [...customForm.categories, cat.name];
                            const newCategory = newCategories[0] || "";
                            setCustomForm((f) => ({
                              ...f,
                              categories: newCategories,
                              category: newCategory,
                            }));
                          }}
                        >
                          {isSelected ? "✓ " : "+ "}
                          {cat.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <label className="field-label">
                Base price · INR
                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={customForm.base_price_paise}
                  onChange={(e) =>
                    setCustomForm((f) => ({
                      ...f,
                      base_price_paise: Number(e.target.value),
                    }))
                  }
                  placeholder="120"
                />
              </label>

              {/* Addon sections */}
              <div className="custom-sections-builder">
                <div className="custom-sections-header">
                  <strong>Customization sections</strong>
                  <small>
                    Add sections with addon options. The option price adds to the base price.
                  </small>
                </div>
                {customForm.sections.map((section, si) => (
                  <div className="custom-section-block" key={si}>
                    <div className="custom-section-title-row">
                      <input
                        required
                        className="custom-section-name-input"
                        placeholder="Section name (e.g. Kebab Selection, Bread Choice, Sauce)"
                        value={section.name}
                        maxLength={120}
                        onChange={(e) => updateSection(si, e.target.value)}
                      />
                      <div className="custom-section-type-toggle" role="group" aria-label="Section requirement">
                        <button
                          type="button"
                          className={`custom-type-pill required-pill ${section.required !== false ? "active" : ""}`}
                          onClick={() => setSectionRequired(si, true)}
                        >
                          Must choose
                        </button>
                        <button
                          type="button"
                          className={`custom-type-pill optional-pill ${section.required === false ? "active" : ""}`}
                          onClick={() => setSectionRequired(si, false)}
                        >
                          Optional
                        </button>
                      </div>
                      <button
                        type="button"
                        className="icon-button danger-icon"
                        onClick={() => removeSection(si)}
                        aria-label="Remove section"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="custom-section-options">
                      {section.options.map((opt, oi) => (
                        <div className="custom-option-row" key={oi}>
                          <input
                            required
                            placeholder="Option name (e.g. Chicken Tikka, Paneer Tikka)"
                            value={opt.name}
                            maxLength={120}
                            onChange={(e) =>
                              updateOption(si, oi, "name", e.target.value)
                            }
                          />
                          <div className="custom-option-price">
                            <span>+₹</span>
                            <input
                              required
                              type="number"
                              min="0"
                              step="1"
                              placeholder="0"
                              value={opt.extra_paise}
                              onChange={(e) =>
                                updateOption(si, oi, "extra_paise", e.target.value)
                              }
                            />
                          </div>
                          {section.options.length > 1 && (
                            <button
                              type="button"
                              className="icon-button"
                              onClick={() => removeOption(si, oi)}
                              aria-label="Remove option"
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        className="custom-add-option-btn"
                        onClick={() => addOption(si)}
                      >
                        <Plus size={13} /> Add option
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="custom-add-section-btn"
                  onClick={addSection}
                >
                  <Plus size={14} /> Add section
                </button>
              </div>

              {/* Images */}
              <div className="field-label">
                Menu images{" "}
                <span className="field-optional">First image is the main photo</span>
                <div className="menu-image-grid">
                  {customForm.image_urls.map((url, index) => (
                    <div className="menu-image-tile" key={`${index}-${url}`}>
                      <img
                        src={resolveImageUrl(url)}
                        alt={`Custom item image ${index + 1}`}
                        onError={(e) =>
                          e.currentTarget
                            .closest(".menu-image-tile")
                            ?.classList.add("menu-image-failed")
                        }
                      />
                      {index === 0 ? (
                        <span className="menu-image-order menu-image-main-badge" title="Main dish photo">
                          <Star size={10} fill="currentColor" /> MAIN
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="menu-image-order menu-image-order-btn"
                          title="Click to set as main image"
                          onClick={() => setMainCustomImage(index)}
                        >
                          #{index + 1}
                        </button>
                      )}
                      <div className="menu-image-actions">
                        {index !== 0 && (
                          <button
                            type="button"
                            className="menu-image-set-main-btn"
                            aria-label="Set as main image"
                            title="Set as main photo (moves to front)"
                            onClick={() => setMainCustomImage(index)}
                          >
                            <Star size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label="Change image"
                          title="Change image"
                          onClick={() =>
                            setCustomImagePrompt({ index, value: url })
                          }
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete image"
                          title="Delete image"
                          onClick={() => removeCustomImage(index)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="menu-image-add"
                    onClick={() =>
                      setCustomImagePrompt({ index: -1, value: "" })
                    }
                  >
                    <Plus size={25} />
                    <span>Add image</span>
                  </button>
                </div>
              </div>

              {/* Checkboxes */}
              <div className="checkbox-settings">
                <label>
                  <input
                    type="checkbox"
                    checked={customForm.is_vegetarian}
                    onChange={(e) =>
                      setCustomForm((f) => ({
                        ...f,
                        is_vegetarian: e.target.checked,
                      }))
                    }
                  />
                  <span>
                    <strong>Vegetarian</strong>
                    <small>Show a green veg marker.</small>
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={customForm.is_available}
                    onChange={(e) =>
                      setCustomForm((f) => ({
                        ...f,
                        is_available: e.target.checked,
                      }))
                    }
                  />
                  <span>
                    <strong>Available</strong>
                    <small>Show on the customer menu.</small>
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={customForm.is_featured}
                    onChange={(e) =>
                      setCustomForm((f) => ({
                        ...f,
                        is_featured: e.target.checked,
                      }))
                    }
                  />
                  <span>
                    <strong>KZ pick</strong>
                    <small>Feature this menu favorite.</small>
                  </span>
                </label>
              </div>

              <div className="modal-actions">
                <Button
                  variant="secondary"
                  onClick={handleRequestCloseCustom}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy
                    ? "Saving…"
                    : editingCustom
                      ? "Save changes"
                      : "Create custom item"}{" "}
                  <ArrowRight size={15} />
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
      {customImagePrompt && (
        <ImageUploadModal
          key={`custom-img-modal-${customImagePrompt.index}-${customImagePrompt.value || "new"}`}
          isOpen={true}
          title={customImagePrompt.index === -1 ? "Add custom dish image" : "Replace custom dish image"}
          initialUrl={customImagePrompt.value || ""}
          onSave={handleSaveCustomImage}
          onClose={() => setCustomImagePrompt(null)}
        />
      )}

      {discardModalOpen && (
        <div
          className="address-map-backdrop"
          style={{
            zIndex: 10005,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            className="admin-panel"
            role="dialog"
            aria-modal="true"
            style={{
              maxWidth: "430px",
              width: "90%",
              padding: "1.75rem",
              borderRadius: "14px",
              textAlign: "center",
              boxShadow: "0 16px 40px rgba(0, 0, 0, 0.45)",
            }}
          >
            <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "1.2rem", fontWeight: 700 }}>
              Discard changes?
            </h3>
            <p style={{ margin: "0 0 1.5rem 0", color: "var(--muted)", fontSize: "0.92rem", lineHeight: 1.45 }}>
              Are you sure you want to discard your changes? Any unsaved edits and staged dish photos will be lost.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: "0.85rem" }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDiscardModalOpen(false)}
              >
                Keep editing
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={forceCloseNormal}
              >
                Discard changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {discardCustomModalOpen && (
        <div
          className="address-map-backdrop"
          style={{
            zIndex: 10005,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            className="admin-panel"
            role="dialog"
            aria-modal="true"
            style={{
              maxWidth: "430px",
              width: "90%",
              padding: "1.75rem",
              borderRadius: "14px",
              textAlign: "center",
              boxShadow: "0 16px 40px rgba(0, 0, 0, 0.45)",
            }}
          >
            <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "1.2rem", fontWeight: 700 }}>
              Discard custom item?
            </h3>
            <p style={{ margin: "0 0 1.5rem 0", color: "var(--muted)", fontSize: "0.92rem", lineHeight: 1.45 }}>
              Are you sure you want to discard your changes? Any unsaved custom sections and staged photos will be lost.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: "0.85rem" }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDiscardCustomModalOpen(false)}
              >
                Keep editing
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={forceCloseCustom}
              >
                Discard changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {archiveTarget && (
        <div
          className="address-map-backdrop"
          style={{
            zIndex: 10005,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            className="admin-panel"
            role="dialog"
            aria-modal="true"
            style={{
              maxWidth: "430px",
              width: "90%",
              padding: "1.75rem",
              borderRadius: "14px",
              textAlign: "center",
              boxShadow: "0 16px 40px rgba(0, 0, 0, 0.45)",
            }}
          >
            <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "1.2rem", fontWeight: 700 }}>
              Remove from live menu?
            </h3>
            <p style={{ margin: "0 0 1.5rem 0", color: "var(--muted)", fontSize: "0.92rem", lineHeight: 1.45 }}>
              Are you sure you want to remove <strong>{archiveTarget.name}</strong> from the live menu? This will mark it as unavailable.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: "0.85rem" }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setArchiveTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  const target = archiveTarget;
                  setArchiveTarget(null);
                  if (target) void archive(target);
                }}
              >
                Remove item
              </Button>
            </div>
          </div>
        </div>
      )}

      {archiveCustomTarget && (
        <div
          className="address-map-backdrop"
          style={{
            zIndex: 10005,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            className="admin-panel"
            role="dialog"
            aria-modal="true"
            style={{
              maxWidth: "430px",
              width: "90%",
              padding: "1.75rem",
              borderRadius: "14px",
              textAlign: "center",
              boxShadow: "0 16px 40px rgba(0, 0, 0, 0.45)",
            }}
          >
            <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "1.2rem", fontWeight: 700 }}>
              Remove custom item?
            </h3>
            <p style={{ margin: "0 0 1.5rem 0", color: "var(--muted)", fontSize: "0.92rem", lineHeight: 1.45 }}>
              Are you sure you want to remove <strong>{archiveCustomTarget.name}</strong> from the custom menu?
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: "0.85rem" }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setArchiveCustomTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  const target = archiveCustomTarget;
                  setArchiveCustomTarget(null);
                  if (target) void archiveCustom(target);
                }}
              >
                Remove item
              </Button>
            </div>
          </div>
        </div>
      )}

      {categoryDeleteTarget && (
        <div
          className="address-map-backdrop"
          style={{
            zIndex: 10005,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCategoryDeleteTarget(null);
          }}
        >
          <div
            className="admin-panel"
            role="dialog"
            aria-modal="true"
            style={{
              maxWidth: "430px",
              width: "90%",
              padding: "1.75rem",
              borderRadius: "14px",
              textAlign: "center",
              boxShadow: "0 16px 40px rgba(0, 0, 0, 0.45)",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "#fef2f2",
                color: "#dc2626",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 1rem",
              }}
            >
              <Trash2 size={24} />
            </div>
            <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "1.2rem", fontWeight: 700 }}>
              Delete category?
            </h3>
            <p style={{ margin: "0 0 1.5rem 0", color: "var(--muted)", fontSize: "0.92rem", lineHeight: 1.45 }}>
              {(() => {
                const affected = getCategoryMenuCount(categoryDeleteTarget);
                return affected > 0 ? (
                  <>
                    Are you sure you want to delete <strong>“{categoryDeleteTarget.name}”</strong>?{" "}
                    <strong>{affected}</strong> {affected === 1 ? "menu item belongs" : "menu items belong"} to this category.
                  </>
                ) : (
                  <>Are you sure you want to delete category <strong>“{categoryDeleteTarget.name}”</strong>?</>
                );
              })()}
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: "0.85rem" }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCategoryDeleteTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  const target = categoryDeleteTarget;
                  setCategoryDeleteTarget(null);
                  if (target) void executeDeleteCategory(target);
                }}
              >
                Delete category
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function BadgeTag() {
  return <span className="badge-tag-icon">✦</span>;
}

function Reports() {
  const [period, setPeriod] = usePreference<string>("admin_reports_period", "week");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    setLoading(true);
    api<Report>(`/admin/reports/sales?period=${period}`)
      .then(setReport)
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Could not load sales report.",
        ),
      )
      .finally(() => setLoading(false));
  }, [period]);
  const maximum = Math.max(
    1,
    ...(report?.series || []).map((point) => point.revenue_paise),
  );
  const paidPercent = report?.total_orders
    ? Math.round((report.paid_orders / report.total_orders) * 100)
    : 0;
  return (
    <>
      <PageTitle
        eyebrow="NUMBERS WITH A LITTLE MORE FLAVOR"
        title="Sales reports"
        description="A clear picture of sales, order volume and what people are loving."
        action={
          <RoundedSelect
            className="sales-period-select"
            icon={<BarChart3 size={15} />}
            ariaLabel="Report period"
            value={period}
            onChange={(next) => setPeriod(next)}
            options={[
              { value: "day", label: "Today" },
              { value: "week", label: "This week" },
              { value: "month", label: "This month" },
              { value: "year", label: "This year" },
            ]}
          />
        }
      />
      {error && <Notice>{error}</Notice>}
      {loading ? (
        <Loading label="Crunching the numbers…" />
      ) : (
        report && (
          <>
            <div className="report-stat-grid">
              <div className="report-stat-card report-stat-primary">
                <span>PAID REVENUE</span>
                <strong>{formatINR(report.revenue_paise)}</strong>
                <small>For this {period}</small>
                <span className="report-decoration">↗</span>
              </div>
              <div className="report-stat-card">
                <span>PAID ORDERS</span>
                <strong>{report.paid_orders}</strong>
                <small>
                  {report.total_orders} placed in this {period}
                </small>
                <span className="report-stat-icon">
                  <ShoppingBag size={17} />
                </span>
              </div>
              <div className="report-stat-card">
                <span>AVERAGE ORDER</span>
                <strong>{formatINR(report.average_order_paise)}</strong>
                <small>Paid orders, all payment types</small>
                <span className="report-stat-icon">
                  <CreditCard size={17} />
                </span>
              </div>
              <div className="report-stat-card">
                <span>PAYMENT SUCCESS</span>
                <strong>{paidPercent}%</strong>
                <small>Payments currently marked paid</small>
                <span className="report-stat-icon">
                  <ShieldCheck size={17} />
                </span>
              </div>
            </div>
            <div className="report-content-grid">
              <section className="admin-panel report-chart-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">SALES OVER TIME</span>
                    <h2>
                      {period === "day"
                        ? "Hourly sales"
                        : period === "year"
                          ? "Month by month"
                          : "Daily sales"}
                    </h2>
                  </div>
                  <span className="report-total">
                    <small>Total</small>
                    <strong>{formatINR(report.revenue_paise)}</strong>
                  </span>
                </div>
                <div className="report-chart">
                  <div className="chart-axis">
                    <span>{formatINR(maximum)}</span>
                    <span>{formatINR(maximum / 2)}</span>
                    <span>₹0</span>
                  </div>
                  <div className="chart-bars">
                    {report.series.map((point, index) => (
                      <div
                        className="chart-bar-wrap"
                        key={`${index}-${point.label}`}
                      >
                        <span className="chart-tip">
                          {formatINR(point.revenue_paise)}
                          <small>{point.orders} orders</small>
                        </span>
                        <div
                          className={`chart-bar ${point.revenue_paise ? "bar-highlight" : ""}`}
                          style={{
                            height: `${Math.max(point.revenue_paise ? 7 : 2, (point.revenue_paise / maximum) * 100)}%`,
                          }}
                        />
                        <span className="chart-label">{point.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="chart-legend">
                  <span>
                    <i className="legend-dot" /> Paid revenue
                  </span>
                  <span>
                    Orders placed {formatStatus(period)}: {report.total_orders}
                  </span>
                </div>
              </section>
              <div className="report-side-panels">
                <section className="admin-panel status-breakdown">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">IN THE FLOW</span>
                      <h2>Order status</h2>
                    </div>
                    <Activity size={16} />
                  </div>
                  {Object.entries(report.statuses).filter(([, count]) => count)
                    .length ? (
                    Object.entries(report.statuses)
                      .filter(([, count]) => count)
                      .sort((a, b) => b[1] - a[1])
                      .map(([status, count]) => (
                        <div className="status-break-row" key={status}>
                          <StatusBadge status={status} />
                          <strong>{count}</strong>
                        </div>
                      ))
                  ) : (
                    <p className="report-no-data">No orders in this period.</p>
                  )}
                </section>
                <section className="admin-panel bestsellers">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">GUEST FAVORITES</span>
                      <h2>Top sellers</h2>
                    </div>
                    <Flame size={16} />
                  </div>
                  {report.top_items.length ? (
                    report.top_items.map((item, index) => (
                      <div className="best-seller-row" key={item.name}>
                        <span>{index + 1}</span>
                        <strong>{item.name}</strong>
                        <b>{item.quantity}</b>
                      </div>
                    ))
                  ) : (
                    <p className="report-no-data">No paid orders yet.</p>
                  )}
                </section>
              </div>
            </div>
          </>
        )
      )}
    </>
  );
}

function RestaurantLocationMap({ latitude, longitude, onSave, onClose }: { latitude: number | null; longitude: number | null; onSave: (latitude: number, longitude: number) => void; onClose: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState<google.maps.LatLngLiteral>(latitude != null && longitude != null ? { lat: latitude, lng: longitude } : amtalaMapCenter);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
    if (!key) { setError("Google Maps is not configured. Add VITE_GOOGLE_MAPS_API_KEY to the frontend build environment."); return; }
    let disposed = false;
    void loadRestaurantMaps(key).then((maps) => {
      if (disposed || !container.current) return;
      const initial = latitude != null && longitude != null ? { lat: latitude, lng: longitude } : amtalaMapCenter;
      const map = new maps.Map(container.current, { center: initial, zoom: latitude != null ? 16 : 12, mapTypeControl: false, streetViewControl: false, clickableIcons: false, gestureHandling: "greedy" });
      const marker = new google.maps.Marker({ map, position: initial, draggable: true, title: "Restaurant location" });
      const choose = (location: google.maps.LatLngLiteral) => { marker.setPosition(location); setPoint(location); };
      map.addListener("click", (event: google.maps.MapMouseEvent) => { if (event.latLng) choose(event.latLng.toJSON()); });
      marker.addListener("dragend", () => { const location = marker.getPosition()?.toJSON(); if (location) setPoint(location); });
      setReady(true);
    }).catch(() => { if (!disposed) setError("Google Maps could not load. Check the API key and Maps JavaScript API restrictions."); });
    return () => { disposed = true; };
  }, [latitude, longitude]);
  return <div className="address-map-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="address-map-dialog" role="dialog" aria-modal="true" aria-labelledby="restaurant-location-title"><div className="address-map-heading"><span><small>RESTAURANT LOCATION</small><h2 id="restaurant-location-title">Pin your restaurant</h2></span><button className="icon-button" type="button" onClick={onClose} aria-label="Close map"><X size={18} /></button></div><div className="address-map-toolbar"><p className="address-map-help">The map opens on Amtala, South 24 Parganas. Click or drag the pin to your restaurant’s exact entrance.</p></div><div className="address-map-wrap"><div className="address-map-canvas address-google-map" ref={container} /></div>{error ? <Notice>{error}</Notice> : <div className="address-map-status">Selected: {point.lat.toFixed(6)}, {point.lng.toFixed(6)}</div>}<div className="address-map-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="button" disabled={!ready} onClick={() => { onSave(point.lat, point.lng); onClose(); }}><Check size={15} /> Use this pin</Button></div></section></div>;
}

interface CustomSchedule {
  id: string;
  start_time: string;
  end_time: string;
  days: string[];
}

const SCHEDULE_DAYS = [
  { id: "monday", label: "Monday", short: "Mon" },
  { id: "tuesday", label: "Tuesday", short: "Tue" },
  { id: "wednesday", label: "Wednesday", short: "Wed" },
  { id: "thursday", label: "Thursday", short: "Thu" },
  { id: "friday", label: "Friday", short: "Fri" },
  { id: "saturday", label: "Saturday", short: "Sat" },
  { id: "sunday", label: "Sunday", short: "Sun" },
] as const;

function timeToMinutes(t: string): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatTime12(t: string): string {
  if (!t) return "";
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 === 0 ? 12 : h % 12;
  const displayM = m < 10 ? `0${m}` : m;
  return `${displayH}:${displayM} ${period}`;
}

function parseSchedulesFromWeekly(scheduleObj: any): CustomSchedule[] {
  if (!scheduleObj) return [];
  if (Array.isArray(scheduleObj.custom_schedules) && scheduleObj.custom_schedules.length > 0) {
    return scheduleObj.custom_schedules;
  }
  const groups: Record<string, string[]> = {};
  for (const day of ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]) {
    const d = scheduleObj[day];
    if (d && d.open) {
      const opens = d.opens || "10:00";
      const closes = d.closes || "22:00";
      const key = `${opens}_${closes}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(day);
    }
  }
  return Object.entries(groups).map(([key, days], index) => {
    const [start_time, end_time] = key.split("_");
    return {
      id: `sched_${index + 1}`,
      start_time,
      end_time,
      days,
    };
  });
}

function buildWeeklySchedule(schedules: CustomSchedule[]): Record<string, any> {
  const allDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const res: Record<string, any> = {
    custom_schedules: schedules,
  };
  for (const day of allDays) {
    const matching = schedules.filter((s) => s.days.includes(day));
    if (matching.length > 0) {
      res[day] = {
        open: true,
        opens: matching[0].start_time,
        closes: matching[0].end_time,
        slots: matching.map((s) => ({ opens: s.start_time, closes: s.end_time })),
      };
    } else {
      res[day] = {
        open: false,
        opens: "10:00",
        closes: "22:00",
        slots: [],
      };
    }
  }
  return res;
}

function checkClash(
  newSched: { start_time: string; end_time: string; days: string[] },
  existingSchedules: CustomSchedule[],
  ignoreId?: string,
): string | null {
  if (!newSched.start_time || !newSched.end_time) {
    return "Please specify both start and end times.";
  }
  const newStart = timeToMinutes(newSched.start_time);
  const newEnd = timeToMinutes(newSched.end_time);
  if (newEnd <= newStart) {
    return "End time must be after start time.";
  }
  if (!newSched.days || newSched.days.length === 0) {
    return "Please select at least one day.";
  }

  for (const ex of existingSchedules) {
    if (ignoreId && ex.id === ignoreId) continue;
    const commonDays = newSched.days.filter((d) => ex.days.includes(d));
    if (commonDays.length > 0) {
      const exStart = timeToMinutes(ex.start_time);
      const exEnd = timeToMinutes(ex.end_time);
      if (newStart < exEnd && exStart < newEnd) {
        const dayNames = commonDays
          .map((d) => d.charAt(0).toUpperCase() + d.slice(1))
          .join(", ");
        return `Schedule clashes with an existing schedule on ${dayNames} (${ex.start_time} - ${ex.end_time}).`;
      }
    }
  }
  return null;
}

function formatOverrideTime(isoString?: string | null): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();
    const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (isToday) return `today at ${timeStr}`;
    if (isTomorrow) return `tomorrow at ${timeStr}`;
    const dayName = d.toLocaleDateString([], { weekday: "short" });
    return `${dayName} at ${timeStr}`;
  } catch {
    return "";
  }
}

function isCurrentlyOpenBySchedule(schedules: CustomSchedule[]): boolean {
  if (!schedules || schedules.length === 0) return false;
  const now = new Date();
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const currentDay = dayNames[now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  for (const s of schedules) {
    if (s.days.includes(currentDay)) {
      const startMin = timeToMinutes(s.start_time);
      const endMin = timeToMinutes(s.end_time);
      if (startMin <= endMin) {
        if (currentMinutes >= startMin && currentMinutes <= endMin) {
          return true;
        }
      } else {
        if (currentMinutes >= startMin || currentMinutes <= endMin) {
          return true;
        }
      }
    }
  }
  return false;
}

function SettingsPage() {
  const [form, setForm] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [isLocationHovered, setIsLocationHovered] = useState(false);

  const [schedules, setSchedules] = useState<CustomSchedule[]>([]);
  const [addScheduleOpen, setAddScheduleOpen] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [newStartTime, setNewStartTime] = useState("10:00");
  const [newEndTime, setNewEndTime] = useState("22:00");
  const [newSelectedDays, setNewSelectedDays] = useState<string[]>([
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ]);
  const [scheduleError, setScheduleError] = useState("");

  const [phoneNumbers, setPhoneNumbers] = useState<string[]>([""]);
  const [savedToastOpen, setSavedToastOpen] = useState(false);
  const initialSnapshot = useRef<string>("");

  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [settingsDiffs, setSettingsDiffs] = useState<{ label: string; from: string; to: string }[]>([]);

  const [overrideWarningOpen, setOverrideWarningOpen] = useState(false);
  const [pendingToggleValue, setPendingToggleValue] = useState<boolean | null>(null);

  useEffect(() => {
    api<Restaurant>("/admin/settings")
      .then((settings) => {
        const parsedScheds = parseSchedulesFromWeekly(settings.weekly_schedule);
        setSchedules(parsedScheds);
        const phonesList = (settings.phones && settings.phones.length > 0)
          ? settings.phones
          : settings.phone
            ? settings.phone.split(",").map((p: string) => p.trim()).filter(Boolean)
            : [""];
        const finalPhones = phonesList.length > 0 ? phonesList : [""];
        setPhoneNumbers(finalPhones);

        const formData: Restaurant = {
          ...settings,
          weekly_schedule: settings.weekly_schedule || {},
          delivery_fee_per_km_paise: settings.delivery_fee_per_km_paise / 100,
          minimum_order_paise: settings.minimum_order_paise / 100,
          accepting_orders: settings.accepting_orders,
          distance_calculation_mode: settings.distance_calculation_mode || "AUTO",
          haversine_routing_factor: settings.haversine_routing_factor ?? 1.3,
          enforce_driver_geofence: Boolean(settings.enforce_driver_geofence),
          driver_geofence_meters: settings.driver_geofence_meters || 500,
        };
        setForm(formData);
        initialSnapshot.current = JSON.stringify({
          form: formData,
          schedules: parsedScheds,
          phoneNumbers: finalPhones,
        });
      })
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Could not load settings.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const isDirty = useMemo(() => {
    if (!form || !initialSnapshot.current) return false;
    const current = JSON.stringify({
      form,
      schedules,
      phoneNumbers,
    });
    return current !== initialSnapshot.current;
  }, [form, schedules, phoneNumbers]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // Periodic poll so the switch updates automatically in real-time when schedule shifts occur
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!isDirty && !busy) {
        api<Restaurant>("/admin/settings")
          .then((settings) => {
            setForm((prev) => {
              if (!prev) return null;
              return {
                ...prev,
                accepting_orders: settings.accepting_orders,
                admin_override_state: settings.admin_override_state,
                admin_override_until: settings.admin_override_until,
                admin_override_open: settings.admin_override_open,
                is_currently_scheduled_open: settings.is_currently_scheduled_open,
                schedule_status: settings.schedule_status,
                next_schedule_refresh: settings.next_schedule_refresh,
              };
            });
          })
          .catch(() => {});
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [isDirty, busy]);

  async function persistAcceptingOrders(nextVal: boolean) {
    if (!form) return;
    const cleanPhones = phoneNumbers.map((p) => p.trim()).filter(Boolean);
    const phoneStr = cleanPhones.join(", ");
    const weekly = buildWeeklySchedule(schedules);
    const scheduledOpen = form.is_currently_scheduled_open ?? isCurrentlyOpenBySchedule(schedules);
    const isOverride = nextVal !== scheduledOpen;

    setBusy(true);
    try {
      const updated = await api<Restaurant>("/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...form,
          accepting_orders: nextVal,
          admin_override_open: nextVal,
          phone: phoneStr,
          phones: cleanPhones,
          weekly_schedule: weekly,
          delivery_fee_per_km_paise: Math.round(form.delivery_fee_per_km_paise * 100),
          minimum_order_paise: Math.round(form.minimum_order_paise * 100),
          distance_calculation_mode: form.distance_calculation_mode || "AUTO",
          haversine_routing_factor: Number(form.haversine_routing_factor) || 1.3,
          enforce_driver_geofence: Boolean(form.enforce_driver_geofence),
          driver_geofence_meters: Number(form.driver_geofence_meters) || 500,
        }),
      });

      const parsedScheds = parseSchedulesFromWeekly(updated.weekly_schedule);
      setSchedules(parsedScheds);
      const phonesList = (updated.phones && updated.phones.length > 0)
        ? updated.phones
        : updated.phone
          ? updated.phone.split(",").map((p: string) => p.trim()).filter(Boolean)
          : [""];
      const finalPhones = phonesList.length > 0 ? phonesList : [""];
      setPhoneNumbers(finalPhones);

      const formData: Restaurant = {
        ...updated,
        weekly_schedule: updated.weekly_schedule || {},
        delivery_fee_per_km_paise: updated.delivery_fee_per_km_paise / 100,
        minimum_order_paise: updated.minimum_order_paise / 100,
        distance_calculation_mode: updated.distance_calculation_mode || "AUTO",
        haversine_routing_factor: updated.haversine_routing_factor ?? 1.3,
        enforce_driver_geofence: Boolean(updated.enforce_driver_geofence),
        driver_geofence_meters: updated.driver_geofence_meters || 500,
      };
      setForm(formData);
      initialSnapshot.current = JSON.stringify({
        form: formData,
        schedules: parsedScheds,
        phoneNumbers: finalPhones,
      });

      let noticeMsg = "Order status updated.";
      if (isOverride) {
        const untilStr = updated.admin_override_until ? ` until ${formatOverrideTime(updated.admin_override_until)}` : "";
        noticeMsg = nextVal
          ? `Override active: Restaurant opened for orders${untilStr}.`
          : `Override active: Restaurant orders paused${untilStr}.`;
      } else {
        noticeMsg = nextVal
          ? "Restaurant is open for orders as scheduled."
          : "Restaurant is closed for orders as scheduled.";
      }
      setNotice(noticeMsg);
      setSavedToastOpen(true);
      setTimeout(() => setSavedToastOpen(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update order status.");
    } finally {
      setBusy(false);
    }
  }

  function handleToggleAcceptingOrders() {
    if (!form || busy) return;
    const nextVal = !form.accepting_orders;
    const scheduledOpen = form.is_currently_scheduled_open ?? isCurrentlyOpenBySchedule(schedules);
    if (nextVal !== scheduledOpen) {
      setPendingToggleValue(nextVal);
      setOverrideWarningOpen(true);
    } else {
      void persistAcceptingOrders(nextVal);
    }
  }

  function handleOpenAddSchedule() {
    setEditingScheduleId(null);
    setNewStartTime("10:00");
    setNewEndTime("22:00");
    setNewSelectedDays([
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ]);
    setScheduleError("");
    setAddScheduleOpen(true);
  }

  function handleOpenEditSchedule(s: CustomSchedule) {
    setEditingScheduleId(s.id);
    setNewStartTime(s.start_time);
    setNewEndTime(s.end_time);
    setNewSelectedDays([...s.days]);
    setScheduleError("");
    setAddScheduleOpen(true);
  }

  function handleSaveSchedule() {
    const clash = checkClash(
      { start_time: newStartTime, end_time: newEndTime, days: newSelectedDays },
      schedules,
      editingScheduleId || undefined,
    );
    if (clash) {
      setScheduleError(clash);
      return;
    }
    let updated: CustomSchedule[];
    if (editingScheduleId) {
      updated = schedules.map((s) =>
        s.id === editingScheduleId
          ? {
              ...s,
              start_time: newStartTime,
              end_time: newEndTime,
              days: newSelectedDays,
            }
          : s,
      );
    } else {
      const newSched: CustomSchedule = {
        id: `sched_${Date.now()}`,
        start_time: newStartTime,
        end_time: newEndTime,
        days: newSelectedDays,
      };
      updated = [...schedules, newSched];
    }
    setSchedules(updated);
    const newWeekly = buildWeeklySchedule(updated);
    change("weekly_schedule", newWeekly);
    setAddScheduleOpen(false);
    setEditingScheduleId(null);
    setScheduleError("");
  }

  function handleRemoveSchedule(id: string) {
    const updated = schedules.filter((s) => s.id !== id);
    setSchedules(updated);
    const newWeekly = buildWeeklySchedule(updated);
    change("weekly_schedule", newWeekly);
  }

  async function executeSaveSettings() {
    if (!form || !isDirty) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const weekly = buildWeeklySchedule(schedules);
      const cleanPhones = phoneNumbers.map((p) => p.trim()).filter(Boolean);
      const phoneStr = cleanPhones.join(", ");
      const updated = await api<Restaurant>("/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...form,
          phone: phoneStr,
          phones: cleanPhones,
          weekly_schedule: weekly,
          delivery_fee_per_km_paise: Math.round(form.delivery_fee_per_km_paise * 100),
          minimum_order_paise: Math.round(form.minimum_order_paise * 100),
          distance_calculation_mode: form.distance_calculation_mode || "AUTO",
          haversine_routing_factor: Number(form.haversine_routing_factor) || 1.3,
          enforce_driver_geofence: Boolean(form.enforce_driver_geofence),
          driver_geofence_meters: Number(form.driver_geofence_meters) || 500,
        }),
      });
      const parsedScheds = parseSchedulesFromWeekly(updated.weekly_schedule);
      setSchedules(parsedScheds);
      const phonesList = (updated.phones && updated.phones.length > 0)
        ? updated.phones
        : updated.phone
          ? updated.phone.split(",").map((p: string) => p.trim()).filter(Boolean)
          : [""];
      const finalPhones = phonesList.length > 0 ? phonesList : [""];
      setPhoneNumbers(finalPhones);

      const formData: Restaurant = {
        ...updated,
        weekly_schedule: updated.weekly_schedule || {},
        delivery_fee_per_km_paise: updated.delivery_fee_per_km_paise / 100,
        minimum_order_paise: updated.minimum_order_paise / 100,
        distance_calculation_mode: updated.distance_calculation_mode || "AUTO",
        haversine_routing_factor: updated.haversine_routing_factor ?? 1.3,
        enforce_driver_geofence: Boolean(updated.enforce_driver_geofence),
        driver_geofence_meters: updated.driver_geofence_meters || 500,
      };
      setForm(formData);
      initialSnapshot.current = JSON.stringify({
        form: formData,
        schedules: parsedScheds,
        phoneNumbers: finalPhones,
      });
      setConfirmSaveOpen(false);
      setSettingsDiffs([]);
      setNotice("Restaurant details saved.");
      setSavedToastOpen(true);
      setTimeout(() => setSavedToastOpen(false), 2600);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save these settings.",
      );
    } finally {
      setBusy(false);
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !isDirty) return;

    let initial: { form?: Restaurant; schedules?: CustomSchedule[]; phoneNumbers?: string[] } = {};
    try {
      initial = JSON.parse(initialSnapshot.current || "{}");
    } catch {}

    const oldF: Restaurant = initial.form || ({} as Restaurant);
    const oldScheds: CustomSchedule[] = initial.schedules || [];
    const oldP: string[] = initial.phoneNumbers || [];

    const diffs: { label: string; from: string; to: string }[] = [];

    if (form.restaurant_name !== oldF.restaurant_name) {
      diffs.push({
        label: "Restaurant name",
        from: oldF.restaurant_name || "—",
        to: form.restaurant_name || "—",
      });
    }

    if ((form.tagline || "") !== (oldF.tagline || "")) {
      diffs.push({
        label: "Tagline",
        from: oldF.tagline || "—",
        to: form.tagline || "—",
      });
    }

    const oldCleanPhones = oldP.map((p) => p.trim()).filter(Boolean).join(", ");
    const newCleanPhones = phoneNumbers.map((p) => p.trim()).filter(Boolean).join(", ");
    if (oldCleanPhones !== newCleanPhones) {
      diffs.push({
        label: "Contact phone numbers",
        from: oldCleanPhones || "—",
        to: newCleanPhones || "—",
      });
    }

    if ((form.address || "") !== (oldF.address || "")) {
      diffs.push({
        label: "Restaurant address",
        from: oldF.address || "—",
        to: form.address || "—",
      });
    }

    if (
      Number(oldF.latitude || 0).toFixed(4) !== Number(form.latitude || 0).toFixed(4) ||
      Number(oldF.longitude || 0).toFixed(4) !== Number(form.longitude || 0).toFixed(4)
    ) {
      diffs.push({
        label: "GPS coordinates",
        from: `${oldF.latitude ?? 0}, ${oldF.longitude ?? 0}`,
        to: `${form.latitude ?? 0}, ${form.longitude ?? 0}`,
      });
    }

    if ((form.distance_calculation_mode || "AUTO") !== (oldF.distance_calculation_mode || "AUTO")) {
      const modeNames: Record<string, string> = {
        AUTO: "Auto",
        GOOGLE_MAPS: "Google's API",
        HAVERSINE: "Haversine",
      };
      diffs.push({
        label: "Distance calculation mode",
        from: modeNames[oldF.distance_calculation_mode || "AUTO"] || oldF.distance_calculation_mode || "AUTO",
        to: modeNames[form.distance_calculation_mode || "AUTO"] || form.distance_calculation_mode || "AUTO",
      });
    }

    if (Number(form.haversine_routing_factor ?? 1.3) !== Number(oldF.haversine_routing_factor ?? 1.3)) {
      diffs.push({
        label: "Haversine routing factor",
        from: String(oldF.haversine_routing_factor ?? 1.3),
        to: String(form.haversine_routing_factor ?? 1.3),
      });
    }

    if (Number(form.minimum_order_paise) !== Number(oldF.minimum_order_paise)) {
      diffs.push({
        label: "Minimum order amount",
        from: `₹${oldF.minimum_order_paise}`,
        to: `₹${form.minimum_order_paise}`,
      });
    }

    if (Number(form.delivery_radius_km) !== Number(oldF.delivery_radius_km)) {
      diffs.push({
        label: "Max delivery distance",
        from: `${oldF.delivery_radius_km} km`,
        to: `${form.delivery_radius_km} km`,
      });
    }

    if (Number(form.free_delivery_radius_km) !== Number(oldF.free_delivery_radius_km)) {
      diffs.push({
        label: "Free delivery radius",
        from: `${oldF.free_delivery_radius_km} km`,
        to: `${form.free_delivery_radius_km} km`,
      });
    }

    if (Number(form.delivery_fee_per_km_paise) !== Number(oldF.delivery_fee_per_km_paise)) {
      diffs.push({
        label: "Delivery fee per km",
        from: `₹${oldF.delivery_fee_per_km_paise}`,
        to: `₹${form.delivery_fee_per_km_paise}`,
      });
    }

    const oldGeofenceEnforced = Boolean(oldF.enforce_driver_geofence);
    const newGeofenceEnforced = Boolean(form.enforce_driver_geofence);
    const oldMeters = oldF.driver_geofence_meters || 500;
    const newMeters = form.driver_geofence_meters || 500;
    if (oldGeofenceEnforced !== newGeofenceEnforced || (newGeofenceEnforced && oldMeters !== newMeters)) {
      diffs.push({
        label: "Driver geofence enforcement",
        from: oldGeofenceEnforced ? `Enabled (${oldMeters}m)` : "Disabled",
        to: newGeofenceEnforced ? `Enabled (${newMeters}m)` : "Disabled",
      });
    }

    const formatSchedSummary = (list: CustomSchedule[]) => {
      if (!list || list.length === 0) return "No custom schedules";
      return list
        .map(
          (s) =>
            `${s.days.map((d) => d.slice(0, 3).toUpperCase()).join(", ")} (${s.start_time} - ${s.end_time})`,
        )
        .join("; ");
    };
    if (JSON.stringify(oldScheds) !== JSON.stringify(schedules)) {
      diffs.push({
        label: "Operating schedules",
        from: formatSchedSummary(oldScheds),
        to: formatSchedSummary(schedules),
      });
    }

    if (diffs.length === 0) {
      void executeSaveSettings();
      return;
    }

    setSettingsDiffs(diffs);
    setConfirmSaveOpen(true);
  }

  if (loading) return <Loading label="Opening the settings book…" />;
  if (!form)
    return (
      <Notice>{error || "Restaurant settings could not be loaded."}</Notice>
    );

  function change<K extends keyof Restaurant>(key: K, value: Restaurant[K]) {
    setForm((old) => (old ? { ...old, [key]: value } : old));
  }

  return (
    <>
      <PageTitle
        eyebrow="A PLACE OF YOUR OWN"
        title="Restaurant settings"
        description="Keep your public details and checkout expectations up to date."
      />
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice>{error}</Notice>}
      <form className="settings-form" onSubmit={handleFormSubmit}>
        <div className="settings-layout">
          <div className="settings-main">
            <section className="admin-panel settings-card">
              <h2>Restaurant profile</h2>
              <div className="settings-fields">
                <label className="field-label">
                  Restaurant name
                  <input
                    required
                    maxLength={120}
                    value={form.restaurant_name}
                    onChange={(event) =>
                      change("restaurant_name", event.target.value)
                    }
                  />
                </label>
                <label className="field-label">
                  Tagline
                  <input
                    maxLength={200}
                    value={form.tagline}
                    onChange={(event) => change("tagline", event.target.value)}
                  />
                </label>
                <div className="field-label" style={{ gridColumn: "span 2" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "0.25rem",
                    }}
                  >
                    <span>Mobile numbers</span>
                    <button
                      type="button"
                      className="link-subtle"
                      style={{
                        fontSize: "0.82rem",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        color: "var(--accent)",
                        cursor: "pointer",
                        border: "none",
                        background: "transparent",
                        padding: "2px 6px",
                      }}
                      onClick={() => setPhoneNumbers((prev) => [...prev, ""])}
                    >
                      <Plus size={14} /> Add mobile number
                    </button>
                  </div>
                  <div className="restaurant-phones-grid">
                    {phoneNumbers.map((phone, idx) => (
                      <div key={idx} className="restaurant-phone-item">
                        <input
                          required={idx === 0}
                          maxLength={32}
                          placeholder={idx === 0 ? "Primary mobile number" : `Mobile number ${idx + 1}`}
                          value={phone}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPhoneNumbers((prev) => {
                              const next = [...prev];
                              next[idx] = val;
                              return next;
                            });
                          }}
                          style={{ flex: 1 }}
                        />
                        {phoneNumbers.length > 1 && (
                          <button
                            type="button"
                            className="phone-remove-btn"
                            title="Remove number"
                            onClick={() => {
                              setPhoneNumbers((prev) => prev.filter((_, i) => i !== idx));
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <label className="field-label">
                  Address
                  <input
                    required
                    maxLength={300}
                    value={form.address}
                    onChange={(event) => change("address", event.target.value)}
                  />
                </label>
                <div className="field-label restaurant-location-control">
                  <span>Exact restaurant location</span>
                  {(() => {
                    const lat = form.latitude;
                    const lng = form.longitude;
                    const hasLocation = lat != null && lng != null;
                    const defaultText = hasLocation
                      ? `${lat.toFixed(6)}, ${lng.toFixed(6)}`
                      : "Edit";
                    const displayText = isLocationHovered ? "Edit" : defaultText;
                    return (
                      <span
                        onMouseEnter={() => setIsLocationHovered(true)}
                        onMouseLeave={() => setIsLocationHovered(false)}
                        style={{ display: "block", width: "100%" }}
                      >
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setLocationPickerOpen(true)}
                        >
                          {displayText}
                        </Button>
                      </span>
                    );
                  })()}
                </div>
              </div>

              <div
                className="settings-schedule"
                style={{
                  marginTop: "1.75rem",
                  paddingTop: "1.25rem",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "1.25rem",
                    flexWrap: "wrap",
                    gap: "0.75rem",
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
                    Opening days and hours
                  </h3>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontSize: "0.92rem", fontWeight: 600 }}>
                      Open for Orders
                    </span>
                    {form.admin_override_state !== null && form.admin_override_state !== undefined && (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          padding: "3px 9px",
                          borderRadius: "6px",
                          background: form.accepting_orders ? "#fef3c7" : "#fee2e2",
                          color: form.accepting_orders ? "#92400e" : "#991b1b",
                          border: form.accepting_orders ? "1px solid #fde68a" : "1px solid #fecaca",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        OVERRIDE ACTIVE · {form.accepting_orders ? "Open" : "Paused"}{form.admin_override_until ? ` until ${formatOverrideTime(form.admin_override_until)}` : ""}
                      </span>
                    )}
                    {form.admin_override_state !== null && form.admin_override_state !== undefined && (
                      <button
                        type="button"
                        className="button button-sm button-secondary"
                        style={{ padding: "3px 9px", fontSize: "0.75rem", height: "auto" }}
                        disabled={busy}
                        onClick={() => {
                          const scheduledOpen = form.is_currently_scheduled_open ?? isCurrentlyOpenBySchedule(schedules);
                          void persistAcceptingOrders(scheduledOpen);
                        }}
                      >
                        Resume schedule
                      </button>
                    )}
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={form.accepting_orders}
                        disabled={busy}
                        onChange={handleToggleAcceptingOrders}
                      />
                      <span />
                    </label>
                  </div>
                </div>

                {schedules.length === 0 ? (
                  <div
                    style={{
                      padding: "1.25rem",
                      border: "1px dashed var(--border)",
                      borderRadius: "8px",
                      textAlign: "center",
                      color: "var(--muted)",
                      marginBottom: "1rem",
                    }}
                  >
                    No operating schedules added yet. Click &ldquo;+ Add custom schedule&rdquo; below to set opening hours.
                  </div>
                ) : (
                  <div className="schedule-list">
                    {schedules.map((s) => (
                      <div className="schedule-item-card" key={s.id}>
                        <div className="schedule-item-info">
                          <div className="schedule-item-time">
                            <Clock size={16} />
                            <strong>
                              {formatTime12(s.start_time)} – {formatTime12(s.end_time)}
                            </strong>
                            <span
                              style={{
                                color: "var(--muted)",
                                fontSize: "0.82rem",
                              }}
                            >
                              ({s.start_time} - {s.end_time})
                            </span>
                          </div>
                          <div className="schedule-item-days">
                            {SCHEDULE_DAYS.map((d) => (
                              <span
                                key={d.id}
                                className={`schedule-day-badge ${
                                  s.days.includes(d.id) ? "active" : "inactive"
                                }`}
                              >
                                {d.short}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                          <button
                            type="button"
                            className="icon-button"
                            title="Edit this schedule"
                            onClick={() => handleOpenEditSchedule(s)}
                          >
                            <Edit3 size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            title="Delete this schedule"
                            onClick={() => handleRemoveSchedule(s.id)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: "1rem" }}>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleOpenAddSchedule}
                  >
                    <Plus size={16} /> Add custom schedule
                  </Button>
                </div>
              </div>
            </section>

            <section className="admin-panel settings-card">
              <h2>Checkout & delivery</h2>
              <div className="settings-fields">
                <label className="field-label">
                  Distance Calculation Mode
                  <RoundedSelect
                    value={form.distance_calculation_mode || "AUTO"}
                    onChange={(val) =>
                      change(
                        "distance_calculation_mode",
                        val as "AUTO" | "GOOGLE_MAPS" | "HAVERSINE",
                      )
                    }
                    options={[
                      { value: "AUTO", label: "Auto" },
                      { value: "GOOGLE_MAPS", label: "Google's API" },
                      { value: "HAVERSINE", label: "Haversine" },
                    ]}
                  />
                </label>
                <label className="field-label">
                  Routing Factor for Haversine
                  <input
                    type="number"
                    min="1"
                    max="4"
                    step="any"
                    value={form.haversine_routing_factor ?? 1.3}
                    onChange={(event) =>
                      change(
                        "haversine_routing_factor",
                        Number(event.target.value),
                      )
                    }
                  />
                </label>
                <label className="field-label">
                  Minimum Order Amount
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.minimum_order_paise}
                    onChange={(event) =>
                      change("minimum_order_paise", Number(event.target.value))
                    }
                  />
                </label>
                <label className="field-label">
                  Maximum Delivery Distance (in km)
                  <input
                    type="number"
                    min="0.1"
                    max="500"
                    step="any"
                    value={form.delivery_radius_km}
                    onChange={(event) =>
                      change("delivery_radius_km", Number(event.target.value))
                    }
                  />
                </label>
                <label className="field-label">
                  Free Delivery Radius (in km)
                  <input
                    type="number"
                    min="0"
                    max="500"
                    step="any"
                    value={form.free_delivery_radius_km}
                    onChange={(event) =>
                      change(
                        "free_delivery_radius_km",
                        Number(event.target.value),
                      )
                    }
                  />
                </label>
                <label className="field-label">
                  Delivery Fee Amount per km
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.delivery_fee_per_km_paise}
                    onChange={(event) =>
                      change(
                        "delivery_fee_per_km_paise",
                        Number(event.target.value),
                      )
                    }
                  />
                </label>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    minHeight: "56px",
                    border: "1px solid #e8e5dd",
                    borderRadius: "12px",
                    background: "#fff",
                    boxSizing: "border-box",
                    margin: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.95rem",
                      fontWeight: 600,
                      color: "#29332f",
                      textAlign: "left",
                    }}
                  >
                    Delivery Driver Geofence
                  </span>
                  <label className="toggle-switch" style={{ margin: 0, flexShrink: 0 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(form.enforce_driver_geofence)}
                      onChange={(event) =>
                        change("enforce_driver_geofence", event.target.checked)
                      }
                    />
                    <span />
                  </label>
                </div>
                {form.enforce_driver_geofence ? (
                  <label className="field-label" style={{ margin: 0, textAlign: "left" }}>
                    Allowed Distance from Shop (in m)
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={form.driver_geofence_meters || 500}
                      onChange={(event) =>
                        change(
                          "driver_geofence_meters",
                          Number(event.target.value),
                        )
                      }
                    />
                  </label>
                ) : (
                  <div />
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="settings-pinned-bar">
          <div className="settings-pinned-bar-content">
            <Button
              type="submit"
              disabled={busy || !isDirty}
              className={`settings-save-button ${isDirty ? "is-dirty" : "is-pristine"}`}
            >
              {busy ? "Saving…" : "Save restaurant settings"}
            </Button>
          </div>
        </div>
      </form>

      {savedToastOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              background: "#1e2420",
              color: "#ffffff",
              padding: "16px 28px",
              borderRadius: "14px",
              boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              fontSize: "1.05rem",
              fontWeight: 600,
              pointerEvents: "auto",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#22c55e",
                borderRadius: "50%",
                width: 28,
                height: 28,
              }}
            >
              <Check size={18} color="#fff" strokeWidth={3} />
            </span>
            Restaurant settings saved
          </div>
        </div>
      )}

      {addScheduleOpen && (
        <div
          className="address-map-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setAddScheduleOpen(false);
              setEditingScheduleId(null);
              setScheduleError("");
            }
          }}
        >
          <section
            className="admin-panel"
            role="dialog"
            aria-modal="true"
            style={{
              maxWidth: "480px",
              width: "95%",
              padding: "1.75rem",
              borderRadius: "12px",
              boxShadow: "0 12px 32px rgba(0, 0, 0, 0.4)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "1.25rem",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1.15rem" }}>
                {editingScheduleId ? "Edit custom schedule" : "Add custom schedule"}
              </h3>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  setAddScheduleOpen(false);
                  setEditingScheduleId(null);
                  setScheduleError("");
                }}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1rem",
                marginBottom: "1.25rem",
              }}
            >
              <label className="field-label">
                Start time
                <RoundedTimePicker
                  value={newStartTime}
                  onChange={(timeVal) => {
                    setNewStartTime(timeVal);
                    setScheduleError("");
                  }}
                  ariaLabel="Schedule start time"
                  placeholder="--:--"
                />
              </label>
              <label className="field-label">
                End time
                <RoundedTimePicker
                  value={newEndTime}
                  onChange={(timeVal) => {
                    setNewEndTime(timeVal);
                    setScheduleError("");
                  }}
                  ariaLabel="Schedule end time"
                  placeholder="--:--"
                />
              </label>
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "0.6rem",
                }}
              >
                <span style={{ fontSize: "0.88rem", fontWeight: 600 }}>
                  Select days
                </span>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="link-subtle"
                    style={{ fontSize: "0.78rem" }}
                    onClick={() => {
                      setNewSelectedDays(SCHEDULE_DAYS.map((d) => d.id));
                      setScheduleError("");
                    }}
                  >
                    All days
                  </button>
                  <span style={{ color: "var(--muted)" }}>·</span>
                  <button
                    type="button"
                    className="link-subtle"
                    style={{ fontSize: "0.78rem" }}
                    onClick={() => {
                      setNewSelectedDays([
                        "monday",
                        "tuesday",
                        "wednesday",
                        "thursday",
                        "friday",
                      ]);
                      setScheduleError("");
                    }}
                  >
                    Weekdays
                  </button>
                  <span style={{ color: "var(--muted)" }}>·</span>
                  <button
                    type="button"
                    className="link-subtle"
                    style={{ fontSize: "0.78rem" }}
                    onClick={() => {
                      setNewSelectedDays(["saturday", "sunday"]);
                      setScheduleError("");
                    }}
                  >
                    Weekends
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {SCHEDULE_DAYS.map((d) => {
                  const isSelected = newSelectedDays.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        setNewSelectedDays((prev) =>
                          prev.includes(d.id)
                            ? prev.filter((x) => x !== d.id)
                            : [...prev, d.id],
                        );
                        setScheduleError("");
                      }}
                      className={`schedule-day-chip ${isSelected ? "selected" : ""}`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {scheduleError && (
              <div style={{ marginBottom: "1.25rem" }}>
                <Notice tone="error">{scheduleError}</Notice>
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "0.75rem",
              }}
            >
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setAddScheduleOpen(false);
                  setEditingScheduleId(null);
                  setScheduleError("");
                }}
              >
                Cancel
              </Button>
              <Button type="button" onClick={handleSaveSchedule}>
                <Check size={16} /> {editingScheduleId ? "Save changes" : "Add schedule"}
              </Button>
            </div>
          </section>
        </div>
      )}

      {overrideWarningOpen && (
        <div
          className="address-map-backdrop"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            className="admin-panel"
            role="dialog"
            aria-modal="true"
            style={{
              maxWidth: "460px",
              width: "90%",
              padding: "1.75rem",
              borderRadius: "12px",
              boxShadow: "0 12px 32px rgba(0, 0, 0, 0.4)",
              textAlign: "center",
            }}
          >
            <h3
              style={{
                margin: "0 0 1rem 0",
                fontSize: "1.2rem",
                fontWeight: 600,
              }}
            >
              Are you sure you want to override current schedule?
            </h3>
            <p
              style={{
                margin: "0 0 1.5rem 0",
                color: "var(--muted)",
                fontSize: "0.92rem",
                lineHeight: 1.45,
              }}
            >
              {pendingToggleValue
                ? "The restaurant is currently outside scheduled operating hours. Turning this on will allow customers to place orders right now. It will automatically turn off at the end of operating hours."
                : "The restaurant is currently within scheduled operating hours. Turning this off will pause incoming orders immediately. It will automatically turn back on when the next scheduled working hours start."}
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "1rem",
              }}
            >
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setOverrideWarningOpen(false);
                  setPendingToggleValue(null);
                }}
              >
                No
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  const val = pendingToggleValue;
                  setOverrideWarningOpen(false);
                  setPendingToggleValue(null);
                  if (val !== null) {
                    void persistAcceptingOrders(val);
                  }
                }}
              >
                Yes
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmSaveOpen && (
        <div
          className="address-map-backdrop"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setConfirmSaveOpen(false);
            }
          }}
        >
          <div
            className="admin-panel"
            role="dialog"
            aria-modal="true"
            style={{
              maxWidth: "560px",
              width: "92%",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              padding: "1.75rem",
              borderRadius: "14px",
              boxShadow: "0 16px 40px rgba(0, 0, 0, 0.45)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: "1rem",
              }}
            >
              <div>
                <span
                  className="eyebrow"
                  style={{
                    color: "var(--brand-accent, #e57373)",
                    fontWeight: 700,
                    fontSize: "0.75rem",
                    letterSpacing: "0.08em",
                  }}
                >
                  CONFIRM SETTINGS UPDATE
                </span>
                <h3 style={{ margin: "4px 0 0 0", fontSize: "1.25rem", fontWeight: 700 }}>
                  Review your changes
                </h3>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setConfirmSaveOpen(false)}
                aria-label="Close review dialog"
                disabled={busy}
              >
                <X size={18} />
              </button>
            </div>

            <p
              style={{
                margin: "0 0 1rem 0",
                color: "var(--muted)",
                fontSize: "0.92rem",
                lineHeight: 1.45,
              }}
            >
              Are you sure you want to make these changes to the restaurant settings?
            </p>

            <div
              style={{
                overflowY: "auto",
                flex: 1,
                paddingRight: "4px",
                marginBottom: "1.25rem",
              }}
            >
              <div className="settings-diff-list">
                {settingsDiffs.map((diff) => (
                  <div className="settings-diff-item" key={diff.label}>
                    <span className="settings-diff-label">{diff.label}</span>
                    <div className="settings-diff-values">
                      <span className="settings-diff-from">{diff.from}</span>
                      <span className="settings-diff-arrow">→</span>
                      <span className="settings-diff-to">{diff.to}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "0.75rem",
                borderTop: "1px solid var(--border)",
                paddingTop: "1rem",
              }}
            >
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmSaveOpen(false)}
                disabled={busy}
              >
                Keep editing
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => void executeSaveSettings()}
              >
                {busy ? "Saving…" : "Confirm & Save changes"} <ArrowRight size={15} />
              </Button>
            </div>
          </div>
        </div>
      )}

      {locationPickerOpen && (
        <RestaurantLocationMap
          latitude={form.latitude}
          longitude={form.longitude}
          onClose={() => setLocationPickerOpen(false)}
          onSave={(latitude, longitude) => {
            change("latitude", latitude);
            change("longitude", longitude);
          }}
        />
      )}
    </>
  );
}
function ActivityCenter() {
  const [events, setEvents] = useState<
    {
      id: number;
      message: string;
      actor_name: string;
      created_at: string;
      event_type: string;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = usePreference<string>("admin_activity_sort", "newest");
  useEffect(() => {
    api<typeof events>("/admin/events?limit=250")
      .then(setEvents)
      .finally(() => setLoading(false));
  }, []);
  const visibleEvents = events
    .filter((event) => {
      const textMatches = `${event.message} ${event.actor_name} ${event.event_type}`.toLowerCase().includes(query.trim().toLowerCase());
      if (!textMatches) return false;
      const eventTime = new Date(event.created_at).getTime();
      const now = Date.now();
      if (sort === "day") return (now - eventTime) <= 24 * 60 * 60 * 1000;
      if (sort === "week") return (now - eventTime) <= 7 * 24 * 60 * 60 * 1000;
      if (sort === "month") return (now - eventTime) <= 30 * 24 * 60 * 60 * 1000;
      return true;
    })
    .sort((a, b) => {
      if (sort === "oldest") return a.created_at.localeCompare(b.created_at);
      if (sort === "actor") return a.actor_name.localeCompare(b.actor_name);
      return b.created_at.localeCompare(a.created_at);
    });
  return (
    <>
      <PageTitle
        eyebrow="EVERYTHING THAT MOVES"
        title="Activity & notifications"
        description="Order changes, menu pauses, and delivery updates in date order."
      />
      {loading ? (
        <Loading label="Loading activity…" />
      ) : (
        <section className="admin-panel">
          <div className="activity-filter-bar">
            <label className="admin-search"><Search size={16} /><input aria-label="Search activity" placeholder="Search activity or person" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <RoundedSelect className="activity-sort-select" icon={<ArrowUpDown size={15} />} ariaLabel="Sort activity" value={sort} onChange={setSort} options={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "day", label: "Today" }, { value: "week", label: "This week" }, { value: "month", label: "This month" }, { value: "actor", label: "Person A–Z" }]} />
          </div>
          {visibleEvents.length ? visibleEvents.map((event) => (
            <div className="status-break-row" key={event.id}>
              <strong>{event.message}</strong>
              <span>
                {event.actor_name} · {friendlyDate(event.created_at)}
              </span>
            </div>
          )) : <EmptyState title="No activity found" description="Try a different search." />}
        </section>
      )}
    </>
  );
}

function Offers() {
  const [audience, setAudience] = usePreference<string>("admin_offers_audience", "ALL");
  const [channels, setChannels] = useState<string[]>(["EMAIL"]);
  const [subject, setSubject] = useState("A little something from KebabZilla");
  const [message, setMessage] = useState("");
  const [logs, setLogs] = useState<
    {
      id: number;
      audience: string;
      channels: string[];
      subject: string;
      message: string;
      delivery_counts: Record<string, { recipient_count: number; sent_count: number }>;
      recipient_count: number;
      sent_count: number;
      status: string;
      created_at: string;
    }[]
  >([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editingPreview, setEditingPreview] = useState(false);
  const [logQuery, setLogQuery] = useState("");
  const [logSort, setLogSort] = usePreference<string>("admin_offers_log_sort", "newest");
  const [selectedLog, setSelectedLog] = useState<(typeof logs)[number] | null>(null);
  const refresh = useCallback(
    () => api<typeof logs>("/admin/offers").then(setLogs),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function send() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{
        status: string;
        recipient_count: number;
        sent_count: number;
        provider_notes: string[];
      }>("/admin/offers", {
        method: "POST",
        body: JSON.stringify({ audience, channels, subject, message }),
      });
      setNotice(
        `${result.status}: ${result.sent_count}/${result.recipient_count} recipients sent. ${result.provider_notes.join("; ")}`,
      );
      setMessage("");
      setPreviewOpen(false);
      setEditingPreview(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send offer.");
    } finally {
      setBusy(false);
    }
  }
  const visibleLogs = logs
    .filter((log) => {
      const textMatches = `${log.subject} ${log.message} ${log.status} ${log.audience} ${log.channels.join(" ")}`.toLowerCase().includes(logQuery.trim().toLowerCase());
      if (!textMatches) return false;
      const logTime = new Date(log.created_at).getTime();
      const now = Date.now();
      if (logSort === "day") return (now - logTime) <= 24 * 60 * 60 * 1000;
      if (logSort === "week") return (now - logTime) <= 7 * 24 * 60 * 60 * 1000;
      if (logSort === "month") return (now - logTime) <= 30 * 24 * 60 * 60 * 1000;
      return true;
    })
    .sort((a, b) => {
      if (logSort === "oldest") return a.created_at.localeCompare(b.created_at);
      if (logSort === "status") return a.status.localeCompare(b.status);
      return b.created_at.localeCompare(a.created_at);
    });
  return (
    <>
      <PageTitle
        eyebrow="A LITTLE SOMETHING FOR YOUR GUESTS"
        title="Customer offers"
        description="Send a custom email to all customers, new customers, or returning customers. SMS broadcasts will be added once an SMS provider is configured."
      />
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice>{error}</Notice>}
      <form
        className="admin-panel modal-form"
        onSubmit={(event) => { event.preventDefault(); setEditingPreview(false); setPreviewOpen(true); }}
      >
        <label className="field-label">
          Audience
          <RoundedSelect ariaLabel="Choose offer audience" value={audience} onChange={setAudience} options={[{ value: "ALL", label: "All customers" }, { value: "NEW", label: "New customers · no orders yet" }, { value: "RETURNING", label: "Returning customers" }]} />
        </label>
        <div className="offer-channel-field">
          <span>Send by</span>
          <div className="offer-channel-picker">
          {["EMAIL"].map((channel) => (
            <button type="button" key={channel} aria-pressed={channels.includes(channel)} className={channels.includes(channel) ? "selected" : ""} onClick={() =>
                  setChannels((old) =>
                    old.includes(channel)
                      ? old.filter((item) => item !== channel)
                      : [...old, channel],
                  )
                }>{channel}</button>
          ))}
          </div>
          <small className="field-optional">Sent from support@kebabzilla.in. SMS is not configured yet.</small>
        </div>
        <label className="field-label">
          Offer message
          <textarea
            required
            minLength={2}
            maxLength={1000}
            rows={5}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={busy || !channels.length}>
          Preview offer
        </Button>
      </form>
      {previewOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPreviewOpen(false); }}>
        <section className="modal-card offer-preview-modal" role="dialog" aria-modal="true" aria-labelledby="offer-preview-title">
          <div className="modal-heading"><div><span className="eyebrow">{editingPreview ? "EDIT CUSTOMER EMAIL" : "CUSTOMER EMAIL PREVIEW"}</span><h2 id="offer-preview-title">{editingPreview ? "Refine your offer" : subject}</h2></div><button className="icon-button" type="button" disabled={busy} onClick={() => setPreviewOpen(false)} aria-label="Close preview"><X size={18} /></button></div>
          {editingPreview ? <div className="modal-form"><label className="field-label">Email subject<input required minLength={2} maxLength={160} value={subject} onChange={(event) => setSubject(event.target.value)} /></label><label className="field-label">Email body<textarea required minLength={2} maxLength={1000} rows={7} value={message} onChange={(event) => setMessage(event.target.value)} /></label></div> : <div className="offer-preview-email">
            <div className="offer-preview-meta"><span>From</span><strong>KebabZilla &lt;support@kebabzilla.in&gt;</strong><span>To</span><strong>Selected {audience.toLowerCase()} customers</strong><span>Subject</span><strong>{subject}</strong></div>
            <article className="offer-preview-body"><p>Hi,</p><p>{message}</p><p>KebabZilla</p></article>
          </div>}
          <Notice tone="info">{editingPreview ? "Update the subject or body, then review the email before sending." : "Review the content above. Sending is final and will email every selected customer."}</Notice>
          <div className="modal-actions">{editingPreview ? <Button type="button" variant="secondary" disabled={busy || message.trim().length < 2 || subject.trim().length < 2} onClick={() => setEditingPreview(false)}>Review email</Button> : <Button type="button" variant="secondary" disabled={busy} onClick={() => setEditingPreview(true)}>Edit offer</Button>}<Button type="button" disabled={busy || message.trim().length < 2 || subject.trim().length < 2} onClick={() => void send()}>{busy ? "Sending…" : "Send this offer"} <ArrowRight size={15} /></Button></div>
        </section>
      </div>}
      <section className="admin-panel campaign-log-panel">
        <h2>Campaign log</h2>
        <div className="activity-filter-bar">
          <label className="admin-search"><Search size={16} /><input aria-label="Search campaign log" placeholder="Search campaigns" value={logQuery} onChange={(event) => setLogQuery(event.target.value)} /></label>
          <RoundedSelect className="activity-sort-select" icon={<ArrowUpDown size={15} />} ariaLabel="Sort campaign log" value={logSort} onChange={setLogSort} options={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "day", label: "Today" }, { value: "week", label: "This week" }, { value: "month", label: "This month" }, { value: "status", label: "Status A–Z" }]} />
        </div>
        <div className="campaign-log-scroll-wrap">
          {visibleLogs.length ? visibleLogs.map((log) => (
            <button type="button" className="campaign-log-row" key={log.id} onClick={() => setSelectedLog(log)}>
              <span className="campaign-log-copy"><strong>{log.subject}</strong><span>{log.message}</span></span>
              <span className="campaign-log-delivery">{log.channels.map((channel) => <span key={channel}>{channel} · {log.delivery_counts?.[channel]?.sent_count || 0}/{log.delivery_counts?.[channel]?.recipient_count || 0}</span>)}</span>
              <time>{friendlyDate(log.created_at)}</time>
            </button>
          )) : <EmptyState title="No campaigns found" description="Try a different search." />}
        </div>
      </section>
      {selectedLog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedLog(null); }}><section className="modal-card campaign-detail-modal" role="dialog" aria-modal="true" aria-labelledby="campaign-detail-title"><div className="modal-heading"><div><span className="eyebrow">CAMPAIGN DETAILS</span><h2 id="campaign-detail-title">{selectedLog.subject}</h2></div><button className="icon-button" type="button" onClick={() => setSelectedLog(null)} aria-label="Close campaign details"><X size={18} /></button></div><p className="campaign-detail-message">{selectedLog.message}</p><div className={`campaign-channel-details campaign-channel-details-${selectedLog.channels.length}`}>{selectedLog.channels.map((channel) => { const detail = selectedLog.delivery_counts?.[channel] || { recipient_count: 0, sent_count: 0 }; return <section key={channel} className="campaign-channel-card"><span className="eyebrow">{channel}</span><h3>{detail.sent_count} delivered</h3><p>{detail.sent_count} of {detail.recipient_count} selected customers received this message via {channel.toLowerCase()}.</p></section>; })}</div><div className="campaign-detail-footer"><span>{selectedLog.audience} customers</span><time>{friendlyDate(selectedLog.created_at)}</time></div></section></div>}
    </>
  );
}

type MenuDiscountRow = {
  id: number;
  campaign_name: string | null;
  menu_item_ids: number[];
  custom_menu_item_ids?: number[];
  menu_item_names: string[];
  discount_percent: number;
  starts_at: string;
  ends_at: string;
  created_at: string;
};

type SelectableItem = {
  key: string;
  id: number;
  isCustom: boolean;
  name: string;
  price_paise: number;
};

function localDateTimeValue(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function localDatePart(value: Date) { return localDateTimeValue(value).slice(0, 10); }
function localTimePart(value: Date) { return localDateTimeValue(value).slice(11, 16); }
function combineLocalDateTime(date: string, time: string) { return new Date(`${date}T${time}`); }

function Discounts() {
  const [itemsList, setItemsList] = useState<SelectableItem[]>([]);
  const [discounts, setDiscounts] = useState<MenuDiscountRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<number | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [menuPickerOpen, setMenuPickerOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [percent, setPercent] = useState("10");
  const [startsDate, setStartsDate] = useState(() => localDatePart(new Date()));
  const [startsTime, setStartsTime] = useState(() => localTimePart(new Date()));
  const [endsDate, setEndsDate] = useState(() => localDatePart(new Date(Date.now() + 60 * 60 * 1000)));
  const [endsTime, setEndsTime] = useState(() => localTimePart(new Date(Date.now() + 60 * 60 * 1000)));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [availableMenu, customMenu, scheduled] = await Promise.all([
      api<MenuItem[]>("/menu/manage"),
      api<CustomMenuItem[]>("/custom-menu/manage"),
      api<MenuDiscountRow[]>("/admin/discounts"),
    ]);
    const unified: SelectableItem[] = [
      ...availableMenu.map((m) => ({
        key: `std-${m.id}`,
        id: m.id,
        isCustom: false,
        name: m.name,
        price_paise: m.price_paise,
      })),
      ...customMenu.map((c) => ({
        key: `cust-${c.id}`,
        id: c.id,
        isCustom: true,
        name: `[Custom] ${c.name}`,
        price_paise: c.base_price_paise,
      })),
    ];
    setItemsList(unified);
    setDiscounts(scheduled);
  }, []);

  useEffect(() => {
    void refresh()
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load discounts."))
      .finally(() => setLoading(false));
  }, [refresh]);

  async function createDiscount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const stdIds = selectedKeys.filter((k) => k.startsWith("std-")).map((k) => Number(k.replace("std-", "")));
    const custIds = selectedKeys.filter((k) => k.startsWith("cust-")).map((k) => Number(k.replace("cust-", "")));
    try {
      await api<MenuDiscountRow>(
        editingCampaignId ? `/admin/discounts/${editingCampaignId}` : "/admin/discounts",
        {
          method: editingCampaignId ? "PUT" : "POST",
          body: JSON.stringify({
            campaign_name: campaignName.trim() || null,
            menu_item_ids: stdIds,
            custom_menu_item_ids: custIds,
            discount_percent: Number(percent),
            starts_at: combineLocalDateTime(startsDate, startsTime).toISOString(),
            ends_at: combineLocalDateTime(endsDate, endsTime).toISOString(),
          }),
        },
      );
      setModalOpen(false);
      setEditingCampaignId(null);
      setCampaignName("");
      setSelectedKeys([]);
      setItemSearch("");
      setMenuPickerOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this discount.");
    } finally {
      setBusy(false);
    }
  }

  async function removeDiscount(id: number) {
    try {
      await api(`/admin/discounts/${id}`, { method: "DELETE" });
      setDiscounts((rows) => rows.filter((row) => row.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove this discount.");
    }
  }

  const startsAt = combineLocalDateTime(startsDate, startsTime);
  const endsAt = combineLocalDateTime(endsDate, endsTime);
  const occupiedKeys = new Set(
    discounts
      .filter((discount) => discount.id !== editingCampaignId && new Date(discount.starts_at) < endsAt && new Date(discount.ends_at) > startsAt)
      .flatMap((discount) => [
        ...(discount.menu_item_ids || []).map((id) => `std-${id}`),
        ...(discount.custom_menu_item_ids || []).map((id) => `cust-${id}`),
      ]),
  );

  const selectableItems = itemsList.filter((item) => !occupiedKeys.has(item.key) || selectedKeys.includes(item.key));
  const filteredItems = selectableItems.filter((item) => item.name.toLowerCase().includes(itemSearch.trim().toLowerCase()));
  const allItemsSelected = selectableItems.length > 0 && selectableItems.every((item) => selectedKeys.includes(item.key));
  const hiddenDiscountedCount = itemsList.filter((item) => occupiedKeys.has(item.key) && !selectedKeys.includes(item.key)).length;

  const openCreateModal = () => {
    const now = new Date();
    const later = new Date(Date.now() + 60 * 60 * 1000);
    setError("");
    setEditingCampaignId(null);
    setCampaignName("");
    setPercent("10");
    setSelectedKeys([]);
    setItemSearch("");
    setMenuPickerOpen(false);
    setStartsDate(localDatePart(now));
    setStartsTime(localTimePart(now));
    setEndsDate(localDatePart(later));
    setEndsTime(localTimePart(later));
    setModalOpen(true);
  };

  const openEditModal = (discount: MenuDiscountRow) => {
    const startsAt = new Date(discount.starts_at);
    const endsAt = new Date(discount.ends_at);
    const currentKeys = [
      ...(discount.menu_item_ids || []).map((id) => `std-${id}`),
      ...(discount.custom_menu_item_ids || []).map((id) => `cust-${id}`),
    ];
    setError("");
    setEditingCampaignId(discount.id);
    setCampaignName(discount.campaign_name || "");
    setSelectedKeys(currentKeys);
    setItemSearch("");
    setMenuPickerOpen(false);
    setPercent(String(discount.discount_percent));
    setStartsDate(localDatePart(startsAt));
    setStartsTime(localTimePart(startsAt));
    setEndsDate(localDatePart(endsAt));
    setEndsTime(localTimePart(endsAt));
    setModalOpen(true);
  };

  return (
    <>
      <PageTitle
        eyebrow="A LITTLE SOMETHING OFF THE MENU"
        title="Discounts"
        description="Schedule percentage discounts across standard and custom menu items."
        action={
          <Button onClick={openCreateModal}>
            <Plus size={16} /> <span>Create discount</span>
          </Button>
        }
      />
      {error && <Notice onDismiss={() => setError("")}>{error}</Notice>}
      {loading ? (
        <Loading label="Loading discounts…" />
      ) : discounts.length ? (
        <section className="admin-panel discount-list-panel">
          <div className="discount-list-heading">
            <div>
              <span className="eyebrow">SCHEDULED OFFERS</span>
              <h2>Menu discounts</h2>
            </div>
            <span>
              {discounts.length} campaign{discounts.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="discount-list">
            {discounts.map((discount) => {
              const start = new Date(discount.starts_at);
              const end = new Date(discount.ends_at);
              const now = Date.now();
              const state = now < start.getTime() ? "Upcoming" : now < end.getTime() ? "Active" : "Ended";
              const totalItemsCount = (discount.menu_item_ids?.length || 0) + (discount.custom_menu_item_ids?.length || 0);
              const names = discount.menu_item_names.join(", ");
              return (
                <article className="discount-row" key={discount.id}>
                  <div className="discount-percent">
                    <strong>{discount.discount_percent}%</strong>
                  </div>
                  <div className="discount-row-main">
                    <strong>{discount.campaign_name || names || "Menu items unavailable"}</strong>
                    <small>
                      {discount.campaign_name ? names : `${totalItemsCount} item${totalItemsCount === 1 ? "" : "s"}`}
                    </small>
                  </div>
                  <span className={`discount-state ${state.toLowerCase()}`}>{state}</span>
                  <div className="discount-dates">
                    <span>
                      Starts <strong>{friendlyDate(discount.starts_at)}</strong>
                    </span>
                    <span>
                      Ends <strong>{friendlyDate(discount.ends_at)}</strong>
                    </span>
                  </div>
                  <div className="discount-row-actions">
                    {state !== "Ended" && (
                      <>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Edit discount campaign for ${names}`}
                          title="Edit campaign"
                          onClick={() => openEditModal(discount)}
                        >
                          <Edit3 size={16} />
                        </button>
                        <button
                          type="button"
                          className="icon-button danger-icon"
                          aria-label={`Delete discount for ${names}`}
                          title="Delete discount"
                          onClick={() => void removeDiscount(discount.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <EmptyState
          icon={<Percent size={20} />}
          title="No discounts scheduled"
          description="Create a percentage offer for standard and custom menu items with custom start and end times."
        />
      )}
      {modalOpen && (
        <div
          className="modal-backdrop discount-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              setModalOpen(false);
              setEditingCampaignId(null);
            }
          }}
        >
          <section className="modal-card discount-modal" role="dialog" aria-modal="true" aria-labelledby="discount-modal-title">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">A TIMED MENU OFFER</span>
                <h2 id="discount-modal-title">{editingCampaignId ? "Edit discount campaign" : "Create discount"}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close"
                onClick={() => {
                  setModalOpen(false);
                  setEditingCampaignId(null);
                }}
              >
                <X size={18} />
              </button>
            </div>
            <form className="modal-form" onSubmit={(event) => void createDiscount(event)}>
              {error && <Notice>{error}</Notice>}
              <label className="field-label">
                Campaign name <span className="field-optional">optional</span>
                <input
                  maxLength={80}
                  placeholder="e.g. Zilla’s Pick"
                  value={campaignName}
                  onChange={(event) => setCampaignName(event.target.value)}
                />
              </label>
              <label className="field-label">
                Discount · %
                <input
                  required
                  type="number"
                  min="1"
                  max="99"
                  value={percent}
                  onChange={(event) => setPercent(event.target.value)}
                />
              </label>
              <div className="field-label discount-menu-field">
                <span>Menu items (Standard & Custom)</span>
                <button
                  className="discount-menu-trigger"
                  type="button"
                  aria-expanded={menuPickerOpen}
                  onClick={() => setMenuPickerOpen((open) => !open)}
                >
                  {selectedKeys.length ? `${selectedKeys.length} item${selectedKeys.length === 1 ? "" : "s"} selected` : "Choose menu items"}
                  <span>⌄</span>
                </button>
                {menuPickerOpen && (
                  <div className="discount-menu-picker">
                    <label className="admin-search">
                      <Search size={16} />
                      <input
                        autoFocus
                        aria-label="Search menu items"
                        placeholder="Search standard or custom items"
                        value={itemSearch}
                        onChange={(event) => setItemSearch(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="discount-select-all"
                      onClick={() => setSelectedKeys(allItemsSelected ? [] : selectableItems.map((item) => item.key))}
                    >
                      <input type="checkbox" readOnly checked={allItemsSelected} />
                      Select all available menu items
                    </button>
                    {hiddenDiscountedCount > 0 && (
                      <p className="discount-menu-unavailable">
                        {hiddenDiscountedCount} item{hiddenDiscountedCount === 1 ? " is" : "s are"} hidden because another discount overlaps this schedule.
                      </p>
                    )}
                    <div className="discount-menu-options">
                      {filteredItems.map((item) => (
                        <label key={item.key}>
                          <input
                            type="checkbox"
                            checked={selectedKeys.includes(item.key)}
                            onChange={(event) =>
                              setSelectedKeys((keys) =>
                                event.target.checked ? [...keys, item.key] : keys.filter((k) => k !== item.key),
                              )
                            }
                          />
                          <span>{item.name}</span>
                          <small>{formatINR(item.price_paise)}</small>
                        </label>
                      ))}
                      {!filteredItems.length && <p>No menu items match that search.</p>}
                    </div>
                  </div>
                )}
              </div>
              <div className="discount-datetime-grid">
                <div className="discount-time-group">
                  <span className="field-label">Starts</span>
                  <div>
                    <label className="sr-only" htmlFor="discount-start-date">
                      Start date
                    </label>
                    <RoundedDatePicker
                      value={startsDate}
                      onChange={setStartsDate}
                      ariaLabel="Discount start date"
                      placeholder="Start date"
                    />
                    <label className="sr-only" htmlFor="discount-start-time">
                      Start time
                    </label>
                    <RoundedTimePicker
                      value={startsTime}
                      onChange={setStartsTime}
                      ariaLabel="Discount start time"
                      placeholder="Start time"
                    />
                  </div>
                </div>
                <div className="discount-time-group">
                  <span className="field-label">Ends</span>
                  <div>
                    <label className="sr-only" htmlFor="discount-end-date">
                      End date
                    </label>
                    <RoundedDatePicker
                      value={endsDate}
                      onChange={setEndsDate}
                      ariaLabel="Discount end date"
                      placeholder="End date"
                    />
                    <label className="sr-only" htmlFor="discount-end-time">
                      End time
                    </label>
                    <RoundedTimePicker
                      value={endsTime}
                      onChange={setEndsTime}
                      ariaLabel="Discount end time"
                      placeholder="End time"
                    />
                  </div>
                </div>
              </div>
              <div className="modal-actions">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setModalOpen(false);
                    setEditingCampaignId(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={busy || !selectedKeys.length || Number(percent) < 1 || endsAt <= startsAt}
                >
                  {busy ? (editingCampaignId ? "Saving…" : "Creating…") : (editingCampaignId ? "Save changes" : "Create discount")}{" "}
                  <ArrowRight size={15} />
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}


export default function Admin() {
  return (
    <Routes>
      <Route index element={<Overview />} />
      <Route path="orders" element={<AdminOrders />} />
      <Route path="menu" element={<MenuManagement />} />
      <Route path="team" element={<Team />} />
      <Route path="reports" element={<Reports />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="activity" element={<ActivityCenter />} />
      <Route path="offers" element={<Offers />} />
      <Route path="discounts" element={<Discounts />} />
      <Route
        path="*"
        element={
          <EmptyState
            icon={<LayoutDashboard size={20} />}
            title="That admin view isn’t on the menu"
            description="Choose a section from your restaurant workspace."
            action={
              <Link className="button button-secondary" to="/admin">
                Back to overview
              </Link>
            }
          />
        }
      />
    </Routes>
  );
}
