---
name: botoolagent-prdreview
description: "Run adversarial PRD review using Codex CLI red-team analysis. Triggers on: prd review, review prd, prdreview, 审查 prd."
user-invocable: true
---

# BotoolAgent PRD Review

Uses Codex CLI to perform adversarial red-team review of PRD documents, finding completeness gaps, consistency issues, security risks, and implementability problems before development begins.

Supports two modes:
- **A1 Auto-chain** — called by PRDing Ralph background agent as part of the automated pipeline
- **Standalone** — user manually runs `/prdreview <file-path>` to review any `.md` file

---

**Announce at start:** "Starting adversarial PRD review using Codex CLI red-team analysis..."

---

## Prerequisites

This skill requires the Codex CLI to be installed and available in PATH.

Run this check first:

```bash
which codex >/dev/null 2>&1 && echo "codex available" || echo "codex not available"
```

If codex is not available, see **Error Handling / Degraded Mode** at the bottom of this skill.

---

## Usage

**Trigger phrases:** `prd review`, `review prd`, `prdreview`, `审查 prd`

**Arguments:**
- No argument or a projectId → A1 auto-chain mode (registry lookup)
- A file path (contains `/` or ends with `.md`) → Standalone mode

**Examples:**
- `/botoolagent-prdreview` — A1 mode: review prd.md for the current project
- `/botoolagent-prdreview botool-present-v16` — A1 mode: review prd.md for the given projectId
- `/botoolagent-prdreview tasks/my-feature/prd.md` — Standalone mode: review the specified file
- `/botoolagent-prdreview ~/docs/spec.md` — Standalone mode: review an arbitrary markdown file

---

## Step 0: Mode Detection + Setup

### Mode Detection

Parse the argument to determine the mode:

```
ARG = user-provided argument (may be empty)

if ARG contains "/" OR ARG ends with ".md":
  MODE = "standalone"
  SOURCE_FILE = ARG  (resolve to absolute path)
else:
  MODE = "auto-chain"
  PROJECT_ID = ARG  (may be empty)
```

### A1 Auto-chain Setup

When `MODE = "auto-chain"`:

1. If `PROJECT_ID` is provided (non-empty), use it directly.
2. Otherwise, check `tasks/registry.json` (or `BotoolAgent/tasks/registry.json`):
   - If exists with multiple projects, use AskUserQuestion to let the user choose
   - If single project, use that project's ID
   - If no registry, fall back to root `.`
3. Set `PRD_DIR = "tasks/${PROJECT_ID}"`

Locate the PRD file:
```bash
if [ -f "${PRD_DIR}/prd.md" ]; then
  PRD_FILE="${PRD_DIR}/prd.md"
elif [ -f "${PRD_DIR}/prd.json" ]; then
  PRD_FILE="${PRD_DIR}/prd.json"
else
  echo "ERROR: No PRD file found in ${PRD_DIR}"
fi
```

**If no PRD file found:**
```
Error: PRD file not found.

Recovery suggestions:
- Run /botoolagent-pyramidprd to generate a PRD
- Or check the project directory exists: tasks/${PROJECT_ID}/
```
Then stop here.

### Standalone Setup

When `MODE = "standalone"`:

1. Resolve `SOURCE_FILE` to an absolute path.
2. Verify the file exists:
```bash
if [ ! -f "$SOURCE_FILE" ]; then
  echo "ERROR: File not found: $SOURCE_FILE"
  # stop here
fi
```
3. Extract the stem for output naming:
```bash
STEM=$(basename "$SOURCE_FILE" .md)
SOURCE_DIR=$(dirname "$SOURCE_FILE")
```
4. **Backup the original file** before any modifications (BR-042):
```bash
cp "$SOURCE_FILE" "${SOURCE_DIR}/${STEM}_original.md"
```
Tell the user: `"Backup saved to ${SOURCE_DIR}/${STEM}_original.md"`

5. Set `PRD_FILE = $SOURCE_FILE` (used by subsequent steps).

**Skip registry lookup entirely in standalone mode.**

---

## Step 1: Check Codex Availability

```bash
which codex >/dev/null 2>&1 && echo "codex available" || echo "codex not available"
```

**If codex is not available:**
> "Codex CLI is not installed. Falling back to Claude-only review mode (degraded). Install Codex for full adversarial review: `npm install -g @openai/codex`"

Then switch to **Degraded Mode** (see Error Handling section).

---

## Step 2: Read PRD Content

Read the content of `PRD_FILE` (determined in Step 0) into `PRD_CONTENT`.

For both modes, the file has already been located and validated in Step 0.

---

## Step 3: Run Codex Review (Two-Step Method)

The two-step method is required because `codex exec review --base` and custom prompts are mutually exclusive:
1. **Codex** outputs free-text review results
2. **Claude** parses the free-text into structured findings JSON

### Build the Review Prompt

Write the PRD content to a temporary file, then invoke Codex with a prompt covering these 5 dimensions:
1. **completeness** -- Are all requirements, acceptance criteria, and edge cases covered? Are there missing sections?
2. **consistency** -- Are there any contradictions between sections? Do numbers, names, and references align?
3. **implementability** -- Can a developer implement every DT without ambiguity? Are technical details sufficient?
4. **security** -- Are there security risks not addressed (injection, auth, data leaks, path traversal)?
5. **ux** -- Are user flows clear? Are error states and loading states described?

### Execute Codex

```bash
# Write content to temp file
TEMP_FILE=$(mktemp /tmp/prd-review-XXXXXX.md)
# (write PRD_CONTENT to TEMP_FILE)

REVIEW_OUTPUT=$(mktemp /tmp/codex-review-output-XXXXXX.txt)

codex exec --full-auto \
  "You are a red-team PRD reviewer. Your job is to find real problems, not rubber-stamp.

Read the PRD file at: $TEMP_FILE

Review it across these 5 dimensions:
1. completeness
2. consistency
3. implementability
4. security
5. ux

For each finding, output a block in this exact format:
---
SEVERITY: HIGH | MEDIUM | LOW
CATEGORY: [category]
SECTION: (which PRD section)
MESSAGE: (what is wrong)
SUGGESTION: (how to fix it)
---

If there are no issues, output exactly: NO_ISSUES_FOUND

Be thorough but precise. Only flag real problems with concrete evidence." \
  2>&1 | tee "$REVIEW_OUTPUT"

# Clean up temp PRD file
rm -f "$TEMP_FILE"
```

**Sandbox boundary (auto-chain only, BR-040):** When running in A1 auto-chain mode, Codex `exec --full-auto` operates within its built-in sandbox. File writes from this skill are restricted to `tasks/<id>/` and `/tmp/` only. Do NOT write to any path outside these directories in auto-chain mode.

---

## Step 4: Parse Codex Output

Claude reads the content of `$REVIEW_OUTPUT` and parses the free-text into structured findings.

### Parsing Rules

1. Split the output by `---` delimiters
2. For each block, extract:
   - `SEVERITY:` HIGH | MEDIUM | LOW
   - `CATEGORY:` completeness | consistency | implementability | security | ux | rule-violation
   - `SECTION:` (optional) which PRD section
   - `MESSAGE:` problem description
   - `SUGGESTION:` fix recommendation
   - `TASK_ID:` (optional) which DT
3. If Codex output contains `NO_ISSUES_FOUND`, set findings to empty array
4. If output is empty or unparseable, use **fail-closed** behavior: report parse failure, do not silently pass

### Fallback Parsing

If no `---` delimited blocks are found, try numbered paragraph extraction:
- Match patterns like `1. **HIGH** - description...`
- Extract severity from the marker, infer category from content

### Output Structure

```json
{
  "findings": [
    {
      "severity": "HIGH|MEDIUM|LOW",
      "category": "completeness|consistency|implementability|security|ux",
      "section": "3.1 API Design",
      "message": "Problem description",
      "suggestion": "How to fix it",
      "taskId": "DT-001"
    }
  ]
}
```

Display a summary to the user:
```
Review complete:
  Total findings: {total}
  HIGH: {high}  MEDIUM: {medium}  LOW: {low}
```

---

## Step 5: Adversarial Loop (Claude Fix -> Codex Re-review)

**Trigger condition:** Step 4 found HIGH > 0 or MEDIUM > 0.

**If only LOW findings or no findings:** Skip to Step 6.

### Convergence Target

The adversarial loop converges when: **HIGH = 0 AND MEDIUM = 0** (only LOW or no findings remain).

### Loop Logic (max 3 rounds)

For each round (round = 1, 2, 3):

#### 5a. Claude Processes Each HIGH/MEDIUM Finding

For each HIGH or MEDIUM finding, Claude chooses one of:

**Mode A -- Fix:**
- Read the relevant PRD section
- Apply the fix (modify the PRD content in memory)
- Record what was changed

**Mode B -- Argue Rejection:**
- Provide a written argument for why the finding is a false positive or non-issue
- Invoke Codex to evaluate the argument:

```bash
REJECTION_EVAL=$(mktemp /tmp/codex-rejection-XXXXXX.txt)
codex exec --full-auto \
  "A developer argues this finding should NOT be fixed. \
   Finding: {finding.message} (section: {finding.section}) \
   Developer's argument: {rejection_reason} \
   \
   As an independent reviewer, evaluate the argument. \
   State clearly whether you ACCEPT or REJECT the developer's argument, and explain your reasoning. \
   Accept only if the argument is technically sound and the finding is indeed a false positive or non-issue." \
   2>&1 | tee "$REJECTION_EVAL"
```

- Claude parses the Codex response for accept/reject semantics
- **Codex accepts** -> finding marked as `resolved (rejected)`
- **Codex rejects** -> finding remains `unresolved`

#### 5b. Write Fixed PRD

**A1 auto-chain mode:** Write fixed PRD to both:
- `${PRD_DIR}/prd-review-fixed.md` (diff record)
- Overwrite `${PRD_DIR}/prd.md` (auto-chain overwrites the original, per BR-017)

**Standalone mode:** Write fixed content to:
- Overwrite `$SOURCE_FILE` directly (original was backed up in Step 0 as `{stem}_original.md`, per BR-042)

#### 5c. Codex Re-review (Incremental)

Re-run Codex review on the fixed PRD content:

```bash
RECHECK_OUTPUT=$(mktemp /tmp/codex-recheck-XXXXXX.txt)
# (same codex exec prompt as Step 3, but with the fixed content)
codex exec --full-auto "[same review prompt with fixed content]" 2>&1 | tee "$RECHECK_OUTPUT"
```

Claude parses the re-review output (same as Step 4).

#### 5d. Convergence Check

```
Check re-review results:
  No new HIGH/MEDIUM findings -> Loop converged! Continue to Step 6.
  Still has HIGH/MEDIUM AND round < 3 -> Continue next round (back to 5a).
  Still has HIGH/MEDIUM AND round = 3 -> Circuit breaker.
```

**Circuit Breaker behavior depends on mode:**

**A1 auto-chain mode (BR-029):**
Default to `accept + advisory` for unresolved HIGH/MEDIUM findings after 3 rounds. This does NOT block the pipeline -- unresolved findings are recorded as advisory in the review report, and the auto-chain continues to the next step (A2 PRD2JSON).

```
Adversarial PRD review -- 3 rounds without full convergence.
Unresolved findings recorded as advisory (auto-chain continues).

Round history:
  Round 1: Found {n}, Fixed {m}, Rejected {r}
  Round 2: ...
  Round 3: ...
```

**Standalone mode:**
Present the unresolved findings to the user and ask for a decision:

```
Adversarial PRD review -- 3 rounds without convergence.
Unresolved findings:
  <list of remaining HIGH/MEDIUM findings>

Round history:
  Round 1: Found {n}, Fixed {m}, Rejected {r}
  Round 2: ...
  Round 3: ...

Options:
1. I will manually address the remaining issues
2. Record unresolved issues as advisory and continue
3. Stop review
```

Use AskUserQuestion to let the user decide.

---

## Step 6: Output Final Report

### Terminal Output

Display the complete review report:

```
=== PRD Adversarial Review Report ===

Mode: {auto-chain|standalone}
File: {PRD_FILE}
Rounds: {rounds}/3
Status: {converged|circuit_breaker|no_issues}

Findings Summary:
  HIGH:   {count} ({fixed} fixed, {rejected} rejected, {unresolved} unresolved)
  MEDIUM: {count} ({fixed} fixed, {rejected} rejected, {unresolved} unresolved)
  LOW:    {count} (advisory)

[Detailed findings list with resolution status]
```

### Save Review Report

**A1 auto-chain mode:**
Write the review results to `${PRD_DIR}/prd-review.json`:

```json
{
  "mode": "auto-chain",
  "timestamp": "ISO timestamp",
  "sourceFile": "tasks/{projectId}/prd.md",
  "rounds": 1,
  "maxRounds": 3,
  "status": "converged|circuit_breaker|no_issues",
  "findings": [
    {
      "severity": "HIGH|MEDIUM|LOW",
      "category": "...",
      "section": "...",
      "message": "...",
      "suggestion": "...",
      "taskId": "...",
      "resolution": "fixed|rejected|unresolved|advisory",
      "rejectionReason": "...(only for rejected)",
      "codexAccepted": true
    }
  ],
  "summary": {
    "total": 10,
    "high": 2,
    "medium": 3,
    "low": 5,
    "fixed": 4,
    "rejected": 1,
    "unresolved": 0
  }
}
```

Tell the user:
> "Review report saved to `${PRD_DIR}/prd-review.json`"

If a fixed PRD was generated:
> "Reviewed PRD saved to `${PRD_DIR}/prd.md` (auto-overwritten). Diff record at `${PRD_DIR}/prd-review-fixed.md`"

**Standalone mode:**
Write the review results to `${SOURCE_DIR}/${STEM}_review.json` (per BR-042):

```json
{
  "mode": "standalone",
  "timestamp": "ISO timestamp",
  "sourceFile": "/absolute/path/to/reviewed-file.md",
  "backupFile": "/absolute/path/to/{stem}_original.md",
  "rounds": 1,
  "maxRounds": 3,
  "status": "converged|circuit_breaker|no_issues",
  "findings": [ ... ],
  "summary": { ... }
}
```

Tell the user:
> "Review report saved to `${SOURCE_DIR}/${STEM}_review.json`"
> "Original file backed up at `${SOURCE_DIR}/${STEM}_original.md`"
> "Reviewed file overwritten at `${SOURCE_FILE}`"

### Clean Up

```bash
rm -f "$REVIEW_OUTPUT" "$RECHECK_OUTPUT" "$REJECTION_EVAL"
```

---

## Error Handling

### Codex Not Available -- Degraded Mode

When Codex CLI is not installed, fall back to Claude-only review:

1. **Claude performs the review directly** using the same 5 dimensions
2. Claude generates findings in the same structured format
3. **No adversarial loop** (since there is no independent second reviewer)
4. Output includes a warning: "Degraded mode: Claude-only review (no Codex adversarial validation). Install Codex for full adversarial review."

The degraded mode review still produces the review JSON (either `prd-review.json` for auto-chain or `{stem}_review.json` for standalone) with the same schema, but with `"mode": "degraded"` added to the top level.

### Codex Timeout

If Codex does not respond within 60 seconds:
- Record the timeout in the report
- Offer the user: retry / switch to degraded mode / abort

### Parse Failure (Fail-Closed)

If Codex output cannot be parsed into any findings and does not contain `NO_ISSUES_FOUND`:
- **Do NOT treat as "no issues"** (fail-closed principle, per BR-009)
- Report the parse failure to the user
- Save raw output to review JSON with `"parseError": true`
- Offer: retry / switch to degraded mode / abort

---

## Safety Rules

1. **Auto-chain sandbox boundary (BR-040):** In A1 auto-chain mode, file writes are restricted to `tasks/<id>/` and `/tmp/` only. Do NOT write to any path outside these directories.
2. **Standalone backup required (BR-042):** In standalone mode, ALWAYS create `{stem}_original.md` backup before any modifications to the source file.
3. **Auto-chain overwrites prd.md (BR-017):** In A1 mode, the reviewed PRD overwrites `tasks/<id>/prd.md` (the original is reconstructible from prd-review-fixed.md diff record).
4. **Standalone overwrites source file (BR-017):** In standalone mode, the reviewed file overwrites the original (which was backed up in Step 0).
5. **Temp files must be cleaned up** after review completes (success or failure)
6. **Path traversal protection** -- validate all file paths stay within expected boundaries (auto-chain: `tasks/<id>/`; standalone: the source file's directory)
7. **No user input in shell commands** -- Codex prompts use fixed templates, never interpolate user-provided paths into shell commands
