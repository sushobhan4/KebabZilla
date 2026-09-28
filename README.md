# KebabZilla

A role-based restaurant ordering and operations application. The customer web app and FastAPI API are separate deployable services; the API owns authorization, pricing, payment verification, and order state transitions.

## Architecture

- `frontend/`: React, TypeScript, Vite, React Router (hash URLs are GitHub Pages friendly).
- `backend/`: FastAPI REST API, Pydantic, SQLAlchemy 2, Alembic, PostgreSQL.
- Authentication: short-lived signed access tokens. The token identifies the account; the API reloads the active account and role from the database on every request. Registration always creates a `USER`; only an `ADMIN` can provision staff or change roles.
- Payments: cash is available locally. Razorpay order creation, server-side signature verification, and webhook verification are implemented behind a payment service; credentials stay on the API.
- Google Identity Platform has a server-side verifier seam, while local email/password JWT authentication is active by default. Wire and validate a provider-specific Identity Platform token verifier before enabling it in a deployed environment. Delivery navigation opens a map route without exposing a maps secret in the client.
- Razorpay checkout, capture verification, webhooks, and refunds use server-side credentials; add test/live keys to the API environment to enable online payments. Cash checkout remains available without gateway credentials.

## Local development

Requirements: Node.js 20+, Python 3.11+, PostgreSQL 15+ (or Docker), and Git.

1. Create a PostgreSQL database and role (use your own local password):

   ```sql
   CREATE ROLE kebabzilla LOGIN PASSWORD 'choose-a-local-password';
   CREATE DATABASE kebabzilla OWNER kebabzilla;
   ```

2. Configure the API:

   ```powershell
   cd backend
   py -3 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install -r requirements.txt
   Copy-Item .env.example .env
   # Edit DATABASE_URL and JWT_SECRET in .env
   alembic upgrade head
   uvicorn app.main:app --reload
   ```

   API docs are at `http://localhost:8000/docs`. To create an initial administrator, set a 12-character-or-longer `SEED_ADMIN_PASSWORD` in the local, ignored `backend/.env`, then run `python -m app.seed_admin`. The default local administrator email is `admin@kebabzilla.local`. If you forget its password, set a new value and run `python -m app.reset_admin_password`.

3. Configure and run the client in another terminal:

   ```powershell
   cd frontend
   npm install
   Copy-Item .env.example .env.local
   npm run dev
   ```

   The Vite development server is at `http://localhost:5173`.

For a disposable local preview without PostgreSQL, set `DATABASE_URL=sqlite:///./kebabzilla.db`; PostgreSQL remains the intended local and production database. Schema changes are managed with Alembic (`alembic revision --autogenerate -m "describe change"`, then `alembic upgrade head`).

## Deploy independently

- Build `frontend/` as static assets and publish `frontend/dist/` to GitHub Pages. Set the GitHub repository Actions variable `VITE_API_BASE_URL` to the public API URL (including `/api/v1`) before deployment. Razorpay's public checkout key is returned by the API; never put the key secret, JWT secret, database URL, or Identity Platform service credentials in a `VITE_` variable. Hash-based routes work without server-side SPA rewrites.
- Build `backend/Dockerfile` and deploy to Cloud Run. Configure `DATABASE_URL` from a Cloud SQL connection, a high-entropy `JWT_SECRET`, `CORS_ORIGINS` with the Pages origin, and Razorpay/identity variables via Secret Manager. Run `alembic upgrade head` as a deployment migration step before switching traffic.
- `backend/cloudrun.yaml` documents the Cloud Run container port and health probe. Production schema changes must be applied through Alembic, never by app startup.

## Core API areas

- `/api/v1/auth`: register, login, current account.
- `/api/v1/menu`: published menu and administrator CRUD.
- `/api/v1/orders`: customer ordering/history/tracking and payment selection.
- `/api/v1/staff`: queue decisions, walk-in orders, billing, drafts, dispatch.
- `/api/v1/delivery`: queue, route batches, assigned customer details, OTP completion.
- `/api/v1/admin`: account/staff management, order operations, settings, sales reports.
- `/api/v1/payments`: Razorpay signature confirmation and signed webhook.

For production delivery OTPs, configure a transactional SMS adapter using `DELIVERY_OTP_API_URL` and `DELIVERY_OTP_API_TOKEN`. The adapter sends a JSON request with `to`, `sender`, and `message`; map that contract to the SMS provider you choose. Local development returns the generated code to the staff screen for testing.

All money values are integer paise. The API re-prices order lines from the menu at submission time and validates every state change server-side.
