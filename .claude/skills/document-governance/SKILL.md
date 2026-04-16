---
name: document-governance
description: Create, merge, standardize, and maintain project documentation systems and governance rules. Use this skill whenever the user asks to reorganize docs, merge specs,standardize README structures, unify document metadata, enforce status/version/template/naming/numbering rules, or establish documentation governance across product, architecture, design, quality, and specs docs. Also use it when converting existing documentation rules into a reusable documentation-governance workflow or skill, even if the user does not explicitly say "documentation governance". If the request is primarily about task execution docs, milestone plans, owner assignments, or actionable T-category work tracking, use `task-doc-management` instead.
---

# Document Governance

Use this skill to turn scattered project documents into a consistent, maintainable documentation system.

This skill is for:
- Creating new project docs under a governed structure
- Reclassifying or merging existing docs
- Applying metadata, version, status, and change-log conventions
- Enforcing naming and numbering rules
- Creating category-specific docs for product, architecture, design, quality, and specs
- Converting documentation rules into reusable repo-local workflows or skills

Read [references/doc-governance-merged-standard.md](./references/doc-governance-merged-standard.md) before making or reorganizing documentation.

## Default workflow

1. Identify the document's primary category.
   Categories are `product`, `architecture`, `design`, `quality`, and `specs`.
   Choose the category by the document's main job, not by incidental content.
   If the user is asking for task execution documents, task dashboards, owner/blocker views, multi-agent handoff rules, or assignment-ready `T` docs, switch to `task-doc-management`.

2. Apply the directory and numbering system.
   Use `P/A/D/Q/S` prefixes for the categories this skill owns.
   Use `DOC-ROOT` for `docs/README.md`.
   Use `X00` only for category index documents whose filename remains `README.md`.

3. Apply the standard metadata block.
   Every Markdown doc should include:
   - `文档编号`
   - `状态`
   - `版本号`
   - `最后更新时间`
   - `审核人`
   - `生效日期`
   - `负责人`

4. Apply the standard change-log section.
   Each Markdown doc should contain a `变更记录` table near the top.
   When content changes, update `版本号` and `最后更新时间`, then append a change-log row.

5. Enforce the status and version rules.
   Allowed statuses are:
   - `草案`
   - `评审中`
   - `已生效`
   - `已废弃`
   Pick the status based on actual document lifecycle, not wishful labeling.

6. Use the category template.
   Each category has a minimum required structure.
   Do not omit required sections for the chosen category.

7. Keep naming stable unless the document meaning changed.
   Renaming files requires updating all internal links and index pages.
   Do not casually reshuffle numbering once docs are in use.

## Category mapping

### Product (`P`)
- Use for product overview, requirements, scope, roadmap, business goals, role definitions, and phased delivery plans.

### Architecture (`A`)
- Use for system architecture, deployment, operations, security, compliance, and system-wide technical constraints.

### Design (`D`)
- Use for information architecture, business flows, API design, domain models, database design, AI/engine rules, and implementation-level design.

### Quality (`Q`)
- Use for testing, acceptance, integration checklists, release validation, and quality gates.

### Specs (`S`)
- Use for normative rules, shared standards, machine-readable specs, and cross-document governance rules.

## Output requirements

When creating or restructuring docs with this skill:
- Keep links relative and valid
- Keep file names ASCII and hyphenated
- Preserve numbering continuity inside each category
- Update category indexes and `docs/README.md` if the doc set changes
- Preserve old docs instead of deleting them when they still have historical value

## When merging documentation into a skill

If the user wants documentation rules converted into a skill:
- Keep `SKILL.md` focused on trigger conditions and workflow
- Move detailed rules, tables, and category matrices into `references/`
- Merge overlapping rules instead of duplicating them across multiple reference files
- Make the skill reusable beyond a single repo, but keep repo-local conventions explicit

## Do not do these things

- Do not invent new statuses outside the approved set unless the governing spec is updated
- Do not create mixed-language or space-separated file names
- Do not reuse old numbers from abandoned or archived docs
- Do not mark a doc `已生效` if it is still missing key sections
- Do not silently delete deprecated docs that may still be referenced

## Example trigger cases

**Example 1**
Input: "帮我把 docs 里的架构文档和接口文档重组一下，并统一编号和元信息。"
Action: Use this skill to classify docs, enforce `A` and `D` numbering, and normalize metadata blocks.

**Example 2**
Input: "把这几份规范整理成一套文档治理规则。"
Action: Use this skill to merge overlapping standards, write a governed spec set, and update indexes.

**Example 3**
Input: "我要新增一个迭代执行计划文档。"
Action: 遇到真正的任务执行文档，请切换到 `task-doc-management`。

**Example 4**
Input: "帮我把任务文档改成 agent 可并行维护的格式。"
Action: 这属于 `T` 类执行体系，请切换到 `task-doc-management`，不要在 `document-governance` 中重复维护任务执行规则。
