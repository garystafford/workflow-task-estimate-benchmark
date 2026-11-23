export const shipmentCases=[
  {id:'same-day-van',tier:0,description:'Choose the cheaper of two eligible vans for the missed collection.',number:631,
    leg:'A',region:'South',service:'Parcel',units:4,deadline:24,cap:130,cutoff:16,carriers:['Swift'],
    scans:[['A','carrier',8,'missed pickup']],quotes:[['V1','Swift',4,10,17,110],['V2','Swift',4,12,19,85]],selected:'V2',spend:85},
  {id:'capacity-limited',tier:0,description:'Book the single vehicle with enough space for all chilled totes.',number:632,
    leg:'C',region:'West',service:'Chilled',units:8,deadline:25,cap:180,cutoff:15,carriers:['ColdVan'],
    scans:[['C','carrier',9,'missed pickup']],quotes:[['C1','ColdVan',5,11,20,80],['C2','ColdVan',8,12,22,140]],selected:'C2',spend:140},
  {id:'arrival-window',tier:1,description:'Resolve stale tracking and reject the cheaper truck that arrives after the delivery window.',number:633,
    leg:'B',region:'North',service:'Freight',units:6,deadline:22,cap:200,cutoff:15,carriers:['Relay'],alternate:'retired',
    scans:[['B','tracking mirror',8,'tracking delayed'],['B','carrier',10,'missed pickup']],
    quotes:[['F1','Relay',6,11,23,105],['F2','Relay',6,13,22,155]],selected:'F2',spend:155},
  {id:'draft-carrier',tier:1,description:'Apply the approved carrier list despite a newer draft naming a cheaper carrier.',number:634,
    leg:'D',region:'West',service:'Priority',units:5,deadline:24,cap:175,cutoff:14,carriers:['Pace'],alternate:'draft',
    scans:[['D','warehouse',8,'awaiting driver'],['D','carrier',11,'missed pickup']],
    quotes:[['P1','Budget',5,12,18,78],['P2','Pace',5,14,20,145]],selected:'P2',spend:145},
  {id:'regional-waiver',tier:2,description:'Preserve the collected leg and apply a regional carrier rule that waives separate approval.',number:635,
    leg:'A',other:'B',region:'South',service:'Outbound',units:9,deadline:27,cap:230,cutoff:16,carriers:['SouthLine'],alternate:'global',
    scans:[['A','warehouse',8,'staged'],['B','carrier',9,'collected'],['A','carrier',10,'missed pickup']],
    quotes:[['S1','National',9,12,22,100],['S2','SouthLine',9,17,23,125],['S3','SouthLine',9,14,25,195]],selected:'S3',spend:195},
  {id:'regional-approval',tier:2,description:'Obtain regional authorization for the one eligible full load and preserve the other booking.',number:636,
    leg:'C',other:'A',region:'West',service:'Medical',units:12,deadline:25,cap:300,cutoff:15,carriers:['MedWest'],needsApproval:true,alternate:'global',
    scans:[['C','warehouse',8,'staged'],['C','carrier',10,'missed pickup'],['A','carrier',11,'collected']],
    quotes:[['M1','MedWest',10,11,22,160],['M2','National',12,12,22,175],['M3','MedWest',12,15,25,270]],selected:'M3',spend:270}
];

export function shipmentRecords(f) {
  const shipmentId='S-'+f.number,alarm='PICKUP_MISSED';
  const {leg,service,region,carriers,cutoff,cap,units}=f;
  const ticket={shipmentId,service,region,scans:f.scans.map(([leg,source,hour,status])=>({leg,source,hour,status})),
    sync:'current',queues:{'tracking inquiry':'Visibility','confirmed missed pickup':'Shipment Operations'},
    alarmCodes:{'missed pickup':alarm,'tracking delayed':'TRACK_LAG'}};
  const needsApproval=f.needsApproval??false;
  const runbook='RB-'+f.number;
  const current={id:runbook,service,alarm,region:f.alternate==='global'?region:'all',status:'approved',version:2,
    eligibleCarriers:carriers,departureCutoffHour:cutoff,allowSplit:false,needsApproval};
  const procedures=[current];
  if(f.alternate) procedures.unshift({...current,id:runbook+'-ALT',region:'all',version:f.alternate==='retired'?1:4,
    status:f.alternate==='global'?'approved':f.alternate,departureCutoffHour:19,
    eligibleCarriers:[f.alternate==='draft'?'Budget':'National'],needsApproval:!needsApproval});
  const catalog={sync:'current',precedence:'Use approved records only. A matching region overrides global policy. Within a scope use the highest effective approved version.',procedures};
  const quotes=f.quotes.map(([id,carrier,units,departure,arrival,price])=>({id,carrier,units,departure,arrival,price}));
  const market={shipmentId,leg,units,cap,deliveries:[{cumulativeUnits:units,byHour:f.deadline}],quotes};
  const keep=f.other?[{leg:f.other,quote:'EXISTING'}]:[];
  const routed={shipmentId,leg,service,alarm,queue:'Shipment Operations',region};
  const policy={shipmentId,leg,runbook,carriers,cutoff,allowSplit:false,needsApproval};
  const final={shipmentId,leg,quoteIds:[f.selected],spend:f.spend,noticeCount:1};
  return {ticket,catalog,market,keep,routed,policy,final};
}
