from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime
import yfinance as yf
import pandas as pd
import numpy as np
import os
from dotenv import load_dotenv

load_dotenv(override=True)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL not set in .env file")

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=1,
    max_overflow=0,
)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

class WatchlistItem(Base):
    __tablename__ = "watchlist"
    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, unique=True, index=True)
    name = Column(String)
    added_at = Column(DateTime, default=datetime.utcnow)

Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", os.getenv("FRONTEND_URL", "")],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Database setup ───────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=1,
    max_overflow=0,
)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

class WatchlistItem(Base):
    __tablename__ = "watchlist"
    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, unique=True, index=True)
    name = Column(String)
    added_at = Column(DateTime, default=datetime.utcnow)

Base.metadata.create_all(bind=engine)

# ─── Indicator helpers ────────────────────────────────────
def calc_rsi(series, period=14):
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss
    return (100 - (100 / (1 + rs))).round(2)

def calc_macd(series, fast=12, slow=26, signal=9):
    ema_fast = series.ewm(span=fast, adjust=False).mean()
    ema_slow = series.ewm(span=slow, adjust=False).mean()
    macd = ema_fast - ema_slow
    signal_line = macd.ewm(span=signal, adjust=False).mean()
    histogram = macd - signal_line
    return macd.round(4), signal_line.round(4), histogram.round(4)

def calc_bollinger(series, period=20, std=2):
    ma = series.rolling(period).mean()
    stddev = series.rolling(period).std()
    upper = (ma + std * stddev).round(2)
    lower = (ma - std * stddev).round(2)
    return upper, ma.round(2), lower

def safe_float(val):
    try:
        if val is None or (isinstance(val, float) and np.isnan(val)):
            return None
        return float(val)
    except:
        return None

# ─── Stock routes ─────────────────────────────────────────
@app.get("/api/stock/{ticker}")
def get_stock(ticker: str, period: str = "3mo"):
    try:
        stock = yf.Ticker(ticker)
        info = stock.info if stock.info else {}
        hist = stock.history(period=period)
        if hist.empty:
            raise HTTPException(status_code=404, detail="No data found for ticker")
        hist["MA50"] = hist["Close"].rolling(window=50).mean()
        hist["RSI"] = calc_rsi(hist["Close"])
        macd, signal, histogram = calc_macd(hist["Close"])
        hist["MACD"] = macd
        hist["MACD_signal"] = signal
        hist["MACD_hist"] = histogram
        upper, mid, lower = calc_bollinger(hist["Close"])
        hist["BB_upper"] = upper
        hist["BB_mid"] = mid
        hist["BB_lower"] = lower
        price_history = []
        for index, row in hist.iterrows():
            price_history.append({
                "date": str(index.date()),
                "open":  safe_float(row.get("Open")),
                "high":  safe_float(row.get("High")),
                "low":   safe_float(row.get("Low")),
                "close": safe_float(row.get("Close")),
                "ma50":  safe_float(row.get("MA50")),
                "rsi":   safe_float(row.get("RSI")),
                "macd":  safe_float(row.get("MACD")),
                "macd_signal": safe_float(row.get("MACD_signal")),
                "macd_hist":   safe_float(row.get("MACD_hist")),
                "bb_upper": safe_float(row.get("BB_upper")),
                "bb_mid":   safe_float(row.get("BB_mid")),
                "bb_lower": safe_float(row.get("BB_lower")),
            })
        return {
            "ticker": ticker.upper(),
            "name": info.get("longName") or ticker,
            "price": round(float(info.get("currentPrice", 0) or 0), 2),
            "change": round(float(info.get("regularMarketChangePercent", 0) or 0), 2),
            "marketCap": info.get("marketCap") or 0,
            "pe": round(float(info.get("trailingPE", 0) or 0), 2),
            "high52": round(float(info.get("fiftyTwoWeekHigh", 0) or 0), 2),
            "low52": round(float(info.get("fiftyTwoWeekLow", 0) or 0), 2),
            "volume": info.get("regularMarketVolume") or 0,
            "currency": info.get("currency") or "USD",
            "history": price_history,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/compare")
def compare_stocks(t1: str, t2: str, period: str = "3mo"):
    try:
        results = {}
        for ticker in [t1.upper(), t2.upper()]:
            stock = yf.Ticker(ticker)
            hist = stock.history(period=period)
            if hist.empty:
                raise HTTPException(status_code=404, detail=f"No data for {ticker}")
            first_close = hist["Close"].iloc[0]
            hist["normalised"] = ((hist["Close"] - first_close) / first_close * 100).round(2)
            results[ticker] = [
                {"date": str(idx.date()), "value": safe_float(row["normalised"])}
                for idx, row in hist.iterrows()
            ]
        all_dates = sorted(set(
            [d["date"] for d in results[t1.upper()]] +
            [d["date"] for d in results[t2.upper()]]
        ))
        t1_map = {d["date"]: d["value"] for d in results[t1.upper()]}
        t2_map = {d["date"]: d["value"] for d in results[t2.upper()]}
        combined = [{"date": d, t1.upper(): t1_map.get(d), t2.upper(): t2_map.get(d)} for d in all_dates]
        return {"data": combined, "tickers": [t1.upper(), t2.upper()]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/financials/{ticker}")
def get_financials(ticker: str):
    try:
        stock = yf.Ticker(ticker)
        income = stock.financials
        cashflow = stock.cashflow
        def format_statement(df):
            if df is None or df.empty:
                return []
            rows = []
            for metric in df.index:
                row = {"metric": str(metric)}
                for col in df.columns:
                    val = df.loc[metric, col]
                    row[str(col.date())] = safe_float(val)
                rows.append(row)
            return rows
        return {
            "income": format_statement(income),
            "cashflow": format_statement(cashflow),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/news/{ticker}")
def get_news(ticker: str):
    try:
        stock = yf.Ticker(ticker)
        news = stock.news or []
        results = []
        for item in news[:8]:
            content = item.get("content", {})
            results.append({
                "title": content.get("title", ""),
                "url": content.get("canonicalUrl", {}).get("url", "") if isinstance(content.get("canonicalUrl"), dict) else "",
                "source": content.get("provider", {}).get("displayName", "") if isinstance(content.get("provider"), dict) else "",
                "time": content.get("pubDate", ""),
            })
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/search")
def search_tickers(q: str):
    try:
        results = yf.Search(q, max_results=6)
        quotes = results.quotes if hasattr(results, "quotes") else []
        return [
            {
                "ticker": item.get("symbol", ""),
                "name": item.get("longname") or item.get("shortname") or item.get("symbol", ""),
                "type": item.get("quoteType", ""),
            }
            for item in quotes if item.get("symbol")
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/heatmap")
def get_heatmap():
    SECTORS = {
        "Technology": ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "TSLA", "AVGO", "ORCL"],
        "Finance": ["JPM", "BAC", "GS", "MS", "WFC", "BLK", "AXP", "C"],
        "Healthcare": ["UNH", "JNJ", "LLY", "ABBV", "MRK", "TMO", "ABT", "DHR"],
        "Consumer": ["AMZN", "WMT", "HD", "MCD", "NKE", "SBUX", "TGT", "COST"],
        "Energy": ["XOM", "CVX", "COP", "SLB", "EOG", "MPC", "PSX", "VLO"],
        "Indian": ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS", "HINDUNILVR.NS", "ITC.NS", "BAJFINANCE.NS"],
    }
    try:
        all_tickers = [t for tickers in SECTORS.values() for t in tickers]
        data = yf.download(all_tickers, period="2d", auto_adjust=True, progress=False)
        results = {}
        for sector, tickers in SECTORS.items():
            sector_data = []
            for ticker in tickers:
                try:
                    if "Close" in data and ticker in data["Close"].columns:
                        closes = data["Close"][ticker].dropna()
                        if len(closes) >= 2:
                            prev, curr = float(closes.iloc[-2]), float(closes.iloc[-1])
                            change = round((curr - prev) / prev * 100, 2)
                        elif len(closes) == 1:
                            curr = float(closes.iloc[-1])
                            change = 0.0
                        else:
                            continue
                        info = yf.Ticker(ticker).fast_info
                        name = getattr(info, "display_name", None) or ticker
                        sector_data.append({
                            "ticker": ticker,
                            "name": name,
                            "price": round(curr, 2),
                            "change": change,
                        })
                    else:
                        continue
                except Exception:
                    continue
            results[sector] = sector_data
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Watchlist routes ─────────────────────────────────────
@app.get("/api/watchlist")
def get_watchlist():
    db = SessionLocal()
    try:
        items = db.query(WatchlistItem).order_by(WatchlistItem.added_at.desc()).all()
        return [{"id": i.id, "ticker": i.ticker, "name": i.name} for i in items]
    finally:
        db.close()

@app.post("/api/watchlist/{ticker}")
def add_to_watchlist(ticker: str):
    db = SessionLocal()
    try:
        existing = db.query(WatchlistItem).filter(WatchlistItem.ticker == ticker.upper()).first()
        if existing:
            return {"id": existing.id, "ticker": existing.ticker, "name": existing.name}
        stock = yf.Ticker(ticker)
        name = stock.info.get("longName") or ticker.upper()
        item = WatchlistItem(ticker=ticker.upper(), name=name)
        db.add(item)
        db.commit()
        db.refresh(item)
        return {"id": item.id, "ticker": item.ticker, "name": item.name}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

@app.delete("/api/watchlist/{ticker}")
def remove_from_watchlist(ticker: str):
    db = SessionLocal()
    try:
        item = db.query(WatchlistItem).filter(WatchlistItem.ticker == ticker.upper()).first()
        if item:
            db.delete(item)
            db.commit()
        return {"message": "Removed"}
    finally:
        db.close()