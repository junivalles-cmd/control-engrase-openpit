import fs from 'node:fs';
import path from 'node:path';

// Durable results supplement Playwright's final JSON; never enable retries or
// alter expected outcomes. A stopped process retains completed test evidence.
export default class ProgressReporter {
  onBegin(_config, suite) {
    this.directory = path.resolve(process.env.E2E_PROGRESS_DIR || 'node_modules/.cache/cleanup-progress');
    fs.mkdirSync(this.directory, {recursive:true});
    this.resultsPath = path.join(this.directory, 'results.jsonl');
    fs.writeFileSync(this.resultsPath, '');
    this.state = {startedAt:new Date().toISOString(),planned:suite.allTests().length,
      completed:0,passed:0,failed:0,skipped:0,status:'running'};
    fs.writeFileSync(path.join(this.directory, 'planned.json'), JSON.stringify(suite.allTests().map(test => ({
      id:test.id,file:test.location.file,title:test.title,project:test.parent.project()?.name,
    })),null,2));
    this.save();
  }
  onTestEnd(test, result) {
    const skipped = result.status === 'skipped';
    const passed = !skipped && result.status === test.expectedStatus;
    this.state.completed++;
    this.state[skipped ? 'skipped' : passed ? 'passed' : 'failed']++;
    fs.appendFileSync(this.resultsPath, JSON.stringify({id:test.id,file:test.location.file,
      title:test.title,project:test.parent.project()?.name,status:result.status,
      expectedStatus:test.expectedStatus,passed,skipped,duration:result.duration,
      retry:result.retry,annotations:test.annotations,errors:result.errors.map(error => ({
        message:error.message,stack:error.stack,
      })),endedAt:new Date().toISOString()})+'\n');
    this.save();
  }
  onError(error) {
    fs.appendFileSync(path.join(this.directory,'global-errors.jsonl'),JSON.stringify(error)+'\n');
  }
  onEnd(result) {
    this.state.status = result.status;
    this.state.endedAt = new Date().toISOString();
    this.save();
  }
  save() {
    const progressPath = path.join(this.directory,'progress.json');
    const content = JSON.stringify(this.state,null,2);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.writeFileSync(progressPath,content);
        return;
      } catch (error) {
        const transient = ['UNKNOWN','EBUSY','EPERM'].includes(error?.code);
        if (!transient || attempt === 4) return;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20 * (attempt + 1));
      }
    }
  }
}
