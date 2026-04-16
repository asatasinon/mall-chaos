# Task Doc Checklist

Use this checklist when creating, refactoring, or reviewing `docs/task` documents.

This checklist is intentionally operational. It is meant to be checked item by item before closing the task-doc work.

## 1. Classification

- [ ] Confirm the document belongs under `docs/task`, not `product` / `architecture` / `design` / `quality` / `specs`.
- [ ] Confirm the doc is one of: `T00` dashboard, umbrella doc, collaboration-boundary doc, or execution doc.
- [ ] Confirm the chosen `T` number is valid and not overlapping with an existing doc.

## 2. Metadata

- [ ] Title is present and matches the document purpose.
- [ ] Metadata block includes `文档编号 / 状态 / 版本号 / 最后更新时间 / 审核人 / 生效日期 / 负责人`.
- [ ] Metadata `状态` uses only governed lifecycle values: `草案 / 评审中 / 已生效 / 已废弃`.
- [ ] `变更记录` exists and includes a new row for the current change.
- [ ] `版本号` and `最后更新时间` were updated consistently.

## 3. Role fit

- [ ] `T00` acts as index/dashboard only, not as the primary execution surface.
- [ ] Umbrella docs such as `T01/T02` summarize and coordinate, but do not duplicate execution detail from `T04+`.
- [ ] `T03` stores cross-task coordination, boundaries, and handoff rules.
- [ ] Each `T04+` execution doc owns one stable responsibility slice only.

## 4. Assignment-ready execution fields

For execution docs:

- [ ] `执行状态` exists and uses `未开始 / 进行中 / 阻塞 / 已完成`.
- [ ] `执行 owner` exists and names a current owner.
- [ ] `执行排期` exists and includes `优先级 / ETA / 实际完成时间`.
- [ ] `预计输入` exists and names concrete upstream docs, systems, or decisions.
- [ ] `预计输出` exists and names concrete downstream deliverables.
- [ ] `允许修改的代码目录` exists if code work is expected.
- [ ] `外部依赖登记表` exists.
- [ ] `agent 接手说明` exists.
- [ ] `交接记录` exists.

## 5. Subtask quality

- [ ] Subtask table uses stable `子任务编号`.
- [ ] Subtask table includes `子状态`.
- [ ] Subtask table includes `执行 owner`.
- [ ] Subtask table includes `预计输入 / 预计输出`.
- [ ] Every subtask has observable `Done Criteria`.
- [ ] No subtask is vague enough that two different agents could both interpret it as theirs.

## 6. Ownership and boundary checks

- [ ] Primary ownership is unique and explicit.
- [ ] The document clearly states `负责范围` and `不负责范围`.
- [ ] `允许维护` and `禁止越界` are clear when multi-agent execution is expected.
- [ ] Cross-task issues are recorded as dependencies or blockers, not by editing other execution docs directly.

## 7. Dashboard and coordination checks

For `T00`:

- [ ] Portfolio dashboard exists.
- [ ] Owner aggregation view exists.
- [ ] Blocker aggregation view exists.
- [ ] Dispatch rules are present.
- [ ] Recommended execution order is present.

For the whole task-doc system:

- [ ] `T00` owner, ETA, and blocker summaries are aligned with current execution docs.
- [ ] `T03` is aligned with the current responsibility split.
- [ ] `T04+` docs are the main execution docs, not the umbrella docs.

## 8. Link and navigation checks

- [ ] `docs/task/README.md` lists the current visible task docs.
- [ ] `docs/README.md` reflects the current visible task-doc set when needed.
- [ ] Relative links between task docs are valid.
- [ ] New task docs are included in the reading / dispatch order if required.

## 9. Anti-overlap checks

- [ ] No two execution docs claim the same primary deliverable.
- [ ] No umbrella doc repeats the full task table from an execution doc.
- [ ] No execution doc silently changes another task's owner, ETA, or blocker state.
- [ ] No task doc uses execution status values in the metadata `状态` field.

## 10. Review outcome

- [ ] The doc set is safe for single-agent execution.
- [ ] The doc set is safe for multi-agent parallel execution.
- [ ] The current change can be handed off without oral explanation.
