import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// One-time build input. The browser never fetches these sources or receives an API token.
// Wikipedia tables: CC BY-SA 4.0. Historical price dataset: MIT (see DATA_SOURCES.md).
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const output = join(root, 'src', 'data')
const wikiPages = [
  ['上海证券交易所主板上市公司列表', '沪市主板', 1, 2, 'sh'],
  ['上海证券交易所科创板上市公司列表', '科创板', 1, 2, 'sh'],
  ['深圳证券交易所主板上市公司列表', '深市主板', 3, 4, 'sz'],
  ['深圳证券交易所创业板上市公司列表', '创业板', 3, 4, 'sz'],
  ['北京证券交易所上市公司列表', '北交所', 0, 1, 'bj'],
]

const clean = text => text
  .replace(/<ref\b[^>]*>.*?<\/ref>/g, '')
  .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
  .replace(/\[\[([^\]]+)\]\]/g, '$1')
  .replace(/\{\{[^{}]*\}\}/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/'''?/g, '')
  .trim()

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'A-share-simulation-game/1.0 (educational; static data build)' } })
      if (!response.ok) throw new Error(`${response.status} ${url}`)
      return await response.json()
    } catch (error) {
      if (attempt === 2) throw error
      await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1200))
    }
  }
}

async function getWikiStocks() {
  const stocks = new Map()
  for (const [title, board, codeColumn, nameColumn, exchange] of wikiPages) {
    const url = `https://zh.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`
    const response = await fetch(url, { headers: { 'User-Agent': 'A-share-simulation-game/1.0 (educational; static data build)' } })
    if (!response.ok) throw new Error(`Wikipedia ${response.status}: ${title}`)
    const raw = await response.text()
    let active = true
    let count = 0
    for (const line of raw.split(/\r?\n/)) {
      if (/^==[^=]/.test(line) && /暂缓|未能上市|终止上市|已转板|仅B股|参考|参见|外部链接/.test(line)) active = false
      if (!active || !line.startsWith('|') || !line.includes('||')) continue
      const rawCells = line.slice(1).split('||')
      const cells = rawCells.map(clean)
      const code = rawCells[codeColumn]?.match(/\b\d{6}\b/)?.[0]
      const name = cells[nameColumn]?.trim()
      if (!code || !name || /未上市|待定|暂无/.test(name) || !/^\d{6}$/.test(code)) continue
      if (exchange === 'sh' && !/^6/.test(code)) continue
      if (exchange === 'sz' && !/^(0|3)/.test(code)) continue
      if (exchange === 'bj' && !/^(8|9|4)/.test(code)) continue
      stocks.set(code, { code, name, board, exchange, sector: board, anchor: null, anchorDate: null })
      count++
    }
    console.log(`${board}: ${count}`)
  }
  return stocks
}

const dataset = 'ellendan/a-share-prices'
const rowUrl = (offset, length) => `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(dataset)}&config=main_data&split=train&offset=${offset}&length=${length}`
async function getPriceSnapshot() {
  const size = await getJson(`https://datasets-server.huggingface.co/size?dataset=${encodeURIComponent(dataset)}`)
  const total = size.size?.dataset?.num_rows
  if (!Number.isInteger(total) || total < 1000) throw new Error('Historical dataset row count unavailable')
  const finalRow = (await getJson(rowUrl(total - 1, 1))).rows?.[0]?.row
  const date = finalRow?.date?.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Historical dataset date unavailable')
  // Updates have been appended by trading date. Find the first row for the final day.
  let lo = Math.max(0, total - 10000), hi = total - 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const row = (await getJson(rowUrl(mid, 1))).rows?.[0]?.row
    if (!row?.date || row.date.slice(0, 10) < date) lo = mid + 1
    else hi = mid
  }
  const start = lo
  const offsets = []
  for (let offset = start; offset < total; offset += 100) offsets.push(offset)
  const quotes = new Map()
  for (let i = 0; i < offsets.length; i += 4) {
    const pages = await Promise.all(offsets.slice(i, i + 4).map(offset => getJson(rowUrl(offset, Math.min(100, total - offset)))))
    for (const page of pages) for (const { row } of page.rows || []) {
      if (row.date?.slice(0, 10) !== date || !Number.isFinite(row.close) || row.close <= 0) continue
      const code = String(row.code).match(/\d{6}/)?.[0]
      if (code) quotes.set(code, { price: Math.round(row.close * 100) / 100, sector: row.industry || null })
    }
  }
  console.log(`Historical close ${date}: ${quotes.size} instruments`)
  return { date, quotes }
}

const stocks = await getWikiStocks()
let snapshot
try {
  snapshot = process.argv.includes('--reuse-prices') ? null : await getPriceSnapshot()
} catch (error) {
  console.warn(`Historical dataset unavailable (${error.message}); reusing checked-in price anchors`)
}
if (!snapshot) {
  const existing = JSON.parse(await readFile(join(output, 'universe.json'), 'utf8'))
  const previous = JSON.parse(await readFile(join(output, 'universe-meta.json'), 'utf8'))
  snapshot = { date: previous.priceDate, quotes: new Map(existing.filter(stock => stock.anchor).map(stock => [stock.code, { price: stock.anchor, sector: stock.sector }])) }
}
const { date, quotes } = snapshot
let anchored = 0
for (const stock of stocks.values()) {
  const quote = quotes.get(stock.code)
  if (quote) {
    stock.anchor = quote.price
    stock.anchorDate = date
    if (quote.sector) stock.sector = quote.sector
    anchored++
  }
}
const result = [...stocks.values()].sort((a, b) => a.code.localeCompare(b.code))
if (result.length < 4000 || anchored < 1000) throw new Error(`Unexpectedly small snapshot: ${result.length} symbols, ${anchored} anchors`)
await mkdir(output, { recursive: true })
await writeFile(join(output, 'universe.json'), JSON.stringify(result))
await writeFile(join(output, 'universe-meta.json'), JSON.stringify({ generatedAt: new Date().toISOString(), priceDate: date, count: result.length, anchored, sources: [
  { name: '中文维基百科上市公司列表', license: 'CC BY-SA 4.0', urls: wikiPages.map(([title]) => `https://zh.wikipedia.org/wiki/${encodeURIComponent(title)}`) },
  { name: 'ellendan/a-share-prices', license: 'MIT', url: 'https://huggingface.co/datasets/ellendan/a-share-prices' },
] }, null, 2))
console.log(`Saved ${result.length} securities; ${anchored} historical price anchors`)
