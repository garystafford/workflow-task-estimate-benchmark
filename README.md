# Workflow cost benchmark

This benchmark covers **five business workflows**. Each workflow has **three distinct tasks**, for **15 tasks in total**. It measures model cost and pass rates for individual tasks and for each workflow from start to finish. The project includes synthetic business records, local tools, reference answers, and graders so you can run the benchmark yourself.

## Technologies used

- **OpenAI GPT-6.2 Sol** (`gpt-6.2-sol`) runs the workflow tasks and grades their explanations, with medium reasoning effort in both roles.
- **OpenAI Agents API (beta)** runs each task in a hosted agent session through the OpenAI JavaScript SDK. The Node.js runner executes function calls locally against synthetic business records and receives structured JSON outputs from the session.
- **OpenAI Responses API and Promptfoo** run model-based grading for task explanations and end-to-end workflow outputs. The benchmark also checks structured outputs, tool evidence, and final records with deterministic checks that use Ajv for JSON Schema validation.
- **Node.js** runs the benchmark and its tests. **Python** generates the cost and pass-rate reports.

## Workflows

| Workflow                                                                  | What the three tasks do                                                                                                                             | Command                      |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| [Supplier invoice processing](WORKFLOWS.md#supplier-invoice-processing)   | Extract the current invoice, reconcile it against orders and receipts, then post the authorized payment and record any dispute.                     | `npm run invoice`            |
| [Shipment recovery](WORKFLOWS.md#shipment-recovery)                       | Identify the missed shipment leg, select the applicable recovery procedure, then book a replacement or request approval.                            | `npm run shipment`           |
| [Project feasibility](WORKFLOWS.md#project-feasibility)                   | Summarize stakeholder feedback, verify and save the finding, then assess whether the selected work package fits the staffing, budget, and deadline. | `npm run project`            |
| [Travel expense reimbursement](WORKFLOWS.md#travel-expense-reimbursement) | Verify receipts, look up the travel policy when needed, then reimburse eligible expenses or hold the report for approval.                           | `npm run travel-expense`     |
| [Employee knowledge assistant](WORKFLOWS.md#employee-knowledge-assistant) | Establish the employee’s circumstances, select the governing policies, then give a cited answer or ask for the missing fact.                        | `npm run employee-knowledge` |

The [detailed workflow and task guide](WORKFLOWS.md) shows what each task receives, what it hands to the next task, and how to recognize a successful outcome. Use its task IDs to look up individual tasks in your results.

A case is one business situation with its own records and expected outcome. Each workflow has 13 cases (three Routine, three Standard, three Complex, and four Advanced). Each case runs three times. In a standalone attempt, a task that needs an upstream input receives a verified reference handoff. In an end-to-end attempt, it receives the previous task’s actual output.

Across all five workflows, `npm run all` schedules **65 cases, 564 standalone attempts, and 195 end-to-end attempts**. Each workflow has 39 end-to-end attempts and 117 standalone attempts, except travel, which has 96 standalone attempts because seven cases already include the governing policy.

## Set up once

Use Node.js 26 or later, npm, and Python 3.9 or later. Node.js 22 (22.22.2+) and 24 (24.15.0+) also meet the dependencies’ version requirements. From this directory, install the dependencies and check the benchmark locally. These commands work without an API key.

```sh
npm ci --include=dev
npm test
npm run all -- --validate-only
```

For a live run, set `OPENAI_API_KEY` in your shell or copy [.env.example](.env.example) to `.env` and fill in the key. Live runs and grading incur API charges. The key needs access to GPT-6.2 Sol through both OpenAI APIs.

## Run the benchmark

Use a workflow’s command from the table above, or run all five in sequence.

```sh
npm run all
```

Each command validates the cases, runs standalone tasks and end-to-end workflows, grades the outputs, audits the hosted sessions, and writes a report. Open `results/invoice/README.md` for the invoice report. Each other workflow uses its own folder under `results/`.

You can also validate a single workflow locally, for example with `npm run invoice -- --validate-only`.

Rerunning a command reuses completed attempts and grades in its workflow folder. If a run was interrupted and left a lock or pending receipt, check the recorded process or hosted turn before retrying. For an independent repeat, move the existing workflow folder before running the command again.

## Read your measurements

Each workflow report includes pass counts and costs by tier. A task passes when its structured output and required tool evidence pass the scripted checks and its explanation passes the model grader. An end-to-end pass requires every applicable task to pass, the handoffs to complete, the final records to match the case, and the whole workflow to pass grading.

| File                                         | What it contains                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `cost-per-task.csv`                          | Task by ID and tier. The `mode` column distinguishes standalone attempts (`isolated`) from stages inside end-to-end attempts (`workflow`). |
| `cost-per-workflow.csv`                      | End-to-end attempts, passes, and worker costs by workflow and tier                                                                         |
| `task-attempts.csv`, `workflow-attempts.csv` | Per-attempt usage, costs, and grading components                                                                                           |
| `summary.json`, `failures.json`              | Totals, worker and judge costs, and reasons for failed grades                                                                              |
| `repetitions.csv`                            | Counts, passes, and costs for each of the three repetitions                                                                                |
| `expense-monthly-mix.csv`                    | Travel reimbursement only. Your measured connected costs and pass rates weighted by the supplied monthly case counts                       |

For each row in the grouped cost tables, divide `passed` by `attempts` for the pass rate. `mean_uncached_usd` prices all input at the uncached rate. `mean_worker_usd` accounts for observed cache hits. Both include output cost and average across all attempts. `worker_usd_per_success` divides the worker spend on all attempts by the number that passed. The fixed rates per million tokens are $2 for uncached input, $0.10 for cached input, and $10 for output. Use your own applicable prices for a production budget. Judge usage is accounted for separately. The local mock tools have no external service fees.

Promptfoo runs automatically during grading and the benchmark saves its verdicts in `grades/`. To trace a result, match the attempt key in `runs/` to those verdicts. Compare it with the reference output and final state in `controls.json`. The run folder also includes the schedule, the benchmark configuration and frozen source files, and the hosted session audit in `verified-sessions.json`.

## Project layout

- `src/matrix/` contains the workflow and case builders, mock tool behavior, scheduling, and deterministic checks.
- `fixtures/` contains synthetic records and the assumed travel case counts. Some cases are defined directly in the workflow builders.
- `src/specialists/` contains the hosted session transport and schema helpers. `evals/` contains the semantic judge.
- `scripts/` contains the command-line runner, session audit, and reporting code. `test/` contains local regression tests.

The default output directory, dependency directories, caches, and local credentials are covered by [.gitignore](.gitignore). Keep generated runs under `results/` if you share your working copy.
