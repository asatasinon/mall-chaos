# Task Documentation Standard

Use this reference when creating or maintaining `T` category documents.

This file is the single source of truth for task-document rules in this repository. Do not recreate parallel T-category governance copies under `docs/`.

## 1. Category definition

Task docs are execution-facing documents under `docs/task`.

Use a task doc when the primary need is:
- task breakdown
- execution sequencing
- owner assignment
- milestone tracking
- blocker management
- completion criteria

Do not use task docs for:
- product positioning
- architecture decisions
- API contracts
- cross-category governance rules

## 2. Location and numbering

- Directory: `docs/task`
- Index file: `docs/task/README.md`
- Index document number: `T00`
- Regular task docs: `T01`, `T02`, `T03`, ...

File format:
- `<TNN>-<english-short-name>.md`

Examples:
- `T01-mvp-execution-plan.md`
- `T02-release-readiness-checklist.md`
- `T03-iteration-2-task-breakdown.md`

## 3. Metadata block

Use this exact metadata block below the title:

```md
> 文档编号：T01
> 状态：草案
> 版本号：v0.1.0
> 最后更新时间：2026-04-12
> 审核人：待定
> 生效日期：2026-04-12
> 负责人：待定
```

Allowed status values:
- `草案`
- `评审中`
- `已生效`
- `已废弃`

## 4. Change log

Every task doc should include:

```md
## 变更记录

| 版本号 | 日期 | 变更人 | 变更说明 |
| --- | --- | --- | --- |
| v0.1.0 | 2026-04-12 | Codex | 创建首版任务文档。 |
```

When the task doc changes:
- update `版本号`
- update `最后更新时间`
- append a change-log row
- update `状态` if lifecycle changed

## 5. Required structure

Every task doc should include these sections:
- `文档目的`
- `目标读者`
- `关联文档`
- `任务背景` or `任务来源`
- `任务范围`
- `任务拆解`
- `负责人` or `角色分工`
- `完成标准`

For assignment-ready execution docs, also include:
- `执行状态`
- `执行 owner`
- `执行排期`
- `预计输入`
- `预计输出`
- `允许修改的代码目录`
- `外部依赖登记表`
- `agent 接手说明`
- `交接记录`

## 6. Recommended sections

Add these when useful:
- `优先级`
- `里程碑`
- `依赖与阻塞`
- `风险`
- `状态跟踪`
- `交付物`
- `派单规则`
- `总看板视图`
- `按 owner 聚合视图`
- `按阻塞聚合视图`

## 6.1 Task-system document roles

When the task set becomes a working execution system, prefer these roles:

| Document role | Typical number | Main job |
| --- | --- | --- |
| Task index/dashboard | `T00` | index, dispatch rules, dashboard, owner/blocker views |
| Umbrella execution plan | `T01` | overall phase plan and milestone summary |
| Umbrella acceptance checklist | `T02` | overall integration and acceptance summary |
| Collaboration-boundary doc | `T03` | ownership boundaries, handoff rules, maintenance rules |
| Execution docs | `T04+` | one stable responsibility slice per doc |

Execution docs should not overlap in primary ownership.

## 6.2 Execution status vs. metadata status

Metadata `状态` is still governed by lifecycle values:
- `草案`
- `评审中`
- `已生效`
- `已废弃`

Execution-facing task tracking should use a separate `执行状态` section.

Recommended `执行状态` values:
- `未开始`
- `进行中`
- `阻塞`
- `已完成`

Recommended `子状态` values for subtask rows:
- `未开始`
- `进行中`
- `阻塞`
- `已完成`

Do not replace the metadata lifecycle status with execution status.

## 6.3 Execution owner and schedule fields

Assignment-ready task docs should include:

```md
## 执行 owner
- owner 角色：前端负责人
- 当前执行 owner：`frontend-agent`
- 备援 owner：待分配
- 协作角色：后端负责人、测试负责人
- owner 变更要求：切换执行人时同步更新本节和交接记录。

## 执行排期
- 优先级：P1
- ETA：2026-04-21
- 实际完成时间：待完成
- 排期维护要求：排期变化时同步更新 `T00`。
```

Recommended priority values:
- `P0`
- `P1`
- `P2`

If the real assignee is unknown, default role-based agent names are acceptable.

## 6.4 Assignment-ready subtask table

Prefer this table shape for execution docs:

```md
| 子任务编号 | 子状态 | 子任务 | 执行 owner | 预计输入 | 预计输出 | Done Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| T05-01 | 未开始 | 应用骨架与全局上下文 | `frontend-agent` | `D01`、`T04` | 路由骨架和上下文切换 | 应用可稳定切换家庭与宝宝，并具备全局错误兜底。 |
```

Rules:
- `子任务编号` should be stable and traceable to the parent task doc
- `执行 owner` should normally match the task owner unless the task intentionally contains sub-ownership
- `预计输入` should be concrete upstream docs, contracts, environments, or data
- `预计输出` should be concrete deliverables
- `Done Criteria` should be observable and testable

## 6.5 Expected inputs and outputs

Assignment-ready task docs should explicitly state:
- what upstream docs, systems, or decisions they consume
- what downstream tasks can rely on after completion

This reduces informal coordination and prevents multiple agents from making hidden assumptions.

## 6.6 Allowed write scope

Execution docs should include `允许修改的代码目录` when code work is expected.

This section should:
- list the expected write scope
- mark whether each path already exists
- clarify which areas are placeholders vs. established directories

If the write scope changes materially, update the task doc before implementation.

## 6.7 External dependency register and handoff

Execution docs should include:
- `外部依赖登记表`
- `agent 接手说明`
- `交接记录`

These sections are used to:
- record blockers without editing other task docs
- preserve handoff continuity between agents
- keep ownership changes visible and auditable

## 6.8 T00 dashboard expectations

When `T00` acts as the active portfolio dashboard, it should usually include:

### Portfolio dashboard
- task id
- ownership domain
- current execution status
- current execution owner
- priority
- ETA
- actual completion time
- main inputs
- main outputs
- current blocker

### Owner aggregation view
- owner
- owned tasks
- current status
- near-term goal
- main blocker

### Blocker aggregation view
- blocker theme
- impacted tasks
- current status
- responsible owner
- handling direction

## 7. Writing rules

Task docs should answer:
- Why does this task exist?
- What exactly must be done?
- Who owns each part?
- What dependencies or blockers exist?
- How do we know the task is complete?

Prefer:
- explicit actions
- concrete owners
- observable completion criteria
- finite milestones

Avoid:
- vague goals without action items
- missing owners
- missing done criteria
- mixing broad product strategy with execution details

## 7.1 Anti-patterns

Avoid these task-doc anti-patterns because they commonly cause cross-execution or cross-maintenance problems:

| Anti-pattern | Why it is harmful | Preferred correction |
| --- | --- | --- |
| umbrella docs become the primary working surface | execution detail drifts away from the real owner doc | keep umbrella docs summary-only and push detail into execution docs |
| one execution doc mixes frontend, backend, ops, and QA ownership | multiple agents need to edit the same doc constantly | split by stable execution boundary |
| two execution docs claim the same deliverable | ownership becomes ambiguous and conflict-prone | assign one clear primary owner and record the rest as dependencies |
| subtask rows have no `Done Criteria` | completion becomes subjective and hard to audit | require observable completion conditions |
| execution docs omit `预计输入` and `预计输出` | agents make hidden assumptions and handoff quality drops | state concrete upstream inputs and downstream outputs explicitly |
| execution docs omit `允许修改的代码目录` | write scope becomes unclear and overlap risk rises | define write scope before implementation |
| blockers are solved by editing another task doc directly | maintenance boundaries collapse | record the blocker locally, then escalate through the agreed handoff path |
| execution statuses are written into metadata `状态` | lifecycle governance and execution tracking become mixed | keep lifecycle status in metadata and execution status in a separate section |
| `T00` is not updated after owner/ETA/blocker changes | dispatch and portfolio view become stale | update `T00` after material execution changes |
| numbering is changed casually during refactor | links, references, and history become unstable | preserve numbering unless there is a strong migration reason |

## 8. Example minimal template

```md
# 标题

> 文档编号：T01
> 状态：草案
> 版本号：v0.1.0
> 最后更新时间：2026-04-12
> 审核人：待定
> 生效日期：2026-04-12
> 负责人：待定

## 变更记录

| 版本号 | 日期 | 变更人 | 变更说明 |
| --- | --- | --- | --- |
| v0.1.0 | 2026-04-12 | Codex | 创建首版任务文档。 |

## 文档目的
## 目标读者
## 关联文档
## 任务背景
## 任务范围
## 任务拆解
## 负责人
## 完成标准
```

## 8.1 Example assignment-ready template

```md
# 标题

> 文档编号：T04
> 状态：草案
> 版本号：v0.1.0
> 最后更新时间：2026-04-12
> 审核人：待定
> 生效日期：2026-04-12
> 负责人：后端负责人

## 变更记录

| 版本号 | 日期 | 变更人 | 变更说明 |
| --- | --- | --- | --- |
| v0.1.0 | 2026-04-12 | Codex | 创建首版任务文档。 |

## 执行状态
- 当前状态：未开始
- 可选状态：未开始 / 进行中 / 阻塞 / 已完成

## 执行 owner
- owner 角色：后端负责人
- 当前执行 owner：`spec-agent`
- 备援 owner：待分配
- 协作角色：前端负责人、测试负责人

## 执行排期
- 优先级：P0
- ETA：2026-04-14
- 实际完成时间：待完成

## 文档目的
## 目标读者
## 关联文档
## 任务背景
## 任务范围
## 预计输入
## 预计输出
## 允许修改的代码目录
## 外部依赖登记表
## agent 接手说明
## 交接记录

## 任务拆解

| 子任务编号 | 子状态 | 子任务 | 执行 owner | 预计输入 | 预计输出 | Done Criteria |
| --- | --- | --- | --- | --- | --- | --- |
```

## 8.2 Full T00 dashboard template

Use this when `T00` is an active task-system index rather than a passive list.

```md
# 任务类文档

> 文档编号：T00
> 状态：草案
> 版本号：v0.1.0
> 最后更新时间：2026-04-12
> 审核人：待定
> 生效日期：2026-04-12
> 负责人：待定

## 变更记录

| 版本号 | 日期 | 变更人 | 变更说明 |
| --- | --- | --- | --- |
| v0.1.0 | 2026-04-12 | Codex | 创建任务索引与总看板。 |

## 分类说明
- 面向任务拆解、执行计划、责任分配、阻塞管理和完成标准定义。

## 包含文档
- [T01 示例总计划](./T01-example-plan.md)
- [T02 示例验收清单](./T02-example-checklist.md)
- [T03 示例协作边界](./T03-example-collaboration.md)
- [T04 示例执行任务](./T04-example-execution.md)

## 派单规则
- 一次只认领一个执行主文档。
- 接手时必须更新对应文档中的执行 owner 和交接记录。
- 执行前先检查预计输入和外部依赖。
- 完成后先更新执行文档，再回写 `T00`。

## 总看板视图

| Task | 主责域 | 当前执行状态 | 当前执行 owner | 优先级 | ETA | 实际完成时间 | 主要输入 | 主要输出 | 当前阻塞 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `T04` | 示例领域 | 未开始 | `example-agent` | P0 | 2026-04-14 | 待完成 | 输入 A、输入 B | 输出 A、输出 B | 阻塞项待处理 |

## 按 owner 聚合视图

| Owner | 负责任务 | 当前状态 | 近期目标 | 主要阻塞 |
| --- | --- | --- | --- | --- |
| `example-agent` | `T04` | 未开始 | 完成示例任务 | 阻塞项待处理 |

## 按阻塞聚合视图

| 阻塞主题 | 影响任务 | 当前状态 | 责任 owner | 处理方向 |
| --- | --- | --- | --- | --- |
| 契约未冻结 | `T04` | 待处理 | `example-agent` | 先完成契约冻结 |

## 推荐执行顺序
1. 阅读 `T03` 协作规则。
2. 完成前置冻结任务。
3. 并行执行稳定责任域任务。
4. 最后汇总联调和验收结论。
```

## 8.3 Full T03 collaboration-boundary template

Use this when multiple people or agents will maintain the task system in parallel.

```md
# Agent 协作边界与维护规则

> 文档编号：T03
> 状态：草案
> 版本号：v0.1.0
> 最后更新时间：2026-04-12
> 审核人：待定
> 生效日期：2026-04-12
> 负责人：项目经理

## 变更记录

| 版本号 | 日期 | 变更人 | 变更说明 |
| --- | --- | --- | --- |
| v0.1.0 | 2026-04-12 | Codex | 创建协作边界与回写规则。 |

## 文档目的
## 目标读者
## 关联文档
## 任务背景
## 任务范围

## 分片原则
- 一个执行文档只负责一个稳定能力域。
- 总览文档不承载一线执行细节。
- 同一类交付物只能有一个主责文档。

## 主责矩阵

| 文档 | 主责范围 | 上游输入 | 下游输出 | 主维护人 |
| --- | --- | --- | --- | --- |
| `T04` | 示例责任域 | 上游输入 | 下游输出 | `example-agent` |

## Agent 执行规则

| 规则编号 | 规则 |
| --- | --- |
| R1 | 一次只认领一份主执行文档。 |
| R2 | 先更新自己的执行文档，再更新总览。 |
| R3 | 外部问题先登记依赖，不直接改写其他任务文档。 |

## 回写顺序
1. 更新主责任务文档。
2. 更新 `T01` 或 `T02`。
3. 更新 `T00`。

## 完成标准
- 各执行文档主责唯一。
- 回写顺序明确。
- 多 agent 可并行维护且不交叉覆盖。
```

## 8.4 Full T04+ execution-doc template

Use this for execution docs that will be directly assigned to an agent.

```md
# 标题

> 文档编号：T04
> 状态：草案
> 版本号：v0.1.0
> 最后更新时间：2026-04-12
> 审核人：待定
> 生效日期：2026-04-12
> 负责人：后端负责人

## 变更记录

| 版本号 | 日期 | 变更人 | 变更说明 |
| --- | --- | --- | --- |
| v0.1.0 | 2026-04-12 | Codex | 创建首版执行任务文档。 |

## 执行状态
- 当前状态：未开始
- 可选状态：未开始 / 进行中 / 阻塞 / 已完成

## 执行 owner
- owner 角色：后端负责人
- 当前执行 owner：`example-agent`
- 备援 owner：待分配
- 协作角色：前端负责人、测试负责人
- owner 变更要求：变更执行人时同步更新本节和交接记录。

## 执行排期
- 优先级：P0
- ETA：2026-04-14
- 实际完成时间：待完成
- 排期维护要求：排期变化时同步更新 `T00`。

## 文档目的
## 目标读者
## 关联文档
## 任务背景
## 任务范围

### 负责范围
### 不负责范围

## Agent 执行边界

### 允许维护
### 禁止越界

## 预计输入
## 预计输出
## 允许修改的代码目录

| 目录 | 用途 | 当前状态 |
| --- | --- | --- |
| `path/example/` | 示例占位 | 待创建 |

## 外部依赖登记表

| 编号 | 依赖项 | 来源任务/文档 | 当前状态 | 阻塞影响 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| D-04-01 | 示例依赖 | `T03` | 待确认 | 影响执行 | 跟进确认 |

## agent 接手说明
1. 接手前检查边界和输入。
2. 开始执行时更新执行状态和交接记录。
3. 发现跨任务问题时先登记依赖。
4. 交接前写明完成项、阻塞项和下步建议。

## 交接记录

| 日期 | 交接人 | 接手内容 | 当前状态 | 备注 |
| --- | --- | --- | --- | --- |
| 2026-04-12 | Codex | 初始化执行模板 | 未开始 | 待执行人接手 |

## 交付物
## 任务拆解

| 子任务编号 | 子状态 | 子任务 | 执行 owner | 预计输入 | 预计输出 | Done Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| T04-01 | 未开始 | 示例子任务 | `example-agent` | 输入 A | 输出 A | 可验证完成条件 |

## 依赖与阻塞
## 状态跟踪
## 完成标准
```

## 8.5 Repo-specific playbook

Use this repository's current task-doc system as the default playbook unless the user explicitly wants a redesign.

### Current recommended layout

| Doc | Role in this repo |
| --- | --- |
| `T00` | active dashboard, dispatch rules, owner view, blocker view |
| `T01` | phased delivery umbrella plan |
| `T02` | integration and acceptance umbrella checklist |
| `T03` | collaboration-boundary and maintenance-rule doc |
| `T04` | spec, contract, and data-model freeze |
| `T05` | frontend user app, H5, and admin |
| `T06` | backend auth, family, baby, and event core |
| `T07` | summary, alerts, and async jobs |
| `T08` | AI, export, and sharing |
| `T09` | ops, security, and release readiness |
| `T10` | quality, integration, and acceptance execution |

### Repo-specific operating rules
- Prefer extending `T04` to `T10` rather than creating overlapping new execution docs.
- Keep `T01` and `T02` as umbrella docs, not as the primary execution surface.
- Use `T03` for cross-task agent coordination rules rather than repeating them in every task doc.
- Update `T00` when owner, ETA, execution status, or blocker state materially changes.
- If real assignees are unknown, initialize role-based agent names and replace them later.

### Default role-based agent names in this repo
- `spec-agent`
- `frontend-agent`
- `backend-core-agent`
- `backend-async-agent`
- `ai-report-agent`
- `ops-agent`
- `qa-agent`

## 9. Update checklist

When adding a task doc:
1. choose the next valid `T` number
2. create the file under `docs/task`
3. add the metadata block
4. add the change-log section
5. decide whether this is an umbrella doc, a dashboard doc, a boundary doc, or an execution doc
6. if it is an execution doc, add execution owner, schedule, inputs, outputs, write scope, dependency register, and handoff sections
7. if `T00` is active, update dashboard, owner view, and blocker view
8. follow the required task structure
9. update `docs/task/README.md`
10. update `docs/README.md` if the new task doc should be listed there

## 10. Relationship to document governance

Task docs still follow the repo-wide governance rules:
- status values
- versioning format
- naming format
- preservation of deprecated docs

Use `document-governance` when the user is asking for cross-category governance changes rather than task execution documents.

## 11. Multi-agent maintenance rule

When task docs are used by multiple agents:
- one execution doc should have one clear primary owner
- agents should update their own execution doc first
- blockers should be recorded as dependencies, not solved by editing other task docs
- `T00` should summarize, not replace, execution detail
- umbrella docs should not become the primary working surface once execution docs exist

## 12. Refactor-current-task-docs workflow

Use this workflow when existing `docs/task` content needs to be upgraded into an assignment-ready system:

1. classify every current `T` doc by role: index, umbrella, boundary, or execution
2. identify overlapping ownership and mixed-scope docs
3. split mixed docs into stable responsibility slices
4. upgrade execution docs with assignment-ready sections
5. normalize subtask tables to include `子状态` and `Done Criteria`
6. initialize execution owners and ETAs
7. upgrade `T00` into an active dashboard
8. verify that execution detail lives in execution docs, not umbrella docs
9. run `task-doc-checklist.md` before closing the refactor
