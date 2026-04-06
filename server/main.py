from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import numpy as np

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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

@app.get("/api/stock/{ticker}")
def get_stock(ticker: str, period: str = "1mo"):
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