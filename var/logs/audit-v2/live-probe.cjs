// Live reference: pre-scroll, then viewport screenshots every 1080px + heading list with doc offsets
const { chromium } = require('playwright')
const fs = require('fs')
const out = process.env.OUT
;(async () => {
  const b = await chromium.launch()
  for (const [name, url] of process.argv.slice(2).map(s => s.split('='))) {
    const dir = `${out}/${name}`; fs.mkdirSync(dir, { recursive: true })
    const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
    await p.goto(url, { waitUntil: 'load', timeout: 60000 }).catch(e => console.log('goto', e.message))
    await p.waitForTimeout(5000)
    const go = y => p.evaluate(y => { if (window.lenis && window.lenis.scrollTo) window.lenis.scrollTo(y, { immediate: true, force: true }); else window.scrollTo(0, y) }, y)
    let h = 0
    for (let y = 0; y < 40000; y += 540) { await go(y); await p.waitForTimeout(250); h = await p.evaluate(() => document.documentElement.scrollHeight); if (y > h) break }
    await p.waitForTimeout(1500); await go(0); await p.waitForTimeout(3000)
    h = await p.evaluate(() => document.documentElement.scrollHeight)
    const heads = await p.evaluate(() => [...document.querySelectorAll('h1,h2,h3,h4,section')].map(e => { const r = e.getBoundingClientRect(); return { tag: e.tagName, y: Math.round(r.top + scrollY), h: Math.round(r.height), t: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 70) } }))
    fs.writeFileSync(`${dir}/sections.json`, JSON.stringify({ url, scrollHeight: h, heads }, null, 1))
    let i = 0
    for (let y = 0; y < h; y += 1080) { await go(y); await p.waitForTimeout(2500); const sy = await p.evaluate(() => Math.round(scrollY)); await p.screenshot({ path: `${dir}/${String(i++).padStart(2, '0')}_y${sy}.png`, timeout: 120000 }) }
    console.log(name, 'scrollHeight', h, 'shots', i)
    await p.close()
  }
  await b.close()
})()
