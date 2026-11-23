import {readFileSync} from 'node:fs';
import {makeStage, reader, tool, call, str, num, bool, list, same, verifiedAfter} from '../mock.mjs';
import {recoveryIssues} from './recovery.mjs';

const shipment = JSON.parse(readFileSync(new URL('../../../fixtures/shipment/advanced.json', import.meta.url)));
export function advancedShipment(caseSet) {
  const west = caseSet === 'case-b', laterDeadline = caseSet === 'case-d';
  const shipmentId = shipment.shipmentId;
  const leg = west ? 'A' : 'B', other = west ? 'B' : 'A';
  const region = west ? 'West' : 'East', cap = west ? 53000 : laterDeadline ? 55000 : 60000;
  const eventHour=13, service='Outbound', alarm='PICKUP_MISSED';
  const ticket={shipmentId,service,incidentEffectiveHour:eventHour,
    alarmDirectory:{'confirmed missed pickup':alarm,'tracking delay':'TRACK_LAG'},
    legs:[{id:'A',region:'West'},{id:'B',region:'East'}],
    claims:['Both legs missed pickup','Warehouse dashboard shows both legs staged'],
    scans:[{id:'SCAN-A',leg:'A',hour:11,outcome:'missed'},{id:'SCAN-B',leg:'B',hour:11,outcome:'missed'}]};
  const custody={asOfHour:eventHour,proofs:[
    {id:'P1',leg:'A',hour:12,status:'picked up',signedBy:'carrier'},
    {id:'P2',leg:'B',hour:12,status:'picked up',signedBy:'carrier'}],
    voids:[{proofId:'P1',hour:west?13:15,reason:'wrong manifest'},{proofId:'P2',hour:west?15:13,reason:'wrong manifest'}],
    routing:'A nonvoid signed custody proof overrides a missed scan. Keep the collected leg intact. Route the remaining missed leg to its regional dispatch desk using queue E-DISPATCH or W-DISPATCH.'};
  const route={shipmentId,leg,protectedLeg:other,region,service,alarm,eventHour,queue:west?'W-DISPATCH':'E-DISPATCH'};
  function rule(id,area,effective,capCents,carriers,split,status='approved') {
    return {id,area,effectiveHour:effective,capCents,carriers,split,status,service,alarm};
  }
  const policies=[rule('GLOBAL','all',12,70000,['North'],false),rule('E-8','East',8,60000,['North','East'],true),
    rule('W-6','West',9,53000,['East','North'],true),rule('W-9','West',16,72000,['East','North'],true),
    rule('E-12','East',laterDeadline?12:14,55000,['East','North'],true),
    rule('E-DRAFT','East',13,90000,['East','North'],true,'draft')];
  const book=west?'W-6':laterDeadline?'E-12':'E-8';
  const policy={shipmentId,leg,protectedLeg:other,region,runbook:book,capCents:cap,carriers:['East','North'],split:true};
  const {commitments,warehouse,quotes}=structuredClone(shipment);
  if(laterDeadline)commitments.priorityDue=shipment.revisedPriorityDue;
  const quoteIds=laterDeadline?['Q-71']:['Q-73','Q-74'];
  const proposed=laterDeadline?52000:56000, committed=west?0:proposed;
  const decision={shipmentId,leg,status:west?'needs_approval':'confirmed',quoteIds,proposedCents:proposed,
    committedCents:committed,extraApprovalCents:Math.max(0,proposed-cap),notices:west?0:1,
    cheapestOnTimeWholeCents:laterDeadline?52000:69000,splitCents:56000,priorityShortfallOnCheapestWhole:laterDeadline?0:2};
  const state={bookings:[{leg:other,quote:'EXISTING'}],dispatch:null,notices:[],approvalRequests:[]};
  let firstPriority=true;
  const offerFields={leg:str,runbook:str};
  // The warehouse and carriers expose the market only for the leg and policy passed through the workflow.
  function checkScope(a) {
    if(a.leg!==leg||a.runbook!==book)throw Error('No recovery authority for this leg and runbook');
  }
  const itinerary={leg,runbook:book,quoteIds};
  const stages=[
    makeStage('CS-01','Resolve conflicting warehouse, carrier and custody evidence at the incident cutoff. Identify the missed leg, the collected leg to protect, its regional dispatch queue and exact alarm-directory code. Pass incidentEffectiveHour as eventHour for policy selection. Explain why the other apparent miss is cleared. Attribute reported warehouse claims to their source. Establish collection or readiness only from records that directly verify it.',
      {shipmentId:str,leg:str,protectedLeg:str,region:str,service:str,alarm:str,eventHour:num,queue:str},route,[
        reader('read_ticket','Read the customer ticket, site mapping and initial scans.',ticket),
        reader('read_custody','Read signed custody proofs, void notices and routing rules.',custody),
      ],[call('read_ticket'),call('read_custody')],{minReads:{read_ticket:1,read_custody:1}}),
    makeStage('IT-02','Resolve the handed-off incident against approved rules effective at eventHour. Regional policy prevails over global policy. Within the same scope take the newest effective approved revision. Pass the protected leg, exact policy ID, permitted carriers, split permission and spending limit.',
      {shipmentId:str,leg:str,protectedLeg:str,region:str,runbook:str,capCents:num,carriers:list,split:bool},policy,[
        reader('search_runbooks','Return regional and global policy versions and publication status.',policies)
      ],[call('search_runbooks')],{minReads:{search_runbooks:1},
        handoffIssue(input){
          return input?.shipmentId===shipmentId&&ticket.legs.some(l=>l.id===input.leg&&l.region===input.region)&&
            input.protectedLeg!==input.leg&&input.service===service&&Object.values(ticket.alarmDirectory).includes(input.alarm)&&
            input.eventHour===ticket.incidentEffectiveHour ? null : 'Unknown shipment, leg, region, alarm or effective time';
        },
      }),
    makeStage('LG-05','Use the incoming runbook and leg to recover ten units against both delivery commitments. Choose the least expensive eligible full plan, explain the rejected alternatives, and compare its cost with delegated authority. Above the limit, request only the shortfall and leave bookings, dispatch and notices untouched. Within the limit, reserve, reconcile uncertain writes, verify carrier reservations, save dispatch, read it back before notifying, and verify the final notice. Account for the protected leg.',
      {shipmentId:str,leg:str,status:{type:'string',enum:['confirmed','needs_approval']},quoteIds:list,proposedCents:num,committedCents:num,extraApprovalCents:num,notices:num,
        cheapestOnTimeWholeCents:num,splitCents:num,priorityShortfallOnCheapestWhole:num},decision,[
        tool('read_market','Read current commitments, stock, and indivisible quotes for the affected leg.',offerFields,a=>{
          checkScope(a);return {commitments,warehouse,quotes};
        }),
        tool('request_shortfall','Submit a pending spending request for the shortfall in cents; read_dispatch shows saved requests.',{...offerFields,extraCents:num},a=>{
          checkScope(a);
          if(a.extraCents<=0)throw Error('A positive shortfall is required');
          state.approvalRequests.push({...a});return {status:'pending'};
        }),
        tool('reserve_offer','Reserve the quote against the specified leg and effective regional authority. Each accepted call incurs a charge.',{...offerFields,quote:str},a=>{
          checkScope(a);
          const selected=quotes.find(q=>q.quoteId===a.quote);
          if(!selected)throw Error('Unknown quote');
          const prior=state.bookings.filter(x=>x.leg===leg).reduce((sum,x)=>sum+quotes.find(q=>q.quoteId===x.quote).priceCents,0);
          if(selected.priceCents+prior>cap)throw Error('Spend exceeds authority');
          const uncertain=a.quote==='Q-73'&&firstPriority;
          if(uncertain)firstPriority=false;
          if(!uncertain||caseSet!=='case-c')state.bookings.push({leg,quote:a.quote});
          if(uncertain)throw Error('Carrier acknowledgment timeout. Commit status unknown.');
          return {accepted:true};
        }),
        tool('read_carrier','Read all authoritative bookings for both legs.',{},()=>structuredClone(state.bookings)),
        tool('update_dispatch','Save a confirmed itinerary for the authorized leg.',{...offerFields,quoteIds:list},a=>{
          checkScope(a);
          const actual=state.bookings.filter(x=>x.leg===leg).map(x=>x.quote).sort();
          if(!actual.length||!same(actual,[...a.quoteIds].sort()))throw Error('Itinerary differs from bookings');
          state.dispatch={...a,quoteIds:actual};return {saved:true};
        }),
        tool('notify_customer','Send the saved itinerary to the order customer.',{},()=>{
          if(!state.dispatch)throw Error('No saved itinerary');
          state.notices.push(structuredClone(state.dispatch));return {sent:true};
        }),
        tool('read_dispatch','Verify current dispatch and delivered customer notices.',{},()=>structuredClone(state)),
      ],[call('read_market',{leg,runbook:book}),...(west?[call('request_shortfall',{leg,runbook:book,extraCents:proposed-cap})]:[
        ...quoteIds.flatMap(q=>[call('reserve_offer',{leg,runbook:book,quote:q}),...(q==='Q-73'?[call('read_carrier'),
          ...(caseSet==='case-c'?[call('reserve_offer',{leg,runbook:book,quote:q})]:[])]:[])]),
        call('read_carrier'),call('update_dispatch',itinerary),call('read_dispatch'),call('notify_customer')]),call('read_dispatch')],{
        minReads:{read_market:1,read_dispatch:1},
        handoffIssue(input){
          return input?.shipmentId===shipmentId&&input.leg===leg&&input.protectedLeg===other&&input.runbook===book
            ? null : 'Handoff does not authorize this leg and runbook';
        },
        stateCheck(trace){
          const issues=[];
          const key=x=>x.leg+'/'+x.quote;
          const expected=[{leg:other,quote:'EXISTING'},...(west?[]:quoteIds.map(quote=>({leg,quote})))];
          if(!same(state.bookings.map(key).sort(),expected.map(key).sort())||!same(state.dispatch,west?null:itinerary)||
            !same(state.notices,west?[]:[itinerary]))issues.push('incorrect booking, dispatch or customer state');
          const writes=['reserve_offer','update_dispatch','notify_customer'];
          if(west&&trace.some(e=>writes.includes(e.name)))issues.push('unauthorized write attempted');
          const requests=west?[{leg,runbook:book,extraCents:proposed-cap}]:[];
          if(!same(state.approvalRequests,requests)||west&&!verifiedAfter(trace,'read_dispatch',['request_shortfall']))
            issues.push('incorrect or unverified approval request');
          if(!west){
            const at=trace.findIndex(e=>e.name==='update_dispatch'&&!e.error);
            const notify=trace.findIndex(e=>e.name==='notify_customer'&&!e.error);
            if(!verifiedAfter(trace.slice(0,at),'read_carrier',['reserve_offer'])||
               !verifiedAfter(trace.slice(0,notify),'read_dispatch',['update_dispatch'])||
               !verifiedAfter(trace,'read_dispatch',['notify_customer']))issues.push('missing ordered verification');
            if(!laterDeadline)issues.push(...recoveryIssues(trace,'reserve_offer','read_carrier'));
          }
          return issues;
        },
      }),
  ];
  return {caseRef:shipmentId,stages,state};
}
