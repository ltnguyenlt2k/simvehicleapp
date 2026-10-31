const {chromium,expect}=require('@playwright/test');
const BASE=process.env.STUDIO_URL||'http://127.0.0.1:3180';
(async()=>{
 const browser=await chromium.launch({headless:false,args:['--disable-dev-shm-usage']});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(BASE,{waitUntil:'networkidle'});await page.locator('.app-nav button').first().click();
  const registry=await(await page.request.get(BASE+'/api/blocks')).json();expect(registry.blocks).toHaveLength(24);
  await page.getByLabel('Tên project mới',{exact:true}).fill('Kiểm tra 24 block qua palette');await page.getByRole('button',{name:'Canvas trống',exact:false}).click();await page.getByRole('button',{name:'Tạo project',exact:true}).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);let count=0;
  for(const block of registry.blocks){
   const button=page.locator('[data-block-id="'+block.id+'"]');
   if(count===0)await button.dragTo(page.getByTestId('workflow-canvas'),{targetPosition:{x:500,y:250}});else await button.click();
   count++;await expect(page.locator('.react-flow__node')).toHaveCount(count+1);
   await expect(page.locator('.inspector-title h2')).toHaveText(block.title.vi||block.title.en);
   await expect(page.getByTestId('selected-node-id')).toContainText('step_');
  }
  await page.getByRole('button',{name:'Xóa bước này',exact:true}).click();await expect(page.locator('.react-flow__node')).toHaveCount(24);
  await page.getByRole('button',{name:'Tín hiệu RSS',exact:true}).click();await page.getByLabel('Tìm bước hoặc tín hiệu').fill('Robot.PowerSystem.Battery.StateOfCharge');await expect(page.locator('.rss-item')).toHaveCount(1);
  expect(errors).toEqual([]);await page.screenshot({path:'/evidence/palette-24.png',fullPage:true});console.log(JSON.stringify({passed:true,blocks:count,htmlDragDrop:true,deletion:true,rssSearch:true,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
