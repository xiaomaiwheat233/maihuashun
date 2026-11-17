import { priceLimitRate, round, type Stock } from './market'
import type { MarketId } from './markets'

export type Side = 'buy' | 'sell'
export type OrderStatus = 'pending' | 'filled' | 'cancelled'
export type Order = { id: string; code: string; side: Side; price: number; quantity: number; status: OrderStatus; createdAt: string; filledAt?: string; fillPrice?: number; fee?: number }
export type Holding = { code: string; quantity: number; todayBought: number; cost: number }
export type Account = { market: MarketId; cash: number; initialCapital: number; holdings: Record<string, Holding>; orders: Order[]; realizedProfit: number; dayStartAssets: number }

export const initialAccount = (market: MarketId = 'cn'): Account => ({ market, cash: 100000, initialCapital: 100000, holdings: {}, orders: [], realizedProfit: 0, dayStartAssets: 100000 })
export const buyFee = (amount: number) => round(Math.max(5, amount * .0003))
export const sellFee = (amount: number) => round(Math.max(5, amount * .0003) + amount * .0005)
export const marketBuyFee = (market: MarketId, amount: number) => market === 'cn' ? buyFee(amount) : market === 'hk' ? round(Math.max(3, amount * .001)) : 0
export const marketSellFee = (market: MarketId, amount: number) => market === 'cn' ? sellFee(amount) : market === 'hk' ? round(Math.max(3, amount * .001)) : 0
export const reservedCash = (account: Account) => round(account.orders.filter(o => o.status === 'pending' && o.side === 'buy').reduce((sum, o) => sum + o.price * o.quantity + marketBuyFee(account.market || 'cn', o.price * o.quantity), 0))
export const reservedShares = (account: Account, code: string) => account.orders.filter(o => o.status === 'pending' && o.side === 'sell' && o.code === code).reduce((sum, o) => sum + o.quantity, 0)
export const availableCash = (account: Account) => round(account.cash - reservedCash(account))
export function maxBuyQuantity(account: Account, stock: Stock, price: number) {
  if (!Number.isFinite(price) || price <= 0) return 0
  const lot = account.market === 'cn' ? 100 : account.market === 'hk' ? stock.lotSize || 100 : 1
  const cash = availableCash(account)
  let quantity = Math.floor(cash / price / lot) * lot
  while (quantity > 0 && price * quantity + marketBuyFee(account.market, price * quantity) > cash) quantity -= lot
  return Math.max(0, quantity)
}
export const availableShares = (account: Account, code: string) => Math.max(0, (account.holdings[code]?.quantity ?? 0) - (account.market === 'cn' ? account.holdings[code]?.todayBought ?? 0 : 0) - reservedShares(account, code))
export const marketValue = (account: Account, stocks: Record<string, Stock>) => round(Object.values(account.holdings).reduce((sum, h) => sum + h.quantity * (stocks[h.code]?.price ?? 0), 0))
export const totalAssets = (account: Account, stocks: Record<string, Stock>) => round(account.cash + marketValue(account, stocks))

// Default A-share rule set. Future game modes can implement the same interface.
export interface TradingRules {
  validate(account: Account, stock: Stock, side: Side, price: number, quantity: number): string | null
  crosses(order: Order, stock: Stock): boolean
  execute(account: Account, order: Order, stock: Stock, at: string): Account
}

function makeRules(market: MarketId): TradingRules { return {
  validate(account, stock, side, price, quantity) {
    if (!Number.isFinite(price) || price <= 0) return '请输入有效委托价格'
    const lot = market === 'cn' ? 100 : market === 'hk' ? stock.lotSize || 100 : 1
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity % lot !== 0) return `委托数量须为 ${lot} 股的整数倍`
    if (market === 'cn') {
      const limit = priceLimitRate(stock)
      if (price < round(stock.prevClose * (1 - limit)) || price > round(stock.prevClose * (1 + limit))) return `委托价格超出今日涨跌幅限制（±${limit * 100}%）`
    }
    if (side === 'buy' && price * quantity + marketBuyFee(market, price * quantity) > availableCash(account) + .0001) return '可用资金不足'
    if (side === 'sell' && quantity > availableShares(account, stock.code)) return market === 'cn' ? '可卖数量不足（当日买入次日可卖）' : '可卖数量不足'
    return null
  },
  crosses(order, stock) { return order.side === 'buy' ? order.price >= stock.price : order.price <= stock.price },
  execute(account, order, stock, at) {
    const amount = round(stock.price * order.quantity)
    const fee = order.side === 'buy' ? marketBuyFee(market, amount) : marketSellFee(market, amount)
    const old = account.holdings[stock.code]
    let holdings = { ...account.holdings }
    let realizedProfit = account.realizedProfit
    if (order.side === 'buy') {
      const quantity = (old?.quantity ?? 0) + order.quantity
      const cost = round(((old?.cost ?? 0) * (old?.quantity ?? 0) + amount + fee) / quantity)
      holdings[stock.code] = { code: stock.code, quantity, todayBought: market === 'cn' ? (old?.todayBought ?? 0) + order.quantity : 0, cost }
    } else if (old) {
      const left = old.quantity - order.quantity
      realizedProfit = round(realizedProfit + amount - fee - old.cost * order.quantity)
      if (left === 0) delete holdings[stock.code]
      else holdings[stock.code] = { ...old, quantity: left }
    }
    return { ...account, cash: round(account.cash + (order.side === 'buy' ? -amount - fee : amount - fee)), holdings, realizedProfit, orders: account.orders.map(o => o.id === order.id ? { ...o, status: 'filled', filledAt: at, fillPrice: stock.price, fee } : o) }
  },
} }

export const standardRules = makeRules('cn')
export const hongKongRules = makeRules('hk')
export const usRules = makeRules('us')
export const rulesForMarket = (market: MarketId): TradingRules => market === 'cn' ? standardRules : market === 'hk' ? hongKongRules : usRules

export function matchOrders(account: Account, stocks: Record<string, Stock>, at: string, rules: TradingRules = rulesForMarket(account.market || 'cn')): Account {
  let current = account
  for (const order of account.orders) {
    const stock = stocks[order.code]
    if (order.status === 'pending' && stock && rules.crosses(order, stock)) current = rules.execute(current, order, stock, at)
  }
  return current
}
