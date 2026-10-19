from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

import math
from sqlalchemy import select

from app.config import settings
from app.routers import admin, auth, cart, custom_menu, delivery, menu, orders, payments, staff
from app.schemas import PublicRestaurantOut
from app.services import calculate_delivery_distance, evaluate_restaurant_and_delivery_status, is_restaurant_open, restaurant_settings
from app.dependencies import CurrentAccount, DbSession
from app.models import Account, Role

import html
import os
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, Response
import logging

logger = logging.getLogger("kebabzilla")

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Role-secured restaurant ordering, payments, and operations API.",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), payment=(self)"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
        if "Content-Security-Policy" not in response.headers:
            if request.url.path.startswith("/api/") or request.url.path.startswith(settings.api_prefix):
                response.headers["Content-Security-Policy"] = (
                    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
                )
            else:
                response.headers["Content-Security-Policy"] = (
                    "default-src 'self'; "
                    "script-src 'self' 'unsafe-inline'; "
                    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                    "font-src 'self' https://fonts.gstatic.com data:; "
                    "img-src 'self' data: blob: https:; "
                    "connect-src 'self' https:; "
                    "frame-ancestors 'none'; "
                    "base-uri 'self'; "
                    "object-src 'none'"
                )
        return response

app.add_middleware(SecurityHeadersMiddleware)
is_dev = settings.environment.casefold() != "production"
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"^https://.*\.trycloudflare\.com$" if is_dev else None,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Razorpay-Signature", "X-CSRF-Token"],
    expose_headers=["X-CSRF-Token"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

for route_module in (auth, menu, cart, orders, staff, delivery, admin, payments, custom_menu):
    app.include_router(route_module.router, prefix=settings.api_prefix)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled server error processing %s %s: %s", request.method, request.url.path, exc)
    origin = request.headers.get("origin")
    headers = {}
    allowed_origins = set(settings.cors_origins if isinstance(settings.cors_origins, list) else [settings.cors_origins])
    allowed_origins.update(["https://kebabzilla.in", "http://localhost:5173", "http://127.0.0.1:5173"])
    if origin and (origin in allowed_origins or (is_dev and origin.endswith(".trycloudflare.com"))):
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
        headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-Razorpay-Signature, X-CSRF-Token"
        headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    return JSONResponse(
        status_code=500,
        content={"detail": "Our servers are currently down. Please check back in a few minutes.", "error": str(exc)},
        headers=headers,
    )



def format_public_weekly_schedule(raw_schedule: dict | None) -> dict:
    if not isinstance(raw_schedule, dict):
        return {}
    all_days = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
    clean = {}
    custom_schedules = raw_schedule.get("custom_schedules")
    if isinstance(custom_schedules, list):
        clean["custom_schedules"] = custom_schedules
        for day in all_days:
            matching = [s for s in custom_schedules if isinstance(s, dict) and day in (s.get("days") or [])]
            if matching:
                clean[day] = {
                    "open": True,
                    "opens": str(matching[0].get("start_time", "10:00")),
                    "closes": str(matching[0].get("end_time", "22:00")),
                }
            else:
                clean[day] = {
                    "open": False,
                    "opens": "10:00",
                    "closes": "22:00",
                }
    else:
        for day in all_days:
            day_data = raw_schedule.get(day)
            if isinstance(day_data, dict) and "open" in day_data:
                clean[day] = {
                    "open": bool(day_data.get("open", False)),
                    "opens": str(day_data.get("opens", "10:00")),
                    "closes": str(day_data.get("closes", "22:00")),
                }
            else:
                clean[day] = {
                    "open": False,
                    "opens": "10:00",
                    "closes": "22:00",
                }
    return clean


from app.cache import KEY_PUBLIC_RESTAURANT, cache


@app.get(f"{settings.api_prefix}/public/email-images/{{filename:path}}", tags=["email_images"], response_class=Response)
@app.get(f"{settings.api_prefix}/email-images/{{filename:path}}", tags=["email_images"], response_class=Response)
@app.get(f"{settings.api_prefix}/public/emailImages/{{filename:path}}", tags=["email_images"], response_class=Response)
@app.get(f"{settings.api_prefix}/emailImages/{{filename:path}}", tags=["email_images"], response_class=Response)
@app.get("/email-images/{filename:path}", tags=["email_images"], response_class=Response)
@app.get("/public/email-images/{filename:path}", tags=["email_images"], response_class=Response)
@app.get("/emailImages/{filename:path}", tags=["email_images"], response_class=Response)
@app.get("/public/emailImages/{filename:path}", tags=["email_images"], response_class=Response)
def serve_public_email_image(filename: str, blur: int = 0):
    """Serve an email image stored in GCS under emailImages/ (or local fallback), optionally blurred."""
    try:
        from app.storage import get_email_image_blob
        data, content_type = get_email_image_blob(filename)
        if blur > 0:
            from app.image_utils import blur_image_bytes
            data, content_type = blur_image_bytes(data, content_type, blur_radius=blur)
        return Response(
            content=data,
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=86400, immutable",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                "X-Content-Type-Options": "nosniff",
            },
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Email image not found")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not load image: {exc}")


@app.get(f"{settings.api_prefix}/public/email-images-proxy", tags=["email_images"], response_class=Response)
@app.get("/email-images-proxy", tags=["email_images"], response_class=Response)
def serve_proxy_email_image(url: str, blur: int = 0):
    """Safely fetch and optionally blur an external image for email clients."""
    import ipaddress
    import urllib.parse
    import httpx
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Invalid URL")
    hostname = parsed.hostname or ""
    try:
        import socket
        addr_info = socket.getaddrinfo(hostname, None)
        if not addr_info:
            raise HTTPException(status_code=400, detail="Unable to resolve target host")
        for _, _, _, _, sockaddr in addr_info:
            ip = ipaddress.ip_address(sockaddr[0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
                raise HTTPException(status_code=400, detail="Disallowed target host")
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="Unable to resolve target host")
    except ValueError:
        raise HTTPException(status_code=400, detail="Disallowed target host")
    try:
        with httpx.Client(timeout=10, follow_redirects=True) as client:
            res = client.get(url)
            if res.status_code != 200:
                raise HTTPException(status_code=502, detail="Upstream image failed")
            data = res.content
            content_type = res.headers.get("content-type", "image/jpeg")
            if blur > 0:
                from app.image_utils import blur_image_bytes
                data, content_type = blur_image_bytes(data, content_type, blur_radius=blur)
            return Response(
                content=data,
                media_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=86400, immutable",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                    "X-Content-Type-Options": "nosniff",
                },
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Proxy error: {exc}")



@app.get("/fonts/{filename:path}", tags=["fonts"])
@app.get(f"{settings.api_prefix}/public/fonts/{{filename:path}}", tags=["fonts"])
def serve_public_font(filename: str):
    """Serve storefront brand fonts (SerambiRamadhan.ttf, Slopes.ttf) with CORS enabled."""
    from pathlib import Path
    fonts_dir = Path(__file__).resolve().parents[2] / "frontend" / "public" / "fonts"
    safe_path = (fonts_dir / filename).resolve()
    if not str(safe_path).startswith(str(fonts_dir.resolve())):
        raise HTTPException(status_code=400, detail="Invalid font path")
    if not safe_path.is_file():
        raise HTTPException(status_code=404, detail="Font file not found")
    media_type = "font/woff2" if filename.endswith(".woff2") else "font/ttf"
    return Response(
        content=safe_path.read_bytes(),
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.get("/copy-otp", response_class=HTMLResponse, tags=["auth_helper"])
@app.get(f"{settings.api_prefix}/public/copy-otp", response_class=HTMLResponse, tags=["auth_helper"])
def copy_otp_page(code: str = "", email: str = ""):
    """Storefront-aesthetic helper page that auto-copies the OTP to clipboard and redirects to sign in."""
    import json
    clean_code = code.strip()
    clean_email = email.strip()
    redirect_url = f"/forgot-password?email={html.escape(clean_email)}&otp={html.escape(clean_code)}" if clean_email else "/login"

    escaped_code = html.escape(clean_code)
    json_code = json.dumps(clean_code)

    page_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KebabZilla — Verification Code</title>
  <style>
    @font-face {{
      font-family: 'Serambhi Ramadhan';
      src: url('/fonts/SerambiRamadhan.ttf') format('truetype');
      font-display: swap;
    }}
    @font-face {{
      font-family: 'Slopes';
      src: url('/fonts/Slopes.ttf') format('truetype');
      font-display: swap;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background-color: #0b0d10;
      color: #f3f4f6;
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }}
    .card {{
      background-color: #111318;
      background-image: url('https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=1200&q=80');
      background-size: cover;
      background-position: center;
      border: 1px solid #282c37;
      border-radius: 18px;
      max-width: 480px;
      width: 100%;
      overflow: hidden;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65);
      text-align: center;
    }}
    .card-overlay {{
      background: linear-gradient(180deg, rgba(10, 12, 16, 0.85) 0%, rgba(13, 15, 20, 0.92) 50%, rgba(10, 12, 16, 0.96) 100%);
    }}
    .brand-header {{
      padding: 30px 20px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      line-height: 1;
    }}
    .brand-title {{
      font-family: 'Serambhi Ramadhan', Georgia, 'Times New Roman', serif;
      font-size: 40px;
      line-height: 0.9;
      color: #fdfbf7;
      letter-spacing: -0.2px;
      font-weight: normal;
      display: block;
      margin: 0;
      padding: 0;
      text-shadow: 0 2px 10px rgba(0,0,0,0.7);
    }}
    .brand-tagline {{
      font-family: 'Slopes', 'Brush Script MT', cursive, sans-serif;
      font-size: 11px;
      line-height: 0.85;
      color: #e05334;
      margin-top: -6px;
      letter-spacing: 0.3px;
      display: block;
      white-space: nowrap;
      text-shadow: 0 1px 4px rgba(0,0,0,0.5);
    }}
    .body-content {{
      padding: 36px 28px 30px;
    }}
    .status-badge {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 16px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 18px;
      transition: all 0.2s ease;
    }}
    .status-copied {{
      background: rgba(16, 185, 129, 0.18);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.4);
    }}
    .status-ready {{
      background: rgba(224, 83, 52, 0.18);
      color: #ffedd5;
      border: 1px solid rgba(224, 83, 52, 0.4);
    }}
    .code-box {{
      background-color: rgba(20, 24, 32, 0.85);
      border: 2px solid #e05334;
      border-radius: 14px;
      padding: 20px 24px;
      margin: 0 auto 16px;
      cursor: pointer;
      user-select: all;
      -webkit-user-select: all;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      transition: transform 0.1s ease;
    }}
    .code-box:active {{
      transform: scale(0.98);
    }}
    .code-digits {{
      font-family: 'Courier New', Consolas, Monaco, monospace;
      font-size: 44px;
      font-weight: 800;
      letter-spacing: 10px;
      color: #fbf1df;
      line-height: 1;
    }}
    .subtext {{
      font-size: 12px;
      color: #9ca3af;
      margin-bottom: 24px;
    }}
    .btn-primary {{
      display: block;
      width: 100%;
      background-color: #c34226;
      color: #ffffff;
      text-decoration: none;
      padding: 15px 24px;
      font-size: 15px;
      font-weight: 800;
      border-radius: 10px;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 18px rgba(195, 66, 38, 0.45);
      transition: background-color 0.15s ease;
    }}
    .btn-primary:hover {{
      background-color: #a8351d;
    }}
    .btn-secondary {{
      display: block;
      width: 100%;
      margin-top: 12px;
      background: rgba(255, 255, 255, 0.08);
      color: #f3f4f6;
      border: 1px solid rgba(255, 255, 255, 0.15);
      padding: 13px 20px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 10px;
      text-decoration: none;
      box-sizing: border-box;
    }}
    .btn-secondary:hover {{
      background: rgba(255, 255, 255, 0.14);
    }}
    .footer {{
      padding: 20px 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      font-size: 13px;
      color: #9ca3af;
    }}
    .footer a {{
      color: #e05334;
      text-decoration: none;
      font-weight: 600;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="card-overlay">
      <div class="brand-header">
        <div class="brand-title">KebabZilla</div>
        <div class="brand-tagline">Meat, Fire, Glory</div>
      </div>
      <div class="body-content">
        <div id="status" class="status-badge status-ready">
          📋 Copying your code…
        </div>
        <div class="code-box" id="codeBox" onclick="copyCode()" title="Click to copy code">
          <div class="code-digits" id="otpText">{escaped_code or "------"}</div>
        </div>
        <div class="subtext">
          Single-tap the code above or use the button below to copy to clipboard
        </div>
        <button class="btn-primary" id="copyBtn" onclick="copyCode()">
          📋 Copy Code to Clipboard
        </button>
        <a class="btn-secondary" href="{redirect_url}" id="continueBtn">
          Continue to KebabZilla &rarr;
        </a>
      </div>
      <div class="footer">
        If you need any support, mail us at <a href="mailto:support@kebabzilla.in">support@kebabzilla.in</a>
      </div>
    </div>
  </div>
  <script>
    const code = {json_code};
    function copyCode() {{
      if (!code) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {{
        navigator.clipboard.writeText(code).then(showCopied).catch(fallbackCopy);
      }} else {{
        fallbackCopy();
      }}
    }}
    function fallbackCopy() {{
      const box = document.getElementById('otpText');
      const range = document.createRange();
      range.selectNodeContents(box);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try {{
        document.execCommand('copy');
        showCopied();
      }} catch (e) {{}}
    }}
    function showCopied() {{
      const badge = document.getElementById('status');
      badge.className = 'status-badge status-copied';
      badge.innerHTML = '✓ Copied to clipboard!';
      const btn = document.getElementById('copyBtn');
      btn.innerText = '✓ Code Copied!';
      btn.style.backgroundColor = '#059669';
      setTimeout(() => {{
        btn.innerText = '📋 Copy Code to Clipboard';
        btn.style.backgroundColor = '#c34226';
      }}, 2500);
    }}
    window.addEventListener('DOMContentLoaded', () => {{
      if (code) {{
        copyCode();
      }}
    }});
  </script>
</body>
</html>"""
    return HTMLResponse(content=page_html)


@app.get(f"{settings.api_prefix}/restaurant", tags=["restaurant"], response_model=PublicRestaurantOut)
def public_restaurant(db: DbSession, response: Response):
    cached = cache.get(KEY_PUBLIC_RESTAURANT)
    if cached is not None:
        response.headers["Cache-Control"] = "public, max-age=10, stale-while-revalidate=30"
        return cached

    config = restaurant_settings(db)
    status_info = evaluate_restaurant_and_delivery_status(config)
    data = {
        "restaurant_name": config.restaurant_name,
        "tagline": config.tagline,
        "phone": config.phone,
        "email": getattr(config, "email", "support@kebabzilla.in") or "support@kebabzilla.in",
        "address": config.address,
        "latitude": config.latitude,
        "longitude": config.longitude,
        "is_restaurant_open": status_info["is_restaurant_open"],
        "is_delivery_open": status_info["is_delivery_open"],
        "weekly_schedule": format_public_weekly_schedule(config.weekly_schedule),
        "minimum_order_paise": getattr(config, "minimum_order_paise", 0) or 0,
        "delivery_radius_km": getattr(config, "delivery_radius_km", 10.0) or 10.0,
        "free_delivery_radius_km": getattr(config, "free_delivery_radius_km", 3.0) or 3.0,
        "delivery_fee_per_km_paise": getattr(config, "delivery_fee_per_km_paise", 0) or 0,
        "charge_from_zero_beyond_free_radius": getattr(config, "charge_from_zero_beyond_free_radius", False) or False,
        "accepting_orders": status_info.get("accepting_orders", status_info["is_restaurant_open"]),
        "order_cutoff_minutes_before_closing": status_info.get("order_cutoff_minutes_before_closing", 30),
        "delivery_status": status_info["delivery_status"],
        "delivery_status_heading": status_info["delivery_status_heading"],
        "delivery_status_message": status_info["delivery_status_message"],
        "closing_in_minutes": status_info["closing_in_minutes"],
        "cutoff_in_minutes": status_info.get("cutoff_in_minutes"),
        "closing_time": status_info["closing_time"],
        "schedule_status": status_info.get("schedule_status", ""),
    }
    cache.set(KEY_PUBLIC_RESTAURANT, data, ttl_seconds=15.0)
    response.headers["Cache-Control"] = "public, max-age=10, stale-while-revalidate=30"
    return data


@app.get(f"{settings.api_prefix}/restaurant/delivery-estimate", tags=["restaurant"])
def estimate_delivery(latitude: float, longitude: float, db: DbSession):
    config = restaurant_settings(db)
    if config.latitude is None or config.longitude is None:
        raise HTTPException(status_code=503, detail="The restaurant delivery location is not configured")
    distance_km, method = calculate_delivery_distance(config, latitude, longitude)
    within_radius = distance_km <= config.delivery_radius_km
    if distance_km <= config.free_delivery_radius_km:
        fee_paise = 0
        raw_fee_inr = 0.0
        raw_fee_paise = 0
        round_off_inr = 0.0
        round_off_paise = 0
    else:
        charge_from_zero = getattr(config, "charge_from_zero_beyond_free_radius", False)
        billable_km = distance_km if charge_from_zero else (distance_km - config.free_delivery_radius_km)
        raw_fee_inr = round(billable_km * (config.delivery_fee_per_km_paise / 100.0), 2)
        rounded_fee_inr = math.ceil(raw_fee_inr)
        round_off_inr = round(rounded_fee_inr - raw_fee_inr, 2)
        raw_fee_paise = round(raw_fee_inr * 100)
        fee_paise = int(rounded_fee_inr * 100)
        round_off_paise = int(round_off_inr * 100)

    return {
        "distance_km": round(distance_km, 2),
        "method": method,
        "delivery_fee_paise": fee_paise,
        "delivery_fee_inr": fee_paise / 100,
        "raw_delivery_fee_inr": raw_fee_inr,
        "raw_delivery_fee_paise": raw_fee_paise,
        "round_off_inr": round_off_inr,
        "round_off_paise": round_off_paise,
        "within_radius": within_radius,
        "max_radius_km": config.delivery_radius_km,
        "free_radius_km": config.free_delivery_radius_km,
        "fee_per_km_paise": config.delivery_fee_per_km_paise,
    }



@app.get("/health", tags=["health"])
def health():
    return {"status": "ok", "service": "kebabzilla-api"}


@app.get(f"{settings.api_prefix}/admin-preview/delivery", tags=["administration"])
def admin_delivery_preview(db: DbSession, account: CurrentAccount):
    """Admin-only read of delivery staff for role preview; enforcement is explicit here."""
    if account.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="You do not have access to this action")
    people = db.scalars(select(Account).where(Account.role == Role.DELIVERY).order_by(Account.name)).all()
    return [{"id": person.id, "name": person.name, "phone": person.phone} for person in people]
