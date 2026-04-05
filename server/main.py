from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/stock/{ticker}")
def get_stock(ticker: str, period: str = "1mo"):
    try:
        stock = yf.Ticker(ticker)

        # Safer info fetch (info can fail or be empty)
        info = stock.info if stock.info else {}

        hist = stock.history(period=period)

        # ❗ Handle empty history (invalid ticker or API failure)
        if hist.empty:
            raise HTTPException(status_code=404, detail="No data found for ticker")

        # Moving average
        hist["MA50"] = hist["Close"].rolling(window=50).mean()

        price_history = []
        for index, row in hist.iterrows():
            price_history.append({
                "date": str(index.date()),
                "close": round(float(row["Close"]), 2) if not pd.isna(row["Close"]) else None,
                "ma50": round(float(row["MA50"]), 2) if not pd.isna(row["MA50"]) else None,
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

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))