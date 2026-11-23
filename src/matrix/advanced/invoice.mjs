import {makeStage, reader, tool, call, obj, str, num, list, bool, arrayOf, same, verifiedAfter} from '../mock.mjs';
import {recoveryIssues} from './recovery.mjs';

export function advancedInvoice(caseSet) {
  const signedCorrection = ['case-b', 'case-d'].includes(caseSet);
  const timeoutCommitted = ['case-a', 'case-b'].includes(caseSet);
  const pendingReversal = caseSet === 'case-d';
  const invoiceId = 'AP-743', po = 'PO-823';
  const line = obj({line: str, amount: num});
  const lines = values => values.map((amount, index) => ({line: 'L' + (index + 1), amount}));
  const versions = [
    {revision: 'v1', digest: 'F91', quantities: [3, 4, 3]},
    {revision: 'v2', digest: 'B16', quantities: [3, 3, 3]},
    {revision: 'v3', digest: 'A04', quantities: [3, 1, 4]},
  ];
  const docs = versions.map(({revision, digest, quantities}) => ({
    invoiceId, po, revision, digest, source: 'DOC-' + digest,
    items: quantities.map((quantity, i) => ({orderLine: 'L' + (i+1), quantity, unitUSD: [20,20,10][i]})),
    printedUSD: quantities.reduce((sum, q, i) => sum + q * [20,20,10][i], 0),
  }));
  const authority = {asOf: 16, accepted: [
    {digest:'F91',supersedes:null,hour:8}, {digest:'B16',supersedes:'F91',hour:11},
    {digest:'A04',supersedes:'F91',hour:12},
    {digest:signedCorrection?'A04':'D88',supersedes:'B16',hour:14},
    {digest:'A04',supersedes:'D88',hour:18},
  ],rule:'Starting with the original, follow signed entries chronologically through 16:00 only. An entry is effective only when its predecessor is the current chain tip. Select the latest attached document on the effective chain. A newer signed digest without an attachment does not erase the preceding verified attachment.'};
  const revision = signedCorrection ? 'v3' : 'v2';
  const extracted = {invoiceId,po,revision,source:signedCorrection?'DOC-A04':'DOC-B16',
    gross:signedCorrection?120:150,lines:lines(signedCorrection?[60,20,40]:[60,60,30]),
    changedLines:signedCorrection?['L2','L3']:['L2']};
  const goods = {po,authorizedLines:lines([60,80,pendingReversal?15:50]),receipts:[
    {id:'GR1',line:'L1',acceptedUSD:60}, {id:'GR2',line:'L2',acceptedUSD:40},
    {id:'GR3',line:'L3',acceptedUSD:20}, {id:'RET2',line:'L2',acceptedUSD:-10,reversesPartOf:'GR2'}]};
  const credits = [
    {id:'CM4',line:'L1',amount:10,status:'posted'}, {id:'CM4',line:'L1',amount:10,status:'posted'},
    {id:'CM5',line:'L3',amount:10,status:'posted'}, {id:'VOID5',line:'L3',amount:-10,status:pendingReversal?'pending':'posted',reverses:'CM5'},
  ];
  const split = lines(pendingReversal?[50,20,5]:signedCorrection?[50,20,20]:[50,30,20]);
  const contested = lines(pendingReversal?[0,0,25]:signedCorrection?[0,0,20]:[0,30,10]);
  const payable = pendingReversal?75:signedCorrection?90:100, disputed = pendingReversal?25:signedCorrection?20:40;
  const receipts=['GR1','GR2','GR3','RET2'];
  const receiptEvidence=[{line:'L1',ids:['GR1']},{line:'L2',ids:['GR2','RET2']},{line:'L3',ids:['GR3']}];
  const approval={revision:'v2',lines:lines([50,30,20])};
  const balance={invoiceId,revision,payable,disputed,credit:pendingReversal?20:10,payLines:split,disputeLines:contested,receiptIds:receipts,receiptEvidence,freshApproval:signedCorrection};
  const fields={invoiceId:str,revision:str,payable:num,disputed:num,credit:num,payLines:arrayOf(line),disputeLines:arrayOf(line),receiptIds:list,
    receiptEvidence:arrayOf(obj({line:str,ids:list})),freshApproval:bool};
  const posting={invoiceId,revision,lines:split}, dispute={invoiceId,revision,lines:contested.filter(x=>x.amount>0),evidence:signedCorrection?['GR3']:['GR2','GR3','RET2']};
  const state={approval:structuredClone(approval),postings:[],disputes:[]};
  const sortedLines = values => [...values].sort((a,b)=>a.line.localeCompare(b.line));
  let firstWrite=true;
  const stages=[
    makeStage('FP-03','Select the effective, authenticated multi-line invoice as of cutoff. When citing a time, use the clock time as recorded. Include a time zone only if the source specifies one. Check printed totals against quantities and prices. Identify changed line IDs compared with its immediately preceding signed version and explain any rejected correction.',
      {invoiceId:str,po:str,revision:str,source:str,gross:num,lines:arrayOf(line),changedLines:list},extracted,[
        reader('get_invoice_documents','Retrieve the original and candidate amendments.',docs),
        reader('get_signature_chain','Read independent digest approvals, predecessor links and cutoff policy.',authority),
      ],[call('get_invoice_documents'),call('get_signature_chain')],{minReads:{get_invoice_documents:1,get_signature_chain:1}}),
    makeStage('FP-04','Use the handed-off revision and its lines. Per line cap accepted receipts net of returns at the invoice and order amounts, then deduct distinct posted credits net of reversals. Dispute the unsupported invoiced balance before credits. Include zero-valued dispute lines, all receipt/return IDs, and whether the handoff needs new approval. Compare the selected revision and net line payables after credits with the current authorization. Explain a sufficient reason for renewal.',
      fields,balance,[reader('get_goods_records','Read order and signed receipt/return entries.',goods),
        reader('get_credit_and_approval','Read line credits and line-level authorization.',{credits,approval})],
      [call('get_goods_records'),call('get_credit_and_approval')],{
        minReads:{get_goods_records:1,get_credit_and_approval:1},
        handoffIssue(input){
          const document=docs.find(doc=>doc.source===input?.source);
          return document&&input.invoiceId===invoiceId&&input.po===po&&document.revision===input.revision
            ? null : 'Unknown invoice, source or order in intake handoff';
        },
      }),
    makeStage('FP-06','Settle the verified line allocations in the upstream handoff. Check the approved revision and line amounts. Reuse a current approval and describe what read_approval returned. If approval is stale, renew it. A successful request_approval issues signed authorization for the new revision and line amounts. Attribute issuance to that action. The approval reader verifies the revision and amounts only. Open disputes for positive disputed lines with receipt evidence. Recover an uncertain posting from ledger state before retrying. Verify exactly one posting and one dispute covering the contested lines.',
      {invoiceId:str,revision:str,posted:num,disputed:num,postingCount:num,disputeCount:num},
      {invoiceId,revision,posted:payable,disputed,postingCount:1,disputeCount:1},[
        tool('read_approval','Read currently authorized invoice revision and line amounts.',{},()=>structuredClone(state.approval)),
        tool('request_approval','Request signed line authorization for the verified revision.',{revision:str,lines:arrayOf(line)},a=>{
          if(a.revision!==revision || !same(sortedLines(a.lines),split)) throw Error('Line authorization denied');
          state.approval={revision:a.revision,lines:sortedLines(a.lines)};return structuredClone(state.approval);
        }),
        tool('post_ledger','Post the approved revision and line amounts.',{invoiceId:str,revision:str,lines:arrayOf(line)},a=>{
          if(a.invoiceId!==invoiceId||a.revision!==revision||a.revision!==state.approval.revision||!same(sortedLines(a.lines),state.approval.lines))throw Error('Invalid authorization');
          const uncertain=firstWrite; firstWrite=false;
          if(!uncertain||timeoutCommitted)state.postings.push({...a,lines:sortedLines(a.lines)});
          if(uncertain)throw Error('Ledger acknowledgment timeout. Commit status unknown.');
          return {posted:true};
        }),
        tool('open_dispute','Open a dispute. Supply all receipt and return IDs supporting each contested line. The system links those records to the line; other valid invoice receipts may also be supplied.',{invoiceId:str,revision:str,lines:arrayOf(line),evidence:list},a=>{
          if(a.invoiceId!==invoiceId||a.revision!==revision||!a.lines.length||a.lines.some(x=>x.amount<=0))throw Error('Invalid dispute');
          const required=goods.receipts.filter(r=>a.lines.some(l=>l.line===r.line)).map(r=>r.id).sort();
          if(!required.every(id=>a.evidence.includes(id))||a.evidence.some(id=>!goods.receipts.some(r=>r.id===id)))throw Error('Missing or unknown receipt evidence');
          state.disputes.push({...a,lines:sortedLines(a.lines),evidence:required});return {opened:true};
        }),
        tool('read_ledger','Authoritative committed postings and disputes for every revision.',{},()=>structuredClone({postings:state.postings,disputes:state.disputes})),
      ],[call('read_approval'),...(signedCorrection?[call('request_approval',{revision,lines:split})]:[]),
        call('post_ledger',posting),call('read_ledger'),...(!timeoutCommitted?[call('post_ledger',posting)]:[]),
        call('open_dispute',dispute),call('read_ledger')],{
        minReads:{read_approval:1},
        handoffIssue(input){
          if(input?.invoiceId!==invoiceId||!versions.some(v=>v.revision===input.revision))return 'Unknown invoice revision in settlement handoff';
          if(!Array.isArray(input.payLines)||!Array.isArray(input.disputeLines)||
            input.payLines.reduce((s,l)=>s+l.amount,0)!==input.payable||
            input.disputeLines.reduce((s,l)=>s+l.amount,0)!==input.disputed)return 'Unbalanced line allocations';
          return null;
        },
        stateCheck(trace){
          const issues=recoveryIssues(trace,'post_ledger','read_ledger');
          if(trace.filter(e=>e.name==='request_approval').length!==(signedCorrection?1:0))
            issues.push('incorrect approval renewal count');
          if(!same(state.postings,[posting])||!same(state.disputes,[dispute]))issues.push('wrong ledger or dispute state');
          if(!verifiedAfter(trace,'read_ledger',['post_ledger','open_dispute']))issues.push('missing final ledger verification');
          return issues;
        },
      }),
  ];
  return {caseRef:invoiceId,stages,state};
}
