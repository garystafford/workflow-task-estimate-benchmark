/* Deterministic clients for the local controls. They see business inputs and tool responses only. */
function extract(call) {
  const docs=call('get_invoice_documents');
  const registry=call('get_signature_chain');
  const chain=[];
  for(const entry of registry.accepted.filter(x=>x.hour<=registry.asOf).sort((a,b)=>a.hour-b.hour)){
    if(entry.supersedes===(chain.at(-1)?.digest??null))chain.push(entry);
  }
  const verified=chain.map(entry=>docs.find(d=>d.digest===entry.digest)).filter(Boolean);
  const doc=verified.at(-1),prior=verified.at(-2);
  const lines=doc.items.map(({orderLine,quantity,unitUSD})=>({line:orderLine,amount:quantity*unitUSD}));
  const gross=lines.reduce((n,x)=>n+x.amount,0);
  if(gross!==doc.printedUSD)throw Error('Invoice total mismatch');
  return {invoiceId:doc.invoiceId,po:doc.po,revision:doc.revision,source:doc.source,gross,lines,
    changedLines:lines.filter(x=>{const old=prior.items.find(y=>y.orderLine===x.line);return !old||old.quantity*old.unitUSD!==x.amount;}).map(x=>x.line)};
}
function reconcile(call, input) {
  const {authorizedLines,receipts}=call('get_goods_records');
  const {credits,approval}=call('get_credit_and_approval');
  const uniqueCredits=[...new Map(credits.filter(c=>c.status==='posted').map(c=>[c.id,c])).values()];
  const payLines=[],disputeLines=[];
  for(const item of input.lines){
    const authorized=authorizedLines.find(l=>l.line===item.line).amount;
    const accepted=receipts.filter(r=>r.line===item.line).reduce((s,r)=>s+r.acceptedUSD,0);
    const covered=Math.min(item.amount,authorized,accepted);
    const credit=uniqueCredits.filter(c=>c.line===item.line).reduce((s,c)=>s+c.amount,0);
    payLines.push({line:item.line,amount:covered-credit});
    disputeLines.push({line:item.line,amount:item.amount-covered});
  }
  return {invoiceId:input.invoiceId,revision:input.revision,credit:uniqueCredits.reduce((s,c)=>s+c.amount,0),
    payable:payLines.reduce((s,x)=>s+x.amount,0),disputed:disputeLines.reduce((s,x)=>s+x.amount,0),
    payLines,disputeLines,receiptIds:receipts.map(r=>r.id),
    receiptEvidence:input.lines.map(l=>({line:l.line,ids:receipts.filter(r=>r.line===l.line).map(r=>r.id)})),
    freshApproval:approval.revision!==input.revision};
}
function settle(call,input){
  const {invoiceId,revision}=input;
  let approval=call('read_approval');
  if(approval.revision!==revision)approval=call('request_approval',{revision,lines:input.payLines});
  if(input.payLines.some(l=>approval.lines.find(a=>a.line===l.line)?.amount!==l.amount))throw Error('Line approval mismatch');
  const posting={invoiceId,revision,lines:input.payLines};
  try{call('post_ledger',posting);}catch(e){
    if(!/timeout/i.test(e.message))throw e;
    if(!call('read_ledger').postings.some(p=>p.invoiceId===invoiceId&&p.revision===revision))call('post_ledger',posting);
  }
  const lines=input.disputeLines.filter(x=>x.amount>0);
  const evidence=input.receiptEvidence.filter(r=>lines.some(l=>l.line===r.line)).flatMap(r=>r.ids);
  if(lines.length)call('open_dispute',{invoiceId,revision,lines,evidence});
  const {postings,disputes}=call('read_ledger');
  const total=rows=>rows.flatMap(r=>r.lines).reduce((s,l)=>s+l.amount,0);
  return {invoiceId,revision,posted:total(postings),disputed:total(disputes),postingCount:postings.length,disputeCount:disputes.length};
}
function route(call){
  const ticket=call('read_ticket'), custody=call('read_custody');
  const voids=new Set(custody.voids.filter(v=>v.hour<=custody.asOfHour).map(v=>v.proofId));
  const collected=custody.proofs.filter(p=>p.signedBy==='carrier'&&p.hour<=custody.asOfHour&&!voids.has(p.id)).map(p=>p.leg);
  const missed=ticket.scans.find(s=>s.outcome==='missed'&&!collected.includes(s.leg));
  const {id:leg,region}=ticket.legs.find(l=>l.id===missed.leg);
  return {shipmentId:ticket.shipmentId,leg,protectedLeg:collected[0],region,service:ticket.service,alarm:ticket.alarmDirectory['confirmed missed pickup'],
    queue:region==='East'?'E-DISPATCH':'W-DISPATCH',eventHour:ticket.incidentEffectiveHour};
}
function procedure(call,input){
  const candidates=call('search_runbooks').filter(r=>r.status==='approved'&&r.service===input.service&&r.alarm===input.alarm&&
    r.effectiveHour<=input.eventHour&&(r.area===input.region||r.area==='all'));
  candidates.sort((a,b)=>Number(b.area===input.region)-Number(a.area===input.region)||b.effectiveHour-a.effectiveHour);
  const rule=candidates[0];
  return {shipmentId:input.shipmentId,leg:input.leg,protectedLeg:input.protectedLeg,region:input.region,
    runbook:rule.id,capCents:rule.capCents,carriers:rule.carriers,split:rule.split};
}
function recover(call,input){
  const {shipmentId,leg,runbook}=input,scope={leg,runbook};
  const {commitments:c,warehouse,quotes}=call('read_market',scope);
  const units=c.priorityUnits+c.remainingUnits;
  const allowed=quotes.filter(q=>input.carriers.includes(q.carrier));
  const candidates=allowed.map(q=>[q]);
  if(input.split&&c.splitAllowed&&warehouse.splitReleaseAllowed)
    for(let i=0;i<allowed.length;i++)for(const second of allowed.slice(i+1))candidates.push([allowed[i],second]);
  const cost=plan=>plan.reduce((s,q)=>s+q.priceCents,0);
  const eligible=candidates.filter(plan=>warehouse.readyUnits>=units&&plan.reduce((s,q)=>s+q.units,0)===units&&
    plan.every(q=>Date.parse(q.arrival)<=Date.parse(c.remainingDue))&&
    plan.filter(q=>Date.parse(q.arrival)<=Date.parse(c.priorityDue)).reduce((s,q)=>s+q.units,0)>=c.priorityUnits);
  const best=eligible.sort((a,b)=>cost(a)-cost(b))[0];
  const proposedCents=cost(best), quoteIds=best.map(q=>q.quoteId);
  const extraApprovalCents=Math.max(0,proposedCents-input.capCents);
  if(extraApprovalCents){
    call('request_shortfall',{...scope,extraCents:extraApprovalCents});
  }else{
    for(const quote of quoteIds){
      const args={...scope,quote};
      try{call('reserve_offer',args);}catch(e){
        if(!/timeout/i.test(e.message))throw e;
        if(!call('read_carrier').some(b=>b.leg===leg&&b.quote===quote))call('reserve_offer',args);
      }
    }
    const booked=call('read_carrier').filter(b=>b.leg===leg).map(b=>b.quote);
    call('update_dispatch',{...scope,quoteIds:booked});
    call('read_dispatch');
    call('notify_customer');
  }
  const final=call('read_dispatch');
  const committedCents=final.bookings.filter(b=>b.leg===leg).reduce((s,b)=>s+quotes.find(q=>q.quoteId===b.quote).priceCents,0);
  const cheapestWhole=allowed.filter(q=>q.units===units).sort((a,b)=>a.priceCents-b.priceCents)[0];
  return {shipmentId,leg,status:extraApprovalCents?'needs_approval':'confirmed',quoteIds,proposedCents,committedCents,extraApprovalCents,notices:final.notices.length,
    cheapestOnTimeWholeCents:Math.min(...eligible.filter(p=>p.length===1).map(cost)),
    splitCents:Math.min(...eligible.filter(p=>p.length>1).map(cost)),
    priorityShortfallOnCheapestWhole:Date.parse(cheapestWhole.arrival)>Date.parse(c.priorityDue)?c.priorityUnits:0};
}
function survey(call,input,projectId){
  const comments=call('get_responses'), reg=call('get_participation');
  const amendments=reg.sponsorRecord.amendments.filter(a=>a.signed&&a.effective<=reg.cutoff);
  const withdrawn=amendments.find(a=>a.action==='withdraw').site;
  const sites=reg.sponsorRecord.initialSites.filter(s=>s!==withdrawn).sort();
  const included=comments.filter(c=>sites.includes(c.site)&&!c.copyOf&&!reg.consentRevoked.includes(c.id));
  const topics=new Set(),disputedFrequencySites=[];
  for(const site of sites){
    const quotes=included.filter(c=>c.site===site).map(c=>c.text).join(' ').toLowerCase();
    if(/retype|re-entry/.test(quotes))topics.add('duplicate_entry');
    if(/approval queue/.test(quotes))topics.add('approval_wait');
    if(/validate|checklist/.test(quotes))topics.add('repeat_checks');
    if(/every time|many|twice/.test(quotes)&&/uncommon|occasional|rare/.test(quotes))disputedFrequencySites.push(site);
  }
  return {projectId,sites,withdrawn,topics:[...topics],disputedFrequencySites,evidenceIds:included.map(c=>c.id)};
}
function finding(call,input){
  const wb=call('get_workbook'),adj=call('get_adjustments'),ledger=call('get_site_ledger');
  const corrections=[...new Map(adj.entries.filter(x=>x.signed&&x.effective<=adj.cutoff).map(x=>[x.id,x])).values()];
  const discrepancies=[];
  const figures=input.sites.map(site=>{
    const row=wb.rows.find(r=>r.site===site), checked=ledger.records.find(r=>r.site===site);
    const affected=row.grossEvents-row.reopens-corrections.filter(c=>c.site===site).reduce((s,c)=>s+c.removeTraining,0);
    if(affected!==checked.events||row.denominator!==checked.total)
      discrepancies.push({site,workbookEvents:affected,ledgerEvents:checked.events});
    return {site,affected,denominator:row.denominator,ratePercent:100*affected/row.denominator};
  });
  const top=[...figures].filter(x=>x.ratePercent>=10).sort((a,b)=>b.ratePercent-a.ratePercent)[0];
  const fundingStatus=discrepancies.some(d=>d.site===top.site)?'withhold':'recommend';
  const result={projectId:input.projectId,packageId:ledger.packages[top.site],fundingStatus,discrepancies,eligibleSites:input.sites,figures,sources:[adj.id,ledger.id,wb.id]};
  call('save_finding',result);
  return call('read_finding');
}
function planning(call,input){
  const packet=call('get_delivery_capacity',{packageId:input.packageId}),change=call('get_staffing_changes');
  const staff=new Map(packet.roster.map(p=>[p.id,{...p}]));
  for(const c of change.changes.filter(c=>c.signed&&c.effective<=change.cutoff))staff.get(c.id).hoursPerDay=c.hoursPerDay;
  for(const c of change.rateChanges.filter(c=>c.signed&&c.effective<=change.cutoff))staff.get(c.id).rate=c.rate;
  const reviewer=packet.roster.find(p=>p.role==='reviewer'), review=staff.get(reviewer.id);
  const evaluated=[];
  for(const plan of packet.plans){
    const assignments=plan.engineers;
    if(assignments.reduce((s,a)=>s+a.hours,0)!==packet.buildHours||assignments.some(a=>staff.get(a.id).hoursPerDay<=0))continue;
    const finishDay=Math.max(...assignments.map(a=>Math.ceil(a.hours/staff.get(a.id).hoursPerDay)))+Math.ceil(packet.reviewHours/review.hoursPerDay);
    const costUSD=assignments.reduce((s,a)=>s+a.hours*staff.get(a.id).rate,packet.reviewHours*review.rate);
    if(costUSD<=packet.budgetUSD)evaluated.push({plan:plan.id,staff:[...assignments.map(a=>a.id),review.id],costUSD,finishDay,extensionDays:Math.max(0,finishDay-packet.deadlineDays)});
  }
  const best=evaluated.sort((a,b)=>a.extensionDays-b.extensionDays||a.costUSD-b.costUSD)[0];
  return {projectId:input.projectId,packageId:input.packageId,fundingStatus:input.fundingStatus,feasible:best.extensionDays===0,...best};
}
export const referenceClients={'FP-03':extract,'FP-04':reconcile,'FP-06':settle,'CS-01':route,'IT-02':procedure,'LG-05':recover,'RR-02':survey,'RR-06':finding,'SD-05':planning};
