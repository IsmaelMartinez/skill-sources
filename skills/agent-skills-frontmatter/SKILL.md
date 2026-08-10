---
name: agent-skills-frontmatter
description: Covers the YAML frontmatter of a SKILL.md file — the name, description, license, compatibility, metadata and allowed-tools fields, their character limits, and the directory layout a skill must have. Use when authoring a new skill, when frontmatter fails validation, or when checking an existing skill against the Agent Skills specification.
license: MIT
---

# Agent Skills frontmatter

A skill is a directory containing at minimum a `SKILL.md`, which is YAML
frontmatter followed by Markdown instructions. Everything else is optional:

```
skill-name/
├── SKILL.md          # required: metadata + instructions
├── scripts/          # optional: executable code
├── references/       # optional: documentation loaded on demand
└── assets/           # optional: templates, images, data files
```

## Fields

| Field           | Required | Constraints                                           |
| --------------- | -------- | ----------------------------------------------------- |
| `name`          | yes      | 1–64 chars, lowercase `a-z0-9` and `-` only           |
| `description`   | yes      | 1–1024 chars, non-empty                               |
| `license`       | no       | a licence name, or the name of a bundled licence file |
| `compatibility` | no       | max 500 chars                                         |
| `metadata`      | no       | a map from string keys to string values               |
| `allowed-tools` | no       | space-separated string; experimental                  |

### name

Beyond the character rules, three constraints catch people out: it must not
start or end with a hyphen, it must not contain consecutive hyphens (`--`), and
it must match the parent directory name. A skill in `pdf-processing/` declaring
`name: pdf_processing` is invalid on two counts at once.

```yaml
name: pdf-processing # valid
name: PDF-Processing # invalid — uppercase
name: -pdf # invalid — leading hyphen
name: pdf--processing # invalid — consecutive hyphens
```

### description

This is the field that decides whether the skill is ever used, because it is
loaded for every skill at startup while the body is not. It should say both what
the skill does and when to use it, and carry the keywords that would appear in a
task the skill applies to.

```yaml
# good
description: Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents or when the user mentions PDFs, forms, or document extraction.

# poor: no keywords, nothing to trigger on
description: Helps with PDFs.
```

### Optional fields

`compatibility` states environment requirements — intended product, system
packages, network access — and most skills should leave it out rather than
state the obvious. `metadata` is a client-defined key-value bag; since the
values are strings, a version has to be quoted, or YAML parses it as a float
rather than the string the spec asks for:

```yaml
metadata:
  author: example-org
  version: "1.0" # quoted — 1.0 alone is a float, not a string
```

Keep `metadata` keys reasonably unique to avoid colliding with another client's.

## Body and size

Agents load a skill in three stages: `name` and `description` at startup
(~100 tokens), the full body once the skill activates (keep under 5000 tokens),
and files under `scripts/`, `references/` or `assets/` only when the task
reaches for them. Structure for that — keep `SKILL.md` under 500 lines and move
detailed reference material into separate files rather than inlining it.

Reference other files by relative path from the skill root, one level deep. Deep
chains of references pointing at further references are hard for an agent to
follow.

## Validating

The reference library checks frontmatter and naming:

```bash
skills-ref validate ./my-skill
```

## Common mistakes

| Mistake                                    | Consequence                               |
| ------------------------------------------ | ----------------------------------------- |
| `name` differs from the directory name     | Invalid, even if both are well-formed     |
| Unquoted `version: 1.0` in `metadata`      | Parsed as a float; values must be strings |
| Description says what, not when            | Skill exists but is never selected        |
| Whole reference manual inlined in the body | Loads in full on every activation         |
| `allowed-tools` written as a YAML list     | It is a single space-separated string     |
