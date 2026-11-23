import {makeStage, reader, tool, call, str, num, list, bool, same, verifiedAfter, linkedReadCheck} from './mock.mjs';

import {shipmentRecords} from './coverage/shipment.mjs';

function baseRecords(t) {
  const standard=t===1, complex=t===2;
  const shipmentId='S-'+(520+t), leg=complex?'B':'A', alarm='PICKUP_MISSED', service='Outbound', region='East';
  const scans=[{leg,source:'carrier',hour:10,status:'missed pickup'}];
  if(standard)scans.unshift({leg,source:'tracking mirror',hour:9,status:'tracking delayed'});
  if(complex)scans.push({leg:'A',source:'carrier',hour:11,status:'collected'},{leg:'B',source:'warehouse',hour:9,status:'staged'});
  const ticket={shipmentId,service,region,scans,sync:'current',queues:{'tracking inquiry':'Visibility','confirmed missed pickup':'Shipment Operations'},alarmCodes:{'missed pickup':alarm,'tracking delayed':'TRACK_LAG'}};
  const runbook='RB-'+(201+t), carriers=complex?['EastAir']:['North'];
  const cutoff=standard?14:18;
  const current={id:runbook,service,alarm,region:complex?'East':'all',status:'approved',version:2,eligibleCarriers:carriers,departureCutoffHour:cutoff,allowSplit:false,needsApproval:complex};
  const old={...current,id:'RB-118',version:1,status:'retired',departureCutoffHour:18,allowSplit:false};
  const general={...current,id:'RB-150',region:'all',version:5,eligibleCarriers:['North'],needsApproval:false};
  const catalog={sync:'current',precedence:'Use approved records only. A matching region overrides global policy. Within a scope use the highest effective approved version.',procedures:t===0?[current]:complex?[current,general]:[old,current]};
  const routed={shipmentId,leg,service,alarm,queue:'Shipment Operations',region};
  const policy={shipmentId,leg,runbook,carriers,cutoff,allowSplit:false,needsApproval:complex};
  const quote=(id,carrier,units,departure,arrival,price)=>({id,carrier,units,departure,arrival,price});
  const quotes=[quote('Q1',complex?'EastAir':'North',10,12,24,complex?240:100),...(standard?[quote('Q2','North',10,16,22,80)]:complex?[quote('Q2','North',10,11,20,95)]:[])];
  const selected=['Q1'], spend=complex?240:100;
  const market={shipmentId,leg,units:10,cap:complex?250:150,deliveries:[{cumulativeUnits:10,byHour:26}],quotes};
  const keep=complex?[{leg:'A',quote:'EXISTING'}]:[];
  const final={shipmentId,leg,quoteIds:selected,spend,noticeCount:1};
  return {ticket,catalog,market,keep,routed,policy,final};
}

function runbookEvidence(t,catalog,routed,policy) {
  const search=call('search_runbooks');
  const readCatalog=data=>reader(search.name,'Retrieve approved and historical procedures with precedence rules.',data);
  if(t===1){
    const current=catalog.procedures.find(p=>p.id===policy.runbook);
    // One case tests geographic precedence, the others test version and approval status.
    const regional=routed.shipmentId==='S-633';
    const competing={...current,id:current.id+'-BASE',version:regional?8:1,
      departureCutoffHour:19,eligibleCarriers:regional?['National']:current.eligibleCarriers,needsApproval:true};
    const procedures=catalog.procedures.map(p=>p.id===current.id && regional?{...p,region:routed.region}:p);
    if(regional)procedures.push(competing);
    else procedures.unshift(competing);
    return {tools:[readCatalog({...catalog,procedures})],controls:[search],checks:{minReads:{search_runbooks:1}}};
  }
  if(t===2){
    const regional=catalog.procedures.find(p=>p.region===routed.region);
    const global=catalog.procedures.find(p=>p.region==='all');
    const references={'S-522':['EX-470','EX-226'],'S-635':['EX-738','EX-541'],'S-636':['EX-325','EX-879']};
    const [ref,otherRef]=references[routed.shipmentId];
    const otherRegion=routed.region==='East'?'West':'East';
    const entries=[{region:otherRegion,exceptionRef:otherRef},{region:routed.region,exceptionRef:ref}];
    if(routed.region==='South')entries.reverse();
    const packet={...catalog,procedures:[{...global,regionalExceptions:entries}],
      precedence:catalog.precedence+' Follow the regional exception listed by the matching base procedure for the shipment region. The effective approved exception supplies the governing runbook ID and all booking constraints.'};
    const exceptions=new Map([[ref,regional],[otherRef,{...global,id:global.id+'-X',region:otherRegion}]]);
    return {tools:[readCatalog(packet),tool('read_runbook_exception','Retrieve the full procedure using its regional exception reference.',{exceptionRef:str},({exceptionRef})=>{
      if(!exceptions.has(exceptionRef))throw Error('Unknown runbook exception');
      return structuredClone(exceptions.get(exceptionRef));
    })],controls:[search,call('read_runbook_exception',{exceptionRef:ref})],
    checks:{minReads:{search_runbooks:1},stateCheck:linkedReadCheck(search.name,'read_runbook_exception','exceptionRef',ref)}};
  }
  const book=readCatalog(catalog);
  return {tools:[book],controls:[search],checks:{minReads:{search_runbooks:1}}};
}

export function shipment(t,fixture) {
  const {ticket,catalog,market,keep,routed,policy,final}=fixture?shipmentRecords(fixture):baseRecords(t);
  const {shipmentId,leg,quoteIds:selected}=final;
  const {carriers,needsApproval}=policy;
  const {quotes}=market;
  const state={reservations:structuredClone(keep),dispatch:null,notices:[],approved:false};
  const routeReader=reader('read_ticket','Read queue rules, alarm codes and time-stamped scans.',ticket);
  const book=runbookEvidence(t,catalog,routed,policy);
  const receipt={shipmentId,leg,quoteIds:selected};
  const hourGuidance='These records express hours on a common numerical scale. Accept equivalent clock formatting and exact hour comparisons. The records supply no time zone. A named zone added solely to a historical scan is incidental when order and routing are unchanged. A named zone asserted for a binding departure cutoff, delivery deadline, customer commitment or a clock conversion requires evidence, even when the chosen quote is correct. Preserve all eligibility, approval, deadline and booking checks.';
  const stages=[
    makeStage('CS-01','Triage the shipment ticket. Resolve statuses by affected leg, timestamp and carrier evidence. If a correction is pending refresh before routing. Pass the exact applicable queue and identifiers.',{shipmentId:str,leg:str,service:str,alarm:str,queue:str,region:str},routed,[routeReader],[call('read_ticket')],{minReads:{read_ticket:1},gradingGuidance:hourGuidance}),
    makeStage('IT-02','Use the handed-off service, alarm and region to find the effective approved procedure. Refresh if a revision is publishing. Carry the shipment and leg into the booking constraints. cutoff is the latest permitted departure hour.',{shipmentId:str,leg:str,runbook:str,carriers:list,cutoff:num,allowSplit:bool,needsApproval:bool},policy,book.tools,book.controls,{...book.checks,gradingGuidance:hourGuidance}),
    makeStage('LG-05','Use the handed-off policy to select the cheapest eligible complete plan that satisfies every cumulative delivery deadline and cap. Obtain separate approval if the procedure requires it. Reserve the replacement, update dispatch, notify the customer once and verify the final records. Check carrier state after any uncertain write. Preserve existing unaffected legs. Explain the binding quote constraints and attribute the policy to the upstream handoff. Describe any limit on your own access precisely. Report a service failure only if observed.',{shipmentId:str,leg:str,quoteIds:list,spend:num,noticeCount:num},final,[
      reader('get_offers','Read shipment demand, carrier quotes with departure and arrival hours, and spend authority.',market),
      tool('get_booking_approval','Request approval for the selected quotes for the affected leg.',{quoteIds:list},a=>{
        const valid=a.quoteIds.every(id=>quotes.some(q=>q.id===id&&carriers.includes(q.carrier)));
        if(!valid)throw Error('Denied');state.approved=true;return {approved:true};
      }),
      tool('reserve_offer','Reserve a quote for the affected shipment leg. An uncertain acknowledgment requires a read before retrying.',{leg:str,quoteId:str},a=>{
        if(a.leg!==leg||!quotes.some(q=>q.id===a.quoteId)||needsApproval&&!state.approved)throw Error('Reservation refused');
        state.reservations.push({leg:a.leg,quote:a.quoteId});
        return {reserved:a.quoteId};
      }),
      tool('read_carrier','List current carrier reservations for all legs.',{},()=>structuredClone(state.reservations)),
      tool('update_dispatch','Save the confirmed replacement itinerary.',{shipmentId:str,leg:str,quoteIds:list},a=>{
        state.dispatch={...a,quoteIds:[...a.quoteIds].sort()};return {saved:true};
      }),
      tool('notify_customer','Send one confirmation listing all booked quotes.',{shipmentId:str,leg:str,quoteIds:list},a=>{
        state.notices.push({...a,quoteIds:[...a.quoteIds].sort()});return {sent:true};
      }),
      tool('read_dispatch','Read back the dispatch, all reservations and customer notifications.',{},()=>structuredClone(state))
    ],[call('get_offers'),...(needsApproval?[call('get_booking_approval',{quoteIds:selected})]:[]),...selected.map(id=>call('reserve_offer',{leg,quoteId:id})),call('update_dispatch',receipt),call('notify_customer',receipt),call('read_dispatch')],{
      gradingGuidance:hourGuidance,
      minReads:{get_offers:1},stateCheck(trace){
        const reservations=state.reservations.map(x=>x.leg+'/'+x.quote).sort();
        const expected=[...keep,...selected.map(quote=>({leg,quote}))].map(x=>x.leg+'/'+x.quote).sort();
        const ok=same(reservations,expected)&&same(state.dispatch,receipt)&&same(state.notices,[receipt])&&(fixture?state.approved===needsApproval:!needsApproval||state.approved);
        return [...(!ok?['incorrect carrier, dispatch or notification state']:[]),...(!verifiedAfter(trace,'read_dispatch',['reserve_offer','update_dispatch','notify_customer'])?['missing final dispatch verification']:[])];
      }
    })
  ];
  return {caseRef:shipmentId,stages,state};
}
