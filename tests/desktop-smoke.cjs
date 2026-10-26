const { _electron: electron, chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
(async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ridian-desktop-'));
  let app;
  try {
    fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
    app=await electron.launch({args:[path.join(__dirname,'..')],env:{...process.env,RIDIAN_TEST:'1',RIDIAN_DATA_DIR:directory}});
    const page=await app.firstWindow();await page.waitForSelector('#orb');
    const issues=[];page.on('pageerror',e=>issues.push(e.message));
    await page.getByRole('button',{name:/Open today/}).click();await page.waitForSelector('.sheet:not([hidden])');
    for(const title of ['完成今天最重要的一件事','读二十页喜欢的书','整理复习笔记']) {await page.getByRole('textbox',{name:'Add a task'}).fill(title);await page.locator('#task-input').press('Enter');await page.waitForFunction(t=>[...document.querySelectorAll('.task-text')].some(el=>el.textContent===t),title);}
    await page.getByRole('checkbox',{name:'完成今天最重要的一件事'}).click();
    await page.waitForFunction(()=>document.querySelector('.task.done'));
    const snapshot=await app.evaluate(()=>global.__ridianTest.service.store.snapshot());assert.equal(snapshot.tasks.length,3);assert.equal(snapshot.tasks.filter(t=>t.completedAt).length,1);
    const priorityButton=()=>page.getByRole('button',{name:/Priority: .*整理复习笔记/});
    await priorityButton().press('Enter');
    assert.equal(await page.getByRole('radio').count(),4);
    await page.getByRole('radio',{name:'Normal',exact:true}).press('Home');
    await page.getByRole('radio',{name:'Urgent',exact:true}).press('Escape');
    assert.equal(await page.locator('.sheet').isVisible(),true);
    assert.equal((await app.evaluate(()=>global.__ridianTest.service.store.snapshot())).tasks[2].priority,'normal');
    await priorityButton().click();
    await page.getByRole('radio',{name:'Urgent',exact:true}).click();
    await page.waitForSelector('.priority.urgent:not([disabled])');
    assert.equal((await app.evaluate(()=>global.__ridianTest.service.store.snapshot())).tasks[2].priority,'urgent');
    for (const level of ['Low','High']) {
      const start=await priorityButton().boundingBox();
      await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();
      const target=await page.getByRole('radio',{name:level,exact:true}).boundingBox();
      await page.mouse.move(start.x+start.width/2,target.y+target.height/2,{steps:12});
      await page.mouse.up();
      await page.waitForSelector(`.priority.${level.toLowerCase()}:not([disabled])`);
      assert.equal((await app.evaluate(()=>global.__ridianTest.service.store.snapshot())).tasks[2].priority,level.toLowerCase());
    }
    await page.screenshot({path:path.join(__dirname,'../test-results/widget.png')});
    const bounds=await app.evaluate(()=>global.__ridianTest.win.getBounds());assert.equal(bounds.width,356);assert.equal(bounds.height,468);
    await page.mouse.move(0,0);await page.evaluate(()=>window.ridian.hover(false));await app.evaluate(()=>global.__ridianTest.win.blur());await page.waitForTimeout(400);
    const opacity=await app.evaluate(()=>global.__ridianTest.win.getOpacity());assert.ok(opacity<0.6,`expected faded, got ${opacity}`);
    await page.evaluate(()=>window.ridian.hover(true));await page.waitForTimeout(350);assert.ok((await app.evaluate(()=>global.__ridianTest.win.getOpacity()))>.95);
    await page.getByRole('button',{name:'Collapse'}).click();await page.waitForSelector('#orb:not([hidden])');assert.equal((await app.evaluate(()=>global.__ridianTest.win.getBounds())).width,80);
    await page.screenshot({path:path.join(__dirname,'../test-results/orb.png')});
    const url=await app.evaluate(()=>`http://127.0.0.1:43127/#key=${global.__ridianTest.service.sessionToken}`);
    const journalPromise=app.waitForEvent('window');
    await app.evaluate(({BrowserWindow},url)=>{const preview=new BrowserWindow({width:1280,height:1000});preview.loadURL(url);},url);
    const journal=await journalPromise;await journal.waitForSelector('.connection-state.live');
    assert.equal(await journal.locator('.day-task').count(),3);assert.equal(await journal.locator('.day-task.done').count(),1);
    assert.ok(!(await journal.url()).includes('#key='));
    await journal.setViewportSize({width:1280,height:1000});await journal.screenshot({path:path.join(__dirname,'../test-results/journal.png'),fullPage:true});
    await journal.setViewportSize({width:390,height:844});await journal.screenshot({path:path.join(__dirname,'../test-results/mobile.png'),fullPage:true});
    assert.ok(await journal.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await journal.getByRole('button',{name:'Previous day'}).click();assert.equal(await journal.locator('.day-task').count(),0);
    await journal.getByRole('button',{name:/Today/}).click();assert.equal(await journal.locator('.day-task').count(),3);
    const native=await app.evaluate(()=>({alwaysOnTop:global.__ridianTest.win.isAlwaysOnTop(),allWorkspaces:global.__ridianTest.win.isVisibleOnAllWorkspaces()}));assert.ok(native.alwaysOnTop);assert.ok(native.allWorkspaces);
    assert.deepEqual(issues,[]);
    console.log('Desktop smoke passed: add, complete, priority, collapse, native fade/hover, always-on-top, shared journal, mobile layout, date navigation.');
  } finally {if(app)await app.close();fs.rmSync(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
