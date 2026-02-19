---
name: botoolagent-prdreview
description: "Run adversarial PRD review using Codex CLI red-team analysis. Triggers on: prd review, review prd, prdreview, 审查 prd."
user-invocable: true
---

# BotoolAgent PRD Review

Uses Codex CLI to perform adversarial red-team review of PRD documents, finding completeness gaps, consistency issues, security risks, and implementability problems before development begins.

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

**Options:**
- Default: reviews the PRD (`prd.md` or `prd.json`)
- `--target enrich`: reviews the Enrich output instead of the raw PRD

**Examples:**
- `/botoolagent-prdreview` — review the PRD for the current project
- `/botoolagent-prdreview --target enrich` — review the Enrich output

---

## Step 0: Project Selection + Argument Parsing

### Project Selection

Check `tasks/registry.json` (or `BotoolAgent/tasks/registry.json`) for multi-project mode:
- If exists with multiple projects, use AskUserQuestion to let the user choose
- Set `PROJECT_ID` and `PRD_DIR="tasks/${PROJECT_ID}"`
- If no registry or single project, set `PRD_DIR="tasks/${PROJECT_ID}"` for the sole project, or fall back to root `.`

### Argument Parsing

Check if user passed `--target enrich`:
- If yes, set `REVIEW_TARGET="enrich"`
- Otherwise, set `REVIEW_TARGET="prd"` (default)

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

### For `REVIEW_TARGET="prd"`:

```bash
# Try prd.md first, then prd.json
if [ -f "${PRD_DIR}/prd.md" ]; then
  PRD_FILE="${PRD_DIR}/prd.md"
elif [ -f "${PRD_DIR}/prd.json" ]; then
  PRD_FILE="${PRD_DIR}/prd.json"
else
  echo "ERROR: No PRD file found in ${PRD_DIR}"
fi
```

### For `REVIEW_TARGET="enrich"`:

```bash
if [ -f "${PRD_DIR}/prd.json" ]; then
  PRD_FILE="${PRD_DIR}/prd.json"
else
  echo "ERROR: No prd.json found in ${PRD_DIR}"
fi
```

**If no PRD file found:**
```
Error: PRD file not found.

Recovery suggestions:
- Run /botoolagent-pyramidprd to generate a PRD
- Or run /botoolagent-prd2json to convert PRD to JSON
```
Then stop here.

Read the PRD content into `PRD_CONTENT`.

---

## Step 3: Run Codex Review (Two-Step Method)

The two-step method is required because `codex exec review --base` and custom prompts are mutually exclusive:
1. **Codex** outputs free-text review results
2. **Claude** parses the free-text into structured findings JSON

### Build the Review Prompt

**For PRD review (`REVIEW_TARGET="prd"`):**

Write the PRD content to a temporary file, then invoke Codex with a prompt covering these 5 dimensions:
1. **completeness** -- Are all requirements, acceptance criteria, and edge cases covered? Are there missing sections?
2. **consistency** -- Are there any contradictions between sections? Do numbers, names, and references align?
3. **implementability** -- Can a developer implement every DT without ambiguity? Are technical details sufficient?
4. **security** -- Are there security risks not addressed (injection, auth, data leaks, path traversal)?
5. **ux** -- Are user flows clear? Are error states and loading states described?

**For Enrich review (`REVIEW_TARGET="enrich"`):**

Write the Enrich JSON to a temporary file, then invoke Codex with a prompt covering these 5 dimensions:
1. **syntax** -- Are code examples syntactically valid TypeScript/JavaScript? Are imports correct?
2. **dependency** -- Are task dependencies acyclic? Is the dependency graph consistent (no missing refs)?
3. **filepath** -- Do filesToModify reference paths that plausibly exist in the project structure?
4. **eval** -- Are eval commands valid shell commands? Would blocking evals actually work (no typos)?
5. **session** -- Are sessions properly sized (max 8 DTs each)? Are dependent tasks in the same session?

### Execute Codex

```bash
# Write content to temp file
TEMP_FILE=$(mktemp /tmp/prd-review-XXXXXX.md)
# (write PRD_CONTENT to TEMP_FILE)

# Build prompt (see buildPrdReviewPrompt / buildEnrichReviewPrompt in
# viewer/src/app/api/prd/review/route.ts for the exact prompt format)

REVIEW_OUTPUT=$(mktemp /tmp/codex-review-output-XXXXXX.txt)

codex exec --full-auto \
  "You are a red-team PRD reviewer. Your job is to find real problems, not rubber-stamp.

Read the PRD file at: $TEMP_FILE

Review it across these 5 dimensions:
[dimensions list based on REVIEW_TARGET]

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

---

## Step 4: Parse Codex Output

Claude reads the content of `$REVIEW_OUTPUT` and parses the free-text into structured findings.

### Parsing Rules

1. Split the output by `---` delimiters
2. For each block, extract:
   - `SEVERITY:` HIGH | MEDIUM | LOW
   - `CATEGORY:` completeness | consistency | implementability | security | ux | rule-violation | syntax | dependency | filepath | eval | session
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
- Apply the fix (modify the PRD content in memory or write to a backup file)
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

#### 5b. Write Fixed PRD to Backup

Write the modified PRD to `${PRD_DIR}/prd-review-fixed.md` (or `.json`). **Never overwrite the original file.**

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

**Circuit Breaker (round 3 with unresolved findings):**
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

Target: {prd|enrich}
File: {PRD_FILE}
Rounds: {rounds}/3
Status: {converged|circuit_breaker|no_issues}

Findings Summary:
  HIGH:   {count} ({fixed} fixed, {rejected} rejected, {unresolved} unresolved)
  MEDIUM: {count} ({fixed} fixed, {rejected} rejected, {unresolved} unresolved)
  LOW:    {count} (advisory)

[Detailed findings list with resolution status]
```

### Save to File

Write the review results to `${PRD_DIR}/prd-review.json`:

```json
{
  "reviewTarget": "prd|enrich",
  "timestamp": "ISO timestamp",
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
      "resolution": "fixed|rejected|unresolved",
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
> "Fixed PRD saved to `${PRD_DIR}/prd-review-fixed.md` (original unchanged)"

### Clean Up

```bash
rm -f "$REVIEW_OUTPUT" "$RECHECK_OUTPUT" "$REJECTION_EVAL"
```

---

## Error Handling

### Codex Not Available -- Degraded Mode

When Codex CLI is not installed, fall back to Claude-only review:

1. **Claude performs the review directly** using the same 5 dimensions (PRD or Enrich)
2. Claude generates findings in the same structured format
3. **No adversarial loop** (since there is no independent second reviewer)
4. Output includes a warning: "Degraded mode: Claude-only review (no Codex adversarial validation). Install Codex for full adversarial review."

The degraded mode review still produces `prd-review.json` with the same schema, but with `"mode": "degraded"` added to the top level.

### Codex Timeout

If Codex does not respond within 60 seconds:
- Record the timeout in the report
- Offer the user: retry / switch to degraded mode / abort

### Parse Failure (Fail-Closed)

If Codex output cannot be parsed into any findings and does not contain `NO_ISSUES_FOUND`:
- **Do NOT treat as "no issues"** (fail-closed principle, per BR-009)
- Report the parse failure to the user
- Save raw output to `prd-review.json` with `"parseError": true`
- Offer: retry / switch to degraded mode / abort

---

## Safety Rules

1. **NEVER overwrite the original PRD file** -- all fixes go to `prd-review-fixed.md` (or `.json`)
2. **NEVER modify files outside the project's `tasks/` directory**
3. **Always create backup before modifying** any PRD-adjacent files
4. **Temp files must be cleaned up** after review completes (success or failure)
5. **Path traversal protection** -- validate all file paths stay within the project directory
6. **No user input in shell commands** -- Codex prompts use fixed templates, never interpolate user-provided paths into shell commands
