import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const url = 'http://127.0.0.1:4173/'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
let browser
const checks = []
const check = async (name, run) => { await run(); checks.push(name); console.log(`✓ ${name}`) }

try {
  let ready = false
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error(`Vite exited: ${server.exitCode}`)
    try { const response = await fetch(url); if (response.ok) { ready = true; break } } catch { /* Wait for local dev server. */ }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.ok(ready, 'Vite did not start')
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  await check('A 股首页与移动端导航', async () => {
    await page.getByRole('button', { name: 'A 股', exact: true }).waitFor()
    assert.equal(await page.locator('.app-shell').getAttribute('data-market'), 'cn')
    await page.getByRole('button', { name: '行情', exact: true }).click()
    await page.getByText('5499只').waitFor()
    const width = await page.locator('.app-shell').evaluate(el => el.getBoundingClientRect().width)
    assert.equal(width, 390)
  })

  await check('港股切换、配色、搜索与日 K', async () => {
    await page.getByRole('button', { name: '港股', exact: true }).click()
    assert.equal(await page.locator('.app-shell').getAttribute('data-market'), 'hk')
    await page.getByText('20只').waitFor()
    const rise = await page.locator('.app-shell').evaluate(el => getComputedStyle(el).getPropertyValue('--rise').trim())
    assert.equal(rise, '#139669')
    await page.getByRole('button', { name: /搜索股票名称/ }).click()
    await page.getByPlaceholder('股票名称或代码').fill('腾讯')
    await page.getByText('腾讯控股', { exact: true }).first().waitFor()
    await page.getByRole('button', { name: '关闭搜索' }).click()
    await page.getByRole('button', { name: /腾讯控股/ }).first().click()
    await page.getByRole('button', { name: '日K' }).click()
    await page.locator('canvas').first().waitFor()
  })

  await check('港股买入、持仓、币种与独立账户', async () => {
    await page.getByRole('button', { name: '买入', exact: true }).click()
    await page.getByPlaceholder(/请输入股数/).fill('100')
    await page.getByRole('button', { name: '确认买入' }).click()
    await page.getByText('买入模拟成交 100 股').waitFor()
    await page.getByRole('button', { name: '资产', exact: true }).click()
    await page.getByText('总资产（HKD）').waitFor()
    await page.getByText('100 / 100').waitFor()
    await page.getByRole('button', { name: 'A 股', exact: true }).click()
    await page.getByText('总资产（CNY）').waitFor()
    await page.getByText('暂无持仓，去交易页买入股票').waitFor()
    await page.getByRole('button', { name: '港股', exact: true }).click()
    await page.getByText('100 / 100').waitFor()
  })

  await check('美股一股交易、当天卖出、刷新恢复', async () => {
    await page.getByRole('button', { name: '美股', exact: true }).click()
    await page.getByRole('button', { name: '交易', exact: true }).click()
    await page.getByPlaceholder(/请输入股数/).fill('1')
    await page.getByRole('button', { name: '确认买入' }).click()
    await page.getByText('买入模拟成交 1 股').waitFor()
    await page.getByRole('button', { name: '卖出', exact: true }).click()
    await page.getByPlaceholder(/请输入股数/).fill('1')
    await page.getByRole('button', { name: '确认卖出' }).click()
    await page.getByText('卖出模拟成交 1 股').waitFor()
    await page.getByRole('button', { name: '资产', exact: true }).click()
    await page.getByText('总资产（USD）').waitFor()
    await page.reload({ waitUntil: 'domcontentloaded' })
    assert.equal(await page.locator('.app-shell').getAttribute('data-market'), 'us')
    await page.getByRole('button', { name: '资产', exact: true }).click()
    await page.getByRole('button', { name: '成交', exact: true }).click()
    assert.equal(await page.getByText('已成交').count(), 2)
  })

  await check('A 股 T+1、暂停、限价挂单撤单、推进交易日', async () => {
    await page.getByRole('button', { name: 'A 股', exact: true }).click()
    await page.getByRole('button', { name: '交易', exact: true }).click()
    await page.getByRole('button', { name: '买入', exact: true }).click()
    await page.getByPlaceholder(/请输入股数/).fill('100')
    await page.getByRole('button', { name: '确认买入' }).click()
    await page.getByText('买入模拟成交 100 股').waitFor()
    await page.getByRole('button', { name: '资产', exact: true }).click()
    await page.getByRole('button', { name: '持仓', exact: true }).click()
    await page.getByText('100 / 0').waitFor()
    await page.getByRole('button', { name: '我的', exact: true }).click()
    await page.getByRole('button', { name: /暂停模拟行情/ }).click()
    await page.getByText('已暂停', { exact: true }).waitFor()
    await page.getByRole('button', { name: '交易', exact: true }).click()
    await page.getByRole('button', { name: '−' }).click()
    await page.getByPlaceholder(/请输入股数/).fill('100')
    await page.getByRole('button', { name: '确认买入' }).click()
    await page.getByText('模拟委托已提交，等待行情触价').waitFor()
    await page.getByRole('button', { name: '资产', exact: true }).click()
    await page.getByRole('button', { name: '可撤', exact: true }).click()
    await page.getByRole('button', { name: '撤单' }).click()
    await page.getByText('暂无可撤委托').waitFor()
    await page.getByRole('button', { name: '我的', exact: true }).click()
    await page.getByRole('button', { name: /进入下一交易日/ }).click()
    await page.getByRole('button', { name: '资产', exact: true }).click()
    await page.getByRole('button', { name: '持仓', exact: true }).click()
    await page.getByText('100 / 100').waitFor()
  })

  await check('搜索自选、三种 K 线周期与账户重置', async () => {
    await page.getByRole('button', { name: '行情', exact: true }).click()
    await page.getByRole('button', { name: /搜索股票名称/ }).click()
    await page.getByPlaceholder('股票名称或代码').fill('600018')
    await page.getByRole('button', { name: '切换自选' }).click()
    await page.getByRole('button', { name: '关闭搜索' }).click()
    await page.getByRole('button', { name: '自选', exact: true }).click()
    await page.getByRole('button', { name: /上港集团/ }).first().click()
    for (const period of ['日K', '周K', '月K']) {
      await page.getByRole('button', { name: period, exact: true }).click()
      await page.locator('canvas').first().waitFor()
    }
    await page.getByRole('button', { name: '返回' }).click()
    await page.getByRole('button', { name: '我的', exact: true }).click()
    await page.getByRole('button', { name: '重置模拟账户' }).click()
    await page.getByRole('button', { name: '确定重置' }).click()
    await page.getByRole('button', { name: '资产', exact: true }).click()
    await page.getByText('暂无持仓，去交易页买入股票').waitFor()
    await page.getByText('100,000.00').first().waitFor()
  })

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  assert.ok(overflow <= 1, `Mobile layout overflows by ${overflow}px`)

  assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`)
  console.log(`\n${checks.length} browser smoke checks passed`)
} finally {
  await browser?.close()
  server.kill()
}
