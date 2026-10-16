// Run the real page, data loader and engine in Chromium with software WebGL2.
// A completed capture is diagnostic evidence, not a gameplay success assertion.
const {chromium} = require('playwright');
const fs = require('node:fs');
fs.mkdirSync('gameplay-report', {recursive:true});
const log = fs.createWriteStream('gameplay-report/browser.log');
let fatalError = false;
const record = text => { log.write(text+'\n'); console.log(text); };
(async () => {
  const browser = await chromium.launch({headless:true,args:[
    '--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'
  ]});
  const context = await browser.newContext({viewport:{width:960,height:540}});
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Profiler.enable');
  page.on('console', m => {if (/Sys_Error|Aborted\(/.test(m.text())) fatalError=true;record(m.type()+': '+m.text());});
  page.on('pageerror', e => {fatalError=true;record('PAGE ERROR: '+e.stack);});
  page.on('crash', () => {fatalError=true;record('PAGE CRASH');});
  await page.goto('http://127.0.0.1:8765/?mobile=1');
  await page.evaluate(() => {
    const phase=window.KBZBootLog.phase;
    window.KBZBootLog.phase=(message)=>{console.log('[PHASE] '+message);return phase(message);};
  });
  const gl = await page.evaluate(() => {
    const c=document.createElement('canvas').getContext('webgl2');
    if (!c) return null;
    const result={version:c.getParameter(c.VERSION),renderer:c.getParameter(c.RENDERER)};
    c.getExtension('WEBGL_lose_context')?.loseContext();
    return result;
  });
  record('WEBGL: '+JSON.stringify(gl));
  if (!gl) throw new Error('Test environment has no WebGL2');
  await page.click('[data-view="settings"]');
  await page.selectOption('#bm-resolution','640x360');
  await page.selectOption('#bm-audio','off');
  await page.click('[data-view="maps"]');
  await cdp.send('Profiler.start');
  await page.click('#bm-start',{noWaitAfter:true});
  await new Promise(resolve=>setTimeout(resolve,180000));
  const profileResult = await Promise.race([cdp.send('Profiler.stop'),new Promise(resolve=>setTimeout(()=>resolve(null),5000))]);
  if (profileResult) {
    fs.writeFileSync('gameplay-report/profile.json',JSON.stringify(profileResult.profile));
    const counts=new Map();
    for(const id of profileResult.profile.samples||[])counts.set(id,(counts.get(id)||0)+1);
    const hot=profileResult.profile.nodes.map(n=>({samples:counts.get(n.id)||0,frame:n.callFrame})).sort((a,b)=>b.samples-a.samples).slice(0,25);
    record('CPU PROFILE: '+JSON.stringify(hot));
  }
  const snapshot = (async () => {
    const state = await page.evaluate(() => ({status:document.getElementById('status')?.textContent,
      fs:Module.KBFS?.snapshot(),started:Module.calledRun,canvas:{width:Module.canvas.width,height:Module.canvas.height}}));
    record('FINAL STATE: '+JSON.stringify(state));
    fs.writeFileSync('gameplay-report/state.json',JSON.stringify(state,null,2));
    await page.evaluate(()=>window.BO1ZMenu.exposeEngine());
    await page.screenshot({path:'gameplay-report/engine.png',timeout:10000});
    await page.locator('#canvas').screenshot({path:'gameplay-report/canvas-before.png',timeout:10000});
    if (fatalError) throw new Error('Engine failed; screenshots captured, input test cannot establish gameplay');
    await page.evaluate(()=>Module._KBMobile_Key(119,1));
    await new Promise(resolve=>setTimeout(resolve,1500));
    await page.evaluate(()=>{Module._KBMobile_Key(119,0);Module._KBMobile_Look(80,0);Module._KBMobile_Key(-1,1);});
    await new Promise(resolve=>setTimeout(resolve,300));
    await page.evaluate(()=>Module._KBMobile_Key(-1,0));
    await page.locator('#canvas').screenshot({path:'gameplay-report/canvas-after-input.png',timeout:10000});
    record('INPUT PROBE: movement, look and fire delivered; inspect screenshots for game response');
  })();
  await Promise.race([snapshot,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Renderer unresponsive after capture window')),30000))]);
  await browser.close();
  log.end();
})().catch(e=>{record('CAPTURE ERROR: '+e.stack);log.end(()=>process.exit(1));});
