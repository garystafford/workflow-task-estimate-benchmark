# GPT-6.2 Sol benchmark costs per task and workflow

Processing one Routine supplier invoice from start to finish averaged **24.35¢** in model usage. Running just the reconciliation task on a verified input averaged **4.09¢**. Use the task rate when you automate that step alone. Use the connected workflow rate when the application handles the whole invoice.

The example uses GPT-6.2 Sol (`gpt-6.2-sol`) with **medium reasoning effort**. The rates below are measured means in **US cents per attempt**, calculated from recorded token usage at fixed study prices of **$2 per million input tokens** and **$10 per million output tokens**. Every input token is priced at the uncached rate. The figures cover the model doing the business work. Grading, hosting, paid tools, and human review are separate costs.

## Cost per end-to-end workflow

A workload is the application, such as an accounts payable app. Its workflow is the sequence of tasks it runs for one incoming item. During a connected run, each task receives the preceding task’s actual output. Each row below therefore includes the model usage across all the steps taken for that item.

| Workflow                     | One run handles        | Routine | Standard | Complex | Advanced | Study mix |
| ---------------------------- | ---------------------- | ------: | -------: | ------: | -------: | --------: |
| Supplier invoice processing  | supplier invoice       |  24.35¢ |   25.92¢ |  23.25¢ |   28.66¢ |    25.78¢ |
| Shipment recovery            | shipment incident      |  24.53¢ |   19.76¢ |  23.60¢ |   31.04¢ |    25.22¢ |
| Project feasibility          | feasibility assessment |  21.81¢ |   19.84¢ |  21.88¢ |   23.61¢ |    21.93¢ |
| Travel expense reimbursement | expense report         |  14.66¢ |   15.02¢ |  18.00¢ |   19.37¢ |    16.96¢ |
| Employee knowledge assistant | employee question      |  15.61¢ |   16.72¢ |  15.17¢ |   19.78¢ |    17.05¢ |

The **study mix** weights each tier by its number of attempts. Each workflow had 13 synthetic cases, with three each for Routine, Standard, and Complex, and four for Advanced. Each case ran three times, giving 9, 9, 9, and 12 connected attempts, respectively. Tier describes the work a case requires. A higher tier can cost less if the agent finishes in fewer calls or uses fewer tokens.

## Cost per standalone task

Each task ran on its own case records, with a verified handoff supplied wherever an earlier step would normally provide one. The IDs match the [workflow and task guide](WORKFLOWS.md).

| Workflow           | Task                                           | Routine | Standard | Complex | Advanced |
| ------------------ | ---------------------------------------------- | ------: | -------: | ------: | -------: |
| Invoice            | `FP-03` Extract the current invoice            |   4.07¢ |    3.89¢ |   3.78¢ |    5.84¢ |
| Invoice            | `FP-04` Reconcile the invoice                  |   4.09¢ |    4.70¢ |   3.98¢ |    4.54¢ |
| Invoice            | `FP-06` Settle the invoice                     |  12.04¢ |   11.64¢ |  13.64¢ |   18.13¢ |
| Shipment           | `CS-01` Triage the incident                    |   3.96¢ |    4.17¢ |   4.04¢ |    4.36¢ |
| Shipment           | `IT-02` Select the recovery procedure          |   4.34¢ |    4.23¢ |   5.78¢ |    5.34¢ |
| Shipment           | `LG-05` Recover the shipment                   |  16.81¢ |   17.40¢ |  15.28¢ |   23.30¢ |
| Project            | `RR-02` Summarize stakeholder evidence         |   4.26¢ |    3.93¢ |   5.19¢ |    4.90¢ |
| Project            | `RR-06` Verify and save the finding            |  10.95¢ |   12.61¢ |  12.86¢ |   11.57¢ |
| Project            | `SD-05` Assess delivery feasibility            |   3.96¢ |    3.90¢ |   6.45¢ |    6.11¢ |
| Travel expense     | `TE-01` Verify the receipts                    |   5.63¢ |    5.89¢ |   5.70¢ |    7.94¢ |
| Travel expense     | `TE-02` Find the governing travel policy       |   4.14¢ |    4.19¢ |   4.23¢ |    4.36¢ |
| Travel expense     | `TE-03` Settle the reimbursement               |   8.14¢ |    9.29¢ |   9.05¢ |    8.73¢ |
| Employee knowledge | `EK-03` Establish the employee’s circumstances |   6.96¢ |    7.01¢ |   7.66¢ |    8.02¢ |
| Employee knowledge | `EK-01` Select the governing policies          |   5.74¢ |    4.96¢ |   4.16¢ |    7.92¢ |
| Employee knowledge | `EK-02` Answer or clarify                      |   3.96¢ |    3.96¢ |   3.99¢ |    4.06¢ |

Most tasks ran 39 times. Travel policy lookup (`TE-02`) ran 18 times because seven of the 13 expense cases already included the governing policy. Its row gives the cost **per lookup**. The travel workflow row above averages over **all reports**, including those that skipped the lookup.

<details>
<summary>Cost of each task inside a connected workflow</summary>

These stage costs are already included in the end-to-end totals. For a Complex invoice, for example, the three standalone tasks together averaged **21.40¢**, while the connected workflow averaged **23.25¢**. Posting and verification rose from **13.64¢** alone to **15.38¢** with the actual handoff. All figures below are per execution of the listed stage.

| Workflow           | Task                                           | Routine | Standard | Complex | Advanced |
| ------------------ | ---------------------------------------------- | ------: | -------: | ------: | -------: |
| Invoice            | `FP-03` Extract the current invoice            |   3.86¢ |    3.87¢ |   3.71¢ |    4.49¢ |
| Invoice            | `FP-04` Reconcile the invoice                  |   7.63¢ |    6.69¢ |   4.16¢ |    4.43¢ |
| Invoice            | `FP-06` Settle the invoice                     |  12.86¢ |   15.35¢ |  15.38¢ |   19.73¢ |
| Shipment           | `CS-01` Triage the incident                    |   4.08¢ |    4.07¢ |   4.16¢ |    4.29¢ |
| Shipment           | `IT-02` Select the recovery procedure          |   4.03¢ |    3.95¢ |   5.75¢ |    6.14¢ |
| Shipment           | `LG-05` Recover the shipment                   |  16.42¢ |   11.73¢ |  13.69¢ |   20.60¢ |
| Project            | `RR-02` Summarize stakeholder evidence         |   4.24¢ |    3.91¢ |   4.05¢ |    5.69¢ |
| Project            | `RR-06` Verify and save the finding            |  12.78¢ |   11.99¢ |  11.80¢ |   11.67¢ |
| Project            | `SD-05` Assess delivery feasibility            |   4.79¢ |    3.94¢ |   6.03¢ |    6.24¢ |
| Travel expense     | `TE-01` Verify the receipts                    |   4.60¢ |    5.67¢ |   6.70¢ |    7.77¢ |
| Travel expense     | `TE-02` Find the governing travel policy       |   4.16¢ |    4.21¢ |   4.26¢ |    4.38¢ |
| Travel expense     | `TE-03` Settle the reimbursement               |   8.68¢ |    7.95¢ |   8.46¢ |    9.40¢ |
| Employee knowledge | `EK-03` Establish the employee’s circumstances |   6.79¢ |    7.50¢ |   7.02¢ |    8.02¢ |
| Employee knowledge | `EK-01` Select the governing policies          |   4.82¢ |    5.23¢ |   4.14¢ |    7.67¢ |
| Employee knowledge | `EK-02` Answer or clarify                      |   3.99¢ |    3.99¢ |   4.01¢ |    4.09¢ |

</details>

## Estimate a workload’s monthly model cost

Suppose the accounts payable app receives **10,000 invoices per month** and runs one connected workflow per invoice. Multiply each tier’s expected volume by its measured cost per invoice, then add the four amounts. The calculation uses the underlying USD rates before rounding to cents.

| Invoice tier    | Invoices per month | USD per invoice | Monthly model cost |
| --------------- | -----------------: | --------------: | -----------------: |
| Routine         |              7,000 |     $0.24346333 |          $1,704.24 |
| Standard        |              2,000 |     $0.25916311 |            $518.33 |
| Complex         |                800 |     $0.23246178 |            $185.97 |
| Advanced        |                200 |     $0.28655517 |             $57.31 |
| **Monthly mix** |         **10,000** |    **$0.24658** |      **$2,465.85** |

For a different workload, substitute its monthly volumes and case mix. If jobs require retries, include every attempt in model spend. To measure cost per successful job in a pilot, divide that spend by the number of jobs that passed.

## Compare with your own run

After fixes, reruns, and grading review, **564 of 564 standalone attempts** and **195 of 195 connected attempts** passed across the 65 cases. The corresponding means were **7.40¢ per standalone attempt** and **21.39¢ per connected attempt**. These pass rates describe the final benchmark cases. Use fresh cases representative of your workload to measure production reliability.

After [setting up the benchmark](../README.md#set-up-once), run `npm run invoice` for the invoice example or `npm run all` for all five workflows. In each workflow’s results folder, compare `mean_uncached_usd` in `cost-per-workflow.csv` and `cost-per-task.csv` with the tables above (multiply USD by 100 for cents). For tasks, `mode=isolated` gives the standalone rate and `mode=workflow` gives the connected stage rate. To include observed cache discounts at the benchmark’s configured rates, use `mean_worker_usd`.
