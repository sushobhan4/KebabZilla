import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  CircleDollarSign,
  CookingPot,
  CreditCard,
  Edit3,
  Flame,
  LayoutDashboard,
  Plus,
  Percent,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Truck,
  Users,
  X,
} from "lucide-react";
import { Link, Route, Routes } from "react-router-dom";
import {
  api,
  formatINR,
  formatStatus,
  friendlyDate,
  type Account,
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
  RoundedSelect,
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
            <RefreshCw size={15} /> Refresh
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
  const [filter, setFilter] = useState("ALL");
  const [period, setPeriod] = useState("all");
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
  async function refund(order: Order) {
    const message = `Issue a full Razorpay refund of ${formatINR(order.total_paise)} for order ${order.order_id}?`;
    if (!window.confirm(message)) return;
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
            <RefreshCw size={15} /> Refresh
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
            <RoundedSelect ariaLabel="Filter orders by time" value={period} onChange={(next) => { setPeriod(next); setPage(0); setLoading(true); }} options={[{ value: "all", label: "All time" }, { value: "day", label: "Today" }, { value: "week", label: "This week" }, { value: "month", label: "This month" }, { value: "year", label: "This year" }]} className="orders-period-select" />
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
                          onClick={() => void refund(order)}
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
    </>
  );
}

function Team() {
  const { account } = useAuth();
  const [people, setPeople] = useState<Account[]>([]);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("ALL");
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
        body: JSON.stringify(form),
      });
      setCreating(false);
      setProvisioned(created);
      setForm({
        name: "",
        email: "",
        phone: "",
        role: "EMPLOYEE",
      });
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
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> Create account
          </Button>
        }
      />
      {error && <Notice onDismiss={() => setError("")}>{error}</Notice>}
      {provisioned && <Notice tone="info" onDismiss={() => setProvisioned(null)}>
        {provisioned.notification_status === "EMAIL_SENT" ? <><strong>{provisioned.name}'s account is ready.</strong> Their temporary password was sent to <strong>{provisioned.email}</strong>. SMS is not configured yet. They must change it on first sign-in.</> : <><strong>{provisioned.name}'s account is ready.</strong> Email could not be sent and SMS is not configured. Share this temporary password securely: <strong>{provisioned.temporary_password}</strong>. They must change it on first sign-in.</>}
      </Notice>}
      <div className="team-metrics">
        <div>
          <strong>{total}</strong>
          <span>{q || role !== "ALL" ? "Matching accounts" : "Team accounts"}</span>
        </div>
        <div>
          <strong>{roleCounts.EMPLOYEE || 0}</strong>
          <span>Employees</span>
        </div>
        <div>
          <strong>{roleCounts.DELIVERY || 0}</strong>
          <span>Delivery partners</span>
        </div>
        <div>
          <strong>{total}</strong>
          <span>Team accounts</span>
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
          <div className="role-filter"><Users size={15} /><RoundedSelect ariaLabel="Sort people by role" value={role} onChange={(next) => { setRole(next); setPage(0); setLoading(true); }} options={[{ value: "ALL", label: "All roles" }, ...roles.map((r) => ({ value: r, label: formatStatus(r) }))]} /></div>
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
              </div>
              <Notice tone="info">
                A temporary password will be generated automatically from the person's first name, six random digits, and a symbol. It will be sent to their email. SMS delivery will be added once an SMS provider is configured.
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
  const [busy, setBusy] = useState(false);
  const [imagePrompt, setImagePrompt] = useState<{ index: number; value: string } | null>(null);
  const blank = {
    name: "",
    description: "",
    category: "",
    price_paise: 0,
    image_url: "",
    image_urls: [] as string[],
    is_vegetarian: false,
    is_available: true,
    is_featured: false,
  };
  const [form, setForm] = useState(blank);
  const refresh = useCallback(
    () =>
      Promise.all([
        api<MenuItem[]>("/menu/manage"),
        api<{ id: number; name: string }[]>("/menu/categories"),
      ])
        .then(([menu, categories]) => {
          setItems(menu);
          setMenuCategories(categories);
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
    setEditing(item);
    const imageUrls = item.image_urls?.length
      ? item.image_urls
      : item.image_url
        ? [item.image_url]
        : [];
    setForm({
      ...item,
      price_paise: item.price_paise / 100,
      image_url: imageUrls[0] || "",
      image_urls: imageUrls,
    });
    setCreating(false);
  }
  function openCreate() {
    setCreating(true);
    setEditing(null);
    setForm(blank);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = {
      ...form,
      price_paise: Math.round(Number(form.price_paise) * 100),
      image_urls: form.image_urls,
      image_url: form.image_urls[0] || null,
    };
    try {
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
  async function deleteCategory(category: { id: number; name: string }) {
    if (category.id === 0) {
      setError(
        "This category is attached to existing menu data. Run the database migration before editing categories.",
      );
      return;
    }
    const affected = items.filter(
      (item) => item.category === category.name,
    ).length;
    const warning = affected
      ? `Delete “${category.name}”? ${affected} ${affected === 1 ? "menu item will" : "menu items will"} have an empty category.`
      : `Delete “${category.name}”?`;
    if (!window.confirm(warning)) return;
    try {
      await api(`/menu/categories/${category.id}`, { method: "DELETE" });
      setItems((old) =>
        old.map((item) =>
          item.category === category.name ? { ...item, category: "" } : item,
        ),
      );
      setMenuCategories((old) =>
        old.filter((entry) => entry.id !== category.id),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete this category.",
      );
    }
  }
  function editImage(index: number) {
    setImagePrompt({ index, value: form.image_urls[index] || "" });
  }
  function saveImage() {
    if (!imagePrompt) return;
    const url = imagePrompt.value.trim();
    if (!url) {
      setError("Please enter an image URL.");
      return;
    }
    let imageUrl: string;
    try {
      const parsed = new URL(url);
      const driveFileId =
        parsed.hostname === "drive.google.com"
          ? parsed.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ||
            parsed.searchParams.get("id")
          : parsed.hostname === "docs.google.com"
            ? parsed.searchParams.get("id")
            : null;
      imageUrl = driveFileId
        ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w1200`
        : url;
    } catch {
      setError("Please enter a valid image URL.");
      return;
    }
    const imageUrls = [...form.image_urls];
    if (imagePrompt.index === -1) imageUrls.push(imageUrl);
    else imageUrls[imagePrompt.index] = imageUrl;
    setForm({ ...form, image_urls: imageUrls, image_url: imageUrls[0] || "" });
    setError("");
    setImagePrompt(null);
  }
  function removeImage(index: number) {
    const imageUrls = form.image_urls.filter(
      (_, imageIndex) => imageIndex !== index,
    );
    setForm({ ...form, image_urls: imageUrls, image_url: imageUrls[0] || "" });
  }
  const categories = menuCategories.length;
  const showModal = creating || Boolean(editing);
  return (
    <>
      <PageTitle
        eyebrow="SET THE MENU, SET THE MOOD"
        title="Menu management"
        description="Keep the good stuff up to date, one plate at a time."
        action={
          <Button onClick={openCreate}>
            <Plus size={16} /> Add a menu item
          </Button>
        }
      />
      {error && <Notice onDismiss={() => setError("")}>{error}</Notice>}
      <div className="menu-admin-stats">
        <div>
          <span>
            <CookingPot size={17} />
          </span>
          <strong>{items.length}</strong>
          <small>Total menu items</small>
        </div>
        <div>
          <span>
            <Check size={17} />
          </span>
          <strong>{items.filter((item) => item.is_available).length}</strong>
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
          {menuCategories.map((category) => (
            <div
              className="category-chip"
              key={`${category.id}-${category.name}`}
            >
              <span>{category.name}</span>
              <small>
                {items.filter((item) => item.category === category.name).length}{" "}
                menus
              </small>
              <button
                type="button"
                className="icon-button danger-icon"
                title={`Delete ${category.name}`}
                aria-label={`Delete ${category.name}`}
                onClick={() => void deleteCategory(category)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>
      {loading ? (
        <Loading label="Laying out the menu…" />
      ) : (
        <div className="menu-admin-list">
          {items.map((item) => (
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
                  <Badge tone="soft">{item.category || "Uncategorized"}</Badge>
                  {item.is_vegetarian && <span className="veg-label">VEG</span>}
                  {!item.is_available && (
                    <Badge tone="danger">Unavailable</Badge>
                  )}
                </div>
                <h3>{item.name}</h3>
                <p>
                  {item.description || "A KebabZilla favorite, made fresh."}
                </p>
                <div className="menu-admin-price">{formatINR(item.price_paise)} <small>tax included</small></div>
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
                    onClick={() => void archive(item)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {showModal && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setEditing(null);
              setCreating(false);
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
                onClick={() => {
                  setEditing(null);
                  setCreating(false);
                }}
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
              <div className="modal-two-col">
                <label className="field-label">
                  Category
                  <select
                    value={form.category}
                    onChange={(event) =>
                      setForm({ ...form, category: event.target.value })
                    }
                  >
                    <option value="">No category</option>
                    {menuCategories.map((category) => (
                      <option key={category.name} value={category.name}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  Price · INR
                  <input
                    required
                    type="number"
                    min="1"
                    step="1"
                    value={form.price_paise}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        price_paise: Number(event.target.value),
                      })
                    }
                    placeholder="299"
                  />
                </label>
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
                        src={url}
                        alt={`Menu image ${index + 1}`}
                        onError={(event) =>
                          event.currentTarget
                            .closest(".menu-image-tile")
                            ?.classList.add("menu-image-failed")
                        }
                      />
                      <span className="menu-image-order">
                        {index === 0 ? "MAIN" : `#${index + 1}`}
                      </span>
                      <div className="menu-image-actions">
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
                  onClick={() => {
                    setEditing(null);
                    setCreating(false);
                  }}
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
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setImagePrompt(null) }}>
          <section className="modal-card image-url-modal" role="dialog" aria-modal="true" aria-labelledby="image-url-title">
            <div className="modal-heading"><div><span className="eyebrow">MENU PHOTOGRAPHY</span><h2 id="image-url-title">{imagePrompt.index === -1 ? "Add image" : "Replace image"}</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setImagePrompt(null)}><X size={18} /></button></div>
            <div className="modal-form"><label className="field-label">Image URL<input autoFocus type="url" required value={imagePrompt.value} onChange={(event) => setImagePrompt({ ...imagePrompt, value: event.target.value })} placeholder="https://…" /></label><div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setImagePrompt(null)}>Cancel</Button><Button type="button" onClick={saveImage}>Use image <ArrowRight size={15} /></Button></div></div>
          </section>
        </div>
      )}
    </>
  );
}

function BadgeTag() {
  return <span className="badge-tag-icon">✦</span>;
}

function Reports() {
  const [period, setPeriod] = useState("week");
  const [periodOpen, setPeriodOpen] = useState(false);
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
          <div className="period-select">
            <BarChart3 size={15} />
            <button type="button" className="period-select-trigger" aria-haspopup="listbox" aria-expanded={periodOpen} onClick={() => setPeriodOpen((open) => !open)}>
              {({ day: "Today", week: "This week", month: "This month", year: "This year" } as const)[period as "day" | "week" | "month" | "year"]}
              <ChevronDown size={14} />
            </button>
            {periodOpen && <div className="period-select-options" role="listbox" aria-label="Report period">{([['day', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year']] as const).map(([value, label]) => <button type="button" role="option" aria-selected={period === value} className={period === value ? 'active' : ''} key={value} onClick={() => { setPeriod(value); setPeriodOpen(false) }}>{label}</button>)}</div>}
          </div>
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

function SettingsPage() {
  const [form, setForm] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  useEffect(() => {
    api<Restaurant>("/admin/settings")
      .then((settings) =>
        setForm({
          ...settings,
          weekly_schedule: settings.weekly_schedule || {},
          delivery_fee_per_km_paise: settings.delivery_fee_per_km_paise / 100,
          minimum_order_paise: settings.minimum_order_paise / 100,
        }),
      )
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Could not load settings.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await api<Restaurant>("/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...form,
          weekly_schedule: form.weekly_schedule,
          delivery_fee_per_km_paise: Math.round(form.delivery_fee_per_km_paise * 100),
          minimum_order_paise: Math.round(form.minimum_order_paise * 100),
        }),
      });
      setForm({
        ...updated,
        weekly_schedule: updated.weekly_schedule || {},
        delivery_fee_per_km_paise: updated.delivery_fee_per_km_paise / 100,
        minimum_order_paise: updated.minimum_order_paise / 100,
      });
      setNotice("Restaurant details saved.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save these settings.",
      );
    } finally {
      setBusy(false);
    }
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
      <form className="settings-form" onSubmit={(event) => void save(event)}>
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
                <label className="field-label">
                  Phone
                  <input
                    required
                    maxLength={32}
                    value={form.phone}
                    onChange={(event) => change("phone", event.target.value)}
                  />
                </label>
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
                  <small>{form.latitude != null && form.longitude != null ? `${form.latitude.toFixed(6)}, ${form.longitude.toFixed(6)}` : "Not pinned yet"}</small>
                  <Button type="button" variant="secondary" onClick={() => setLocationPickerOpen(true)}>Set on map</Button>
                </div>
              </div>
              <div className="settings-schedule">
                <h3>Opening days and hours</h3>
                {(
                  [
                    "monday",
                    "tuesday",
                    "wednesday",
                    "thursday",
                    "friday",
                    "saturday",
                    "sunday",
                  ] as const
                ).map((day) => {
                  const hours = form.weekly_schedule?.[day] || {
                    open: false,
                    opens: "10:00",
                    closes: "22:00",
                  };
                  return (
                    <div className="weekday-row" key={day}>
                      <label>
                        <input
                          type="checkbox"
                          checked={hours.open}
                          onChange={(event) =>
                            change("weekly_schedule", {
                              ...form.weekly_schedule,
                              [day]: { ...hours, open: event.target.checked },
                            })
                          }
                        />{" "}
                        {formatStatus(day)}
                      </label>
                      <input
                        aria-label={`${day} opens`}
                        type="time"
                        value={hours.opens}
                        onChange={(event) =>
                          change("weekly_schedule", {
                            ...form.weekly_schedule,
                            [day]: { ...hours, opens: event.target.value },
                          })
                        }
                      />
                      <input
                        aria-label={`${day} closes`}
                        type="time"
                        value={hours.closes}
                        onChange={(event) =>
                          change("weekly_schedule", {
                            ...form.weekly_schedule,
                            [day]: { ...hours, closes: event.target.value },
                          })
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </section>
            <section className="admin-panel settings-card">
              <h2>Checkout & delivery</h2>
              <div className="settings-fields">
                <label className="field-label">
                  Minimum order · INR
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
                  Delivery radius · km
                  <input
                    type="number"
                    min="0.1"
                    max="500"
                    step="0.1"
                    value={form.delivery_radius_km}
                    onChange={(event) =>
                      change("delivery_radius_km", Number(event.target.value))
                    }
                  />
                </label>
                <label className="field-label">
                  Free delivery radius · km
                  <input
                    type="number"
                    min="0"
                    max="500"
                    step="0.1"
                    value={form.free_delivery_radius_km}
                    onChange={(event) =>
                      change("free_delivery_radius_km", Number(event.target.value))
                    }
                  />
                </label>
                <label className="field-label">
                  Delivery fee per km · INR
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.delivery_fee_per_km_paise}
                    onChange={(event) =>
                      change("delivery_fee_per_km_paise", Number(event.target.value))
                    }
                  />
                </label>
              </div>
            </section>
          </div>
          <aside className="settings-aside">
            <section className="admin-panel accept-orders-card">
              <strong>
                {form.accepting_orders
                  ? "Open for orders"
                  : "Taking a breather"}
              </strong>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={form.accepting_orders}
                  onChange={(event) =>
                    change("accepting_orders", event.target.checked)
                  }
                />
                <span />
              </label>
            </section>
            <Button
              type="submit"
              disabled={busy}
              className="full-width settings-save"
            >
              {busy ? (
                "Saving…"
              ) : (
                <>
                  Save restaurant settings <Check size={16} />
                </>
              )}
            </Button>
          </aside>
        </div>
      </form>
      {locationPickerOpen && <RestaurantLocationMap latitude={form.latitude} longitude={form.longitude} onClose={() => setLocationPickerOpen(false)} onSave={(latitude, longitude) => { change("latitude", latitude); change("longitude", longitude); }} />}
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
  const [sort, setSort] = useState("newest");
  useEffect(() => {
    api<typeof events>("/admin/events?limit=250")
      .then(setEvents)
      .finally(() => setLoading(false));
  }, []);
  const visibleEvents = events
    .filter((event) => `${event.message} ${event.actor_name} ${event.event_type}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => sort === "oldest" ? a.created_at.localeCompare(b.created_at) : sort === "actor" ? a.actor_name.localeCompare(b.actor_name) : b.created_at.localeCompare(a.created_at));
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
            <RoundedSelect ariaLabel="Sort activity" value={sort} onChange={setSort} options={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "actor", label: "Person A–Z" }]} />
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
  const [audience, setAudience] = useState("ALL");
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
  const [logSort, setLogSort] = useState("newest");
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
    .filter((log) => `${log.subject} ${log.message} ${log.status} ${log.audience} ${log.channels.join(" ")}`.toLowerCase().includes(logQuery.trim().toLowerCase()))
    .sort((a, b) => logSort === "oldest" ? a.created_at.localeCompare(b.created_at) : logSort === "status" ? a.status.localeCompare(b.status) : b.created_at.localeCompare(a.created_at));
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
          <RoundedSelect ariaLabel="Sort campaign log" value={logSort} onChange={setLogSort} options={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "status", label: "Status A–Z" }]} />
        </div>
        {visibleLogs.length ? visibleLogs.map((log) => (
          <button type="button" className="campaign-log-row" key={log.id} onClick={() => setSelectedLog(log)}>
            <span className="campaign-log-copy"><strong>{log.subject}</strong><span>{log.message}</span></span>
            <span className="campaign-log-delivery">{log.channels.map((channel) => <span key={channel}>{channel} · {log.delivery_counts?.[channel]?.sent_count || 0}/{log.delivery_counts?.[channel]?.recipient_count || 0}</span>)}</span>
            <time>{friendlyDate(log.created_at)}</time>
          </button>
        )) : <EmptyState title="No campaigns found" description="Try a different search." />}
      </section>
      {selectedLog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedLog(null); }}><section className="modal-card campaign-detail-modal" role="dialog" aria-modal="true" aria-labelledby="campaign-detail-title"><div className="modal-heading"><div><span className="eyebrow">CAMPAIGN DETAILS</span><h2 id="campaign-detail-title">{selectedLog.subject}</h2></div><button className="icon-button" type="button" onClick={() => setSelectedLog(null)} aria-label="Close campaign details"><X size={18} /></button></div><p className="campaign-detail-message">{selectedLog.message}</p><div className={`campaign-channel-details campaign-channel-details-${selectedLog.channels.length}`}>{selectedLog.channels.map((channel) => { const detail = selectedLog.delivery_counts?.[channel] || { recipient_count: 0, sent_count: 0 }; return <section key={channel} className="campaign-channel-card"><span className="eyebrow">{channel}</span><h3>{detail.sent_count} delivered</h3><p>{detail.sent_count} of {detail.recipient_count} selected customers received this message via {channel.toLowerCase()}.</p></section>; })}</div><div className="campaign-detail-footer"><span>{selectedLog.audience} customers</span><time>{friendlyDate(selectedLog.created_at)}</time></div></section></div>}
    </>
  );
}

type MenuDiscountRow = { id: number; campaign_name: string | null; menu_item_ids: number[]; menu_item_names: string[]; discount_percent: number; starts_at: string; ends_at: string; created_at: string };

function localDateTimeValue(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function localDatePart(value: Date) { return localDateTimeValue(value).slice(0, 10); }
function localTimePart(value: Date) { return localDateTimeValue(value).slice(11, 16); }
function combineLocalDateTime(date: string, time: string) { return new Date(`${date}T${time}`); }

function Discounts() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [discounts, setDiscounts] = useState<MenuDiscountRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<number | null>(null);
  const [selectedMenuItemIds, setSelectedMenuItemIds] = useState<number[]>([]);
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
    const [availableMenu, scheduled] = await Promise.all([api<MenuItem[]>("/menu/manage"), api<MenuDiscountRow[]>("/admin/discounts")]);
    setMenu(availableMenu);
    setDiscounts(scheduled);
  }, []);
  useEffect(() => { void refresh().catch((err) => setError(err instanceof Error ? err.message : "Could not load discounts.")).finally(() => setLoading(false)); }, [refresh]);

  async function createDiscount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api<MenuDiscountRow>(editingCampaignId ? `/admin/discounts/${editingCampaignId}` : "/admin/discounts", { method: editingCampaignId ? "PUT" : "POST", body: JSON.stringify({ campaign_name: campaignName.trim() || null, menu_item_ids: selectedMenuItemIds, discount_percent: Number(percent), starts_at: combineLocalDateTime(startsDate, startsTime).toISOString(), ends_at: combineLocalDateTime(endsDate, endsTime).toISOString() }) });
      setModalOpen(false);
      setEditingCampaignId(null);
      setCampaignName("");
      setSelectedMenuItemIds([]);
      setItemSearch("");
      setMenuPickerOpen(false);
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create this discount."); }
    finally { setBusy(false); }
  }

  async function removeDiscount(id: number) {
    try { await api(`/admin/discounts/${id}`, { method: "DELETE" }); setDiscounts((rows) => rows.filter((row) => row.id !== id)); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not remove this discount."); }
  }

  const startsAt = combineLocalDateTime(startsDate, startsTime);
  const endsAt = combineLocalDateTime(endsDate, endsTime);
  const occupiedMenuItemIds = new Set(discounts.filter((discount) => discount.id !== editingCampaignId && new Date(discount.starts_at) < endsAt && new Date(discount.ends_at) > startsAt).flatMap((discount) => discount.menu_item_ids));
  const selectableMenu = menu.filter((item) => !occupiedMenuItemIds.has(item.id) || selectedMenuItemIds.includes(item.id));
  const filteredMenu = selectableMenu.filter((item) => item.name.toLowerCase().includes(itemSearch.trim().toLowerCase()));
  const allMenuSelected = selectableMenu.length > 0 && selectableMenu.every((item) => selectedMenuItemIds.includes(item.id));
  const hiddenDiscountedMenuCount = menu.filter((item) => occupiedMenuItemIds.has(item.id) && !selectedMenuItemIds.includes(item.id)).length;
  const openCreateModal = () => {
    const now = new Date();
    const later = new Date(Date.now() + 60 * 60 * 1000);
    setError(""); setEditingCampaignId(null); setCampaignName(""); setPercent("10"); setSelectedMenuItemIds([]); setItemSearch(""); setMenuPickerOpen(false);
    setStartsDate(localDatePart(now)); setStartsTime(localTimePart(now)); setEndsDate(localDatePart(later)); setEndsTime(localTimePart(later)); setModalOpen(true);
  };
  const openEditModal = (discount: MenuDiscountRow) => {
    const startsAt = new Date(discount.starts_at);
    const endsAt = new Date(discount.ends_at);
    setError(""); setEditingCampaignId(discount.id); setCampaignName(discount.campaign_name || ""); setSelectedMenuItemIds(discount.menu_item_ids); setItemSearch(""); setMenuPickerOpen(false);
    setPercent(String(discount.discount_percent)); setStartsDate(localDatePart(startsAt)); setStartsTime(localTimePart(startsAt)); setEndsDate(localDatePart(endsAt)); setEndsTime(localTimePart(endsAt)); setModalOpen(true);
  };

  return <>
    <PageTitle eyebrow="A LITTLE SOMETHING OFF THE MENU" title="Discounts" description="Schedule percentage discounts across one or more menu items." action={<Button onClick={openCreateModal}><Plus size={16} /> Create discount</Button>} />
    {error && <Notice onDismiss={() => setError("")}>{error}</Notice>}
    {loading ? <Loading label="Loading discounts…" /> : discounts.length ? (
      <section className="admin-panel discount-list-panel">
        <div className="discount-list-heading"><div><span className="eyebrow">SCHEDULED OFFERS</span><h2>Menu discounts</h2></div><span>{discounts.length} campaign{discounts.length === 1 ? "" : "s"}</span></div>
        <div className="discount-list">{discounts.map((discount) => {
          const start = new Date(discount.starts_at);
          const end = new Date(discount.ends_at);
          const now = Date.now();
          const state = now < start.getTime() ? "Upcoming" : now < end.getTime() ? "Active" : "Ended";
          const names = discount.menu_item_names.join(", ");
          return <article className="discount-row" key={discount.id}>
            <div className="discount-percent"><strong>{discount.discount_percent}%</strong></div>
            <div className="discount-row-main"><strong>{discount.campaign_name || names || "Menu items unavailable"}</strong><small>{discount.campaign_name ? names : `${discount.menu_item_ids.length} menu item${discount.menu_item_ids.length === 1 ? "" : "s"}`}</small></div>
            <span className={`discount-state ${state.toLowerCase()}`}>{state}</span>
            <div className="discount-dates"><span>Starts <strong>{friendlyDate(discount.starts_at)}</strong></span><span>Ends <strong>{friendlyDate(discount.ends_at)}</strong></span></div>
            <div className="discount-row-actions">
              {state !== "Ended" && <><button type="button" className="icon-button" aria-label={`Edit discount campaign for ${names}`} title="Edit campaign" onClick={() => openEditModal(discount)}><Edit3 size={16} /></button><button type="button" className="icon-button danger-icon" aria-label={`Delete discount for ${names}`} title="Delete discount" onClick={() => void removeDiscount(discount.id)}><Trash2 size={16} /></button></>}
            </div>
          </article>;
        })}</div>
      </section>
    ) : <EmptyState icon={<Percent size={20} />} title="No discounts scheduled" description="Create a percentage offer for selected menu items with custom start and end times." />}
    {modalOpen && <div className="modal-backdrop discount-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setModalOpen(false); setEditingCampaignId(null); } }}>
      <section className="modal-card discount-modal" role="dialog" aria-modal="true" aria-labelledby="discount-modal-title">
        <div className="modal-heading"><div><span className="eyebrow">A TIMED MENU OFFER</span><h2 id="discount-modal-title">{editingCampaignId ? "Edit discount campaign" : "Create discount"}</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={() => { setModalOpen(false); setEditingCampaignId(null); }}><X size={18} /></button></div>
        <form className="modal-form" onSubmit={(event) => void createDiscount(event)}>
          {error && <Notice>{error}</Notice>}
          <label className="field-label">Campaign name <span className="field-optional">optional</span><input maxLength={80} placeholder="e.g. Zilla’s Pick" value={campaignName} onChange={(event) => setCampaignName(event.target.value)} /></label>
          <label className="field-label">Discount · %<input required type="number" min="1" max="99" value={percent} onChange={(event) => setPercent(event.target.value)} /></label>
          <div className="field-label discount-menu-field"><span>Menu items</span><button className="discount-menu-trigger" type="button" aria-expanded={menuPickerOpen} onClick={() => setMenuPickerOpen((open) => !open)}>{selectedMenuItemIds.length ? `${selectedMenuItemIds.length} item${selectedMenuItemIds.length === 1 ? "" : "s"} selected` : "Choose menu items"}<span>⌄</span></button>{menuPickerOpen && <div className="discount-menu-picker"><label className="admin-search"><Search size={16} /><input autoFocus aria-label="Search menu items" placeholder="Search menu items" value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} /></label><button type="button" className="discount-select-all" onClick={() => setSelectedMenuItemIds(allMenuSelected ? [] : selectableMenu.map((item) => item.id))}><input type="checkbox" readOnly checked={allMenuSelected} />Select all available menu items</button>{hiddenDiscountedMenuCount > 0 && <p className="discount-menu-unavailable">{hiddenDiscountedMenuCount} item{hiddenDiscountedMenuCount === 1 ? " is" : "s are"} hidden because another discount overlaps this schedule.</p>}<div className="discount-menu-options">{filteredMenu.map((item) => <label key={item.id}><input type="checkbox" checked={selectedMenuItemIds.includes(item.id)} onChange={(event) => setSelectedMenuItemIds((ids) => event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} /><span>{item.name}</span><small>{formatINR(item.price_paise)}</small></label>)}{!filteredMenu.length && <p>No menu items match that search.</p>}</div></div>}</div>
          <div className="discount-datetime-grid"><div className="discount-time-group"><span className="field-label">Starts</span><div><label className="sr-only" htmlFor="discount-start-date">Start date</label><input id="discount-start-date" required type="date" value={startsDate} onChange={(event) => setStartsDate(event.target.value)} /><label className="sr-only" htmlFor="discount-start-time">Start time</label><input id="discount-start-time" required type="time" value={startsTime} onChange={(event) => setStartsTime(event.target.value)} /></div></div><div className="discount-time-group"><span className="field-label">Ends</span><div><label className="sr-only" htmlFor="discount-end-date">End date</label><input id="discount-end-date" required type="date" value={endsDate} onChange={(event) => setEndsDate(event.target.value)} /><label className="sr-only" htmlFor="discount-end-time">End time</label><input id="discount-end-time" required type="time" value={endsTime} onChange={(event) => setEndsTime(event.target.value)} /></div></div></div>
          <div className="modal-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => { setModalOpen(false); setEditingCampaignId(null); }}>Cancel</Button><Button type="submit" disabled={busy || !selectedMenuItemIds.length || Number(percent) < 1 || endsAt <= startsAt}>{busy ? (editingCampaignId ? "Saving…" : "Creating…") : (editingCampaignId ? "Save changes" : "Create discount")} <ArrowRight size={15} /></Button></div>
        </form>
      </section>
    </div>}
  </>;
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
