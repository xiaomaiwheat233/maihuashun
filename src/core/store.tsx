import { createContext, useCallback, useContext, useEffect, useReducer, type ReactNode } from 'react'
import { createStocks, nextDayStocks, tickStocks, type Candle, type Stock } from './market'
import { marketTime, markets, type MarketId } from './markets'
import { activeAdapter, describeMarketError, indexSymbols, loadQuoteCache, quoteIsUsable, saveQuoteCache, seedSymbols, type LiveStock, type QuoteBatch, type SearchHit } from './liveMarket'
import { initialAccount, matchOrders, rulesForMarket, totalAssets, type Account, type Side } from './rules'

export type Mode = 'offline' | 'live'
export type MarketPocket = { stocks: Record<string, Stock>; account: Account; favorites: string[]; date: string; minute: number; running: boolean }
export type GameState = {
  stocks: Record<string, Stock>; account: Account; favorites: string[]; date: string; minute: number; running: boolean; toast: string | null
  market: MarketId; pockets: Record<MarketId, MarketPocket>
  mode: Mode; offlineStocks: Record<string, Stock>; liveStocks: Record<string, LiveStock>; offlineAccount: Account; liveAccount: Account
  offlineFavorites: string[]; liveFavorites: string[]; indexes: Record<string, LiveStock>; marketError: string | null; marketFetching: boolean; autoLive: boolean; lastFetch: string | null
}
type Action = { type: 'tick' } | { type: 'nextDay' } | { type: 'toggleRunning' } | { type: 'switchMarket'; market: MarketId } | { type: 'favorite'; code: string } | { type: 'order'; code: string; side: Side; price: number; quantity: number } | { type: 'cancel'; id: string } | { type: 'reset' } | { type: 'clearToast' } | { type: 'marketLoading' } | { type: 'marketError'; error: string } | { type: 'liveQuotes'; batch: QuoteBatch; activate?: boolean } | { type: 'liveHistory'; code: string; candles: Candle[] } | { type: 'offlineMode' }
const key = 'market-playground-v4'
const previousKey = 'market-playground-v3'
const olderKey = 'market-playground-v2'
const oldKey = 'market-playground-v1'
const defaultLiveFavorites = ['600519', '000001', '601318', '300750']
const pocket = (market: MarketId, favorites: string[]): MarketPocket => ({ stocks: createStocks(market), account: initialAccount(market), favorites, date: '2026-11-17', minute: 0, running: true })
const fresh = (): GameState => {
  const pockets = { cn: pocket('cn', ['600519', '300750', '688981', '000001']), hk: pocket('hk', ['00700', '09988', '01810', '00388']), us: pocket('us', ['AAPL', 'MSFT', 'NVDA', 'TSLA']) }
  const current = pockets.cn
  return { ...current, market: 'cn', pockets, toast: null, mode: 'offline', offlineStocks: current.stocks, liveStocks: {}, offlineAccount: current.account, liveAccount: initialAccount(), offlineFavorites: current.favorites, liveFavorites: defaultLiveFavorites, indexes: {}, marketError: null, marketFetching: false, autoLive: false, lastFetch: null }
}

type StoredPocket = Omit<MarketPocket, 'stocks'> & { quotes: Record<string, number[]> }
type Stored = Partial<GameState> & { quotes?: Record<string, number[]>; savedPockets?: Partial<Record<MarketId, StoredPocket>> }
function restoreQuotes(stocks: Record<string, Stock>, quotes?: Record<string, number[]>) {
  const result = { ...stocks }
  if (quotes) for (const [code, quote] of Object.entries(quotes)) {
    const stock = result[code]
    if (stock && quote.length === 7 && quote.every(Number.isFinite)) result[code] = { ...stock, prevClose: quote[0], price: quote[1], open: quote[2], high: quote[3], low: quote[4], volume: quote[5], turnover: quote[6] }
  }
  return result
}
function activePocket(state: GameState): MarketPocket { return { stocks: state.stocks, account: state.account, favorites: state.favorites, date: state.date, minute: state.minute, running: state.running } }
function syncPocket(state: GameState): GameState {
  if (state.mode !== 'offline') return state
  const pockets = { ...state.pockets, [state.market]: activePocket(state) }
  return { ...state, pockets, offlineStocks: state.stocks, offlineAccount: state.account, offlineFavorites: state.favorites }
}
function restore(value: Stored): GameState {
  const base = fresh()
  const pockets = Object.fromEntries((['cn', 'hk', 'us'] as MarketId[]).map(market => {
    const saved = value.savedPockets?.[market]
    const legacy = market === 'cn' && !saved
    const original = base.pockets[market]
    const stocks = restoreQuotes(original.stocks, saved?.quotes || (legacy ? value.quotes : undefined))
    const rawAccount = saved?.account?.orders ? saved.account : legacy ? value.offlineAccount?.orders ? value.offlineAccount : value.account?.orders ? value.account : original.account : original.account
    const account = { ...rawAccount, market }
    const favorites = (saved?.favorites || (legacy ? value.offlineFavorites || value.favorites : undefined) || original.favorites).filter(code => !!stocks[code])
    return [market, { stocks, account, favorites, date: saved?.date || (legacy && value.quotes ? value.date : undefined) || original.date, minute: saved?.minute ?? (legacy && value.quotes ? value.minute : undefined) ?? 0, running: saved?.running ?? (legacy ? value.running : undefined) ?? true }]
  })) as Record<MarketId, MarketPocket>
  const cache = loadQuoteCache()
  const liveStocks = cache?.stocks || value.liveStocks || {}
  const liveAccount = value.liveAccount?.orders ? { ...value.liveAccount, market: 'cn' as const } : base.liveAccount
  const liveFavorites = value.liveFavorites || base.liveFavorites
  const market: MarketId = value.savedPockets && (value.market === 'hk' || value.market === 'us') ? value.market : 'cn'
  const current = pockets[market]
  return { ...base, ...current, market, pockets,
    offlineStocks: current.stocks, liveStocks, offlineAccount: current.account, liveAccount, offlineFavorites: current.favorites, liveFavorites,
    mode: 'offline', indexes: cache?.indexes || value.indexes || {},
    lastFetch: cache?.fetchedAt || value.lastFetch || null }
}
export const restoreGameState = restore

function load(): GameState {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null') as Stored | null
    if (value?.mode) return restore(value)
    const previous = JSON.parse(localStorage.getItem(previousKey) || 'null') as Stored | null
    if (previous?.mode) return restore(previous)
    const older = JSON.parse(localStorage.getItem(olderKey) || 'null') as Stored | null
    if (older?.mode) return restore(older)
    const old = JSON.parse(localStorage.getItem(oldKey) || 'null') as Partial<GameState> | null
    if (old?.account?.orders) return restore(old)
  } catch { /* Ignore invalid browser data. */ }
  return fresh()
}
function timestamp(state: GameState) { return state.mode === 'live' ? new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }) : `${state.date} ${marketTime(state.market, state.minute)}` }
function nextBusinessDay(date: string): string { const d = new Date(`${date}T12:00:00+08:00`); do { d.setUTCDate(d.getUTCDate() + 1) } while (d.getUTCDay() === 0 || d.getUTCDay() === 6); return d.toISOString().slice(0, 10) }

export function serializeGameState(state: GameState): string {
  const savedPockets = Object.fromEntries((['cn', 'hk', 'us'] as MarketId[]).map(market => {
    const current = state.mode === 'offline' && state.market === market ? activePocket(state) : state.pockets[market]
    const quotes = Object.fromEntries(Object.entries(current.stocks).map(([code, stock]) =>
      [code, [stock.prevClose, stock.price, stock.open, stock.high, stock.low, stock.volume, stock.turnover]]))
    return [market, { account: current.account, favorites: current.favorites, date: current.date, minute: current.minute, running: current.running, quotes }]
  }))
  return JSON.stringify({ mode: state.mode, market: state.market, savedPockets,
    liveAccount: state.liveAccount, liveFavorites: state.liveFavorites, lastFetch: state.lastFetch })
}

function combineLive(old: Record<string, LiveStock>, incoming: Record<string, LiveStock>) {
  return Object.fromEntries(Object.entries(incoming).map(([code, stock]) => {
    const previous = old[code]
    const intraday = previous?.quoteTime?.slice(0, 10) === stock.quoteTime.slice(0, 10) ? previous.intraday : []
    const point = { time: stock.quoteTime.slice(11, 16), value: stock.price, volume: stock.volume }
    return [code, { ...stock, history: previous?.history || [], intraday: intraday[intraday.length - 1]?.time === point.time ? intraday : [...intraday.slice(-239), point] }]
  })) as Record<string, LiveStock>
}

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'tick': {
      if (state.mode !== 'offline' || !state.running) return state
      if (state.minute >= markets[state.market].minutes - 1) return syncPocket({ ...state, running: false, toast: '今日模拟交易已收盘，可进入下一交易日' })
      const stocks = tickStocks(state.stocks, state.minute + 1, state.date)
      const account = matchOrders(state.account, stocks, timestamp({ ...state, minute: state.minute + 1 }))
      return syncPocket({ ...state, stocks, account, minute: state.minute + 1 })
    }
    case 'nextDay': {
      if (state.mode !== 'offline') return state
      const date = nextBusinessDay(state.date), dayStartAssets = totalAssets(state.account, state.stocks)
      const holdings = Object.fromEntries(Object.entries(state.account.holdings).map(([code, h]) => [code, { ...h, todayBought: 0 }]))
      const stocks = nextDayStocks(state.stocks, date)
      const account = matchOrders({ ...state.account, holdings, dayStartAssets }, stocks, `${date} 09:30`)
      return syncPocket({ ...state, date, minute: 0, stocks, account, running: true, toast: `已进入 ${date} 交易日` })
    }
    case 'toggleRunning': return state.mode === 'offline' ? syncPocket({ ...state, running: !state.running, toast: state.running ? '模拟行情已暂停' : '模拟行情已恢复' }) : state
    case 'switchMarket': {
      if (action.market === state.market && state.mode === 'offline') return state
      const pockets = state.mode === 'offline' ? { ...state.pockets, [state.market]: activePocket(state) } : state.pockets
      const current = pockets[action.market]
      return { ...state, ...current, pockets, market: action.market, mode: 'offline', offlineStocks: current.stocks, offlineAccount: current.account, offlineFavorites: current.favorites, autoLive: false, toast: `已切换至${markets[action.market].label}模拟市场` }
    }
    case 'favorite': { const favorites = state.favorites.includes(action.code) ? state.favorites.filter(c => c !== action.code) : [...state.favorites, action.code]; return state.mode === 'live' ? { ...state, favorites, liveFavorites: favorites, toast: state.favorites.includes(action.code) ? '已移出自选' : '已加入自选' } : syncPocket({ ...state, favorites, toast: state.favorites.includes(action.code) ? '已移出自选' : '已加入自选' }) }
    case 'order': {
      const stock = state.stocks[action.code]
      if (!stock) return { ...state, toast: '股票行情不可用' }
      if (state.mode === 'live' && (!('real' in stock) || !quoteIsUsable(stock as LiveStock))) return { ...state, toast: '行情已过期，无法按此价格模拟成交' }
      const rules = rulesForMarket(state.market)
      const error = rules.validate(state.account, stock, action.side, action.price, action.quantity)
      if (error) return { ...state, toast: error }
      const order = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, code: action.code, side: action.side, price: action.price, quantity: action.quantity, status: 'pending' as const, createdAt: timestamp(state) }
      const pending = { ...state.account, orders: [order, ...state.account.orders] }
      const account = rules.crosses(order, stock) ? rules.execute(pending, order, stock, timestamp(state)) : pending
      const next = { ...state, account, toast: account.orders[0].status === 'filled' ? `${action.side === 'buy' ? '买入' : '卖出'}模拟成交 ${action.quantity} 股` : '模拟委托已提交，等待行情触价' }
      return state.mode === 'live' ? { ...next, liveAccount: account } : syncPocket(next)
    }
    case 'cancel': { const account = { ...state.account, orders: state.account.orders.map(o => o.id === action.id && o.status === 'pending' ? { ...o, status: 'cancelled' as const } : o) }; return state.mode === 'live' ? { ...state, account, liveAccount: account, toast: '委托已撤销' } : syncPocket({ ...state, account, toast: '委托已撤销' }) }
    case 'reset': return { ...fresh(), toast: '模拟账户已重置' }
    case 'clearToast': return { ...state, toast: null }
    case 'marketLoading': return { ...state, marketFetching: true, marketError: null }
    case 'marketError': return { ...state, marketFetching: false, marketError: action.error, autoLive: false }
    case 'liveQuotes': {
      const liveStocks = combineLive(state.liveStocks, { ...state.liveStocks, ...action.batch.stocks })
      const toLive = state.mode === 'live' || state.autoLive || !!action.activate
      const freshQuotes = Object.fromEntries(Object.entries(action.batch.stocks).filter(([, stock]) => quoteIsUsable(stock)))
      const previousDate = Object.values(state.liveStocks)[0]?.quoteTime.slice(0, 10)
      const incomingDate = Object.values(action.batch.stocks)[0]?.quoteTime.slice(0, 10)
      const rolled = previousDate && incomingDate && incomingDate > previousDate
      const startingAccount = rolled ? { ...state.liveAccount, dayStartAssets: totalAssets(state.liveAccount, state.liveStocks), holdings: Object.fromEntries(Object.entries(state.liveAccount.holdings).map(([code, holding]) => [code, { ...holding, todayBought: 0 }])) } : state.liveAccount
      const account = toLive ? matchOrders(startingAccount, freshQuotes, timestamp({ ...state, mode: 'live' })) : state.account
      return { ...state, liveStocks, indexes: { ...state.indexes, ...action.batch.indexes }, lastFetch: action.batch.fetchedAt, marketFetching: false, marketError: null, autoLive: false, mode: toLive ? 'live' : state.mode, stocks: toLive ? liveStocks : state.stocks, account, liveAccount: toLive ? account : state.liveAccount, favorites: toLive ? state.liveFavorites : state.favorites, toast: state.autoLive ? '已接入真实行情；交易仍为游戏模拟' : state.toast }
    }
    case 'liveHistory': { const old = state.liveStocks[action.code]; if (!old) return state; const liveStocks = { ...state.liveStocks, [action.code]: { ...old, history: action.candles } }; return { ...state, liveStocks, stocks: state.mode === 'live' ? liveStocks : state.stocks } }
    case 'offlineMode': return { ...state, mode: 'offline', ...state.pockets[state.market], autoLive: false, toast: '已切换到离线模拟行情' }
  }
}

type GameContextValue = { state: GameState; dispatch: React.Dispatch<Action>; refreshLive: (force?: boolean) => Promise<void>; searchLive: (query: string) => Promise<SearchHit[]>; loadLiveStock: (symbol: string) => Promise<boolean>; loadLiveHistory: (code: string, period: 'day' | 'week' | 'month') => Promise<void> }
const GameContext = createContext<GameContextValue | null>(null)
export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load)
  const refreshLive = useCallback(async (force = false) => {
    if (!force && state.mode !== 'live' && !state.autoLive) return
    dispatch({ type: 'marketLoading' })
    try {
      const favorites = state.liveFavorites.map(code => `${code.startsWith('6') ? 'sh' : 'sz'}${code}`)
      const holdings = Object.keys(state.liveAccount.holdings).map(code => `${code.startsWith('6') ? 'sh' : 'sz'}${code}`)
      const symbols = [...new Set([...seedSymbols, ...favorites, ...holdings, ...indexSymbols])].slice(0, 30)
      const batch = await activeAdapter.quotes(symbols)
      saveQuoteCache(batch)
      dispatch({ type: 'liveQuotes', batch, activate: force })
    } catch (error) { dispatch({ type: 'marketError', error: describeMarketError(error) }) }
  }, [state.mode, state.autoLive, state.liveFavorites, state.liveAccount.holdings])
  const searchLive = useCallback((query: string) => activeAdapter.search(query), [])
  const loadLiveStock = useCallback(async (symbol: string) => { try { const batch = await activeAdapter.quotes([symbol]); if (!batch.stocks[symbol.slice(2)]) return false; dispatch({ type: 'liveQuotes', batch }); return true } catch (error) { dispatch({ type: 'marketError', error: describeMarketError(error) }); return false } }, [])
  const loadLiveHistory = useCallback(async (code: string, period: 'day' | 'week' | 'month') => { if (!activeAdapter.history) return; try { dispatch({ type: 'liveHistory', code, candles: await activeAdapter.history(code, period) }) } catch (error) { dispatch({ type: 'marketError', error: describeMarketError(error) }) } }, [])
  useEffect(() => {
    try { localStorage.setItem(key, serializeGameState(state)) } catch { /* Storage quota or private mode: game still runs in memory. */ }
  }, [state])
  useEffect(() => { const id = window.setInterval(() => dispatch({ type: 'tick' }), 3500); return () => window.clearInterval(id) }, [])
  useEffect(() => { if (!state.toast) return; const id = window.setTimeout(() => dispatch({ type: 'clearToast' }), 2800); return () => window.clearTimeout(id) }, [state.toast])
  useEffect(() => { if (state.autoLive) void refreshLive() }, [state.autoLive, refreshLive])
  useEffect(() => { if (state.mode !== 'live') return; const id = window.setInterval(() => { if (!document.hidden) void refreshLive() }, 15 * 60_000); return () => window.clearInterval(id) }, [state.mode, refreshLive])
  return <GameContext.Provider value={{ state, dispatch, refreshLive, searchLive, loadLiveStock, loadLiveHistory }}>{children}</GameContext.Provider>
}
export function useGame() { const value = useContext(GameContext); if (!value) throw new Error('GameProvider missing'); return value }
export const createGameState = fresh
export const gameReducer = reducer
