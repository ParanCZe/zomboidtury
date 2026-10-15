// Run the real page, data loader and engine in Chromium with software WebGL2.
// A completed capture is diagnostic evidence, not a gameplay success assertion.
const {chromium} = require('playwright');
const fs = require('node:fs');
fs.mkdirSync('gameplay-report', {recursive:true});
const log = fs.createWriteStream('gameplay-report/browser.log');
const record = text => { log.write(text+'\n'); console.log(text); };
(async () => {
  const browser = await chromium.launch({headless:true,args:[
    '--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'
  ]});
  const context = await browser.newContext({viewport:{width:960,height:540}});
  const page = await context.newPage();
  page.on('console', m => record(m.type()+': '+m.text()));
  page.on('pageerror', e => record('PAGE ERROR: '+e.stack));
  page.on('crash', () => record('PAGE CRASH'));
  await page.goto('http://127.0.0.1:8765/?mobile=1');
  const gl = await page.evaluate(() => {
    const c=document.createElement('canvas').getContext('webgl2');
    if (!c) return null;
    const result={version:c.getParameter(c.VERSION),renderer:c.getParameter(c.RENDERER)};
    c.getExtension('WEBGL_lose_context')?.loseContext();
    return result;
  });
  record('WEBGL: '+JSON.stringify(gl));
  if (!gl) throw new Error('Test environment has no WebGL2');
  await page.selectOption('#bm-resolution','640x360');
  await page.selectOption('#bm-audio','off');
  await page.click('#bm-start',{noWaitAfter:true});
  await new Promise(resolve=>setTimeout(resolve,180000));
  const snapshot = (async () => {
    const state = await page.evaluate(() => ({status:document.getElementById('status')?.textContent,
      fs:Module.KBFS?.snapshot(),started:Module.calledRun,canvas:{width:Module.canvas.width,height:Module.canvas.height}}));
    record('FINAL STATE: '+JSON.stringify(state));
    fs.writeFileSync('gameplay-report/state.json',JSON.stringify(state,null,2));
    await page.evaluate(()=>window.BO1ZMenu.exposeEngine());
    await page.screenshot({path:'gameplay-report/engine.png',timeout:10000});
  })();
  await Promise.race([snapshot,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Renderer unresponsive after capture window')),15000))]);
  await browser.close();
  log.end();
})().catch(e=>{record('CAPTURE ERROR: '+e.stack);log.end(()=>process.exit(1));});
