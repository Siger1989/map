import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('map requests preempt queued offline traffic and cancellation releases bounded slots', (t) => {
  const jdk=process.env.JAVA_HOME;
  const binary=name=>jdk?join(jdk,'bin',name+(process.platform==='win32'?'.exe':'')):name;
  try{execFileSync(binary('javac'),['-version'],{windowsHide:true,stdio:'pipe',timeout:10000});}
  catch(error){if(error.code==='ENOENT')return t.skip('JDK required; set JAVA_HOME');throw error;}
  const folder=mkdtempSync(join(tmpdir(),'shantu-transfer-budget-'));
  try{
    execFileSync(binary('javac'),['--release','8','-d',folder,
      fileURLToPath(new URL('../mobile/android/src/com/guanyun/weather/MapTransferBudget.java',import.meta.url)),
      fileURLToPath(new URL('../mobile/android/test/com/guanyun/weather/MapTransferBudgetTest.java',import.meta.url)),
    ],{windowsHide:true,stdio:'pipe',timeout:20000});
    const output=execFileSync(binary('java'),['-cp',folder,'com.guanyun.weather.MapTransferBudgetTest'],{windowsHide:true,encoding:'utf8',timeout:10000});
    assert.match(output,/MapTransferBudgetTest PASS/);
  }finally{rmSync(folder,{recursive:true,force:true});}
});
