# Workflow and task guide

Each workflow starts with a business request. Follow the rows in order to see what one task must establish before the next can act. The task IDs match the `task` column in `cost-per-task.csv`. Each workflow runs at four levels of case complexity with the same model and reasoning setting. See the [README](README.md) for commands, case counts, and reports.

## Supplier invoice processing

A supplier submits an invoice. The workflow determines which revision to pay, how much the records support, and what to dispute.

| Task                                | What it checks                                                                                                                                                                                    | What it hands off or delivers                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `FP-03` Extract the current invoice | Read the available versions and select the effective invoice. Check its lines and total, identifying any changes from the prior version.                                                          | The invoice ID, revision, purchase order, source, gross amount, and itemized lines.                                 |
| `FP-04` Reconcile the invoice       | Match the billed lines to the purchase order and accepted receipts. Account for returns and distinct posted credits where applicable. Check whether the approval covers the revision and amounts. | The payable and disputed amounts, with line allocations, supporting receipt IDs, and any need for renewed approval. |
| `FP-06` Settle the invoice          | Compare the handoff with the authorization and renew approval when needed. Check the ledger before retrying an uncertain payment.                                                                 | Post the authorized amount once, record any supported dispute, and read back the settlement records.                |

A correct explanation alone cannot settle an invoice. The ledger must show the authorized payment, including when part of the invoice remains in dispute.

## Shipment recovery

A shipment appears to have missed a connection. The workflow determines which leg needs intervention and what the dispatcher is authorized to book.

| Task                                  | What it checks                                                                                                                                                     | What it hands off or delivers                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CS-01` Triage the incident           | Use ticket, scan, and carrier evidence to resolve the status of the affected leg. In a multi-leg incident, identify any leg already collected.                     | The shipment, affected leg, alarm, and routing queue, with the context needed to select the procedure.                                                                                       |
| `IT-02` Select the recovery procedure | Find the approved runbook that applies to the incident. Resolve effective revisions, regional overrides, carrier restrictions, and deadlines as the case requires. | The runbook ID and booking constraints, including permitted carriers, split shipments, and approval requirements where applicable.                                                           |
| `LG-05` Recover the shipment          | Compare quotes against the delivery commitments and choose the cheapest eligible plan. Check spending authority before committing.                                 | Book and verify the replacement, update dispatch, and notify the customer once. When an Advanced case exceeds delegated authority, request the shortfall and preserve the existing bookings. |

The expected outcome can be a verified booking or a pending spending request. In either case, an unaffected leg stays intact.

## Project feasibility

Stakeholders report an operational problem. The workflow establishes which sites and findings the evidence supports, then evaluates a delivery plan for the selected work package.

| Task                                   | What it checks                                                                                                                                                        | What it hands off or delivers                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `RR-02` Summarize stakeholder evidence | Identify participating sites, recurring themes, conflicting accounts, and limits of the survey. Account for withdrawals, duplicates, or revoked consent when present. | The eligible sites and topics to investigate, with the evidence and exclusions relevant to the case.                                           |
| `RR-06` Verify and save the finding    | Compare the eligible sites’ workbook figures with their ledgers. Apply the selection rule and any signed adjustments.                                                 | Save and read back the finding with its sources and **exact work-package ID**. Advanced cases also carry a recommendation to fund or withhold. |
| `SD-05` Assess delivery feasibility    | Use that same package ID to compare staffing options against skills, site coverage, capacity, budget, and deadline.                                                   | A supported plan with staff, cost, and finish day, or the smallest supported deadline extension. Carry forward any recorded funding decision.  |

The saved finding and the delivery assessment must identify the same package. Completion is a feasibility recommendation. Staffing the project or releasing funds falls outside this workflow.

## Travel expense reimbursement

An employee submits an expense report. The workflow determines which receipts qualify under the trip policy and whether the reimbursement is authorized.

| Task                                     | What it checks                                                                                                                                           | What it hands off or delivers                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `TE-01` Verify the receipts              | Select the highest verified report revision, deduplicate receipt lines, preserve linked refunds and payer information, and convert amounts to USD cents. | The verified lines and signed gross total, plus the policy ID and meal cap if attached.                           |
| `TE-02` Find the governing travel policy | When the report has no policy attachment, find the signed regional policy in force on the trip date.                                                     | The receipt handoff with the governing policy ID and per-receipt meal cap.                                        |
| `TE-03` Settle the reimbursement         | Exclude personal and company-paid lines, cap eligible meals, apply linked credits once, and compare the amount with the authorization.                   | Post the eligible reimbursement once and verify it, or queue an approval hold and verify that nothing was posted. |

Seven of the 13 cases arrive with a verified policy. Those cases go directly from receipt intake to settlement. The other six exercise all three tasks.

## Employee knowledge assistant

An employee asks about a benefit or policy deadline. The workflow establishes which rules apply to that person on the relevant date and gives a source-supported answer.

| Task                                           | What it checks                                                                                                                                                                                | What it hands off or delivers                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `EK-03` Establish the employee’s circumstances | Read the request and directory facts. If a transfer is relevant, follow the filing and amendments to establish the signed effective date when available.                                      | The ticket, topic, event date, home office, role, transfer facts, and any handbook reference supplied at intake.                         |
| `EK-01` Select the governing policies          | Use those facts to select the effective company policy and applicable office, role, or transfer rules. In Advanced cases, references found in one record determine which record to open next. | The possible offices and only the governing section IDs for the employee’s question.                                                     |
| `EK-02` Answer or clarify                      | Read the selected policy text and apply it to the employee’s circumstances. If multiple offices are still possible, check whether the answer differs.                                         | A direct answer with its value, unit, and citations, or a focused request for the missing transfer date when it would change the answer. |

This workflow is read-only. A cited clarification is a successful outcome when the available evidence cannot support a single answer.
