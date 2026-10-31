const {chromium,expect}=require('@playwright/test');
const fs=require('node:fs');
const BASE=process.env.STUDIO_URL||'http://127.0.0.1:3180';
(async()=>{
 const browser=await chromium.launch({headless:false,args:['--disable-dev-shm-usage']});const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[],results=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
 await page.goto(BASE,{waitUntil:'networkidle'});
 for(const template of ['RW-C','RW-A','RW-D','RW-B']){
  await page.locator('.app-nav button').first().click();await page.getByLabel('Chế độ mô phỏng').selectOption('sim');
  await page.getByLabel('Tên project mới',{exact:true}).fill('Test '+template+' · '+Date.now());await page.locator('[data-template="'+template+'"]').click();await page.getByRole('button',{name:'Tạo project',exact:true}).click();
  await page.getByLabel('Cho phép Arm SIM trong bản build này').check();await page.getByRole('button',{name:'Build',exact:true}).click();await expect(page.getByRole('button',{name:'Deploy',exact:true})).toBeEnabled({timeout:20000});await page.getByRole('button',{name:'Deploy',exact:true}).click();
  const editor=page.getByLabel('Kịch bản Test',{exact:true});await expect(editor).toBeVisible();
  const correct=JSON.parse(await editor.inputValue());
  await editor.fill('null');await expect(page.getByRole('button',{name:'Chạy Test trên Mock',exact:true})).toBeDisabled();await editor.fill(JSON.stringify(correct,null,2));
  for(const wrong of [false,true]){
   const scenario=structuredClone(correct);if(wrong)scenario.expect[0].count+=1;
   await editor.fill(JSON.stringify(scenario,null,2));await page.getByRole('button',{name:'Chạy Test trên Mock',exact:true}).click();
   await expect(page.getByTestId('scenario-result')).toHaveText(wrong?'FAIL':'PASS',{timeout:scenario.durationMs+20000});
   const report=await(await page.request.get(BASE+'/api/tests')).json();expect(report.report.safety.confirmed).toBe(true);
   results.push({template,wrongExpectation:wrong,report:report.report});
   fs.writeFileSync('/evidence/scenarios-ui.json',JSON.stringify({passed:results.length===9,results,errors},null,2));
   await page.screenshot({path:'/evidence/scenario-'+template+'-'+(wrong?'fail':'pass')+'.png',fullPage:true});
  }
  if(template==='RW-C'){
   const fault=structuredClone(correct);fault.name='Ép kết quả FAILED, cấm Disarm và quan sát đủ cửa sổ';fault.steps.unshift({atMs:0,commandResult:{path:'Robot.Motion.Perform',phase:'FAILED',count:1}});
   fault.expect=[{...fault.expect[0],phase:'FAILED'},{kind:'forbid',path:'Robot.Safety.Disarm',args:{},withinMs:[0,fault.durationMs]},{kind:'log',contains:'Không hoàn tất',count:1,withinMs:[0,fault.durationMs]}];
   await editor.fill(JSON.stringify(fault,null,2));await page.getByRole('button',{name:'Chạy Test trên Mock',exact:true}).click();
   await expect(page.getByTestId('scenario-result')).toHaveText('PASS',{timeout:fault.durationMs+20000});
   const {report}=await(await page.request.get(BASE+'/api/tests')).json();expect(report.observedDurationMs).toBeGreaterThanOrEqual(fault.durationMs);expect(report.safety.confirmed).toBe(true);
   results.push({template,forcedFailure:true,report});
   fs.writeFileSync('/evidence/scenarios-ui.json',JSON.stringify({passed:false,results,errors},null,2));
  }
 }
 expect(errors).toEqual([]);fs.writeFileSync('/evidence/scenarios-ui.json',JSON.stringify({passed:true,results,errors},null,2));console.log(JSON.stringify({passed:true,scope:'four templates: real native mock scenario correct PASS / wrong expectation FAIL',cases:results.length,errors}));
 }catch(e){await page.screenshot({path:'/evidence/scenarios-failure.png',fullPage:true});await page.getByLabel('Dừng khẩn cấp').click().catch(()=>{});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
