import universe from '../data/universe.json'
import metadata from '../data/universe-meta.json'
import { hongKongStocks, usStocks, type GlobalEntry } from '../data/global-stocks'
import { marketTime, type MarketId } from './markets'

export type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number }
export type Point = { time: string; value: number; volume: number }
export type Stock = {
  code: string; name: string; sector: string; board?: string; exchange?: string; anchorDate?: string | null; market?: MarketId; lotSize?: number
  prevClose: number; price: number; open: number; high: number; low: number; volume: number; turnover: number
  history: Candle[]; intraday: Point[]
}
export type UniverseEntry = (typeof universe)[number]
export const universeMetadata = metadata
export const stockCatalog = universe as UniverseEntry[]

export const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export const pct = (stock: Stock) => (stock.price / stock.prevClose - 1) * 100
export const change = (stock: Stock) => round(stock.price - stock.prevClose)
export const money = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const signed = (n: number, digits = 2) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}`
export function minuteToTime(minute: number) {
  return marketTime('cn', minute)
}

function hash(value: string): number {
  let result = 2166136261
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619)
  return result >>> 0
}
function unit(value: string) { return hash(value) / 4294967295 }
export function priceLimitRate(stock: Pick<Stock, 'code' | 'name' | 'board' | 'market'>) {
  if (stock.market && stock.market !== 'cn') return Infinity
  if (/^(\*?ST)/i.test(stock.name)) return .05
  if (stock.board === '北交所') return .3
  if (stock.board === '创业板' || stock.board === '科创板' || stock.code.startsWith('30') || stock.code.startsWith('68')) return .2
  return .1
}
function limitPrice(stock: Stock, price: number) {
  const limit = priceLimitRate(stock)
  if (!Number.isFinite(limit)) return price
  return round(Math.min(round(stock.prevClose * (1 + limit)), Math.max(round(stock.prevClose * (1 - limit)), price)))
}
function basePrice(entry: UniverseEntry) {
  if (entry.anchor && entry.anchor > 0) return entry.anchor
  // No licensed historical close was available: a reproducible game-only anchor.
  return round(3.5 + Math.pow(unit(entry.code + 'base'), 2) * 116)
}
function gap(code: string, date: string) { return (unit(`${code}:${date}:gap`) - .5) * .022 }
function impulse(stock: Stock, date: string, minute: number) {
  const market = Math.sin(minute * .089 + unit(date) * 6) * .00034
  const sector = Math.sin(minute * .071 + unit(`${stock.sector}:${date}`) * 9) * .00046
  const noise = (unit(`${stock.code}:${date}:${minute}`) - .5) * .0032
  return market + sector + noise
}
function volumeStep(stock: Stock, date: string, minute: number) {
  const size = stock.anchorDate ? Math.max(500, 2600 * Math.sqrt(stock.prevClose / 10)) : 1800
  const shape = 1 + .5 * Math.cos(minute / 240 * Math.PI * 2)
  return Math.round(size * shape * (.55 + unit(`${stock.code}:${date}:${minute}:volume`)) / 100) * 100
}
function tradingDates(end: string, count: number) {
  const result: string[] = []
  const date = new Date(`${end}T12:00:00+08:00`)
  while (result.length < count) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) result.unshift(date.toISOString().slice(0, 10))
    date.setUTCDate(date.getUTCDate() - 1)
  }
  return result
}

export function createStocks(market: MarketId = 'cn'): Record<string, Stock> {
  const catalog: (UniverseEntry | GlobalEntry)[] = market === 'cn' ? stockCatalog : market === 'hk' ? hongKongStocks : usStocks
  return Object.fromEntries(catalog.map(entry => {
    const prior = market === 'cn' ? basePrice(entry as UniverseEntry) : (entry as GlobalEntry).anchor
    const open = round(prior * (1 + gap(entry.code, '2026-10-22')))
    const stock: Stock = {
      code: entry.code, name: entry.name, sector: entry.sector, board: 'board' in entry ? entry.board : undefined, exchange: 'exchange' in entry ? entry.exchange : market,
      anchorDate: 'anchorDate' in entry ? entry.anchorDate : null, market, lotSize: market === 'hk' ? (entry as GlobalEntry).lotSize : market === 'cn' ? 100 : 1,
      prevClose: prior, price: open, open, high: open, low: open,
      volume: 0, turnover: 0, history: [], intraday: [],
    }
    return [stock.code, stock]
  }))
}

export function tickStocks(stocks: Record<string, Stock>, minute: number, date: string): Record<string, Stock> {
  return Object.fromEntries(Object.entries(stocks).map(([code, stock]) => {
    const price = limitPrice(stock, round(stock.price * (1 + impulse(stock, date, minute))))
    const volume = volumeStep(stock, date, minute)
    return [code, { ...stock, price, high: Math.max(stock.high, price), low: Math.min(stock.low, price),
      volume: stock.volume + volume, turnover: round(stock.turnover + price * volume) }]
  }))
}

export function nextDayStocks(stocks: Record<string, Stock>, date: string): Record<string, Stock> {
  return Object.fromEntries(Object.entries(stocks).map(([code, stock]) => {
    const open = round(stock.price * (1 + gap(code, date)))
    return [code, { ...stock, prevClose: stock.price, price: open, open, high: open, low: open, volume: 0, turnover: 0 }]
  }))
}

// Generate chart points only for the instrument being viewed. The bars are all game simulation.
export function withSimulatedCharts(stock: Stock, date: string, minute: number): Stock {
  const intraday: Point[] = [{ time: marketTime(stock.market || 'cn', 0), value: stock.open, volume: 0 }]
  let price = stock.open
  for (let i = 1; i <= minute; i++) {
    price = limitPrice(stock, round(price * (1 + impulse(stock, date, i))))
    intraday.push({ time: marketTime(stock.market || 'cn', i), value: price, volume: volumeStep(stock, date, i) })
  }
  const dates = tradingDates(date, 90)
  const history: Candle[] = []
  let prior = stock.prevClose
  for (let i = dates.length - 2; i >= 0; i--) {
    const day = dates[i]
    const drift = (unit(`${stock.code}:${day}:daily`) - .5) * .042
    const close = prior
    const open = round(close * (1 + (unit(`${stock.code}:${day}:open`) - .5) * .012))
    history.unshift({ time: day, open, high: round(Math.max(open, close) * 1.008), low: round(Math.min(open, close) * .992), close, volume: Math.round(250000 + unit(`${stock.code}:${day}:v`) * 8000000) })
    prior = round(close / (1 + drift))
  }
  history.push({ time: date, open: stock.open, high: stock.high, low: stock.low, close: stock.price, volume: stock.volume })
  return { ...stock, history, intraday }
}

export function groupedCandles(history: Candle[], period: 'day' | 'week' | 'month'): Candle[] {
  if (period === 'day') return history
  const groups = new Map<string, Candle>()
  for (const c of history) {
    const d = new Date(`${c.time}T12:00:00+08:00`)
    const key = period === 'month' ? c.time.slice(0, 7) : `${d.getUTCFullYear()}-${Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 604800000)}`
    const old = groups.get(key)
    groups.set(key, old ? { ...old, time: c.time, high: Math.max(old.high, c.high), low: Math.min(old.low, c.low), close: c.close, volume: old.volume + c.volume } : { ...c })
  }
  return [...groups.values()]
}
