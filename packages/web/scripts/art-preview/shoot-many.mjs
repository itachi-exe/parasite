import puppeteer from 'puppeteer';
const D='/opt/hermes/.hermes/cache/scratch/pv2', O='/opt/hermes/projects/parasite-v2/shots/v2/crew';
const names=['red-headlamp','orange-antenna','yellow-fin','blue-earpods','purple-goggles','pink-beanie','white-crest','rust-scarf','black-dish','cyan-hood'];
const jobs=names.map((n,i)=>[`seat=${i}&form=human`,`${String(i).padStart(2,'0')}-${n}`]);
jobs.push(['seat=8&form=infected','10-infected'],['seat=8&form=parasite','11-parasite'],['seat=0&form=fallen','12-fallen']);
const b=await puppeteer.launch({headless:true,executablePath:'/opt/hermes/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',args:['--no-sandbox']});
const p=await b.newPage(); p.on('pageerror',e=>console.error(e.message));
for(const [q,f] of jobs){
  await p.setViewport({width:1000,height:400}); await p.goto(`file://${D}/single.html?${q}`);
  await p.waitForFunction('window.done===true');
  const d=await p.evaluate(()=>{const c=document.querySelector('canvas');return{w:c.width,h:c.height}});
  await p.setViewport({width:d.w,height:d.h}); await p.screenshot({path:`${O}/${f}.png`,clip:{x:0,y:0,width:d.w,height:d.h}});
}
await b.close(); console.log('ok', jobs.length);
