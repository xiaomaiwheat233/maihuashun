import { useEffect, useRef } from 'react'
import { createChart, ColorType, CrosshairMode, type IChartApi, type UTCTimestamp } from 'lightweight-charts'
import { groupedCandles, type Stock } from '../core/market'
import { markets } from '../core/markets'

export type Period = 'time' | 'day' | 'week' | 'month'
export default function MarketChart({ stock, period }: { stock: Stock; period: Period }) {
  const holder = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const updateRef = useRef<((value: Stock) => void) | null>(null)
  useEffect(() => {
    if (!holder.current) return
    const el = holder.current
    const colors = markets[stock.market || 'cn']
    const chart = createChart(el, { width: el.clientWidth, height: 252, layout: { background: { type: ColorType.Solid, color: '#fff' }, textColor: '#9199a4', fontSize: 10 }, grid: { vertLines: { color: '#f3f5f7' }, horzLines: { color: '#f3f5f7' } }, rightPriceScale: { borderVisible: false, scaleMargins: { top: .13, bottom: .12 } }, timeScale: { borderVisible: false, timeVisible: period === 'time', secondsVisible: false, rightOffset: 2 }, crosshair: { mode: CrosshairMode.Normal }, handleScroll: { mouseWheel: false, pressedMouseMove: true } })
    chartRef.current = chart
    if (period === 'time') {
      const line = chart.addAreaSeries({ lineColor: colors.rising, topColor: stock.market === 'cn' ? '#fce9e9' : '#e5f5ef', bottomColor: '#ffffff', lineWidth: 2, priceLineVisible: false, lastValueVisible: true })
      const reference = line.createPriceLine({ price: stock.prevClose, color: '#b9c0c9', lineStyle: 2, axisLabelVisible: false })
      updateRef.current = value => {
        const date = value.history[value.history.length - 1]?.time || (value as Stock & { quoteTime?: string }).quoteTime?.slice(0, 10)
        if (!date) return
        line.setData(value.intraday.map(p => ({ time: Math.floor(new Date(`${date}T${p.time}:00Z`).getTime() / 1000) as UTCTimestamp, value: p.value })))
        reference.applyOptions({ price: value.prevClose })
      }
    } else {
      const candle = chart.addCandlestickSeries({ upColor: colors.rising, downColor: colors.falling, borderUpColor: colors.rising, borderDownColor: colors.falling, wickUpColor: colors.rising, wickDownColor: colors.falling, priceLineVisible: false })
      updateRef.current = value => candle.setData(groupedCandles(value.history, period).map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })))
    }
    updateRef.current(stock)
    chart.timeScale().fitContent()
    const observer = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }))
    observer.observe(el)
    return () => { observer.disconnect(); chart.remove(); chartRef.current = null; updateRef.current = null }
  }, [stock.code, stock.market, period])
  useEffect(() => { updateRef.current?.(stock) }, [stock])
  return <div ref={holder} className="w-full h-[252px]" aria-label={`${stock.name}${period === 'time' ? '分时' : period === 'day' ? '日K' : period === 'week' ? '周K' : '月K'}图`} />
}
