# Merged Documentation Governance Standard

Use this reference when creating, reorganizing, or reviewing the repository's documentation system.

This file is the single source of truth for non-task documentation governance in this repository. Do not recreate parallel governance copies under `docs/specs/`.

For dedicated task execution documents, switch to `task-doc-management`.

## 1. Category system

The repository uses these categories:

| Prefix | Directory | Category | Typical content |
| --- | --- | --- | --- |
| `P` | `docs/product` | Product | product overview, requirements, scope, roadmap |
| `A` | `docs/architecture` | Architecture | system architecture, deployment, security, compliance |
| `D` | `docs/design` | Design | IA, flows, API, data model, database, AI rules |
| `Q` | `docs/quality` | Quality | testing, acceptance, release checks |
| `S` | `docs/specs` | Specs | cross-doc governance rules, machine-readable specs |

Use the category based on the document's primary purpose.

## 2. Metadata block

Every Markdown doc should use this exact header block immediately below the title:

```md
> 文档编号：D03
> 状态：草案
> 版本号：v0.1.0
> 最后更新时间：2026-04-12
> 审核人：待定
> 生效日期：2026-04-12
> 负责人：待定
```

Special cases:
- `docs/README.md` uses `DOC-ROOT`
- Category index pages keep filename `README.md` and use numbered IDs like `P00`, `A00`, `D00`, `T00`, `Q00`, `S00`

## 3. Change log

Every Markdown doc should contain a `变更记录` section near the top.

Use this structure:

```md
## 变更记录

| 版本号 | 日期 | 变更人 | 变更说明 |
| --- | --- | --- | --- |
| v0.1.0 | 2026-04-12 | Codex | 创建首版文档。 |
```

Whenever the document changes:
- update `版本号`
- update `最后更新时间`
- append a row to the change log
- adjust `状态` if lifecycle changed

## 4. Allowed status values

Only use these status values:
- `草案`
- `评审中`
- `已生效`
- `已废弃`

Guidance:
- `草案`: content still incomplete or changing substantially
- `评审中`: ready for cross-role review
- `已生效`: approved and usable as execution baseline
- `已废弃`: retained for history, no longer current baseline

If a doc is `已废弃`, add a prominent note near the top with:
- deprecation date
- reason
- replacement doc if one exists

## 5. Versioning rules

Use `v<major>.<minor>.<patch>`.

Examples:
- `v0.1.0`
- `v0.2.0`
- `v1.0.0`
- `v1.2.3`

Version bump guidance:

| Change type | Bump | Typical meaning |
| --- | --- | --- |
| typo fixes, links, formatting, minor examples | `patch` | wording changed, execution meaning did not |
| new sections, medium-range expansion, more structure | `minor` | implementation detail changed or expanded, baseline still compatible |
| incompatible change, major repositioning, new execution baseline | `major` | old understanding is no longer reliable |

Examples:
- `v0.1.0 -> v0.1.1`: fix links and wording
- `v0.1.0 -> v0.2.0`: add a full new section or capability
- `v0.2.0 -> v1.0.0`: pass review and become formal execution baseline
- `v1.4.0 -> v2.0.0`: incompatible redesign

## 6. Naming and numbering rules

### Directories
- Use lowercase English names only
- Allowed current category directories:
  - `product`
  - `architecture`
  - `design`
  - `quality`
  - `specs`

Do not use:
- spaces
- Chinese directory names
- underscores
- vague abbreviations

### File names
- Markdown format: `<PREFIX><NN>-<english-short-name>.md`
- Spec file format: `<PREFIX><NN>-<english-short-name>.<ext>`

Examples:
- `P01-product-overview.md`
- `A01-system-architecture.md`
- `D03-api-design.md`
- `Q01-testing-and-acceptance.md`
- `S07-document-governance-playbook.md`
- `S01-openapi.yaml`

Do not use:
- `接口设计.md`
- `P1-api.md`
- `final-v2.md`
- `doc1.md`

### Numbering
- Use two digits per category: `01`, `02`, `03`
- No duplicates within a category
- Do not reuse retired numbers
- Do not renumber stable docs just for aesthetics
- If docs are already in active use, preserve numbering unless there is a compelling migration reason

## 7. Category templates

### Product docs (`P`)
Required sections:
- `文档目的`
- `目标读者`
- `关联文档`
- `背景` or `产品定位`
- `目标用户`
- `核心价值` or `业务目标`
- `范围` or `功能清单`
- `非目标` or `延期项`

### Architecture docs (`A`)
Required sections:
- `文档目的`
- `目标读者`
- `关联文档`
- `设计原则` or `架构原则`
- `总体结构` or `部署拓扑`
- `模块职责` or `组件职责`
- `约束`
- `扩展路径` or `演进策略`

### Design docs (`D`)
Required sections:
- `文档目的`
- `目标读者`
- `关联文档`
- `设计范围`
- `核心对象` or `核心流程` or `核心接口`
- `规则` or `约束` or `口径`
- `示例` or `图示` or `结构定义`

Implementation-oriented design docs should include at least one structured expression:
- tables
- JSON examples
- Mermaid diagrams
- explicit rule lists

### Quality docs (`Q`)
Required sections:
- `文档目的`
- `目标读者`
- `关联文档`
- `测试范围`
- `测试策略` or `测试分层`
- `关键场景`
- `验收标准`

Acceptance criteria should be decidable. Avoid vague language like "works normally" or "looks good".

### Specs docs (`S`)
Recommended sections:
- `文档目的`
- `目标读者`
- `关联文档`
- `适用范围`
- `规则定义`
- `示例`
- `维护建议`

Specs are governance documents. They should define explicit rules, not just principles.

## 8. Deprecated document handling

Default behavior:
- do not delete deprecated docs by default
- preserve them for traceability

When a doc is deprecated:
1. change status to `已废弃`
2. add a visible deprecation note near the top
3. reference the replacement doc if there is one
4. optionally move it under the category's `archive/` directory

If you move a doc to `archive/`:
- keep the original file name and number
- update indexes
- preserve inbound references where possible

## 9. Update checklist

Whenever you add or rename documentation:
1. choose the category
2. assign the next valid number
3. create the file using the naming rule
4. add the metadata block
5. add the change-log section
6. follow the category template
7. update the category `README.md`
8. update `docs/README.md` if the visible document set changed
9. fix all relative links

## 10. When converting these standards into a skill

If the governance rules are packaged as a skill:
- keep the workflow in `SKILL.md`
- keep the detailed matrices and exact conventions in `references/`
- prefer one merged governance reference over multiple fragmented reference files unless the rules grow substantially
- keep the skill usable for both creating new docs and restructuring old ones
- if the request is really about task execution documents, switch to `task-doc-management`
