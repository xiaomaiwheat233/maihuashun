import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, BarChart3, ChevronLeft, ChevronRight, Plus, Search, Star, UserRound, Wallet, X } from 'lucide-react'
import { GameProvider, useGame } from './core/store'
import { availableCash, availableShares, marketValue, maxBuyQuantity, reservedCash, rulesForMarket, totalAssets, type Side } from './core/rules'
import { change, money, pct, round, signed, universeMetadata, withSimulatedCharts, type Stock } from './core/market'
import { marketIds, markets, marketTime } from './core/markets'
import { activeAdapter, describeMarketError, quoteAgeLabel, quoteIsUsable, type LiveStock, type SearchHit } from './core/liveMarket'
import MarketChart, { type Period } from './components/MarketChart'
import ModePage from './components/ModePage'
import { colorFor, InfoPair, SearchTrigger, SectionTitle, StockRow } from './components/Common'

type Tab = 'watch' | 'market' | 'trade' | 'assets' | 'mine'
type OrderView = 'holdings' | 'pending' | 'orders' | 'fills'
const nav = [{ id: 'watch', title: '自选', icon: Star }, { id: 'market', title: '行情', icon: BarChart3 }, { id: 'trade', title: '交易', icon: ArrowUpRight }, { id: 'assets', title: '资产', icon: Wallet }, { id: 'mine', title: '我的', icon: UserRound }] as const

function AppContent() {
  const { state, dispatch } = useGame()
  const [tab, setTab] = useState<Tab>('watch')
  const [code, setCode] = useState<string | null>(null)
  const [search, setSearch] = useState(false)
  const [tradeSide, setTradeSide] = useState<Side>('buy')
  const [tradeCode, setTradeCode] = useState('600018')
  const [orderView, setOrderView] = useState<OrderView>('holdings')
  const openStock = (c: string) => { setCode(c); setSearch(false) }
  const openTrade = (c: string, side: Side) => { setCode(null); setTab('trade'); setTradeSide(side); setTradeCode(c) }
  return <div className="app-shell relative" data-market={state.market}>
    <div className="shrink-0 flex h-10 bg-white border-b hairline px-3 gap-1" aria-label="切换股票市场">{marketIds.map(market => <button key={market} onClick={() => { dispatch({ type: 'switchMarket', market }); setCode(null); setSearch(false); setTradeCode(market === 'cn' ? '600018' : market === 'hk' ? '00700' : 'AAPL') }} className={`flex-1 relative text-[13px] font-semibold ${state.market === market ? 'text-rise' : 'text-muted'}`}>{markets[market].label}{state.market === market && <span className="absolute bottom-0 left-[32%] right-[32%] h-[2px] bg-rise"/>}</button>)}</div>
    {code ? <StockDetail stock={state.stocks[code]} onBack={() => setCode(null)} onTrade={openTrade} /> : <>
      {tab === 'watch' && <WatchPage onSearch={() => setSearch(true)} onStock={openStock} />}
      {tab === 'market' && <MarketPage onSearch={() => setSearch(true)} onStock={openStock} />}
      {tab === 'trade' && <TradePage side={tradeSide} setSide={setTradeSide} code={tradeCode} setCode={setTradeCode} onStock={openStock} />}
      {tab === 'assets' && <AssetsPage view={orderView} setView={setOrderView} onStock={openStock} />}
      {tab === 'mine' && <ModePage />}
      <nav className="flex bg-white border-t hairline safe-bottom shrink-0" aria-label="主导航">{nav.map(item => <button key={item.id} onClick={() => setTab(item.id)} className={`flex-1 flex flex-col items-center gap-0.5 pt-2 tap ${tab === item.id ? 'text-rise' : 'text-[#9299a4]'}`}><item.icon size={21} strokeWidth={tab === item.id ? 2.3 : 1.9}/><span className="text-[10px]">{item.title}</span></button>)}</nav>
    </>}
    {search && <SearchOverlay onClose={() => setSearch(false)} onStock={openStock} />}
    {state.toast && <div className="absolute z-50 bottom-20 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-md bg-[#252a32e8] text-white text-[12px] whitespace-nowrap shadow-lg">{state.toast}</div>}
  </div>
}

function Header({ title, right }: { title: string; right?: React.ReactNode }) { return <header className="shrink-0 h-[50px] flex items-center justify-between px-4 bg-white border-b hairline"><h1 className="text-[18px] font-semibold">{title}</h1>{right}</header> }
function MarketClock() { const { state } = useGame(); const latest = Object.values(state.stocks)[0] as LiveStock | undefined; return <span className="text-[11px] text-muted tabular">{state.mode === 'live' ? `真实行情 · ${latest?.quoteTime?.slice(5, 16) || '载入中'}` : `${markets[state.market].short}模拟 · ${state.date.slice(5)} ${marketTime(state.market, state.minute)} ${state.running ? '●' : 'Ⅱ'}`}</span> }
function SourceStrip() { const { state } = useGame(); const latest = Object.values(state.stocks)[0] as LiveStock | undefined; return <div className={`px-4 py-2 text-[11px] ${state.mode === 'live' ? 'bg-[#eef5fb] text-[#497394]' : 'bg-[#fff6ea] text-[#966f39]'}`}>{state.mode === 'live' ? `${latest?.source === 'eastmoney' ? '东方财富' : 'Miao API'} · 报价 ${latest?.quoteTime || '未知'} · ${quoteAgeLabel(latest?.quoteTime || '')} · 交易为游戏模拟` : state.market === 'cn' ? `A 股代码/名称快照 ${universeMetadata.generatedAt.slice(0, 10)} · 价格参考 ${universeMetadata.priceDate} · 后续行情为模拟` : `${markets[state.market].label} · 常见证券标识示例 · 价格、走势图与交易均为模拟`}</div> }
function ListHead() { return <div className="flex items-center px-4 h-9 bg-[#f8f9fa] text-[11px] text-muted"><span className="flex-1">股票名称</span><span className="w-[88px] text-right">最新价</span><span className="w-[86px] ml-3 text-right">涨跌幅</span></div> }

function WatchPage({ onSearch, onStock }: { onSearch: () => void; onStock: (code: string) => void }) {
  const { state } = useGame()
  const stocks = state.favorites.map(c => state.stocks[c]).filter(Boolean)
  return <><Header title="自选股" right={<MarketClock/>}/><main className="scroll-area flex-1"><SourceStrip/><div className="bg-white p-3"><SearchTrigger onClick={onSearch}/></div><div className="px-4 py-3 bg-white border-t hairline flex items-center justify-between"><div><span className="font-semibold text-[15px]">我的自选</span><span className="ml-2 text-xs text-muted">{stocks.length}只</span></div><button onClick={onSearch} className="text-rise flex items-center gap-1 text-xs tap"><Plus size={15}/>添加自选</button></div><ListHead/>{stocks.length ? stocks.map(s => <StockRow key={s.code} stock={s} onClick={() => onStock(s.code)}/>) : <div className="py-16 text-center bg-white text-muted text-sm">暂无自选行情，搜索或刷新行情后再试</div>}<div className="px-4 py-3 text-[11px] text-muted">{state.mode === 'live' ? '来源与报价时间见顶部；账户交易均为虚拟模拟' : '真实证券标识仅作游戏背景；价格和交易均为模拟'}</div></main></>
}

function MarketPage({ onSearch, onStock }: { onSearch: () => void; onStock: (code: string) => void }) {
  const { state } = useGame()
  const [sector, setSector] = useState('全部')
  const [sort, setSort] = useState('代码')
  const [visible, setVisible] = useState(60)
  useEffect(() => { setSector('全部'); setVisible(60) }, [state.market])
  const stocks = Object.values(state.stocks)
  const sectors = state.market === 'cn' ? ['全部', '沪市主板', '深市主板', '创业板', '科创板', '北交所'] : ['全部', ...new Set(stocks.map(s => s.sector))]
  const filtered = stocks.filter(s => state.mode === 'live' || sector === '全部' || (state.market === 'cn' ? s.board : s.sector) === sector)
    .sort((a, b) => sort === '涨幅' ? pct(b) - pct(a) : sort === '跌幅' ? pct(a) - pct(b) : sort === '成交额' ? b.turnover - a.turnover : a.code.localeCompare(b.code))
  const advancers = stocks.filter(s => pct(s) >= 0).length
  const average = stocks.length ? stocks.reduce((n, s) => n + pct(s), 0) / stocks.length : 0
  return <><Header title="行情" right={<MarketClock/>}/><main className="scroll-area flex-1"><SourceStrip/><div className="bg-white p-3"><SearchTrigger onClick={onSearch}/></div>{state.mode === 'live' ? <div className="grid grid-cols-3 bg-white py-4 border-t hairline">{([['sh000001', '上证指数'], ['sz399001', '深证成指'], ['sz399006', '创业板指']] as const).map(([symbol, name]) => { const s = state.indexes[symbol]; return <div key={symbol} className="text-center border-r hairline px-1"><div className="text-[11px] text-muted">{name}</div><div className={`text-[17px] tabular font-semibold mt-1 ${s ? colorFor(pct(s)) : 'text-muted'}`}>{s ? money(s.price) : '--'}</div><div className={`text-[11px] ${s ? colorFor(pct(s)) : 'text-muted'}`}>{s ? `${signed(pct(s))}%` : '暂无数据'}</div></div> })}</div> : <div className="flex bg-white py-4 border-t hairline"><div className="flex-1 text-center border-r hairline"><div className="text-[11px] text-muted">{markets[state.market].indexLabel}</div><div className={`text-[24px] tabular font-semibold ${colorFor(average)}`}>{((state.market === 'cn' ? 3268.46 : state.market === 'hk' ? 23000 : 6100) * (1 + average / 100)).toFixed(2)}</div><div className={`text-[11px] ${colorFor(average)}`}>{signed(average)}%</div></div><div className="flex-1 text-center"><div className="text-[11px] text-muted">涨跌家数</div><div className="text-[24px] font-semibold tabular"><span className="text-rise">{advancers}</span><span className="text-muted text-base mx-2">/</span><span className="text-fall">{stocks.length - advancers}</span></div><div className="text-[11px] text-muted">{markets[state.market].label} · 模拟涨跌</div></div></div>}<div className="mt-2 bg-white"><SectionTitle>股票行情 <span className="text-xs text-muted font-normal ml-1">{filtered.length}只</span></SectionTitle>{state.mode === 'offline' && <div className="flex gap-2 px-4 py-2 overflow-x-auto">{sectors.map(s => <button key={s} onClick={() => { setSector(s); setVisible(60) }} className={`shrink-0 px-3 py-1.5 text-xs rounded-sm ${sector === s ? 'text-rise bg-[var(--rise-soft)]' : 'text-[#68717d] bg-[#f5f6f7]'}`}>{s}</button>)}</div>}<div className="flex gap-2 px-4 py-2 border-t hairline">{['代码', '涨幅', '跌幅', '成交额'].map(item => <button key={item} onClick={() => { setSort(item); setVisible(60) }} className={`text-xs px-2 py-1 ${sort === item ? 'text-rise font-semibold' : 'text-muted'}`}>{item}</button>)}</div><ListHead/>{filtered.slice(0, visible).map(s => <StockRow key={s.code} stock={s} onClick={() => onStock(s.code)}/>)}{visible < filtered.length && <button className="w-full py-4 text-sm text-rise" onClick={() => setVisible(visible + 60)}>加载更多 · 已显示 {visible}/{filtered.length}</button>}</div></main></>
}

function StockDetail({ stock, onBack, onTrade }: { stock: Stock; onBack: () => void; onTrade: (code: string, side: Side) => void }) {
  const { state, dispatch, loadLiveHistory } = useGame()
  const [period, setPeriod] = useState<Period>('time')
  useEffect(() => { if (state.mode === 'live' && activeAdapter.history && stock && !stock.history.length) void loadLiveHistory(stock.code, 'day') }, [state.mode, stock?.code, stock?.history.length, loadLiveHistory])
  const chartStock = useMemo(() => stock && state.mode === 'offline' ? withSimulatedCharts(stock, state.date, state.minute) : stock, [stock, state.mode, state.date, state.minute])
  if (!stock) return null
  const rate = pct(stock)
  const live = state.mode === 'live' ? stock as LiveStock : null
  const favorite = state.favorites.includes(stock.code)
  const steps = [5, 4, 3, 2, 1]
  return <><header className="h-[50px] shrink-0 flex items-center justify-between px-3 bg-white border-b hairline"><button onClick={onBack} aria-label="返回" className="tap p-1"><ChevronLeft size={23}/></button><div className="text-center"><div className="font-semibold text-[16px]">{stock.name}</div><div className="text-[10px] text-muted tabular">{stock.code} · {live ? '真实行情' : '离线模拟'}</div></div><button onClick={() => dispatch({ type: 'favorite', code: stock.code })} aria-label={favorite ? '移出自选' : '加入自选'} className={`tap p-1 ${favorite ? 'text-[#eea526]' : 'text-[#657080]'}`}><Star size={21} fill={favorite ? 'currentColor' : 'none'}/></button></header>
    <main className="scroll-area flex-1">{live && <SourceStrip/>}<div className="bg-white px-4 pt-4 pb-3"><div className="flex items-end gap-3"><span className={`text-[35px] leading-none font-semibold tabular ${colorFor(rate)}`}>{money(stock.price)}</span><div className={`text-[13px] tabular pb-1 ${colorFor(rate)}`}><div>{signed(change(stock))}</div><div>{signed(rate)}%</div></div></div><div className="mt-4 grid grid-cols-3 gap-x-5 gap-y-1 text-[11px]"><InfoPair label="今开" value={stock.open ? money(stock.open) : '--'}/><InfoPair label="最高" value={stock.high ? money(stock.high) : '--'} valueClass="text-rise"/><InfoPair label="最低" value={stock.low ? money(stock.low) : '--'} valueClass="text-fall"/><InfoPair label="昨收" value={money(stock.prevClose)}/><InfoPair label="成交量" value={`${(stock.volume / 10000).toFixed(1)}万`}/><InfoPair label="成交额" value={`${(stock.turnover / 100000000).toFixed(2)}亿`}/>{live && <InfoPair label="换手率" value={live.turnoverRate === null ? '--' : `${live.turnoverRate.toFixed(2)}%`}/>}</div></div>
      <div className="mt-2 bg-white"><div className="flex border-b hairline">{([['time', '分时'], ['day', '日K'], ['week', '周K'], ['month', '月K']] as const).map(([id, label]) => <button key={id} onClick={() => setPeriod(id)} className={`flex-1 h-11 text-[13px] relative ${period === id ? 'text-rise font-semibold' : 'text-[#69727e]'}`}>{label}{period === id && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-7 h-[2px] bg-rise"/>}</button>)}</div><div className="px-2 pt-2">{(period === 'time' ? chartStock.intraday.length > (live ? 1 : 0) : chartStock.history.length > 0) ? <MarketChart stock={chartStock} period={period}/> : <div className="h-[252px] flex items-center justify-center text-center text-xs text-muted px-6">{period === 'time' ? '真实分时快照尚不足两笔；刷新后显示采样走势' : '当前数据源未提供历史 K 线，未使用模拟图表替代'}</div>}</div></div>
      {live ? <div className="mt-2 bg-white p-4 text-center text-xs text-muted">该数据源未提供五档盘口</div> : <div className="mt-2 bg-white pb-3"><SectionTitle>五档盘口 <span className="text-[11px] font-normal text-muted">模拟报价</span></SectionTitle><div className="grid grid-cols-2 gap-0 text-[12px] tabular"><div className="border-r hairline">{steps.map(n => <div key={`sell${n}`} className="flex justify-between px-4 h-8 items-center"><span className="text-muted">卖{n}</span><span className="text-fall">{money(round(stock.price + n * .01))}</span><span>{(8 + n * 7) * 100}</span></div>)}</div><div>{steps.slice().reverse().map(n => <div key={`buy${n}`} className="flex justify-between px-4 h-8 items-center"><span className="text-muted">买{n}</span><span className="text-rise">{money(round(stock.price - n * .01))}</span><span>{(12 + n * 5) * 100}</span></div>)}</div></div></div>}<div className="text-center text-[11px] text-muted py-3">{live ? `报价时间 ${live.quoteTime} · 来源 ${live.source} · 模拟成交不等于交易所撮合` : `股票代码与简称来自资料快照；${stock.anchorDate ? `起始价参考 ${stock.anchorDate} 收盘价` : '起始价为预设模拟参考价'}；后续价格、图表及盘口均为模拟`}</div></main>
    <div className="flex gap-2 px-4 py-2 bg-white border-t hairline safe-bottom shrink-0"><button onClick={() => onTrade(stock.code, 'buy')} className="flex-1 h-11 bg-rise text-white font-semibold rounded-sm tap">买入</button><button onClick={() => onTrade(stock.code, 'sell')} className="flex-1 h-11 bg-fall text-white font-semibold rounded-sm tap">卖出</button></div></>
}

function SearchOverlay({ onClose, onStock }: { onClose: () => void; onStock: (code: string) => void }) {
  const { state, dispatch, searchLive, loadLiveStock } = useGame()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  useEffect(() => {
    if (state.mode !== 'live' || !query.trim()) { setHits([]); setError(''); return }
    let cancelled = false
    const id = window.setTimeout(() => { void searchLive(query.trim()).then(result => { if (!cancelled) { setHits(result); setError('') } }).catch(cause => { if (!cancelled) { setHits([]); setError(describeMarketError(cause)) } }) }, 350)
    return () => { cancelled = true; window.clearTimeout(id) }
  }, [query, state.mode, searchLive])
  const local = query.trim() ? Object.values(state.stocks).filter(s => `${s.code}${s.name}${s.sector}`.toLowerCase().includes(query.trim().toLowerCase())) : state.favorites.map(code => state.stocks[code]).filter(Boolean)
  const localHits = local.slice(0, 80).map(s => ({ code: s.code, name: s.name, symbol: `${s.exchange || (s.code.startsWith('6') ? 'sh' : 'sz')}${s.code}` }))
  const rows: SearchHit[] = state.mode === 'live' && query.trim() ? hits.length ? hits.slice(0, 80) : localHits : localHits
  const choose = async (hit: SearchHit, favorite = false) => {
    setBusy(hit.code)
    if (state.mode === 'live' && !state.stocks[hit.code]) { const loaded = await loadLiveStock(hit.symbol); if (!loaded) { setError('未能加载该股票的报价'); setBusy(''); return } }
    if (favorite) dispatch({ type: 'favorite', code: hit.code })
    else onStock(hit.code)
    setBusy('')
  }
  return <div className="absolute inset-0 z-40 bg-[#f7f8fa] flex flex-col"><div className="flex items-center gap-3 px-3 py-2 bg-white border-b hairline"><button onClick={onClose} aria-label="关闭搜索"><ChevronLeft size={23}/></button><div className="flex items-center flex-1 gap-2 bg-[#f1f3f5] h-9 px-3 rounded-md"><Search size={16} className="text-muted"/><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="股票名称或代码" className="w-full bg-transparent text-sm"/>{query && <button onClick={() => setQuery('')}><X size={15} className="text-muted"/></button>}</div></div><div className="text-xs text-muted px-4 py-3">{query ? `搜索结果 · ${rows.length}` : state.mode === 'live' ? '已加载 A 股' : `股票目录 · ${Object.keys(state.stocks).length} 只`}</div>{error && <div className="px-4 pb-2 text-xs text-rise">搜索失败：{error}</div>}<div className="scroll-area flex-1">{rows.map(s => <div key={s.symbol} className="flex items-center bg-white border-b hairline"><button onClick={() => void choose(s)} disabled={!!busy} className="flex-1 text-left px-4 h-[60px] tap"><div className="font-semibold text-sm">{s.name}</div><div className="text-[11px] text-muted tabular">{s.code} · {state.mode === 'live' ? 'A股' : state.stocks[s.code]?.sector}</div></button><button onClick={() => void choose(s, true)} disabled={!!busy} className={`px-5 h-[60px] ${state.favorites.includes(s.code) ? 'text-[#eea526]' : 'text-muted'}`} aria-label="切换自选"><Star size={19} fill={state.favorites.includes(s.code) ? 'currentColor' : 'none'}/></button></div>)}{!rows.length && <div className="text-center text-muted text-sm py-16">{busy ? '加载报价中…' : '没有找到相关股票'}</div>}</div></div>
}

function TradePage({ side, setSide, code, setCode, onStock }: { side: Side; setSide: (side: Side) => void; code: string; setCode: (code: string) => void; onStock: (code: string) => void }) {
  const { state, dispatch } = useGame()
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [picker, setPicker] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [percent, setPercent] = useState<number | null>(null)
  const pickerStocks = pickerQuery.trim()
    ? Object.values(state.stocks).filter(s => `${s.code}${s.name}`.toLowerCase().includes(pickerQuery.trim().toLowerCase())).slice(0, 60)
    : [...new Map([...state.favorites.map(c => state.stocks[c]).filter(Boolean), ...Object.values(state.stocks).slice(0, 30)].map(s => [s.code, s])).values()]
  const stock = state.stocks[code] || Object.values(state.stocks)[0]
  useEffect(() => { if (stock && stock.code !== code) { setCode(stock.code); setPrice(''); setQuantity('') } }, [stock?.code, code, setCode])
  if (!stock) return <><Header title="模拟交易"/><Empty label="行情尚未加载，请稍后重试"/></>
  const liveQuoteFresh = state.mode !== 'live' || quoteIsUsable(stock as LiveStock)
  const currentPrice = price === '' ? stock.price : Number(price)
  const usable = side === 'buy' ? availableCash(state.account) : availableShares(state.account, stock.code)
  const lot = state.market === 'cn' ? 100 : state.market === 'hk' ? stock.lotSize || 100 : 1
  const currency = markets[state.market].symbol
  const maximum = side === 'buy' ? maxBuyQuantity(state.account, stock, currentPrice) : usable
  const parsedQuantity = Number(quantity)
  const selectStock = (c: string) => { setCode(c); setPrice(''); setQuantity(''); setPercent(null); setPicker(false) }
  const submit = () => {
    const orderPrice = Number(price || stock.price)
    const error = rulesForMarket(state.market).validate(state.account, stock, side, orderPrice, parsedQuantity)
    dispatch({ type: 'order', code: stock.code, side, price: orderPrice, quantity: parsedQuantity })
    if (!error && liveQuoteFresh) setQuantity('')
  }
  return <><Header title="模拟交易" right={<span className="text-[11px] text-muted">虚拟资金 · 无真实交易</span>}/><main className="scroll-area flex-1"><SourceStrip/><div className="flex bg-white border-b hairline"><button onClick={() => { setSide('buy'); setQuantity(''); setPercent(null) }} className={`flex-1 h-12 text-[15px] font-semibold relative ${side === 'buy' ? 'text-rise' : 'text-muted'}`}>买入{side === 'buy' && <i className="absolute bottom-0 left-[35%] right-[35%] h-[2px] bg-rise"/>}</button><button onClick={() => { setSide('sell'); setQuantity(''); setPercent(null) }} className={`flex-1 h-12 text-[15px] font-semibold relative ${side === 'sell' ? 'text-fall' : 'text-muted'}`}>卖出{side === 'sell' && <i className="absolute bottom-0 left-[35%] right-[35%] h-[2px] bg-fall"/>}</button></div>
    <div className="bg-white px-4 pb-4"><button onClick={() => setPicker(true)} className="h-14 w-full flex items-center border-b hairline text-left tap"><span className="text-muted text-[13px] w-[75px]">股票代码</span><span className="font-semibold text-[15px] tabular">{stock.code}</span><span className="ml-2 text-[13px]">{stock.name}</span><ChevronRight size={17} className="ml-auto text-muted"/></button><div className="flex items-center h-14 border-b hairline"><span className="text-muted text-[13px] w-[75px]">委托价格</span><button onClick={() => setPrice(String(round(currentPrice - .01)))} className="w-8 h-8 bg-[#f4f5f6] text-xl text-[#717985]">−</button><input type="number" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder={stock.price.toFixed(2)} className="flex-1 w-0 text-center tabular text-[17px] font-semibold"/><button onClick={() => setPrice(String(round(currentPrice + .01)))} className="w-8 h-8 bg-[#f4f5f6] text-xl text-[#717985]">+</button></div><div className="flex items-center h-14 border-b hairline"><span className="text-muted text-[13px] w-[75px]">委托数量</span><input type="number" inputMode="numeric" value={quantity} onChange={e => { setQuantity(e.target.value); setPercent(null) }} placeholder={`请输入股数（${lot}股起）`} className="flex-1 text-[15px] tabular"/><span className="text-[13px] text-muted">股</span></div><div className="flex gap-2 py-3">{[.25, .5, .75, 1].map(p => <button key={p} onClick={() => { setQuantity(String(Math.floor(maximum * p / lot) * lot)); setPercent(p) }} className={`flex-1 h-8 text-xs border rounded-sm ${percent === p ? side === 'buy' ? 'border-rise text-rise bg-[var(--rise-soft)]' : 'border-fall text-fall bg-[var(--fall-soft)]' : 'hairline text-[#6b7480]'}`}>{p === 1 ? '全仓' : `${p * 100}%`}</button>)}</div><div className="text-xs text-muted flex justify-between"><span>{side === 'buy' ? '可用资金' : '可卖数量'} <b className="text-ink font-medium tabular">{side === 'buy' ? `${currency}${money(usable)}` : `${usable} 股`}</b></span><span>可{side === 'buy' ? '买' : '卖'} <b className="text-ink font-medium tabular">{maximum} 股</b></span></div><div className="text-xs text-muted flex justify-between pt-2"><span>参考金额</span><span className="tabular">{currency}{money((Number.isFinite(currentPrice) ? currentPrice : 0) * (Number.isFinite(parsedQuantity) ? parsedQuantity : 0))}</span></div><button onClick={submit} className={`w-full h-11 mt-5 text-white text-[15px] font-semibold rounded-sm tap ${side === 'buy' ? 'bg-rise' : 'bg-fall'}`}>确认{side === 'buy' ? '买入' : '卖出'}</button><div className="mt-2 text-[11px] text-muted text-center">限价触达即模拟成交 · {state.market === 'cn' ? '当日买入次交易日可卖' : '支持当日模拟卖出'}{!liveQuoteFresh && <span className="block text-rise mt-1">当前报价超过 30 分钟，交易暂不可用</span>}</div></div>
    <div className="mt-2 bg-white"><SectionTitle>股票报价 <button onClick={() => onStock(code)} className="text-xs text-muted flex items-center">详情 <ChevronRight size={14}/></button></SectionTitle><div className="px-4 py-3 flex items-center justify-between"><div><div className="text-sm font-medium">{stock.name} <span className="text-xs text-muted tabular">{stock.code}</span></div><div className="text-xs text-muted mt-1">昨收 {money(stock.prevClose)} · 今开 {money(stock.open)}</div></div><div className="text-right"><div className={`text-xl tabular font-semibold ${colorFor(pct(stock))}`}>{money(stock.price)}</div><div className={`text-xs tabular ${colorFor(pct(stock))}`}>{signed(pct(stock))}%</div></div></div></div><div className="mt-2 bg-white"><SectionTitle>当日委托</SectionTitle><OrderList kind="pending" compact/></div></main>
    {picker && <div className="absolute inset-0 z-30 bg-[#0006] flex items-end" onClick={() => setPicker(false)}><div className="bg-white w-full max-h-[75%] rounded-t-xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}><div className="h-12 flex items-center justify-between px-4 border-b hairline"><b>选择股票</b><button onClick={() => setPicker(false)}><X size={19}/></button></div><div className="px-4 py-2 border-b hairline"><input value={pickerQuery} onChange={e => setPickerQuery(e.target.value)} placeholder="搜索股票名称或代码" className="w-full h-9 px-3 bg-[#f3f4f6] text-sm rounded-sm"/></div><div className="scroll-area">{pickerStocks.map(s => <button key={s.code} onClick={() => selectStock(s.code)} className="w-full flex items-center justify-between px-4 h-12 border-b hairline text-sm"><span>{s.name} <span className="text-muted text-xs tabular ml-1">{s.code}</span></span><span className={colorFor(pct(s))}>{money(s.price)}</span></button>)}</div></div></div>}
  </>
}

function AssetsPage({ view, setView, onStock }: { view: OrderView; setView: (view: OrderView) => void; onStock: (code: string) => void }) {
  const { state } = useGame()
  const account = state.account
  const assets = totalAssets(account, state.stocks)
  const value = marketValue(account, state.stocks)
  const profit = round(assets - account.initialCapital)
  const daily = round(assets - account.dayStartAssets)
  const holdings = Object.values(account.holdings)
  return <><Header title="资产" right={<span className="text-[11px] text-muted">{markets[state.market].currency} 模拟账户</span>}/><main className="scroll-area flex-1"><SourceStrip/><div className="bg-white px-4 pt-5 pb-4"><div className="text-xs text-muted">总资产（{markets[state.market].currency}）</div><div className="font-semibold text-[31px] tabular mt-1">{money(assets)}</div><div className="flex gap-10 mt-3"><div><div className="text-[11px] text-muted">今日盈亏</div><div className={`text-[15px] font-semibold tabular mt-1 ${colorFor(daily)}`}>{signed(daily)}</div></div><div><div className="text-[11px] text-muted">累计收益</div><div className={`text-[15px] font-semibold tabular mt-1 ${colorFor(profit)}`}>{signed(profit)} <span className="text-xs">({signed(profit / account.initialCapital * 100)}%)</span></div></div></div></div><div className="grid grid-cols-2 bg-white mt-px px-4 py-3 gap-y-3"><div><div className="text-[11px] text-muted">可用资金</div><div className="text-[15px] tabular font-medium mt-1">{money(availableCash(account))}</div></div><div><div className="text-[11px] text-muted">持仓市值</div><div className="text-[15px] tabular font-medium mt-1">{money(value)}</div></div><div><div className="text-[11px] text-muted">冻结资金</div><div className="text-[15px] tabular font-medium mt-1">{money(reservedCash(account))}</div></div><div><div className="text-[11px] text-muted">资金余额</div><div className="text-[15px] tabular font-medium mt-1">{money(account.cash)}</div></div></div><div className="mt-2 bg-white"><div className="flex border-b hairline">{([['holdings', '持仓'], ['pending', '可撤'], ['orders', '委托'], ['fills', '成交']] as const).map(([id, label]) => <button key={id} onClick={() => setView(id)} className={`flex-1 h-11 relative text-[13px] ${view === id ? 'text-rise font-semibold' : 'text-[#68717d]'}`}>{label}{view === id && <span className="absolute bottom-0 left-[28%] right-[28%] h-[2px] bg-rise"/>}</button>)}</div>{view === 'holdings' ? holdings.length ? <>{holdings.map(h => { const s = state.stocks[h.code]; const gain = round((s.price - h.cost) * h.quantity); return <button key={h.code} onClick={() => onStock(h.code)} className="w-full text-left px-4 py-3 border-b hairline tap"><div className="flex justify-between"><div className="font-semibold text-sm">{s.name} <span className="font-normal text-xs text-muted tabular ml-1">{s.code}</span></div><span className={`text-sm tabular font-semibold ${colorFor(gain)}`}>{signed(gain)}</span></div><div className="grid grid-cols-3 mt-3 text-xs"><div><span className="text-muted">持仓 / 可卖</span><div className="tabular mt-1">{h.quantity} / {availableShares(account, h.code)}</div></div><div><span className="text-muted">成本 / 现价</span><div className="tabular mt-1">{money(h.cost)} / {money(s.price)}</div></div><div className="text-right"><span className="text-muted">市值 / 收益率</span><div className={`tabular mt-1 ${colorFor(gain)}`}>{money(s.price * h.quantity)} / {signed((s.price / h.cost - 1) * 100)}%</div></div></div></button> })}</> : <Empty label="暂无持仓，去交易页买入股票"/> : <OrderList kind={view}/>}</div><div className="text-center text-[11px] text-muted py-3">本页面仅显示虚拟资产，不代表真实证券账户</div></main></>
}

function Empty({ label }: { label: string }) { return <div className="py-12 text-center text-[13px] text-muted">{label}</div> }
function OrderList({ kind, compact = false }: { kind: 'pending' | 'orders' | 'fills'; compact?: boolean }) {
  const { state, dispatch } = useGame()
  const orders = state.account.orders.filter(o => kind === 'orders' || (kind === 'pending' ? o.status === 'pending' : o.status === 'filled'))
  if (!orders.length) return <Empty label={kind === 'pending' ? '暂无可撤委托' : kind === 'fills' ? '暂无成交记录' : '暂无委托记录'}/>
  return <div>{orders.slice(0, compact ? 3 : undefined).map(o => <div key={o.id} className="px-4 py-3 border-b hairline text-xs"><div className="flex items-center justify-between"><div><span className="font-semibold text-[13px]">{state.stocks[o.code]?.name}</span><span className="text-muted tabular ml-1">{o.code}</span><span className={`ml-2 ${o.side === 'buy' ? 'text-rise' : 'text-fall'}`}>{o.side === 'buy' ? '买入' : '卖出'}</span></div><span className={o.status === 'filled' ? 'text-rise' : 'text-muted'}>{o.status === 'filled' ? '已成交' : o.status === 'cancelled' ? '已撤单' : '待成交'}</span></div><div className="flex justify-between text-muted tabular mt-2"><span>委托 {money(o.price)} × {o.quantity} 股</span><span>{o.createdAt.slice(5)}</span></div>{o.status === 'filled' && <div className="flex justify-between mt-1.5 text-muted tabular"><span>成交 {money(o.fillPrice ?? 0)} · 费用 {money(o.fee ?? 0)}</span><span>{o.filledAt?.slice(5)}</span></div>}{o.status === 'pending' && <div className="flex justify-end mt-2"><button onClick={() => dispatch({ type: 'cancel', id: o.id })} className="text-rise border border-rise px-3 py-1 rounded-sm tap">撤单</button></div>}</div>)}</div>
}

export default function App() { return <GameProvider><AppContent/></GameProvider> }
