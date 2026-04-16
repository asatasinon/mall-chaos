---
mode: agent
description: "Implement a task from _docs/tasks/. Use when: implementing a task, building a service, executing a task spec, working on task-01 through task-19."
---

Read and implement the task spec for **task-${input:taskNumber}: ${input:taskName}**.

## Steps

1. Read `_docs/tasks/task-${input:taskNumber}-${input:taskName}.md` in full
2. Check `AGENTS.md` for relevant conventions and invariants
3. Check `_docs/tasks/README.md` to confirm prerequisite tasks are complete
4. Implement every sub-task checklist item in order
5. After each sub-task group, verify the stated acceptance criteria

## Rules

- Follow all conventions in `AGENTS.md` exactly
- Respect critical invariants (optimistic locking, chaos profile gating, durationSec auto-off)
- Never expose chaos endpoints without `@Profile("chaos")`
- All services must use structured JSON logging and expose `/actuator/prometheus`
- After implementation, run `mvn clean package -DskipTests` to confirm BUILD SUCCESS
