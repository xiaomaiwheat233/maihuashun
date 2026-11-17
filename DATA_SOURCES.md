# 股票目录与价格基准

`src/data/universe.json` 是静态游戏素材，不会在浏览器中爬取网站。当前版本包含 5,499 个证券代码与中文简称；其中 3,149 个有 2026-03-03 历史收盘价作为**模拟起始价格的参考**。其余起始价格由固定种子的算法生成。所有后续涨跌、成交量、成交额、分时、K 线和游戏委托成交均为本地模拟，不能当作任何日期的真实行情。

`src/data/global-stocks.ts` 另列港股、美股各 20 个常见证券代码和简称作为游戏示例。其 `anchor` 数值与港股示例手数为人为设定的模拟参数，不是实时价格、历史收盘价或交易所标准手数。用户在界面中切换市场后会看到明确的模拟提示。

## 名称和代码

从以下中文维基百科列表中提取活动上市条目，合并、去重并筛去页面中的未上市、终止上市等章节。原列表作者为维基百科贡献者；衍生的名称、代码及板块目录依 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 分享。页面内容会变化，本项目只保留生成时的快照。

- [上海证券交易所主板上市公司列表](https://zh.wikipedia.org/wiki/上海证券交易所主板上市公司列表)
- [上海证券交易所科创板上市公司列表](https://zh.wikipedia.org/wiki/上海证券交易所科创板上市公司列表)
- [深圳证券交易所主板上市公司列表](https://zh.wikipedia.org/wiki/深圳证券交易所主板上市公司列表)
- [深圳证券交易所创业板上市公司列表](https://zh.wikipedia.org/wiki/深圳证券交易所创业板上市公司列表)
- [北京证券交易所上市公司列表](https://zh.wikipedia.org/wiki/北京证券交易所上市公司列表)

## 历史价格参考

部分起始价来自 [ellendan/a-share-prices](https://huggingface.co/datasets/ellendan/a-share-prices) 提供的 2026-03-03 日收盘价。该数据集发布页标注 MIT 许可；这里仅保留收盘价和可用的行业字段，并未复制完整历史行情。原数据集的上游采集许可未能独立核验，因此这一参考价仅用于离线娱乐模拟，不声称代表当前市场价。网页中的起始价来源日期逐只标注。

## 更新

运行 `npm run refresh:universe` 可重新生成静态目录。脚本会检查数量，遇到历史数据服务限流时复用已保存的价格参考；运行 `node scripts/refresh-universe.mjs --reuse-prices` 可主动跳过价格抓取。重新生成后应检查 `src/data/universe-meta.json` 的数量、日期和来源，再构建发布。脚本仅供开发阶段手动运行；一键启动、生产网页都不会访问这些构建来源。

东方财富 `push2` / `push2his` 未用于制作此静态快照。其[服务协议](https://about.eastmoney.com/home/protocol)对行情数据复制与提供设有限制。
