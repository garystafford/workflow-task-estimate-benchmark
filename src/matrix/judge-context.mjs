export function stageEvidence(stage, step, previousStep, access) {
  const toolNames=stage.tools.map(tool=>tool.definition.name);
  const context={};
  if(access){
    if(access.sessionId!==step.sessionId || access.turnId!==step.turnId)throw Error('Hosted access evidence belongs to a different turn');
    context.hostedAccess={environment:access.environment,directTools:access.directTools,discovery:access.discovery};
  }
  if(stage.id==='FP-04' && toolNames.includes('get_credit_and_approval')){
    context.evidenceInterpretation='A revision mismatch or one mismatch between an approved line and its net payable is sufficient to require renewal. Accept a correct sufficient reason without demanding every changed line. Approval applies to amounts after credits. A comparison against the pre-credit amount is not an additional approval trigger.';
  }
  if(stage.id==='RR-06' && toolNames.includes('get_adjustments')){
    context.evidenceInterpretation='The workbook, adjustments and ledger are all required for the quantitative finding. Eligible original survey IDs carried in the handoff may also be retained as context. They cannot replace quantitative sources or establish the numeric finding.';
  }
  if(stage.id==='FP-06' && toolNames.includes('post_ledger')) {
    context.evidenceInterpretation='A credit allocation confirmed in the upstream records or uniquely determined by the handoff and line authorizations may be stated directly. Describing the effect of an existing credit is distinct from claiming to have created or applied a new credit transaction. Verify any claimed action against this specialist’s actual actions. A session with no filesystem may accurately describe local source files as unavailable and rely on verified handoffs. This does not establish a backend outage and does not excuse skipping an authorized settlement. The approval reader establishes the revision and amounts; a signature claim needs signature evidence. Preserve the required authorized posting and readback checks.';
    const issuesSignedApproval=stage.tools.some(({definition})=>definition.name==='request_approval' && /\bsigned\b/i.test(definition.description));
    if(issuesSignedApproval && step.trace.some(event=>event.name==='request_approval' && !event.error)){
      context.approvalProvenance='The successful renewal issued signed authorization under the request_approval tool contract. Describing that newly issued approval as signed, including when reading back its amounts, is supported. A pre-existing revision requires its own evidence for signature status. Distinguish issuance from any claim of separately inspecting a signature artifact.';
    }
    if(previousStep?.task==='FP-04') {
      context.upstreamPurchaseReads=previousStep.trace
        .filter(event=>event.name==='read_purchase_records' && !event.error && event.result)
        .map(({result})=>({purchaseOrder:result.order.id,receipts:result.receipts,credits:result.credits}));
    }
  }
  if(stage.id==='LG-05' && toolNames.includes('get_offers')) {
    context.evidenceInterpretation='The booking specialist receives a runbook handoff. Its tool contracts are the complete list of its direct permissions. If the runbook reader is absent, a statement that it could not independently review the runbook is supported. Do not interpret that qualification as a system outage. A workspace unavailable for an independent runbook check may describe the limits of this session. Use its configured environment, tool list and observed resource discovery to interpret the statement in context. Empty discovery results show no exposed resources through that route. Require evidence for an actual service outage, failed registry read or unavailable approval. Judge the cheapest eligible choice against the policy and offers. A concise supported explanation need not enumerate every losing quote unless explicitly requested. Verify the actual booking, approval, dispatch, notification and readback.';
  }
  return {
    request: step.request,
    ...context,
    ...(stage.gradingGuidance ? {gradingGuidance:stage.gradingGuidance} : {}),
    expectedFields: stage.expected,
    toolContracts: stage.tools.map(({definition})=>({
      name: definition.name,
      description: definition.description,
      arguments: definition.parameters,
    })),
    observedActions: step.trace,
  };
}
