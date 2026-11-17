export type MarketId = 'cn' | 'hk' | 'us'

export const marketIds: MarketId[] = ['cn', 'hk', 'us']
export const markets: Record<MarketId, { label: string; short: string; currency: string; symbol: string; timezone: string; minutes: number; rising: string; falling: string; indexLabel: string }> = {
  cn: { label: 'A 股', short: '沪深京', currency: 'CNY', symbol: '¥', timezone: '北京时间', minutes: 240, rising: '#df3034', falling: '#15956b', indexLabel: '模拟沪深指数' },
  hk: { label: '港股', short: '香港', currency: 'HKD', symbol: 'HK$', timezone: '香港时间', minutes: 330, rising: '#139669', falling: '#d9474f', indexLabel: '模拟恒生指数' },
  us: { label: '美股', short: '纽约', currency: 'USD', symbol: '$', timezone: '纽约时间', minutes: 390, rising: '#139669', falling: '#d9474f', indexLabel: '模拟标普指数' },
}

export function marketTime(market: MarketId, minute: number) {
  const total = market === 'cn'
    ? minute < 120 ? 9 * 60 + 30 + minute : 13 * 60 + minute - 120
    : market === 'hk'
      ? minute < 150 ? 9 * 60 + 30 + minute : 13 * 60 + minute - 150
      : 9 * 60 + 30 + minute
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export const marketLabel = (market: MarketId) => markets[market].label
