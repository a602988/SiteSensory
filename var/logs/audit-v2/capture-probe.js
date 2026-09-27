(async () => {
const { chromium } = await import('playwright')
const { capturePage } = await import('@sitesensory/capture-worker')
const { createLocalObjectStorage } = await import('@sitesensory/image')
const browser = await chromium.launch()
for (const url of process.env.URLS.split(',')) {
  const t = Date.now()
  try {
    const r = await capturePage({ browser, storage: createLocalObjectStorage(process.env.OUTDIR), timeoutMs: 45000, url })
    console.log('OK', url, JSON.stringify({ final: r.finalUrl, title: r.title, vp: r.viewport.objectKey, fp: r.fullPage.objectKey, secs: (Date.now()-t)/1000 }))
  } catch (e) { console.log('FAIL', url, (Date.now()-t)/1000, e && e.message) }
}
await browser.close()
})()
