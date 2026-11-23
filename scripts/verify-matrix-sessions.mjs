import OpenAI from 'openai';
import {readdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {workflows} from '../src/matrix/catalog.mjs';

const dir=process.argv[2];
if(!dir)throw Error('Pass the completed run directory');
const read=async file=>JSON.parse(await readFile(file));
const plan=await read(join(dir,'manifest.json'));
const catalog = plan.suite === 'travel-expense' ? {expense: (await import('../src/matrix/travel-expense.mjs')).travelExpense}
  : plan.suite === 'employee-knowledge' ? {knowledge: (await import('../src/matrix/employee-knowledge.mjs')).employeeKnowledge}
  : workflows;
const files=(await readdir(join(dir,'runs'))).filter(f=>f.endsWith('.json'));
const controls=await read(join(dir,'controls.json'));
assert.equal(files.length,plan.repetitions*controls.reduce((sum,c)=>sum+1+c.checks.length,0));
const queue=[];
for(const file of files) {
  const r=await read(join(dir,'runs',file));
  for(const step of r.steps)queue.push({key:r.key,workflow:r.w,tier:r.tier,caseSet:r.caseSet,step});
}
const records=[];
const sessions=new OpenAI({maxRetries:3}).beta.agents.sessions;
async function audit(){
  while(queue.length){
    const {key,workflow,tier,caseSet,step}=queue.shift();
    const [session,initialTurn]=await Promise.all([
      sessions.retrieve(step.sessionId),
      sessions.turns.retrieve(step.turnId,{session_id:step.sessionId})
    ]);
    let turn=initialTurn;
    for(const wait of [1000,3000,10000]){
      if(turn.usage)break;
      await delay(wait);
      turn=await sessions.turns.retrieve(step.turnId,{session_id:step.sessionId});
    }
    assert.ok(turn.usage,'Hosted usage unavailable for '+step.turnId);
    assert.equal(turn.session_id,step.sessionId);
    assert.equal(turn.id,step.turnId);
    assert.equal(session.agent.model,plan.model);
    assert.equal(session.agent.reasoning.effort,plan.effort);
    assert.equal(session.environment.type,'none');
    assert.ok(['completed','failed','cancelled'].includes(turn.status),'Turn is not terminal: '+step.turnId);
    if(step.answer)assert.equal(turn.status,'completed');
    const tools=catalog[workflow](tier,caseSet).stages[step.index].tools.map(t=>t.definition.name).sort();
    assert.deepEqual(session.agent.tools.map(t=>t.name).sort(),tools);
    if(step.usage){
      for(const field of ['input_tokens','output_tokens','total_tokens'])assert.equal(turn.usage[field],step.usage[field]);
      assert.equal(turn.usage.input_tokens_details?.cached_tokens??0,step.usage.input_tokens_details?.cached_tokens??0);
    }
    records.push({key,task:step.task,sessionId:session.id,turnId:turn.id,model:session.agent.model,
      effort:session.agent.reasoning.effort,environment:session.environment.type,tools,status:turn.status,usage:turn.usage,
      delayedUsageRecovered:!step.usage});
  }
}
await Promise.all(Array.from({length:6},audit));
assert.equal(new Set(records.map(r=>r.sessionId)).size,records.length);
const file=join(dir,'verified-sessions.json');
await writeFile(file+'.tmp',JSON.stringify(records.sort((a,b)=>a.key.localeCompare(b.key)||a.task.localeCompare(b.task)),null,2));
await rename(file+'.tmp',file);
console.log('Checked '+records.length+' distinct server sessions and terminal turns against the local model, effort, tools and token records.');
