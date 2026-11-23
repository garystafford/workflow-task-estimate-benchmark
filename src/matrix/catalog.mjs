import {invoice} from './invoice.mjs';
import {shipment} from './shipment.mjs';
import {project} from './project.mjs';
import {callInterface,inspect} from './mock.mjs';
import {advancedInvoice} from './advanced/invoice.mjs';
import {advancedShipment} from './advanced/shipment.mjs';
import {advancedProject} from './advanced/project.mjs';
import {referenceClients} from './advanced/reference.mjs';

import {invoiceCases} from './coverage/invoice.mjs';
import {shipmentCases} from './coverage/shipment.mjs';
import {projectCases} from './coverage/project.mjs';

export const lowerCases={invoice:invoiceCases,shipment:shipmentCases,project:projectCases};
export const advancedCases=['case-a','case-b','case-c','case-d'];
const lowerTierBuilders={invoice,shipment,project};
const advanced={invoice:advancedInvoice,shipment:advancedShipment,project:advancedProject};
export const workflows=Object.fromEntries(Object.entries(lowerTierBuilders).map(([name,build])=>[
  name, (tier,caseSet='case-a')=>{
    if(tier!==3) {
      if(caseSet==='case-a')return build(tier);
      const fixture=lowerCases[name].find(f=>f.tier===tier && f.id===caseSet);
      if(!fixture)throw Error('Unknown '+name+' lower-tier case: '+caseSet);
      return build(tier,fixture);
    }
    if(!advancedCases.includes(caseSet))throw Error('Unknown Advanced case set: '+caseSet);
    return advanced[name](caseSet);
  }
]));
export const tiers=['Routine','Standard','Complex','Advanced'];
export const workflowNames = [...Object.keys(workflows), 'travel-expense', 'employee-knowledge'];
export function control(workflow,tier,caseSet='case-a') {
  const scenario=workflows[workflow](tier,caseSet);
  const checks=[];
  let handoff=null;
  for(const stage of scenario.stages) {
    if(stage.handoffIssue?.(handoff,true))throw Error('Invalid reference handoff for '+stage.id);
    const trace=[],invoke=callInterface(stage,trace);
    let result;
    if(tier===3){
      result=referenceClients[stage.id](invoke,handoff,scenario.caseRef);
    }else for(const {name,args} of stage.controls) {
      try {invoke(name,args);} catch(e) {
        if(!e.message.toLowerCase().includes('timeout')&&!e.message.includes('timed out')) throw e;
      }
    }
    const answer={...structuredClone(result??stage.expected),explanation:'Reference output for the local control.'};
    const issues=inspect(stage,answer,trace);
    if(issues.length)throw Error([workflow,tiers[tier],stage.id,...issues].join(' '));
    // Every output field is checked independently. An empty trace must also fail.
    for(const key of Object.keys(stage.expected)) {
      const bad={...answer,[key]:null};
      if(!inspect(stage,bad,trace).includes('incorrect '+key))throw Error('Unchecked field '+key);
    }
    if(!inspect(stage,answer,[]).length)throw Error('Missing trace was accepted');
    if(stage.stateCheck) {
      const last=trace.findLastIndex(e=>!e.error);
      if(!inspect(stage,answer,trace.slice(0,last)).length)throw Error('Missing verification was accepted');
    }
    const identity=answer.invoiceId??answer.shipmentId??answer.projectId;
    if(identity!==scenario.caseRef||handoff&&identity!==(handoff.invoiceId??handoff.shipmentId??handoff.projectId)) throw Error('Broken case identity');
    checks.push({id:stage.id,input:handoff,answer,trace,pass:true});
    handoff=answer;
  }
  return {workflow,tier:tiers[tier],...(tier===3||!advancedCases.includes(caseSet)?{caseSet}:{}),checks,finalState:scenario.state};
}


export function coveragePlan(selectedWorkflows = Object.keys(workflows)) {
  const controls = [];
  for (const workflow of selectedWorkflows) {
    for (const tier of tiers.keys()) {
      const caseSets = tier === 3 ? advancedCases :
        ['case-a', ...lowerCases[workflow].filter(f => f.tier === tier).map(f => f.id)];
      for (const caseSet of caseSets) {
        controls.push({...control(workflow, tier, caseSet), caseSet});
      }
    }
  }
  const jobs=[];
  for(const rep of [1,2,3]) for(const c of controls) for(const stage of [-1,0,1,2]) {
    const key=[rep,c.workflow,c.tier,c.caseSet,stage<0?'end-to-end':c.checks[stage].id].join('_');
    jobs.push({rep,w:c.workflow,tier:tiers.indexOf(c.tier),caseSet:c.caseSet,stage,key});
  }
  return {controls,jobs};
}
