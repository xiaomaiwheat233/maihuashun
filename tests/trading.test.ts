import test from 'node:test'
import assert from 'node:assert/strict'
import { createStocks, nextDayStocks, priceLimitRate, round, tickStocks, universeMetadata, withSimulatedCharts } from '../src/core/market'
import { availableCash, availableShares, buyFee, initialAccount, matchOrders, reservedCash, standardRules, totalAssets, type Order } from '../src/core/rules'
import { parseEastQuote, parseMiaoQuotes, quoteAgeLabel, quoteIsUsable } from '../src/core/liveMarket'
import { createGameState, gameReducer, restoreGameState, serializeGameState } from '../src/core/store'
import { marketTime, markets } from '../src/core/markets'
import { maxBuyQuantity, rulesForMarket } from '../src/core/rules'

const makeOrder = (code: string, side: 'buy' | 'sell', price: number, quantity: number): Order => ({ id: `${side}-${price}`, code, side, price, quantity, status: 'pending', createdAt: '2026-10-22 09:30' })

test('immediate buy charges cash once and applies T+1', () => {
  const stocks = createStocks()
  const stock = stocks['600018']
  const order = makeOrder(stock.code, 'buy', stock.price, 100)
  const pending = { ...initialAccount(), orders: [order] }
  const filled = standardRules.execute(pending, order, stock, '2026-10-22 09:30')
  assert.equal(filled.orders[0].status, 'filled')
  assert.equal(filled.cash, 100000 - stock.price * 100 - buyFee(stock.price * 100))
  assert.equal(filled.holdings[stock.code].quantity, 100)
  assert.equal(availableShares(filled, stock.code), 0)
  assert.equal(matchOrders(filled, stocks, '2026-10-22 09:31').cash, filled.cash)
  assert.equal(totalAssets(filled, stocks), 100000 - buyFee(stock.price * 100))
  assert.equal(standardRules.validate(filled, stock, 'sell', stock.price, 100), '可卖数量不足（当日买入次日可卖）')
  const tomorrow = nextDayStocks(stocks, '2026-10-23')
  const carried = { ...filled, holdings: { [stock.code]: { ...filled.holdings[stock.code], todayBought: 0 } } }
  assert.equal(availableShares(carried, stock.code), 100)
  assert.ok(tomorrow[stock.code].prevClose === stock.price)
})

test('pending orders reserve resources and fill only when crossing quote', () => {
  const stocks = createStocks()
  const stock = stocks['600018']
  const low = Math.round((stock.price - .01) * 100) / 100
  const order = makeOrder(stock.code, 'buy', low, 100)
  const account = { ...initialAccount(), orders: [order] }
  assert.equal(reservedCash(account), low * 100 + 5)
  assert.equal(availableCash(account), 100000 - reservedCash(account))
  assert.equal(matchOrders(account, stocks, '2026-10-22 09:31').orders[0].status, 'pending')
  const crossing = { ...stocks, [stock.code]: { ...stock, price: low } }
  const filled = matchOrders(account, crossing, '2026-10-22 09:32')
  assert.equal(filled.orders[0].status, 'filled')
  assert.equal(reservedCash(filled), 0)
  assert.equal(matchOrders(filled, crossing, '2026-10-22 09:33').cash, filled.cash)
})

test('shared quote and daily candle close remain aligned', () => {
  const stocks = tickStocks(createStocks(), 1, '2026-10-22')
  assert.equal(Object.keys(stocks).length, universeMetadata.count)
  assert.ok(universeMetadata.count > 5000)
  for (const code of ['600519', '300750', '688981', '920001']) {
    const stock = stocks[code]
    const chart = withSimulatedCharts(stock, '2026-10-22', 1)
    const candle = chart.history.at(-1)!
    assert.equal(candle.close, stock.price)
    assert.equal(candle.volume, stock.volume)
    assert.equal(chart.intraday.at(-1)!.value, stock.price)
  }
  let sampled = { '600519': createStocks()['600519'] }
  for (let minute = 1; minute <= 30; minute++) sampled = tickStocks(sampled, minute, '2026-10-22')
  assert.equal(withSimulatedCharts(sampled['600519'], '2026-10-22', 30).intraday.at(-1)!.value, sampled['600519'].price)
  assert.equal(priceLimitRate(stocks['920001']), .3)
  assert.equal(priceLimitRate(stocks['300750']), .2)
})

test('Miao quote mapping keeps stock and index separate and respects quote time', () => {
  const sample = (symbol: string, name: string, price: number) => ({ symbol, code: symbol.slice(2), name, price, prevClose: price - 1, open: price - .5, high: price + .5, low: price - .8, volume: 123400, amount: 4567000, turnoverRate: .34, time: '2026-10-22 14:59:00' })
  const batch = parseMiaoQuotes({ code: 200, data: { quotes: [sample('sz000001', '平安银行', 11.3), sample('sh000001', '上证指数', 3268.46)] } }, '2026-10-22T07:00:00Z')
  assert.equal(batch.stocks['000001'].name, '平安银行')
  assert.equal(batch.indexes.sh000001.name, '上证指数')
  assert.equal(batch.stocks['000001'].turnoverRate, .34)
  assert.equal(quoteIsUsable(batch.stocks['000001'], Date.parse('2026-10-22T15:10:00+08:00')), true)
  assert.equal(quoteIsUsable(batch.stocks['000001'], Date.parse('2026-10-22T16:00:00+08:00')), false)
  assert.equal(quoteAgeLabel('2026-10-21 15:00:00', '2026-10-22'), '2026-10-21 历史行情')
})

test('Eastmoney price, volume and timestamp units map correctly', () => {
  const stock = parseEastQuote({ f43: 131849, f44: 132200, f45: 129600, f46: 130321, f47: 42491, f48: 5576216948, f57: '600519', f58: '贵州茅台', f60: 130969, f86: 1792656720, f168: 34 })
  assert.equal(stock.price, 1318.49)
  assert.equal(stock.volume, 4249100)
  assert.equal(stock.turnoverRate, .34)
  assert.equal(stock.source, 'eastmoney')
})

test('quote refresh changes valuation without changing cash, shares or fills', () => {
  const sample = (price: number) => parseMiaoQuotes({ code: 200, data: { quotes: [{ symbol: 'sh600519', code: '600519', name: '贵州茅台', price, prevClose: 100, open: 100, high: price, low: 99, volume: 10000, amount: price * 10000, turnoverRate: .1, time: '2026-10-22 14:59:00' }] } }, '2026-10-22T07:00:00Z')
  const initial = createGameState()
  const holding = { code: '600519', quantity: 100, todayBought: 0, cost: 100 }
  initial.liveAccount = { ...initial.liveAccount, cash: 90000, holdings: { '600519': holding } }
  const live = gameReducer(initial, { type: 'liveQuotes', batch: sample(100), activate: true })
  const updated = gameReducer(live, { type: 'liveQuotes', batch: sample(110) })
  assert.equal(updated.account.cash, 90000)
  assert.equal(updated.account.holdings['600519'].quantity, 100)
  assert.equal(updated.account.orders.length, 0)
  assert.equal(totalAssets(updated.account, updated.stocks), totalAssets(live.account, live.stocks) + 1000)
  const offline = gameReducer(updated, { type: 'offlineMode' })
  assert.equal(offline.account.cash, 100000)
  assert.equal(offline.mode, 'offline')
})

test('market switch isolates quotes, account, favorites and time', () => {
  let state = createGameState()
  const aCash = state.account.cash
  state = gameReducer(state, { type: 'switchMarket', market: 'hk' })
  assert.equal(state.market, 'hk')
  assert.equal(state.account.market, 'hk')
  assert.ok(state.stocks['00700'])
  assert.equal(state.stocks['600519'], undefined)
  const hkStock = state.stocks['00700']
  state = gameReducer(state, { type: 'order', code: '00700', side: 'buy', price: hkStock.price, quantity: hkStock.lotSize || 100 })
  assert.equal(state.account.orders[0].status, 'filled')
  const hkCash = state.account.cash
  state = gameReducer(state, { type: 'tick' })
  state = gameReducer(state, { type: 'switchMarket', market: 'us' })
  assert.equal(state.minute, 0)
  assert.equal(state.account.cash, 100000)
  assert.ok(state.stocks.AAPL)
  state = gameReducer(state, { type: 'switchMarket', market: 'cn' })
  assert.equal(state.account.cash, aCash)
  assert.equal(state.account.orders.length, 0)
  state = gameReducer(state, { type: 'switchMarket', market: 'hk' })
  assert.equal(state.account.cash, hkCash)
  assert.equal(state.account.holdings['00700'].quantity, hkStock.lotSize)
  assert.equal(state.minute, 1)
})

test('HK and US simulation use their own colors, lots, fees and same-day selling', () => {
  const hk = createStocks('hk')['01810']
  const us = createStocks('us').AAPL
  assert.equal(markets.cn.rising, '#df3034')
  assert.equal(markets.hk.rising, markets.us.rising)
  assert.notEqual(markets.hk.rising, markets.cn.rising)
  assert.equal(marketTime('cn', 120), '13:00')
  assert.equal(marketTime('hk', 150), '13:00')
  assert.equal(marketTime('us', 390), '16:00')
  assert.equal(rulesForMarket('hk').validate(initialAccount('hk'), hk, 'buy', hk.price, 100), '委托数量须为 200 股的整数倍')
  assert.equal(rulesForMarket('us').validate(initialAccount('us'), us, 'buy', us.price, 1), null)
  const usOrder = makeOrder(us.code, 'buy', us.price, 1)
  const bought = rulesForMarket('us').execute({ ...initialAccount('us'), orders: [usOrder] }, usOrder, us, '2026-11-17 09:31')
  assert.equal(availableShares(bought, us.code), 1)
  assert.equal(bought.cash, round(100000 - us.price))
  assert.equal(maxBuyQuantity(initialAccount('us'), us, us.price), Math.floor(100000 / us.price))
})

test('all market accounts and active market survive local save and restore', () => {
  let state = createGameState()
  state = gameReducer(state, { type: 'switchMarket', market: 'us' })
  const stock = state.stocks.AAPL
  state = gameReducer(state, { type: 'order', code: stock.code, side: 'buy', price: stock.price, quantity: 1 })
  state = gameReducer(state, { type: 'favorite', code: 'MSFT' })
  state = gameReducer(state, { type: 'tick' })
  const restored = restoreGameState(JSON.parse(serializeGameState(state)))
  assert.equal(restored.market, 'us')
  assert.equal(restored.account.cash, state.account.cash)
  assert.equal(restored.account.holdings.AAPL.quantity, 1)
  assert.equal(restored.minute, 1)
  assert.equal(restored.favorites.includes('MSFT'), false)
  assert.equal(restored.pockets.cn.account.cash, 100000)
  assert.equal(restored.pockets.hk.account.cash, 100000)
  assert.equal(restored.stocks.AAPL.price, state.stocks.AAPL.price)
})

test('previous single-market save migrates its A-share account', () => {
  const old = createGameState()
  const account = { ...old.account, cash: 81234 }
  const migrated = restoreGameState({ mode: 'offline', date: old.date, minute: 12, running: false,
    offlineAccount: account, offlineFavorites: ['600519'], quotes: { '600519': [100, 101, 99, 102, 98, 1000, 101000] } })
  assert.equal(migrated.market, 'cn')
  assert.equal(migrated.account.cash, 81234)
  assert.equal(migrated.account.market, 'cn')
  assert.equal(migrated.minute, 12)
  assert.equal(migrated.stocks['600519'].price, 101)
  assert.equal(migrated.pockets.hk.account.cash, 100000)
})
