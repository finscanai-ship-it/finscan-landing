"""
Refresh market_data.json from Yahoo Finance.

Pulls the most recent two trading-day closes for each ticker via yfinance,
computes the day-over-day % change, and writes the result to
../market_data.json. Designed to be run by GitHub Actions on a daily cron
(weekdays only — the script is no-op-safe on weekends/holidays).

Usage (locally):
    pip install yfinance
    python scripts/refresh_market_data.py

In CI the workflow does:
    python scripts/refresh_market_data.py && git add ...
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import yfinance as yf
except ImportError:
    print("yfinance not installed. `pip install yfinance` first.", file=sys.stderr)
    sys.exit(1)

# Tickers shown on the landing page. Order matters only for grep-readability.
TICKERS = [
    "NVDA", "AAPL", "MSFT", "TSLA", "AMZN", "META", "PLTR",
    "GLD",  "LMT",  "BAESY", "FCX", "CRWD", "GOOGL",
]

OUT_PATH = Path(__file__).resolve().parent.parent / "market_data.json"


def fetch_one(symbol: str) -> dict | None:
    """Pull last 5 trading days + shares outstanding for one ticker.

    Returns {price, change_pct, shares_outstanding, market_cap} for the most
    recent close.  Shares-outstanding can be missing on some tickers (ETFs);
    we leave those fields out.
    """
    try:
        ticker = yf.Ticker(symbol)
        hist   = ticker.history(period="5d", auto_adjust=False)
    except Exception as e:
        print(f"  ! {symbol}: fetch error: {e}", file=sys.stderr)
        return None
    if hist is None or hist.empty or len(hist) < 2:
        print(f"  ! {symbol}: insufficient history ({0 if hist is None else len(hist)} rows)", file=sys.stderr)
        return None
    last_close  = float(hist["Close"].iloc[-1])
    prior_close = float(hist["Close"].iloc[-2])
    if prior_close <= 0:
        return None
    change_pct = (last_close - prior_close) / prior_close * 100.0

    out: dict = {
        "price":      round(last_close, 2),
        "change_pct": round(change_pct, 2),
    }
    # Shares outstanding + market cap (used by the bi-weekly analysis carousels)
    try:
        info   = ticker.info or {}
        shares = info.get("sharesOutstanding")
        if shares and shares > 0:
            out["shares_outstanding"] = int(shares)
            out["market_cap"]         = int(round(last_close * shares))
    except Exception as e:
        print(f"  · {symbol}: no shares info ({e})", file=sys.stderr)
    return out


def main() -> int:
    # Load existing file so we keep previous values for any ticker that fails.
    existing: dict = {}
    if OUT_PATH.exists():
        try:
            existing = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except Exception:
            existing = {}
    existing_tickers: dict = existing.get("tickers", {}) if isinstance(existing, dict) else {}

    tickers: dict = {}
    most_recent_date: datetime | None = None

    for sym in TICKERS:
        print(f"Fetching {sym}…")
        row = fetch_one(sym)
        if row is None:
            # Keep previous value to avoid blanking the site if one ticker hiccups.
            prev = existing_tickers.get(sym)
            if prev:
                tickers[sym] = prev
                print(f"  -> using previous value {prev}")
            continue
        tickers[sym] = row
        # Track the most recent close date as the canonical "as_of"
        try:
            hist = yf.Ticker(sym).history(period="2d", auto_adjust=False)
            dt = hist.index[-1].to_pydatetime()
            if most_recent_date is None or dt > most_recent_date:
                most_recent_date = dt
        except Exception:
            pass

    if not tickers:
        print("ERROR: no tickers fetched. Aborting to avoid wiping the file.", file=sys.stderr)
        return 1

    if most_recent_date is None:
        most_recent_date = datetime.now(timezone.utc)

    out = {
        "_comment": existing.get(
            "_comment",
            "Auto-refreshed daily by .github/workflows/refresh-data.yml."
        ),
        "as_of_iso":   most_recent_date.strftime("%Y-%m-%d"),
        "as_of_label": "PRIOR CLOSE · " + most_recent_date.strftime("%b %-d, %Y").upper() if os.name != "nt"
                       else "PRIOR CLOSE · " + most_recent_date.strftime("%b %#d, %Y").upper(),
        "tickers":     tickers,
    }
    OUT_PATH.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {OUT_PATH} ({len(tickers)} tickers, as_of={out['as_of_iso']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
