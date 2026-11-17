import { ChevronRight, Search } from 'lucide-react'
import { change, money, pct, signed, type Stock } from '../core/market'

export const colorFor = (n: number) => n >= 0 ? 'text-rise' : 'text-fall'
export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) { return <div className="flex items-center justify-between px-4 h-11 bg-white border-b hairline"><h2 className="text-[15px] font-semibold">{children}</h2>{right}</div> }
export function SearchTrigger({ onClick, label = '搜索股票名称 / 代码' }: { onClick: () => void; label?: string }) { return <button onClick={onClick} className="flex items-center gap-2 w-full bg-[#f1f3f5] text-[#a0a7b1] rounded-md h-9 px-3 text-[13px] tap"><Search size={16}/>{label}</button> }
export function StockRow({ stock, onClick, showArrow = false }: { stock: Stock; onClick: () => void; showArrow?: boolean }) {
  const rate = pct(stock)
  return <button onClick={onClick} className="w-full flex items-center px-4 h-[68px] bg-white border-b hairline text-left tap">
    <div className="flex-1 min-w-0"><div className="font-semibold text-[15px] truncate">{stock.name}</div><div className="text-[11px] text-muted mt-0.5 tabular">{stock.code} <span className="ml-1">{stock.sector}</span>{'quoteTime' in stock && typeof stock.quoteTime === 'string' && <span className="ml-1">{stock.quoteTime.slice(11, 16)}</span>}</div></div>
    <div className={`w-[88px] text-right tabular font-semibold text-[16px] ${colorFor(rate)}`}>{money(stock.price)}</div>
    <div className={`w-[86px] ml-3 text-right tabular font-semibold text-[14px] ${colorFor(rate)}`}>{signed(rate)}%</div>
    {showArrow && <ChevronRight size={15} className="text-muted ml-2"/>}
  </button>
}
export function StockMini({ stock }: { stock: Stock }) { const rate = pct(stock); return <><span className={`font-semibold tabular ${colorFor(rate)}`}>{money(stock.price)}</span><span className={`tabular ${colorFor(rate)}`}>{signed(change(stock))} ({signed(rate)}%)</span></> }
export function InfoPair({ label, value, valueClass = '' }: { label: string; value: React.ReactNode; valueClass?: string }) { return <div className="flex justify-between items-center min-h-9 text-[13px]"><span className="text-muted">{label}</span><span className={`tabular ${valueClass}`}>{value}</span></div> }
