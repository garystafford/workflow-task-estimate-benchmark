"""Reconcile the connected benchmark and summarize measured token usage and grades."""

import csv
import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

root = Path(sys.argv[1])
plan = json.loads((root / "manifest.json").read_text())
controls = json.loads((root / "controls.json").read_text())
tiers = plan["tiers"]
model_label = (
    plan["model"].replace("gpt-", "GPT-").replace("-sol", " Sol")
    + " "
    + plan["effort"].title()
)
expense_suite = plan.get("suite") == "travel-expense"
knowledge_suite = plan["suite"] == "employee-knowledge"
coverage_suite = plan["suite"] in ("invoice", "shipment", "project", "balanced-matrix")
assert expense_suite or knowledge_suite or coverage_suite
assert (
    plan["model"] == "gpt-6.2-sol"
    and plan["effort"] == "medium"
    and plan["repetitions"] == 3
)
cases = {
    (case["workflow"], case["tier"], case.get("caseSet")): case for case in controls
}
expected_flows = len(cases) * plan["repetitions"]
expected_stages = sum(len(c["checks"]) for c in controls) * plan["repetitions"]
expected_isolated = expected_stages
expected_runs = expected_flows + expected_isolated
grades = {p.stem: json.loads(p.read_text()) for p in (root / "grades").glob("*.json")}
audit_file = root / "verified-sessions.json"
audited_usage = (
    {r["turnId"]: r["usage"] for r in json.loads(audit_file.read_text())}
    if audit_file.exists()
    else {}
)
runs = [json.loads(p.read_text()) for p in sorted((root / "runs").glob("*.json"))]
if expense_suite:
    case_mix = {r["case_id"]: r for r in plan["caseMix"]}
    assert set(cases) == {("expense", f["tier"], k) for k, f in case_mix.items()}
    assert sum(f["monthly_reports"] for f in case_mix.values()) == 2000
    assert (
        sum(f["monthly_reports"] * f["policy_lookup"] for f in case_mix.values()) == 400
    )
workflow_ids = {"travel-expense": "expense", "employee-knowledge": "knowledge"}
selection = plan["suite"]
workflows = (
    ["invoice", "shipment", "project"]
    if selection == "balanced-matrix"
    else [workflow_ids.get(selection, selection)]
)
assert plan["workflowOrder"] == workflows
assert Counter((w, t) for w, t, k in cases) == {
    (w, t): 4 if t == "Advanced" else 3 for w in workflows for t in tiers
}
schedule = {
    (w, t, k, rep, index)
    for (w, t, k), case in cases.items()
    for rep in range(1, 4)
    for index in range(-1, len(case["checks"]))
}
assert schedule == {
    (r["w"], tiers[r["tier"]], r["caseSet"], r["rep"], r["stage"]) for r in runs
}
for (_, _, k), case in cases.items():
    if coverage_suite:
        assert len(case["checks"]) == 3
    elif knowledge_suite:
        assert [s["id"] for s in case["checks"]] == ["EK-03", "EK-01", "EK-02"]
    else:
        middle = ["TE-02"] if case_mix[k]["policy_lookup"] else []
        assert [s["id"] for s in case["checks"]] == ["TE-01", *middle, "TE-03"]
assert len(runs) == expected_runs and len({r["key"] for r in runs}) == expected_runs
assert not list((root / "runs").glob("*.pending"))
attempts, workflow_runs, failures = [], [], []
used_grades, sessions = set(), set()


def canonical(value):
    if isinstance(value, list):
        return sorted(
            (canonical(x) for x in value), key=lambda x: json.dumps(x, sort_keys=True)
        )
    if isinstance(value, dict):
        return {k: canonical(v) for k, v in value.items()}
    return value


for run in runs:
    workflow, tier, key = run["w"], tiers[run["tier"]], run["key"]
    case = cases[workflow, tier, run["caseSet"]]
    baseline = case["checks"]
    stage_order = list(range(len(baseline))) if run["stage"] < 0 else [run["stage"]]
    assert run["rep"] in range(1, plan["repetitions"] + 1)
    assert run["model"] == plan["model"] and run["effort"] == plan["effort"]
    local = []
    for i, step in enumerate(run["steps"]):
        ix = step["index"]
        assert ix == stage_order[i] and step["task"] == baseline[ix]["id"]
        assert step["sessionId"] and step["sessionId"] not in sessions
        sessions.add(step["sessionId"])
        if run["stage"] < 0 and ix:
            assert step["request"]["upstream"] == run["steps"][i - 1]["answer"]
        if run["stage"] >= 0 and ix:
            upstream = dict(step["request"]["upstream"])
            upstream.pop("explanation")
            reference = dict(baseline[ix - 1]["answer"])
            reference.pop("explanation")
            if workflow == "shipment" and "carriers" in reference:
                # Permitted carrier IDs represent a set. Preserve the raw handoff for the audit.
                assert sorted(upstream.pop("carriers")) == sorted(
                    reference.pop("carriers")
                )
            if knowledge_suite:
                # These two fields contain sets; a source's position carries no precedence.
                for field in ("possibleSites", "sectionRefs"):
                    if field in reference:
                        assert sorted(upstream.pop(field)) == sorted(
                            reference.pop(field)
                        )
            assert upstream == reference
        grade_key = key + "_" + step["task"]
        grade = grades.get(grade_key)
        if step["answer"] is not None:
            assert grade is not None, grade_key
            used_grades.add(grade_key)
        usage = step["usage"] or audited_usage.get(step["turnId"])
        assert usage, ("Missing turn usage; run the server audit", key, ix)
        inp, out = usage["input_tokens"], usage["output_tokens"]
        cached = usage.get("input_tokens_details", {}).get("cached_tokens", 0)
        usd = ((inp - cached) * 2 + cached * 0.1 + out * 10) / 1e6
        if step["usd"] is not None:
            assert abs(usd - step["usd"]) < 1e-9
        issues = list(step["issues"])
        if grade and not grade["verdict"]["pass"]:
            issues.append(grade["verdict"]["reason"])
        row = dict(
            key=key,
            rep=run["rep"],
            workflow=workflow,
            tier=tier,
            mode=run["mode"],
            task=step["task"],
            session=step["sessionId"],
            input_tokens=inp,
            cached_input_tokens=cached,
            output_tokens=out,
            reasoning_tokens=usage.get("output_tokens_details", {}).get(
                "reasoning_tokens"
            ),
            worker_usd=usd,
            uncached_usd=(inp * 2 + out * 10) / 1e6,
            judge_usd=grade["usd"] if grade else 0,
            tool_calls=len(step["trace"]),
            seconds=step["seconds"],
            deterministic_pass=not step["issues"],
            semantic_pass=grade["verdict"]["pass"] if grade else False,
            passed=not issues,
        )
        attempts.append(row)
        local.append(row)
        if issues:
            failures.append(dict(key=key, task=step["task"], issues=issues))
    for row in local:
        row["case_id"] = run["caseSet"]
    if run["stage"] < 0:
        grade_key = key + "_workflow"
        verdict = grades[grade_key]
        used_grades.add(grade_key)
        final_state = run["finalState"]
        if (
            plan.get("projectFindingSourcePolicy") == "verified-survey-context"
            and workflow == "project"
            and tier == "Advanced"
            and len(run["steps"]) >= 2
            and final_state.get("report")
        ):
            finding_step = run["steps"][1]
            ids = final_state["report"].get("sources", [])
            required = set(case["finalState"]["report"]["sources"])
            supplied = set(finding_step["request"]["upstream"].get("evidenceIds", []))
            eligible = supplied.intersection(case["checks"][0]["answer"]["evidenceIds"])
            if (
                required <= set(ids) <= required | eligible
                and len(ids) == len(set(ids))
                and sorted(ids)
                == sorted((finding_step["answer"] or {}).get("sources", []))
            ):
                final_state = {
                    **final_state,
                    "report": {**final_state["report"], "sources": sorted(required)},
                }
        state_correct = canonical(final_state) == canonical(case["finalState"])
        ok = (
            len(local) == len(baseline)
            and all(row["passed"] for row in local)
            and verdict["verdict"]["pass"]
            and state_correct
            and not run.get("handoffError")
        )
        if not state_correct:
            failures.append(
                dict(
                    key=key,
                    task="workflow state",
                    issues=["Final mock records differ from the reference case"],
                )
            )
        if run.get("handoffError"):
            failures.append(dict(key=key, task="handoff", issues=[run["handoffError"]]))
        if not verdict["verdict"]["pass"]:
            failures.append(
                dict(key=key, task="workflow", issues=[verdict["verdict"]["reason"]])
            )
        workflow_runs.append(
            dict(
                key=key,
                rep=run["rep"],
                workflow=workflow,
                tier=tier,
                passed=ok,
                deterministic_pass=len(local) == len(baseline)
                and all(r["deterministic_pass"] for r in local),
                final_semantic_pass=verdict["verdict"]["pass"],
                mock_state_pass=state_correct,
                handoff_error=run.get("handoffError") or "",
                stages=len(local),
                seconds=run["seconds"],
                worker_usd=sum(r["worker_usd"] for r in local),
                uncached_usd=sum(r["uncached_usd"] for r in local),
                judge_usd=sum(r["judge_usd"] for r in local) + verdict["usd"],
            )
        )
        workflow_runs[-1]["case_id"] = run["caseSet"]
assert used_grades == set(grades)
assert (
    len(workflow_runs) == expected_flows
    and sum(r["mode"] == "isolated" for r in attempts) == expected_isolated
)


def group(rows, keys):
    cells = defaultdict(list)
    for row in rows:
        cells[tuple(row[k] for k in keys)].append(row)
    result = []
    for identifiers, members in sorted(cells.items()):
        n = len(members)
        passed = sum(r["passed"] for r in members)
        spend = sum(r["worker_usd"] for r in members)
        result.append(
            dict(
                zip(keys, identifiers),
                attempts=n,
                passed=passed,
                deterministic_passes=sum(r["deterministic_pass"] for r in members),
                semantic_passes=sum(
                    r.get("semantic_pass", r.get("final_semantic_pass"))
                    for r in members
                ),
                mean_worker_usd=spend / n,
                min_worker_usd=min(r["worker_usd"] for r in members),
                max_worker_usd=max(r["worker_usd"] for r in members),
                mean_uncached_usd=statistics.mean(r["uncached_usd"] for r in members),
                mean_grading_usd=statistics.mean(r["judge_usd"] for r in members),
                worker_usd_per_success=spend / passed if passed else None,
                mean_seconds=statistics.mean(r["seconds"] for r in members),
            )
        )
    return result


def write_csv(name, rows):
    with (root / name).open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)


by_task = group(attempts, ["workflow", "task", "mode", "tier"])
by_workflow = group(workflow_runs, ["workflow", "tier"])
for r in by_task + by_workflow:
    per_cell = plan["repetitions"] * sum(
        c["workflow"] == r["workflow"]
        and c["tier"] == r["tier"]
        and ("task" not in r or any(s["id"] == r["task"] for s in c["checks"]))
        for c in controls
    )
    assert 1 <= r["attempts"] <= per_cell
    if "mode" not in r or r["mode"] == "isolated":
        assert r["attempts"] == per_cell
write_csv("task-attempts.csv", attempts)
write_csv("workflow-attempts.csv", workflow_runs)
write_csv("cost-per-task.csv", by_task)
write_csv("cost-per-workflow.csv", by_workflow)
repetitions = []
for rep in range(1, plan["repetitions"] + 1):
    rows = [r for r in attempts if r["rep"] == rep]
    isolated = [r for r in rows if r["mode"] == "isolated"]
    flows = [r for r in workflow_runs if r["rep"] == rep]
    worker = sum(r["worker_usd"] for r in rows)
    judges = sum(r["judge_usd"] for r in isolated + flows)
    input_tokens = sum(r["input_tokens"] for r in rows)
    repetitions.append(
        dict(
            repetition=rep,
            isolated_tasks=len(isolated),
            workflows=len(flows),
            worker_sessions=len(rows),
            isolated_passes=sum(r["passed"] for r in isolated),
            workflow_passes=sum(r["passed"] for r in flows),
            worker_usd=worker,
            grader_usd=judges,
            total_usd=worker + judges,
            cached_share=(
                sum(r["cached_input_tokens"] for r in rows) / input_tokens
                if input_tokens
                else None
            ),
        )
    )
write_csv("repetitions.csv", repetitions)
(root / "failures.json").write_text(json.dumps(failures, indent=2) + "\n")
summary = dict(
    unique_worker_sessions=len(sessions),
    judge_calls=len(grades),
    isolated_worker_usd=sum(
        r["worker_usd"] for r in attempts if r["mode"] == "isolated"
    ),
    workflow_worker_usd=sum(r["worker_usd"] for r in workflow_runs),
    judge_usd=sum(g["usd"] for g in grades.values()),
    isolated_passes=sum(r["passed"] for r in attempts if r["mode"] == "isolated"),
    workflow_passes=sum(r["passed"] for r in workflow_runs),
    isolated_deterministic_passes=sum(
        r["deterministic_pass"] for r in attempts if r["mode"] == "isolated"
    ),
    workflow_deterministic_passes=sum(r["deterministic_pass"] for r in workflow_runs),
    workflow_stage_passes=sum(r["passed"] for r in attempts if r["mode"] == "workflow"),
    workflow_mock_state_passes=sum(r["mock_state_pass"] for r in workflow_runs),
    workflow_final_semantic_passes=sum(r["final_semantic_pass"] for r in workflow_runs),
    workflow_stage_deterministic_passes=sum(
        r["deterministic_pass"] for r in attempts if r["mode"] == "workflow"
    ),
    unexecuted_stages=expected_isolated + expected_stages - len(attempts),
    worker_uncached_usd=sum(r["uncached_usd"] for r in attempts),
    input_tokens=sum(r["input_tokens"] for r in attempts),
    cached_input_tokens=sum(r["cached_input_tokens"] for r in attempts),
    output_tokens=sum(r["output_tokens"] for r in attempts),
    reported_reasoning_tokens=sum(r["reasoning_tokens"] or 0 for r in attempts),
    reasoning_tokens_reported_rows=sum(
        r["reasoning_tokens"] is not None for r in attempts
    ),
)
summary["total_usd"] = sum(
    summary[k] for k in ("isolated_worker_usd", "workflow_worker_usd", "judge_usd")
)
assert abs(summary["total_usd"] - sum(r["total_usd"] for r in repetitions)) < 1e-8
(root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
lines = [
    f"# {model_label} benchmark",
    "",
    "Each cost is the mean uncached worker cost in US dollars per attempt. All assigned attempts count. Grading costs are recorded separately in summary.json.",
    "",
    "| Workflow | Tier | Standalone passes | USD per task | End-to-end passes | USD per workflow |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
]
for workflow in plan["workflowOrder"]:
    for tier in tiers:
        tasks = [
            r
            for r in attempts
            if r["workflow"] == workflow
            and r["tier"] == tier
            and r["mode"] == "isolated"
        ]
        flows = [
            r for r in workflow_runs if r["workflow"] == workflow and r["tier"] == tier
        ]
        if flows:
            cells = [workflow, tier]
            for group_rows in (tasks, flows):
                cells.extend(
                    [
                        f"{sum(r['passed'] for r in group_rows)}/{len(group_rows)}",
                        f"{statistics.mean(r['uncached_usd'] for r in group_rows):.4f}",
                    ]
                )
            lines.append("| " + " | ".join(cells) + " |")
if expense_suite:
    rows = []
    for tier in [*tiers, "All tiers"]:
        members = [
            row
            for row in case_mix.values()
            if tier == "All tiers" or row["tier"] == tier
        ]
        volume = sum(row["monthly_reports"] for row in members)
        spend = 0
        successes = 0
        for case in members:
            flows = [r for r in workflow_runs if r["case_id"] == case["case_id"]]
            spend += case["monthly_reports"] * statistics.mean(
                r["uncached_usd"] for r in flows
            )
            successes += case["monthly_reports"] * statistics.mean(
                r["passed"] for r in flows
            )
        rows.append(
            dict(
                tier=tier,
                monthly_reports=volume,
                monthly_uncached_usd=spend,
                pass_rate=successes / volume,
                uncached_usd_per_success=spend / successes if successes else None,
            )
        )
    write_csv("expense-monthly-mix.csv", rows)
(root / "README.md").write_text("\n".join(lines) + "\n")
print(json.dumps(summary, indent=2))
