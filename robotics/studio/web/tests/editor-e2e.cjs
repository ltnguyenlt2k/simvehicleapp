const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const BASE=process.env.STUDIO_URL||'http://127.0.0.1:3180';
(async()=>{
 const browser=await chromium.launch({headless:false,args:['--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try {
  await page.goto(BASE,{waitUntil:'networkidle'});
  await expect(page.locator('[data-template="RW-C"]')).toBeVisible();
  await page.getByLabel('Tên project mới',{exact:true}).fill('Kiểm chứng giao diện · '+Date.now());
  await page.locator('[data-template="RW-C"]').click();
  await page.getByRole('button',{name:'Tạo project',exact:true}).click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.screenshot({path:'/evidence/studio-editor.png',fullPage:true});
  await page.getByLabel('Cho phép Arm SIM trong bản build này').check();
  await expect(page.locator('.diagnostic-ok')).toBeVisible({timeout:10000});
  await page.getByRole('button',{name:'Build',exact:true}).click();
  await expect(page.getByRole('button',{name:'Deploy',exact:true})).toBeEnabled({timeout:15000});
  await page.getByRole('button',{name:'Deploy',exact:true}).click();
  await expect(page.getByRole('button',{name:'▶ Chạy thử trên Mock',exact:true})).toBeEnabled();
  await expect(page.locator('.job-state')).toContainText('Chưa chạy bản deploy này');
  await page.screenshot({path:'/evidence/studio-deployed.png',fullPage:true});
  await page.getByRole('button',{name:'▶ Chạy thử trên Mock',exact:true}).click();
  await expect(page.locator('.job-state')).toContainText('Workflow đang chạy',{timeout:10000});
  await page.getByRole('button',{name:'Sự kiện: jump',exact:true}).click();
  await expect(page.getByLabel('Nhật ký workflow')).toContainText('SUCCEEDED',{timeout:15000});
  await page.getByLabel('Dừng khẩn cấp').click();
  await expect(page.locator('.job-state')).toContainText('Phiên đã kết thúc',{timeout:15000});
  await expect(page.locator('.job-state')).toContainText('Dừng đã được xác nhận');
  await page.screenshot({path:'/evidence/studio-stopped.png',fullPage:true});
  expect(errors).toEqual([]);
  console.log(JSON.stringify({passed:true,scope:'actual UI project/template/canvas/build/deploy/explicit start/event/native mock motion/confirmed stop',errors}));
 }catch(e){await page.screenshot({path:'/evidence/studio-failure.png',fullPage:true});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
