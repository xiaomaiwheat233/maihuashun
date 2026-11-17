const origin = 'https://example.com'
const sources = [
  ['Miao quote', 'https://api.miao.club/api/stock/quote?symbols=sh600519,sz000001,sh000001'],
  ['Miao search', 'https://api.miao.club/api/stock/search?q=%E8%8C%85%E5%8F%B0'],
  ['Eastmoney quote', 'https://push2.eastmoney.com/api/qt/stock/get?secid=1.600519&fields=f43,f57,f58,f60,f86'],
  ['Eastmoney kline', 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600519&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=0&end=20500101&lmt=3'],
  ['Tencent quote', 'https://qt.gtimg.cn/q=sh600519'],
  ['AShareAPI quote', 'https://api.ashareapi.com/v1/quote?code=sh600519,sz000001'],
  ['AShareAPI kline', 'https://api.ashareapi.com/v1/kline?code=sh600519&period=day&count=3'],
  ['AShareAPI index', 'https://api.ashareapi.com/v1/quote?code=sh000001'],
]

for (const [name, url] of sources) {
  if (process.argv[2] && !name.toLowerCase().includes(process.argv[2].toLowerCase())) continue
  const started = Date.now()
  try {
    const response = await fetch(url, { headers: { Origin: origin }, signal: AbortSignal.timeout(8000) })
    const body = await response.text()
    let sample
    try {
      const json = JSON.parse(body)
      sample = name === 'Miao quote' ? {
        code: json.code, message: json.message, stale: json.stale, updatedAt: json.updatedAt,
        quotes: json.data?.quotes?.map(({ symbol, name, price, prevClose, time }) => ({ symbol, name, price, prevClose, time })),
      } : name === 'Miao search' ? { code: json.code, count: Array.isArray(json.data) ? json.data.length : null, first: Array.isArray(json.data) ? json.data[0] : null }
        : name === 'Eastmoney kline' ? { rc: json.rc, klines: json.data?.klines?.slice(-3) }
        : name.startsWith('AShareAPI') ? { ok: json.ok, source: json.source, stale: json.stale, degraded: json.degraded, reason: json.reason,
          count: Array.isArray(json.data) ? json.data.length : null, symbols: Array.isArray(json.data) ? [...new Set(json.data.map(x => x.symbol))] : null,
          data: Array.isArray(json.data) ? json.data.slice(0, 3) : json.data } : json
    } catch { sample = body.slice(0, 160) }
    console.log(JSON.stringify({ name, status: response.status, ms: Date.now() - started,
      cors: response.headers.get('access-control-allow-origin'), contentType: response.headers.get('content-type'), sample }, null, 2))
  } catch (error) {
    console.log(JSON.stringify({ name, ms: Date.now() - started, error: String(error), cause: String(error.cause || '') }))
  }
}
