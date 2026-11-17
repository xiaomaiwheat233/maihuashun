/// <reference types="vite/client" />
import { round, type Candle, type Stock } from './market'

export type MarketSource = 'miao' | 'eastmoney'
export type LiveStock = Stock & { source: MarketSource; quoteTime: string; turnoverRate: number | null; real: true }
export type SearchHit = { code: string; name: string; symbol: string }
export type QuoteBatch = { stocks: Record<string, LiveStock>; indexes: Record<string, LiveStock>; fetchedAt: string; source: MarketSource }
export interface MarketAdapter {
  id: MarketSource
  quotes(symbols: string[]): Promise<QuoteBatch>
  search(query: string): Promise<SearchHit[]>
  history?(code: string, period: 'day' | 'week' | 'month'): Promise<Candle[]>
}

export const seedSymbols = ['sh600519', 'sz000001', 'sh601318', 'sz300750', 'sh600036', 'sz002594', 'sh688981']
export const indexSymbols = ['sh000001', 'sz399001', 'sz399006']
export const indexCodes = new Set(indexSymbols)
const cacheKey = 'market-playground-live-cache-v1'
const requestCache = new Map<string, { at: number; value: unknown }>()
const inflight = new Map<string, Promise<unknown>>()

export function shanghaiDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now) }
export function quoteAgeLabel(time: string, today = shanghaiDate()) {
  if (!time) return '时间未知'
  return time.slice(0, 10) === today ? '当日行情' : `${time.slice(0, 10)} 历史行情`
}
export function quoteIsUsable(stock: LiveStock, now = Date.now()) {
  const ms = Date.parse(stock.quoteTime.replace(' ', 'T') + '+08:00')
  return Number.isFinite(ms) && ms <= now + 5 * 60_000 && now - ms <= 30 * 60_000 && stock.quoteTime.slice(0, 10) === shanghaiDate(new Date(now))
}
function errorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'TimeoutError') return '行情请求超时'
  if (error instanceof TypeError) return '网络或跨域请求失败'
  return error instanceof Error ? error.message : '行情请求失败'
}
export function describeMarketError(error: unknown) { return errorMessage(error) }

async function getJson<T>(url: string, ttl: number): Promise<T> {
  const saved = requestCache.get(url)
  if (saved && Date.now() - saved.at < ttl) return saved.value as T
  const ongoing = inflight.get(url)
  if (ongoing) return ongoing as Promise<T>
  const job = (async () => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
      if (response.status === 429) throw new Error('接口额度已用尽或请求过于频繁')
      if (!response.ok) throw new Error(`行情接口 HTTP ${response.status}`)
      const data = await response.json() as T
      requestCache.set(url, { at: Date.now(), value: data })
      return data
    } finally { inflight.delete(url) }
  })()
  inflight.set(url, job)
  return job
}

function stockFromQuote(input: { code: string; name: string; price: number; prevClose: number; open: number; high: number; low: number; volume: number; amount: number; turnoverRate: number | null; time: string }, source: MarketSource, isIndex = false): LiveStock {
  return { code: input.code, name: input.name, sector: isIndex ? '指数' : 'A股', price: input.price, prevClose: input.prevClose, open: input.open, high: input.high, low: input.low, volume: input.volume, turnover: input.amount, turnoverRate: input.turnoverRate, quoteTime: input.time, source, real: true, history: [], intraday: [] }
}
const validNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const checked = (value: unknown, field: string) => { if (!validNumber(value)) throw new Error(`行情缺少 ${field} 字段`); return value }

type MiaoQuote = { symbol: string; code: string; name: string; price: number | null; prevClose: number | null; open: number | null; high: number | null; low: number | null; volume: number | null; amount: number | null; turnoverRate?: number | null; time: string | null }
type MiaoEnvelope<T> = { code: number; message?: string; stale?: boolean; updatedAt?: string; data: T }
export function parseMiaoQuotes(payload: MiaoEnvelope<{ quotes: MiaoQuote[] }>, fetchedAt: string): QuoteBatch {
  if (payload.stale) throw new Error('Miao API 仅返回过期缓存')
  if (payload.code !== 200 || !Array.isArray(payload.data?.quotes)) throw new Error(payload.message || 'Miao API 返回无效数据')
  const stocks: Record<string, LiveStock> = {}, indexes: Record<string, LiveStock> = {}
  for (const q of payload.data.quotes) {
    if (!/^\d{6}$/.test(q.code) || !q.time || !q.name) continue
    try {
      const isIndex = indexCodes.has(q.symbol.toLowerCase())
      const item = stockFromQuote({ code: q.code, name: q.name, price: checked(q.price, '最新价'), prevClose: checked(q.prevClose, '昨收'), open: validNumber(q.open) ? q.open : 0, high: validNumber(q.high) ? q.high : 0, low: validNumber(q.low) ? q.low : 0, volume: validNumber(q.volume) ? q.volume : 0, amount: validNumber(q.amount) ? q.amount : 0, turnoverRate: validNumber(q.turnoverRate) ? q.turnoverRate : null, time: q.time }, 'miao', isIndex)
      if (isIndex) indexes[q.symbol.toLowerCase()] = item
      else stocks[q.code] = item
    } catch { /* Skip incomplete quote; never fill with invented prices. */ }
  }
  if (!Object.keys(stocks).length) throw new Error('Miao API 未返回可用 A 股行情')
  return { stocks, indexes, fetchedAt, source: 'miao' }
}

export const miaoAdapter: MarketAdapter = {
  id: 'miao',
  async quotes(symbols) {
    const unique = [...new Set(symbols)].slice(0, 30)
    const payload = await getJson<MiaoEnvelope<{ quotes: MiaoQuote[] }>>(`https://api.miao.club/api/stock/quote?symbols=${encodeURIComponent(unique.join(','))}`, 15 * 60_000)
    return parseMiaoQuotes(payload, new Date().toISOString())
  },
  async search(query) {
    const payload = await getJson<MiaoEnvelope<unknown>>(`https://api.miao.club/api/stock/search?q=${encodeURIComponent(query)}`, 60 * 60_000)
    if (payload.code !== 200) throw new Error(payload.message || '搜索接口异常')
    const entries = Array.isArray(payload.data) ? payload.data : typeof payload.data === 'object' && payload.data !== null ? Object.values(payload.data).find(Array.isArray) : null
    if (!Array.isArray(entries)) throw new Error('搜索接口字段格式不符')
    return entries.filter((x): x is SearchHit & { market: string } => !!x && typeof x === 'object' && typeof x.code === 'string' && typeof x.name === 'string' && typeof x.symbol === 'string' && /^(sh|sz|bj)$/i.test(x.market)).slice(0, 30).map(x => ({ code: x.code, name: x.name, symbol: x.symbol }))
  },
}

// Disabled by default: the site's quote API is publicly reachable, but its terms require authorization for redistribution.
function secid(code: string, symbol?: string) { return `${symbol ? symbol.startsWith('sh') ? 1 : 0 : code.startsWith('6') || code.startsWith('9') ? 1 : 0}.${code}` }
type EastQuote = { f43: number; f44: number; f45: number; f46: number; f47: number; f48: number; f57: string; f58: string; f60: number; f86: number; f168: number }
export function parseEastQuote(data: EastQuote, isIndex = false): LiveStock {
  const time = new Date(data.f86 * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false })
  return stockFromQuote({ code: data.f57, name: data.f58, price: round(data.f43 / 100), prevClose: round(data.f60 / 100), open: round(data.f46 / 100), high: round(data.f44 / 100), low: round(data.f45 / 100), volume: data.f47 * 100, amount: data.f48, turnoverRate: data.f168 / 100, time }, 'eastmoney', isIndex)
}
export const eastmoneyAdapter: MarketAdapter = {
  id: 'eastmoney',
  async quotes(symbols) {
    const stocks: Record<string, LiveStock> = {}, indexes: Record<string, LiveStock> = {}
    for (const symbol of [...new Set(symbols)].slice(0, 30)) {
      const code = symbol.slice(2)
      const payload = await getJson<{ rc: number; data: EastQuote | null }>(`https://push2.eastmoney.com/api/qt/stock/get?secid=${secid(code, symbol)}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f86,f168`, 15 * 60_000)
      if (payload.rc !== 0 || !payload.data) continue
      const isIndex = indexCodes.has(symbol)
      const item = parseEastQuote(payload.data, isIndex)
      if (isIndex) indexes[symbol] = item
      else stocks[code] = item
    }
    if (!Object.keys(stocks).length) throw new Error('东方财富未返回可用行情')
    return { stocks, indexes, fetchedAt: new Date().toISOString(), source: 'eastmoney' }
  },
  async search(query) { return /^\d{6}$/.test(query) ? [{ code: query, name: query, symbol: `${query.startsWith('6') ? 'sh' : 'sz'}${query}` }] : [] },
  async history(code, period) {
    const klt = period === 'day' ? 101 : period === 'week' ? 102 : 103
    const payload = await getJson<{ rc: number; data: { klines?: string[] } | null }>(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid(code)}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=${klt}&fqt=0&end=20500101&lmt=120`, 60 * 60_000)
    return payload.data?.klines?.map(row => { const [time, open, close, high, low, volume] = row.split(','); return { time, open: Number(open), close: Number(close), high: Number(high), low: Number(low), volume: Number(volume) * 100 } }) ?? []
  },
}

export const authorizedEastmoney = import.meta.env?.VITE_ENABLE_EASTMONEY === 'true'
export const activeAdapter = authorizedEastmoney ? eastmoneyAdapter : miaoAdapter
export function saveQuoteCache(batch: QuoteBatch) { try { localStorage.setItem(cacheKey, JSON.stringify(batch)) } catch { /* Storage may be unavailable. */ } }
export function loadQuoteCache(): QuoteBatch | null {
  try { const data = JSON.parse(localStorage.getItem(cacheKey) || 'null') as QuoteBatch | null; return data?.stocks && data.fetchedAt && data.source === activeAdapter.id ? data : null } catch { return null }
}
