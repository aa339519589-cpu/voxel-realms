const { chromium } = require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--disable-dev-shm-usage','--no-sandbox']});
 for (const mode of ['desktop','mobile']){
  const page=await browser.newPage({viewport:mode==='mobile'?{width:393,height:852}:{width:1280,height:800},isMobile:mode==='mobile',hasTouch:mode==='mobile',deviceScaleFactor:1});
  const faults=[];page.on('pageerror',e=>faults.push(e.stack||String(e)));page.on('console',m=>{if(m.type()==='error')faults.push(m.text())});
  await page.goto('http://localhost:9000/strata-world/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(9000);
  const state=await page.evaluate(()=>({loaded:document.getElementById('loadscreen')?.className,loadtext:document.getElementById('loadtext')?.textContent,loadDisplay:document.getElementById('loadscreen')?.style.display,canvas:!!document.querySelector('canvas.webgl'),size:document.querySelector('canvas.webgl')?.getBoundingClientRect().toJSON(),fps:document.getElementById('fps')?.textContent,draws:document.getElementById('draws')?.textContent,animals:document.getElementById('animals')?.textContent,time:document.getElementById('timeReadout')?.textContent,webgl:!!document.querySelector('canvas.webgl')?.getContext('webgl2')}));
  await page.screenshot({path:'/tmp/strata-'+mode+'.png'});
  console.log('STRATA_'+mode.toUpperCase()+'_STATE',JSON.stringify(state));console.log('STRATA_'+mode.toUpperCase()+'_ERRORS',JSON.stringify(faults.slice(0,20)));await page.close();
 }
 await browser.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
