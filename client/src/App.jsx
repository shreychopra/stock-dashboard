import { useState, useEffect, useRef } from "react"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from "recharts"

const API = "http://localhost:8000"
const PERIODS = ["1wk", "1mo", "3mo", "6mo", "1y", "5y"]
const PERIOD_LABELS = { "1wk": "1W", "1mo": "1M", "3mo": "3M", "6mo": "6M", "1y": "1Y", "5y": "5Y" }
const MAX_HISTORY = 6

function getCurrencySymbol(currency) {
  const symbols = { USD: "$", INR: "\u20b9", EUR: "\u20ac", GBP: "\u00a3", JPY: "\u00a5" }
  return symbols[currency] || currency + " "
}

function formatMarketCap(val, currency) {
  if (!val) return "\u2014"
  const sym = getCurrencySymbol(currency)
  if (val >= 1e12) return sym + (val / 1e12).toFixed(2) + "T"
  if (val >= 1e9)  return sym + (val / 1e9).toFixed(2) + "B"
  if (val >= 1e6)  return sym + (val / 1e6).toFixed(2) + "M"
  return sym + val
}

function MetricCard({ label, value, dark }) {
  return (
    <div className={dark ? "bg-gray-800 border border-gray-700 rounded-xl p-4" : "bg-white border border-gray-200 rounded-xl p-4"}>
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={dark ? "text-lg font-medium text-gray-100" : "text-lg font-medium text-gray-800"}>{value ?? "\u2014"}</p>
    </div>
  )
}

function timeAgo(dateStr) {
  if (!dateStr) return ""
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 60000)
  if (diff < 60) return diff + "m ago"
  if (diff < 1440) return Math.floor(diff / 60) + "h ago"
  return Math.floor(diff / 1440) + "d ago"
}

export default function App() {
  const [ticker, setTicker] = useState("")
  const [input, setInput] = useState("")
  const [period, setPeriod] = useState("1mo")
  const [data, setData] = useState(null)
  const [news, setNews] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dark, setDark] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("searchHistory") || "[]") }
    catch { return [] }
  })
  const suggestTimer = useRef(null)
  const wrapperRef = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target))
        setShowSuggestions(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  function handleInputChange(e) {
    const val = e.target.value
    setInput(val)
    clearTimeout(suggestTimer.current)
    if (val.length < 1) { setSuggestions([]); setShowSuggestions(false); return }
    suggestTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/api/search?q=${encodeURIComponent(val)}`)
        const data = await res.json()
        setSuggestions(data)
        setShowSuggestions(data.length > 0)
      } catch {}
    }, 300)
  }

  function addToHistory(t) {
    const updated = [t, ...history.filter(h => h !== t)].slice(0, MAX_HISTORY)
    setHistory(updated)
    localStorage.setItem("searchHistory", JSON.stringify(updated))
  }

  async function loadStock(q) {
    const ticker = q.trim().toUpperCase()
    if (!ticker) return
    setLoading(true)
    setError(null)
    setData(null)
    setNews([])
    setShowSuggestions(false)
    setInput("")
    try {
      const [stockRes, newsRes] = await Promise.all([
        fetch(`${API}/api/stock/${ticker}?period=${period}`),
        fetch(`${API}/api/news/${ticker}`)
      ])
      if (!stockRes.ok) throw new Error("Not found")
      const stockData = await stockRes.json()
      const newsData = newsRes.ok ? await newsRes.json() : []
      setData(stockData)
      setNews(newsData)
      setTicker(ticker)
      addToHistory(ticker)
    } catch {
      setError("Could not find that ticker. Try AAPL, TSLA, or GOOGL.")
    }
    setLoading(false)
  }

  async function changePeriod(p) {
    setPeriod(p)
    if (!ticker) return
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/stock/${ticker}?period=${p}`)
      const json = await res.json()
      setData(json)
    } catch {}
    setLoading(false)
  }

  const isPositive = data && data.change >= 0
  const sym = data ? getCurrencySymbol(data.currency) : "$"
  const bg = dark ? "min-h-screen bg-gray-900" : "min-h-screen bg-gray-50"
  const nav = dark ? "bg-gray-800 border-b border-gray-700 px-8 py-4 flex items-center gap-4" : "bg-white border-b border-gray-200 px-8 py-4 flex items-center gap-4"
  const cardBg = dark ? "bg-gray-800 border border-gray-700 rounded-xl p-6" : "bg-white border border-gray-200 rounded-xl p-6"
  const inputCls = dark
    ? "flex-1 bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
    : "flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"

  return (
    <div className={bg}>
      <div className={nav}>
        <span className={dark ? "font-bold text-gray-100 text-lg" : "font-bold text-gray-800 text-lg"}>Stock Dashboard</span>

        {/* Search with autocomplete */}
        <div className="relative flex-1 max-w-sm" ref={wrapperRef}>
          <div className="flex gap-2">
            <input
              className={inputCls}
              placeholder="Search ticker — AAPL, TSLA, RELIANCE.NS..."
              value={input}
              onChange={handleInputChange}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onKeyDown={e => e.key === "Enter" && loadStock(input)}
            />
            <button onClick={() => loadStock(input)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
              Search
            </button>
          </div>

          {/* Autocomplete dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className={dark
              ? "absolute top-full left-0 right-12 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-50 overflow-hidden"
              : "absolute top-full left-0 right-12 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden"
            }>
              {suggestions.map(s => (
                <button
                  key={s.ticker}
                  onClick={() => loadStock(s.ticker)}
                  className={dark
                    ? "w-full text-left px-4 py-2.5 hover:bg-gray-700 flex items-center gap-3"
                    : "w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-3"
                  }
                >
                  <span className={dark ? "text-sm font-medium text-gray-100 w-20 flex-shrink-0" : "text-sm font-medium text-gray-800 w-20 flex-shrink-0"}>{s.ticker}</span>
                  <span className={dark ? "text-xs text-gray-400 truncate" : "text-xs text-gray-400 truncate"}>{s.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => setDark(d => !d)}
          className={dark
            ? "ml-auto text-xs px-3 py-1.5 rounded-full bg-gray-700 text-gray-300 hover:bg-gray-600"
            : "ml-auto text-xs px-3 py-1.5 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200"
          }
        >
          {dark ? "Light mode" : "Dark mode"}
        </button>
      </div>

      <div className="max-w-5xl mx-auto p-8">
        {/* Search history */}
        {history.length > 0 && (
          <div className="mb-6 flex items-center gap-2 flex-wrap">
            <span className={dark ? "text-xs text-gray-500" : "text-xs text-gray-400"}>Recent:</span>
            {history.map(h => (
              <button key={h} onClick={() => loadStock(h)}
                className={dark
                  ? "text-xs px-3 py-1 rounded-full bg-gray-700 text-gray-300 hover:bg-gray-600"
                  : "text-xs px-3 py-1 rounded-full bg-white border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600"
                }
              >{h}</button>
            ))}
          </div>
        )}

        {!data && !loading && !error && (
          <div className="text-center py-24">
            <p className={dark ? "text-gray-500 text-sm" : "text-gray-400 text-sm"}>Search for a stock ticker above to get started.</p>
            <p className={dark ? "text-gray-600 text-xs mt-2" : "text-gray-300 text-xs mt-2"}>Try AAPL · TSLA · GOOGL · MSFT · RELIANCE.NS</p>
          </div>
        )}

        {loading && <div className="text-center py-24"><p className={dark ? "text-gray-500 text-sm" : "text-gray-400 text-sm"}>Loading...</p></div>}

        {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">{error}</div>}

        {data && !loading && (
          <div>
            <div className="mb-6">
              <div className="flex items-baseline gap-3 flex-wrap">
                <h1 className={dark ? "text-2xl font-bold text-gray-100" : "text-2xl font-bold text-gray-800"}>{data.ticker}</h1>
                <span className="text-gray-400 text-sm">{data.name}</span>
                <span className={dark ? "text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded-full" : "text-xs text-gray-300 bg-gray-100 px-2 py-0.5 rounded-full"}>{data.currency}</span>
              </div>
              <div className="flex items-baseline gap-3 mt-1">
                <span className={dark ? "text-3xl font-bold text-gray-100" : "text-3xl font-bold text-gray-900"}>{sym}{data.price}</span>
                <span className={`text-sm font-medium ${isPositive ? "text-green-500" : "text-red-500"}`}>
                  {isPositive ? "+" : ""}{data.change}%
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <MetricCard label="Market Cap" value={formatMarketCap(data.marketCap, data.currency)} dark={dark} />
              <MetricCard label="P/E Ratio" value={data.pe || "\u2014"} dark={dark} />
              <MetricCard label="52W High" value={data.high52 ? `${sym}${data.high52}` : "\u2014"} dark={dark} />
              <MetricCard label="52W Low"  value={data.low52  ? `${sym}${data.low52}`  : "\u2014"} dark={dark} />
            </div>

            <div className={cardBg + " mb-6"}>
              <div className="flex gap-2 mb-6">
                {PERIODS.map(p => (
                  <button key={p} onClick={() => changePeriod(p)}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium ${period === p ? "bg-blue-600 text-white" : dark ? "bg-gray-700 text-gray-400 hover:bg-gray-600" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                  >{PERIOD_LABELS[p]}</button>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={data.history}>
                  <CartesianGrid strokeDasharray="3 3" stroke={dark ? "#374151" : "#f0f0f0"} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: dark ? "#6b7280" : "#9ca3af" }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: dark ? "#6b7280" : "#9ca3af" }} tickLine={false} axisLine={false} tickFormatter={v => `${sym}${v}`} domain={["auto","auto"]} />
                  <Tooltip
                    formatter={(val, name) => [`${sym}${val}`, name === "close" ? "Price" : "MA50"]}
                    contentStyle={{ borderRadius: 8, border: dark ? "1px solid #374151" : "1px solid #e5e7eb", background: dark ? "#1f2937" : "#fff", color: dark ? "#f3f4f6" : "#111827", fontSize: 12 }}
                  />
                  <Legend formatter={val => val === "close" ? "Price" : "50-day MA"} />
                  <Line type="monotone" dataKey="close" stroke="#2563eb" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="ma50" stroke="#f59e0b" dot={false} strokeWidth={1.5} strokeDasharray="4 4" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* News feed */}
            {news.length > 0 && (
              <div className={cardBg}>
                <h2 className={dark ? "text-sm font-medium text-gray-300 mb-4" : "text-sm font-medium text-gray-600 mb-4"}>Latest news</h2>
                <div className="space-y-3">
                  {news.map((item, i) => (
                    <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                      className={dark ? "block p-3 rounded-lg hover:bg-gray-700 transition-colors" : "block p-3 rounded-lg hover:bg-gray-50 transition-colors"}
                    >
                      <p className={dark ? "text-sm text-gray-200 font-medium leading-snug mb-1" : "text-sm text-gray-800 font-medium leading-snug mb-1"}>{item.title}</p>
                      <div className="flex items-center gap-2">
                        <span className={dark ? "text-xs text-gray-500" : "text-xs text-gray-400"}>{item.source}</span>
                        {item.time && <span className={dark ? "text-xs text-gray-600" : "text-xs text-gray-300"}>· {timeAgo(item.time)}</span>}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}