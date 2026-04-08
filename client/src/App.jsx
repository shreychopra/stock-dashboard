import { useState, useRef, useEffect } from "react"
import {
  ComposedChart, LineChart, BarChart,
  Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
  ReferenceLine, Cell
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

function formatLargeNum(val) {
  if (!val) return "\u2014"
  if (val >= 1e12) return (val / 1e12).toFixed(2) + "T"
  if (val >= 1e9)  return (val / 1e9).toFixed(2) + "B"
  if (val >= 1e6)  return (val / 1e6).toFixed(2) + "M"
  return val.toFixed(0)
}

function timeAgo(dateStr) {
  if (!dateStr) return ""
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 60000)
  if (diff < 60) return diff + "m ago"
  if (diff < 1440) return Math.floor(diff / 60) + "h ago"
  return Math.floor(diff / 1440) + "d ago"
}

function MetricCard({ label, value, dark }) {
  return (
    <div className={dark ? "bg-gray-800 border border-gray-700 rounded-xl p-4" : "bg-white border border-gray-200 rounded-xl p-4"}>
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={dark ? "text-lg font-medium text-gray-100" : "text-lg font-medium text-gray-800"}>{value ?? "\u2014"}</p>
    </div>
  )
}

function CandlestickBar(props) {
  const { x, y, width, payload } = props
  if (!payload || payload.open == null || payload.close == null) return null
  const { open, close } = payload
  const isUp = close >= open
  const color = isUp ? "#22c55e" : "#ef4444"
  const bodyY = Math.min(open, close)
  const bodyH = Math.max(Math.abs(close - open), 1)
  return (
    <g>
      <rect x={x + 1} y={bodyY} width={width - 2} height={bodyH} fill={color} />
    </g>
  )
}

export default function App() {
  const [page, setPage] = useState("stock")
  const [ticker, setTicker] = useState("")
  const [input, setInput] = useState("")
  const [period, setPeriod] = useState("3mo")
  const [data, setData] = useState(null)
  const [news, setNews] = useState([])
  const [financials, setFinancials] = useState(null)
  const [activeTab, setActiveTab] = useState("chart")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dark, setDark] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [chartType, setChartType] = useState("line")
  const [indicators, setIndicators] = useState({ ma50: true, bb: false, rsi: false, macd: false })
  const [watchlist, setWatchlist] = useState([])
  const [compareT1, setCompareT1] = useState("")
  const [compareT2, setCompareT2] = useState("")
  const [compareData, setCompareData] = useState(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("searchHistory") || "[]") } catch { return [] }
  })
  const suggestTimer = useRef(null)
  const wrapperRef = useRef(null)

  useEffect(() => {
    fetchWatchlist()
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setShowSuggestions(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  async function fetchWatchlist() {
    try {
      const res = await fetch(`${API}/api/watchlist`)
      setWatchlist(await res.json())
    } catch {}
  }

  async function addToWatchlist(t, name) {
    await fetch(`${API}/api/watchlist/${t}`, { method: "POST" })
    fetchWatchlist()
  }

  async function removeFromWatchlist(t) {
    await fetch(`${API}/api/watchlist/${t}`, { method: "DELETE" })
    fetchWatchlist()
  }

  const isWatched = ticker && watchlist.some(w => w.ticker === ticker)

  function handleInputChange(e) {
    const val = e.target.value
    setInput(val)
    clearTimeout(suggestTimer.current)
    if (val.length < 1) { setSuggestions([]); setShowSuggestions(false); return }
    suggestTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/api/search?q=${encodeURIComponent(val)}`)
        const d = await res.json()
        setSuggestions(d); setShowSuggestions(d.length > 0)
      } catch {}
    }, 300)
  }

  function addToHistory(t) {
    const updated = [t, ...history.filter(h => h !== t)].slice(0, MAX_HISTORY)
    setHistory(updated)
    localStorage.setItem("searchHistory", JSON.stringify(updated))
  }

  function toggleIndicator(key) {
    setIndicators(prev => ({ ...prev, [key]: !prev[key] }))
  }

  async function loadStock(q) {
    const t = q.trim().toUpperCase()
    if (!t) return
    setPage("stock")
    setLoading(true); setError(null); setData(null); setNews([]); setFinancials(null); setActiveTab("chart")
    setShowSuggestions(false); setInput("")
    try {
      const [stockRes, newsRes] = await Promise.all([
        fetch(`${API}/api/stock/${t}?period=${period}`),
        fetch(`${API}/api/news/${t}`)
      ])
      if (!stockRes.ok) throw new Error("Not found")
      const stockData = await stockRes.json()
      const newsData = newsRes.ok ? await newsRes.json() : []
      setData(stockData); setNews(newsData); setTicker(t)
      addToHistory(t)
    } catch {
      setError("Could not find that ticker. Try AAPL, TSLA, or GOOGL.")
    }
    setLoading(false)
  }

  async function loadFinancials() {
    if (!ticker || financials) return
    try {
      const res = await fetch(`${API}/api/financials/${ticker}`)
      setFinancials(await res.json())
    } catch {}
  }

  async function changePeriod(p) {
    setPeriod(p)
    if (!ticker) return
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/stock/${ticker}?period=${p}`)
      setData(await res.json())
    } catch {}
    setLoading(false)
  }

  async function runComparison() {
    if (!compareT1 || !compareT2) return
    setCompareLoading(true); setCompareData(null)
    try {
      const res = await fetch(`${API}/api/compare?t1=${compareT1.toUpperCase()}&t2=${compareT2.toUpperCase()}&period=${period}`)
      if (!res.ok) throw new Error("Failed")
      setCompareData(await res.json())
    } catch {}
    setCompareLoading(false)
  }

  const isPositive = data && data.change >= 0
  const sym = data ? getCurrencySymbol(data.currency) : "$"
  const bg = dark ? "min-h-screen bg-gray-900" : "min-h-screen bg-gray-50"
  const cardBg = dark ? "bg-gray-800 border border-gray-700 rounded-xl p-6" : "bg-white border border-gray-200 rounded-xl p-6"
  const inputCls = dark
    ? "bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
    : "border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
  const gridStroke = dark ? "#374151" : "#f0f0f0"
  const axisColor = dark ? "#6b7280" : "#9ca3af"
  const tooltipStyle = { borderRadius: 8, border: dark ? "1px solid #374151" : "1px solid #e5e7eb", background: dark ? "#1f2937" : "#fff", color: dark ? "#f3f4f6" : "#111827", fontSize: 12 }
  const histData = data?.history || []

  const KEY_FINANCIALS = ["Total Revenue", "Net Income", "Free Cash Flow", "Gross Profit", "Operating Income"]

  return (
    <div className={bg}>
      {/* Nav */}
      <div className={dark ? "bg-gray-800 border-b border-gray-700 px-8 py-4 flex items-center gap-6" : "bg-white border-b border-gray-200 px-8 py-4 flex items-center gap-6"}>
        <span className={dark ? "font-bold text-gray-100 text-lg flex-shrink-0" : "font-bold text-gray-800 text-lg flex-shrink-0"}>Stock Dashboard</span>

        {/* Search */}
        <div className="relative flex-1 max-w-sm" ref={wrapperRef}>
          <div className="flex gap-2">
            <input className={inputCls + " flex-1"} placeholder="Search ticker..."
              value={input} onChange={handleInputChange}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onKeyDown={e => e.key === "Enter" && loadStock(input)}
            />
            <button onClick={() => loadStock(input)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Search</button>
          </div>
          {showSuggestions && suggestions.length > 0 && (
            <div className={dark ? "absolute top-full left-0 right-12 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-50 overflow-hidden" : "absolute top-full left-0 right-12 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden"}>
              {suggestions.map(s => (
                <button key={s.ticker} onClick={() => loadStock(s.ticker)}
                  className={dark ? "w-full text-left px-4 py-2.5 hover:bg-gray-700 flex items-center gap-3" : "w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-3"}>
                  <span className={dark ? "text-sm font-medium text-gray-100 w-20 flex-shrink-0" : "text-sm font-medium text-gray-800 w-20 flex-shrink-0"}>{s.ticker}</span>
                  <span className="text-xs text-gray-400 truncate">{s.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Page nav */}
        <div className="flex gap-1">
          {[["stock","Stock"],["compare","Compare"],["watchlist","Watchlist"]].map(([p, label]) => (
            <button key={p} onClick={() => setPage(p)}
              className={`text-sm px-3 py-1.5 rounded-lg font-medium ${page === p ? "bg-blue-600 text-white" : dark ? "text-gray-400 hover:text-gray-200" : "text-gray-500 hover:text-gray-800"}`}>
              {label}{p === "watchlist" && watchlist.length > 0 && <span className="ml-1 text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">{watchlist.length}</span>}
            </button>
          ))}
        </div>

        <button onClick={() => setDark(d => !d)} className={dark ? "ml-auto text-xs px-3 py-1.5 rounded-full bg-gray-700 text-gray-300 hover:bg-gray-600 flex-shrink-0" : "ml-auto text-xs px-3 py-1.5 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex-shrink-0"}>
          {dark ? "Light" : "Dark"}
        </button>
      </div>

      <div className="max-w-5xl mx-auto p-8">

        {/* ── Compare Page ── */}
        {page === "compare" && (
          <div>
            <h1 className={dark ? "text-xl font-bold text-gray-100 mb-6" : "text-xl font-bold text-gray-800 mb-6"}>Compare stocks</h1>
            <div className={cardBg + " mb-6"}>
              <div className="flex gap-3 items-end flex-wrap">
                <div className="flex-1 min-w-32">
                  <label className="text-xs text-gray-400 mb-1 block">Ticker 1</label>
                  <input className={inputCls + " w-full"} placeholder="AAPL" value={compareT1} onChange={e => setCompareT1(e.target.value.toUpperCase())} />
                </div>
                <div className="flex-1 min-w-32">
                  <label className="text-xs text-gray-400 mb-1 block">Ticker 2</label>
                  <input className={inputCls + " w-full"} placeholder="MSFT" value={compareT2} onChange={e => setCompareT2(e.target.value.toUpperCase())} />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Period</label>
                  <select className={inputCls} value={period} onChange={e => setPeriod(e.target.value)}>
                    {PERIODS.map(p => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
                  </select>
                </div>
                <button onClick={runComparison} className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Compare</button>
              </div>
            </div>
            {compareLoading && <div className="text-center py-12"><p className="text-gray-400 text-sm">Loading...</p></div>}
            {compareData && (
              <div className={cardBg}>
                <p className={dark ? "text-xs text-gray-400 mb-4" : "text-xs text-gray-400 mb-4"}>% change from start date — both normalised to 0%</p>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={compareData.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: axisColor }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: axisColor }} tickLine={false} axisLine={false} tickFormatter={v => v + "%"} />
                    <Tooltip formatter={(v, name) => [v?.toFixed(2) + "%", name]} contentStyle={tooltipStyle} />
                    <ReferenceLine y={0} stroke={axisColor} strokeWidth={0.5} />
                    <Legend />
                    <Line type="monotone" dataKey={compareData.tickers[0]} stroke="#2563eb" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey={compareData.tickers[1]} stroke="#ef4444" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ── Watchlist Page ── */}
        {page === "watchlist" && (
          <div>
            <h1 className={dark ? "text-xl font-bold text-gray-100 mb-6" : "text-xl font-bold text-gray-800 mb-6"}>Watchlist</h1>
            {watchlist.length === 0 ? (
              <div className="text-center py-24">
                <p className={dark ? "text-gray-500 text-sm" : "text-gray-400 text-sm"}>No stocks saved yet.</p>
                <p className={dark ? "text-gray-600 text-xs mt-2" : "text-gray-300 text-xs mt-2"}>Search a stock and click the bookmark button to add it.</p>
              </div>
            ) : (
              <div className={cardBg}>
                <div className="space-y-2">
                  {watchlist.map(w => (
                    <div key={w.ticker} className={dark ? "flex items-center gap-4 p-3 rounded-lg hover:bg-gray-700" : "flex items-center gap-4 p-3 rounded-lg hover:bg-gray-50"}>
                      <button onClick={() => loadStock(w.ticker)} className="flex-1 text-left">
                        <span className={dark ? "text-sm font-medium text-gray-100" : "text-sm font-medium text-gray-800"}>{w.ticker}</span>
                        <span className="text-xs text-gray-400 ml-2">{w.name}</span>
                      </button>
                      <button onClick={() => removeFromWatchlist(w.ticker)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Stock Page ── */}
        {page === "stock" && (
          <div>
            {history.length > 0 && (
              <div className="mb-6 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-400">Recent:</span>
                {history.map(h => (
                  <button key={h} onClick={() => loadStock(h)}
                    className={dark ? "text-xs px-3 py-1 rounded-full bg-gray-700 text-gray-300 hover:bg-gray-600" : "text-xs px-3 py-1 rounded-full bg-white border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600"}>
                    {h}
                  </button>
                ))}
              </div>
            )}

            {!data && !loading && !error && (
              <div className="text-center py-24">
                <p className={dark ? "text-gray-500 text-sm" : "text-gray-400 text-sm"}>Search for a stock ticker above to get started.</p>
                <p className={dark ? "text-gray-600 text-xs mt-2" : "text-gray-300 text-xs mt-2"}>Try AAPL · TSLA · GOOGL · MSFT · RELIANCE.NS</p>
              </div>
            )}
            {loading && <div className="text-center py-24"><p className="text-gray-400 text-sm">Loading...</p></div>}
            {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">{error}</div>}

            {data && !loading && (
              <div>
                <div className="mb-6 flex items-start justify-between">
                  <div>
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <h1 className={dark ? "text-2xl font-bold text-gray-100" : "text-2xl font-bold text-gray-800"}>{data.ticker}</h1>
                      <span className="text-gray-400 text-sm">{data.name}</span>
                      <span className={dark ? "text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded-full" : "text-xs text-gray-300 bg-gray-100 px-2 py-0.5 rounded-full"}>{data.currency}</span>
                    </div>
                    <div className="flex items-baseline gap-3 mt-1">
                      <span className={dark ? "text-3xl font-bold text-gray-100" : "text-3xl font-bold text-gray-900"}>{sym}{data.price}</span>
                      <span className={`text-sm font-medium ${isPositive ? "text-green-500" : "text-red-500"}`}>{isPositive ? "+" : ""}{data.change}%</span>
                    </div>
                  </div>
                  <button
                    onClick={() => isWatched ? removeFromWatchlist(ticker) : addToWatchlist(ticker, data.name)}
                    className={`text-xs px-4 py-2 rounded-lg border font-medium ${isWatched ? "bg-blue-600 text-white border-blue-600" : dark ? "border-gray-600 text-gray-300 hover:border-blue-500" : "border-gray-200 text-gray-500 hover:border-blue-400"}`}
                  >
                    {isWatched ? "Saved" : "Add to watchlist"}
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                  <MetricCard label="Market Cap" value={formatMarketCap(data.marketCap, data.currency)} dark={dark} />
                  <MetricCard label="P/E Ratio" value={data.pe || "\u2014"} dark={dark} />
                  <MetricCard label="52W High" value={data.high52 ? `${sym}${data.high52}` : "\u2014"} dark={dark} />
                  <MetricCard label="52W Low"  value={data.low52  ? `${sym}${data.low52}`  : "\u2014"} dark={dark} />
                </div>

                {/* Tab bar */}
                <div className="flex gap-1 mb-4">
                  {[["chart","Chart"],["financials","Financials"],["news","News"]].map(([t, label]) => (
                    <button key={t} onClick={() => { setActiveTab(t); if (t === "financials") loadFinancials() }}
                      className={`text-sm px-4 py-2 rounded-lg font-medium ${activeTab === t ? "bg-blue-600 text-white" : dark ? "text-gray-400 hover:text-gray-200" : "text-gray-500 hover:text-gray-800"}`}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* Chart tab */}
                {activeTab === "chart" && (
                  <div className={cardBg + " mb-6"}>
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                      <div className="flex gap-1">
                        {PERIODS.map(p => (
                          <button key={p} onClick={() => changePeriod(p)}
                            className={`text-xs px-3 py-1.5 rounded-full font-medium ${period === p ? "bg-blue-600 text-white" : dark ? "bg-gray-700 text-gray-400 hover:bg-gray-600" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                            {PERIOD_LABELS[p]}
                          </button>
                        ))}
                      </div>
                      <div className={dark ? "flex rounded-lg overflow-hidden border border-gray-600 ml-auto" : "flex rounded-lg overflow-hidden border border-gray-200 ml-auto"}>
                        {["line","candle"].map(t => (
                          <button key={t} onClick={() => setChartType(t)}
                            className={`text-xs px-3 py-1.5 font-medium ${chartType === t ? "bg-blue-600 text-white" : dark ? "bg-gray-700 text-gray-400" : "bg-white text-gray-500"}`}>
                            {t === "line" ? "Line" : "Candle"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap mb-4">
                      {[{ key: "ma50", label: "MA50", color: "#f59e0b" },{ key: "bb", label: "Bollinger", color: "#8b5cf6" },{ key: "rsi", label: "RSI", color: "#06b6d4" },{ key: "macd", label: "MACD", color: "#10b981" }].map(ind => (
                        <button key={ind.key} onClick={() => toggleIndicator(ind.key)}
                          className={`text-xs px-3 py-1 rounded-full border font-medium ${indicators[ind.key] ? "text-white border-transparent" : dark ? "bg-transparent border-gray-600 text-gray-400" : "bg-transparent border-gray-200 text-gray-400"}`}
                          style={indicators[ind.key] ? { background: ind.color, borderColor: ind.color } : {}}>
                          {ind.label}
                        </button>
                      ))}
                    </div>
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={histData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: axisColor }} tickLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 11, fill: axisColor }} tickLine={false} axisLine={false} tickFormatter={v => `${sym}${v}`} domain={["auto","auto"]} />
                        <Tooltip formatter={(val, name) => {
                          const labels = { close: "Price", ma50: "MA50", bb_upper: "BB Upper", bb_lower: "BB Lower", bb_mid: "BB Mid" }
                          return [`${sym}${val}`, labels[name] || name]
                        }} contentStyle={tooltipStyle} />
                        {chartType === "line" && <Line type="monotone" dataKey="close" stroke="#2563eb" dot={false} strokeWidth={2} />}
                        {chartType === "candle" && <Bar dataKey="close" shape={<CandlestickBar />} isAnimationActive={false}>{histData.map((e, i) => <Cell key={i} fill={e.close >= e.open ? "#22c55e" : "#ef4444"} />)}</Bar>}
                        {indicators.ma50 && <Line type="monotone" dataKey="ma50" stroke="#f59e0b" dot={false} strokeWidth={1.5} strokeDasharray="4 4" />}
                        {indicators.bb && <Line type="monotone" dataKey="bb_upper" stroke="#8b5cf6" dot={false} strokeWidth={1} strokeDasharray="3 3" />}
                        {indicators.bb && <Line type="monotone" dataKey="bb_lower" stroke="#8b5cf6" dot={false} strokeWidth={1} strokeDasharray="3 3" />}
                        {indicators.bb && <Line type="monotone" dataKey="bb_mid" stroke="#8b5cf6" dot={false} strokeWidth={1} opacity={0.5} />}
                      </ComposedChart>
                    </ResponsiveContainer>
                    {indicators.rsi && (
                      <div className="mt-4">
                        <p className="text-xs text-gray-400 mb-2">RSI (14)</p>
                        <ResponsiveContainer width="100%" height={100}>
                          <ComposedChart data={histData}>
                            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: axisColor }} tickLine={false} interval="preserveStartEnd" />
                            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: axisColor }} tickLine={false} axisLine={false} />
                            <Tooltip contentStyle={tooltipStyle} formatter={v => [v?.toFixed(2), "RSI"]} />
                            <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1} />
                            <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="3 3" strokeWidth={1} />
                            <Line type="monotone" dataKey="rsi" stroke="#06b6d4" dot={false} strokeWidth={1.5} />
                          </ComposedChart>
                        </ResponsiveContainer>
                        <div className="flex gap-4 mt-1"><span className="text-xs text-red-400">Overbought &gt; 70</span><span className="text-xs text-green-400">Oversold &lt; 30</span></div>
                      </div>
                    )}
                    {indicators.macd && (
                      <div className="mt-4">
                        <p className="text-xs text-gray-400 mb-2">MACD (12, 26, 9)</p>
                        <ResponsiveContainer width="100%" height={100}>
                          <ComposedChart data={histData}>
                            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: axisColor }} tickLine={false} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10, fill: axisColor }} tickLine={false} axisLine={false} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [v?.toFixed(4), name === "macd" ? "MACD" : name === "macd_signal" ? "Signal" : "Histogram"]} />
                            <ReferenceLine y={0} stroke={axisColor} strokeWidth={0.5} />
                            <Bar dataKey="macd_hist" isAnimationActive={false}>{histData.map((e, i) => <Cell key={i} fill={(e.macd_hist || 0) >= 0 ? "#22c55e" : "#ef4444"} />)}</Bar>
                            <Line type="monotone" dataKey="macd" stroke="#10b981" dot={false} strokeWidth={1.5} />
                            <Line type="monotone" dataKey="macd_signal" stroke="#f59e0b" dot={false} strokeWidth={1.5} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                )}

                {/* Financials tab */}
                {activeTab === "financials" && (
                  <div className={cardBg + " mb-6"}>
                    {!financials ? (
                      <p className="text-gray-400 text-sm">Loading financials...</p>
                    ) : financials.income.length === 0 ? (
                      <p className="text-gray-400 text-sm">No financial data available for this ticker.</p>
                    ) : (
                      <div>
                        <p className={dark ? "text-sm font-medium text-gray-300 mb-4" : "text-sm font-medium text-gray-600 mb-4"}>Income statement</p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className={dark ? "border-b border-gray-700" : "border-b border-gray-100"}>
                                <th className="text-left py-2 text-xs text-gray-400 font-medium">Metric</th>
                                {Object.keys(financials.income[0] || {}).filter(k => k !== "metric").map(k => (
                                  <th key={k} className="text-right py-2 text-xs text-gray-400 font-medium">{k}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {financials.income.filter(row => KEY_FINANCIALS.some(k => row.metric?.includes(k))).map((row, i) => (
                                <tr key={i} className={dark ? "border-b border-gray-700" : "border-b border-gray-50"}>
                                  <td className={dark ? "py-2.5 text-xs text-gray-300" : "py-2.5 text-xs text-gray-600"}>{row.metric}</td>
                                  {Object.entries(row).filter(([k]) => k !== "metric").map(([k, v]) => (
                                    <td key={k} className={dark ? "py-2.5 text-xs text-right text-gray-200" : "py-2.5 text-xs text-right text-gray-800"}>
                                      {v != null ? formatLargeNum(v) : "\u2014"}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* News tab */}
                {activeTab === "news" && news.length > 0 && (
                  <div className={cardBg}>
                    <div className="space-y-3">
                      {news.map((item, i) => (
                        <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                          className={dark ? "block p-3 rounded-lg hover:bg-gray-700 transition-colors" : "block p-3 rounded-lg hover:bg-gray-50 transition-colors"}>
                          <p className={dark ? "text-sm text-gray-200 font-medium leading-snug mb-1" : "text-sm text-gray-800 font-medium leading-snug mb-1"}>{item.title}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">{item.source}</span>
                            {item.time && <span className="text-xs text-gray-300">· {timeAgo(item.time)}</span>}
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}