---
name: task-doc-management
description: Create, structure, and maintain task-category documentation for execution and delivery. Use this skill whenever the user asks for task breakdowns, execution plans, milestone plans, implementation checklists, ownership matrices, blocker tracking, rollout checklists, sprint task docs, or any T-category documentation under docs/task. Also use it when the user wants to turn a plan into an actionable task document with owners, dependencies, progress tracking, and done criteria, even if they do not explicitly mention task docs.
---

# Task Doc Management

Use this skill to create and maintain `T` category documents under `docs/task`.

This skill is for:
- Turning plans into actionable task documents
- Creating execution plans, milestone plans, and rollout checklists
- Maintaining owner assignments, dependencies, blockers, and completion criteria
- Creating assignment-ready task docs that an agent can pick up and maintain directly
- Creating task dashboards, ownership views, blocker views, and cross-task execution indexes
- Defining multi-agent execution boundaries and handoff rules inside the task-doc system
- Standardizing task docs with the repo's metadata, versioning, and numbering system
- Updating task indexes when new T-category docs are added

Read [references/task-doc-standard.md](./references/task-doc-standard.md) before creating or restructuring task documentation.
Use [references/task-doc-checklist.md](./references/task-doc-checklist.md) before closing task-doc work or reporting that the task-doc system is ready.

## Default workflow

1. Confirm the document belongs to the task category.
   Use this skill when the main question is execution: who does what, in what order, with what dependencies, and what counts as done.

2. Place the doc under `docs/task`.
   Use the `T` prefix and the next available two-digit number.
   Keep `docs/task/README.md` as the category index with document ID `T00`.

3. Apply the standard metadata block and change-log section.
   Task docs follow the same governed header pattern as the rest of the repo docs.

4. Use the task template.
   Every task doc should clearly answer:
   - what the task is
   - why it exists
   - who owns it
   - what the subtasks are
   - what blocks progress
   - what counts as complete

5. Split task docs by stable execution boundary.
   When work will be executed by multiple people or agents, create:
   - one `T00` index/dashboard document
   - optional umbrella docs for overall plan or acceptance summary
   - one boundary/control doc for collaboration rules
   - one execution doc per stable responsibility slice
   Each execution doc should own one domain only.

6. Make the docs assignment-ready.
   For execution-facing task docs, include:
   - execution status separate from metadata status
   - execution owner
   - priority, ETA, and actual completion time
   - expected inputs and expected outputs
   - allowed write scope
   - external dependency register
   - handoff instructions and handoff log
   - subtask rows with explicit done criteria

7. Keep tasks actionable.
   Prefer explicit tasks, owners, dependencies, milestones, done criteria, and handoff rules over vague goals.

8. Update navigation if the task doc set changes.
   When you add a visible task document, update `docs/task/README.md`.
   Update `docs/README.md` if the task doc should appear in the top-level navigation.

9. Run the checklist before closing.
   Use `references/task-doc-checklist.md` to verify classification, ownership, dashboard coverage, anti-overlap, and navigation consistency.

## Refactor workflow

Use this workflow when the repo already has task docs, but they are not yet suitable for direct agent execution.

1. Audit the current `docs/task` set.
   Identify which docs are:
   - index/dashboard docs
   - umbrella plan docs
   - acceptance/checklist docs
   - collaboration-boundary docs
   - execution docs

2. Separate summary docs from execution docs.
   Do not let `T00`, umbrella plans, or checklist docs become the main working surface if execution docs already exist.

3. Split by stable execution boundary.
   If a task doc mixes multiple ownership domains, split it into:
   - one collaboration/control doc if needed
   - one execution doc per stable responsibility slice

4. Upgrade execution docs to assignment-ready format.
   Add:
   - `执行状态`
   - `执行 owner`
   - `执行排期`
   - `预计输入`
   - `预计输出`
   - `允许修改的代码目录`
   - `外部依赖登记表`
   - `agent 接手说明`
   - `交接记录`
   - subtask rows with explicit `子状态` and `Done Criteria`

5. Upgrade `T00` into an active dashboard if the task set is now operational.
   Include:
   - portfolio dashboard
   - owner aggregation view
   - blocker aggregation view
   - dispatch rules
   - recommended execution order

6. Normalize ownership and handoff.
   Each execution doc should have one primary owner.
   If real assignee names are unavailable, initialize role-based agent names.

7. Re-link the system.
   Update `T00`, umbrella docs, and `docs/README.md` so the execution path is obvious.

8. Preserve continuity.
   Keep numbering stable where possible.
   Prefer refactoring and clarifying over renumbering unless the current structure is unusable.

## Use this skill for

- MVP execution plans
- iteration task breakdowns
- responsibility matrices
- milestone tracking docs
- launch and release checklists
- blocker and dependency tracking docs
- multi-agent execution task systems
- assignment-ready task docs with owner, ETA, inputs, outputs, and subtask done criteria
- task portfolio dashboards under `T00`

## Do not use this skill for

- broad documentation governance rules across all categories
- system architecture and deployment standards
- API and database specs
- product scope or roadmap docs unless the user explicitly wants an execution task document derived from them

Use `document-governance` instead for those governance-heavy or cross-category requests.

## Output requirements

When writing task docs:
- keep the file name ASCII and hyphenated
- use the next valid `T` number
- include metadata and change log
- include task scope, owners, dependencies, and completion criteria
- for execution docs, prefer assignment-ready sections over free-form prose
- if multiple agents will work in parallel, define explicit maintenance boundaries and handoff rules
- keep the document directly actionable

## Task-system guidance

When the user wants a task system rather than a single task doc, prefer this shape:
- `T00`: task index and dashboard
- `T01`/`T02`: optional umbrella docs such as overall plan and acceptance checklist
- `T03`: collaboration-boundary or execution-rule doc
- `T04+`: assignment-ready execution docs per stable responsibility slice

Typical stable slices:
- spec/contracts
- frontend
- core backend
- async/summary/alerts
- AI/export/share
- ops/security/release
- testing/integration/acceptance

Do not split by arbitrary temporary staffing if it causes overlapping ownership.

## Repo-specific playbook

For this repository, the current recommended task-doc system is:
- `T00`: task index, dispatch rules, dashboards, owner/blocker views
- `T01`: overall phased delivery plan
- `T02`: integration and acceptance umbrella checklist
- `T03`: collaboration-boundary and maintenance-rule doc
- `T04`: spec/contracts and data-model freeze
- `T05`: frontend user app, H5, and admin
- `T06`: auth/family/baby/event/backend core
- `T07`: summary/alerts/async jobs
- `T08`: AI/export/sharing
- `T09`: ops/security/release readiness
- `T10`: quality/integration/acceptance execution

When working in this repo:
- prefer extending this system over inventing a different `T` layout
- keep `T04` to `T10` as the primary working docs
- keep `T01` and `T02` as umbrella docs, not the main execution surface
- use `T03` to store cross-task agent coordination rules
- update `T00` whenever ownership, blockers, ETA, or execution state materially changes

## Assignment-ready task doc pattern

For a task doc that will be executed directly by an agent, include:
- `执行状态`
- `执行 owner`
- `执行排期`
- `预计输入`
- `预计输出`
- `允许修改的代码目录`
- `外部依赖登记表`
- `agent 接手说明`
- `交接记录`

The task table should prefer:

| 子任务编号 | 子状态 | 子任务 | 执行 owner | 预计输入 | 预计输出 | Done Criteria |
| --- | --- | --- | --- | --- | --- | --- |

Recommended subtask status values:
- `未开始`
- `进行中`
- `阻塞`
- `已完成`

Recommended execution status values:
- `未开始`
- `进行中`
- `阻塞`
- `已完成`

These execution statuses are separate from the governed metadata lifecycle statuses such as `草案` and `已生效`.

## Dashboard guidance

When `T00` is used as an active task index, it should usually contain:
- a portfolio dashboard of all task docs
- an owner-based view
- a blocker-based view
- dispatch rules and recommended execution order

If the user needs default owners before real names exist, initialize role-based agent names such as:
- `spec-agent`
- `frontend-agent`
- `backend-core-agent`
- `backend-async-agent`
- `ai-report-agent`
- `ops-agent`
- `qa-agent`

## Anti-pattern reminders

Watch for these failure modes:
- umbrella docs becoming the primary working surface after execution docs already exist
- one execution doc covering multiple unrelated responsibility domains
- two execution docs claiming the same deliverable or same code area as primary ownership
- missing `Done Criteria`, causing subjective completion claims
- updating other execution docs directly instead of recording dependencies and blockers
- putting execution statuses like `进行中` into metadata `状态`
- leaving `T00` stale after owners, ETAs, or blockers changed

## Example trigger cases

**Example 1**
Input: "帮我写一个 MVP 执行计划，把工作拆成可以跟进的任务。"
Action: Use this skill to create a `T` doc with scope, task breakdown, owners, dependencies, and done criteria.

**Example 2**
Input: "把这份方案改成上线前检查清单。"
Action: Use this skill to convert the plan into a T-category checklist document.

**Example 3**
Input: "我要一个迭代任务文档，能标负责人、阻塞项和里程碑。"
Action: Use this skill to create a task execution document under `docs/task`.

**Example 4**
Input: "把任务文档拆成能给多个 agent 并行执行和维护的格式。"
Action: Use this skill to create or refactor `T00` dashboard docs, a collaboration-boundary doc, and assignment-ready execution docs with explicit owner, inputs, outputs, and handoff rules.

**Example 5**
Input: "把现有 docs/task 重构成可派单、可交接、可看板跟踪的系统。"
Action: Use the refactor workflow in this skill. Audit existing `T` docs, separate summary vs. execution roles, upgrade execution docs to assignment-ready format, and normalize `T00` as the active dashboard.
