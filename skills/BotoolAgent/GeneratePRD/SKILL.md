---
name: botoolagent-generateprd
description: "Generate a Product Requirements Document through collaborative dialogue. Use when planning a feature, starting a new project, or when asked to create a PRD. Triggers on: create a prd, write prd for, plan this feature, requirements for, spec out."
user-invocable: true
---

# BotoolAgent PRD Generator

Turn ideas into well-formed PRDs through natural collaborative dialogue - one question at a time.

---

## Overview

This skill combines deep exploration with structured output. Instead of asking all questions upfront, we have a conversation to truly understand what you're building, then produce a PRD ready for BotoolAgent execution.

**Preferred method:** Use the BotoolAgent Viewer web interface for the best PRD creation experience with real-time preview, chat UI, and automatic saving.

**Announce at start:** "Using BotoolAgent:GeneratePRD to create your PRD."

---

## Mode Selection

**Web Interface Mode (Recommended):**
- Launch the BotoolAgent Viewer and navigate to Stage 1
- Interactive chat interface with real-time PRD preview
- Automatic PRD saving and seamless transition to conversion

**CLI Mode (Fallback):**
- Use when Viewer is unavailable or user explicitly requests CLI
- Traditional dialogue-based PRD creation in terminal

---

## Web Interface Mode

### Step 1: Check and Start Viewer

```bash
# Check if port 3000 is in use
lsof -i :3000 | grep LISTEN
```

If the server is not running:

```bash
# Navigate to viewer directory and start dev server in background
cd viewer && npm run dev &
```

Wait a few seconds for the server to start.

### Step 2: Open Stage 1 in Browser

```bash
# macOS
open http://localhost:3000/stage1

# Linux
xdg-open http://localhost:3000/stage1
```

### Step 3: Announce to User

Output to the user:

```
BotoolAgent Viewer is now running!

Opening Stage 1 - PRD Creation...

Access URL: http://localhost:3000/stage1

The web interface provides:
- AI chat for collaborative PRD creation
- Real-time PRD preview panel
- Automatic PRD saving to tasks/
- Seamless transition to Stage 2 for JSON conversion

If the browser doesn't open, navigate manually to the URL above.
```

**Then stop here.** The user will complete PRD creation in the browser.

---

## CLI Mode (Fallback)

Use this mode when:
- User explicitly requests CLI mode
- Viewer is unavailable or not installed
- Running in a headless environment

### The Process

### Phase 1: Understand the Idea

**Start by checking context:**
- Look at current project state (files, docs, recent commits)
- Understand the existing codebase structure

**Then ask questions ONE AT A TIME using AskUserQuestion:**
- Focus on: purpose, constraints, success criteria
- Prefer multiple choice when possible
- Open-ended is fine for complex topics
- If a topic needs more exploration, break into multiple questions

**Key questions to cover:**
1. What problem does this solve? (the "why")
2. Who is the target user?
3. What are the core actions/features?
4. What should it NOT do? (scope boundaries)
5. How do we know it's done? (success criteria)
6. Any technical constraints?

### Phase 2: Explore Approaches

Before settling on a design:
- Propose 2-3 different approaches with trade-offs
- Present your recommendation first with reasoning
- Let the user choose or suggest alternatives
- Use AskUserQuestion for the choice

### Phase 3: Present the Design

Once you understand what you're building:
- Present the design in sections (200-300 words each)
- After each section, ask: "Does this look right so far?"
- Cover: architecture, components, data flow, error handling
- Be ready to go back and clarify

**Sections to cover:**
1. Overview & Goals
2. Dev Tasks (one by one, get approval)
3. Functional Requirements
4. Non-Goals / Out of Scope
5. Technical Considerations

### Phase 4: Generate PRD

After all sections are validated:
- Compile into final PRD format
- Save to `tasks/prd-[feature-name].md`
- Announce: "PRD saved. Use BotoolAgent:PRD2JSON to convert for autonomous execution."

---

## Dev Task Guidelines

Each task must be **small enough to complete in one iteration**:

**Right-sized:**
- Add a database column and migration
- Add a UI component to an existing page
- Update a server action with new logic
- Add a filter dropdown to a list

**Too big (split these):**
- "Build the entire dashboard"
- "Add authentication"
- "Refactor the API"

**Rule of thumb:** If you can't describe the change in 2-3 sentences, it's too big.

**Acceptance criteria must be verifiable:**
- Good: "Button shows confirmation dialog before deleting"
- Bad: "Works correctly"

**Always include:**
- "Typecheck passes" for every task
- "Verify in browser" for UI tasks

---

## PRD Output Format

```markdown
# PRD: [Feature Name]

## Introduction

[Brief description of the feature and the problem it solves]

## Goals

- [Specific, measurable objective 1]
- [Specific, measurable objective 2]

## Dev Tasks

### DT-001: [Title]
**Description:** As a [user], I want [feature] so that [benefit].

**Acceptance Criteria:**
- [ ] Specific verifiable criterion
- [ ] Another criterion
- [ ] Typecheck passes
- [ ] [UI only] Verify in browser

### DT-002: [Title]
...

## Functional Requirements

- FR-1: The system must...
- FR-2: When a user clicks X, the system must...

## Non-Goals (Out of Scope)

- [What this feature will NOT include]

## Technical Considerations

- [Known constraints or dependencies]
- [Integration points]

## Success Metrics

- [How success will be measured]

## Open Questions

- [Remaining questions or areas needing clarification]
```

---

## Key Principles

- **One question at a time** - Don't overwhelm
- **Use AskUserQuestion** - Better UX than text prompts
- **Multiple choice preferred** - Easier to answer
- **YAGNI ruthlessly** - Remove unnecessary features
- **Explore alternatives** - Always propose 2-3 approaches
- **Incremental validation** - Present design in sections
- **Be flexible** - Go back and clarify when needed

---

## After the PRD (CLI Mode Only)

Offer next steps:

"PRD complete and saved to `tasks/prd-[name].md`. Next steps:

1. **Open Viewer** - Use `/botoolagent` to open the web interface and continue from Stage 2
2. **Convert to JSON** - Use `/botoolagent-prd2json` to create prd.json
3. **Run autonomously** - Execute `./BotoolAgent.sh` to implement

Which would you like to do?"

---

## Checklist

### Web Interface Mode
- [ ] Started Viewer dev server if not running
- [ ] Opened Stage 1 (http://localhost:3000/stage1) in browser
- [ ] Announced access URL to user

### CLI Mode
Before saving the PRD:
- [ ] Asked questions one at a time with AskUserQuestion
- [ ] Explored 2-3 approaches before settling
- [ ] Presented design in sections and validated each
- [ ] Dev tasks are small and specific
- [ ] Acceptance criteria are verifiable
- [ ] Non-goals section defines clear boundaries
- [ ] Saved to `tasks/prd-[feature-name].md`
