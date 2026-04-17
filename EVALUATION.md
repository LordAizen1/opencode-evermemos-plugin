# Evaluating Memory Impact

This document describes how to measure whether `opencode-evermemos-plugin` improves agent performance compared to:

- no memory plugin
- `supermemory`

The goal is to measure actual task performance, not just whether memory retrieval "looks good" in logs.

## What "Better" Should Mean

A better memory system should improve some or all of these:

- higher task success rate
- fewer turns to complete tasks
- better recall of prior facts, preferences, and actions
- better continuity after long gaps or compaction
- low latency overhead
- low prompt bloat
- no privacy regressions

For this plugin, the most important dimensions are:

- recall quality
- continuity across turns and compaction
- usefulness of stored tool/action memory
- latency cost
- prompt-size cost
- privacy safety

## Recommended Comparison Setup

Run the same benchmark in three modes:

1. no memory plugin
2. `supermemory`
3. `opencode-evermemos-plugin`

Keep these fixed across runs:

- same model
- same repo/worktree
- same prompts
- same starting files
- same environment
- same permissions
- same temperature, ideally `0`

## Task Categories To Benchmark

Use tasks that actually depend on memory.

### 1. Preference Recall

Seed a user preference such as:

`Prefer small focused patches and no unrelated refactors.`

Later ask the agent to make a change and score whether it follows that preference.

### 2. Repo Fact Recall

Seed project facts such as:

- framework
- database
- architecture conventions
- naming rules

Later ask questions that require those facts after several turns.

### 3. Action Recall

Have the agent make a file edit, then later ask:

`What did we change in auth?`

This tests whether action-derived memory is actually useful.

### 4. Exact Symbol Recall

Seed code-specific identifiers such as:

- `validateToken`
- `AuthMiddleware`
- `SessionCache`

Later ask about them after enough context has passed that the base model should no longer have them in short-term context.

### 5. Compaction Survival

Create a long enough session to trigger compaction, then ask about facts or actions mentioned much earlier.

This is a key test for persistent memory value.

### 6. Privacy Negative Tests

Include content such as:

`this is secret <private>abc123</private>`

Then verify that:

- the private payload is not stored
- it is not injected later
- it does not show up in memory tools

## Core Metrics

Track these for every run:

- `task_success_rate`
- `turns_to_success`
- `time_to_first_useful_answer`
- `extra_latency_per_turn`
- `memory_precision`
- `memory_contamination`
- `memory_usefulness`
- `prompt_overhead`
- `privacy_failure_rate`

### Definitions

`task_success_rate`
- Whether the agent actually solved the task.

`turns_to_success`
- Number of user/assistant turns needed before the task is completed correctly.

`time_to_first_useful_answer`
- Time until the first answer that materially advances the task.

`extra_latency_per_turn`
- Added time caused by memory retrieval or storage behavior.

`memory_precision`
- Recalled memories were relevant to the current task.

`memory_contamination`
- Wrong project, wrong user, or irrelevant/stale memory was injected.

`memory_usefulness`
- Recalled memory changed the outcome for the better rather than being decorative.

`prompt_overhead`
- Added injected characters or estimated tokens per turn.

`privacy_failure_rate`
- How often sensitive or `<private>` content appears in stored or injected memory.

## Simple Scoring Rubric

For memory-related quality metrics, use a lightweight rubric:

- `2` = clearly helped
- `1` = neutral
- `0` = hurt, wrong, or noisy

This works well for:

- memory precision
- memory usefulness
- continuity after compaction
- action-memory usefulness

## Fair Eval Pattern

Do not rely on casual transcripts alone. Use a repeatable structure:

1. seed memory in an earlier turn or session
2. remove short-term context pressure by adding unrelated turns or forcing compaction
3. ask a task that depends on the seeded memory
4. compare the result across all three modes

This isolates memory quality from raw model capability.

## What Should Distinguish EverMemOS

If `opencode-evermemos-plugin` is genuinely better than `supermemory`, it should mostly win on:

- exact code symbol recall
- repo-scoped memory separation
- action/history recall from tool summaries
- separation of profile memory from episodic memory

If it loses, the common reasons will likely be:

- noisy tool memories
- prompt bloat
- stale or irrelevant recall
- latency overhead
- cross-user or cross-project contamination

## Logging And Instrumentation To Add

For each turn, log at least:

- recall request latency
- write request latency
- number of recalled memories
- memory types injected
- injected character count
- whether recall occurred
- whether the task eventually succeeded

This makes it possible to correlate memory behavior with outcome rather than guessing from transcripts.

## Suggested Benchmark Size

Start with:

- 15 to 20 benchmark tasks
- 10 runs per mode

That is usually enough to detect clear signal without turning evaluation into a huge research project.

## Example Benchmark Matrix

Use a matrix like this:

| Category | No Plugin | Supermemory | EverMemOS Plugin |
|---|---:|---:|---:|
| Preference recall success |  |  |  |
| Repo fact recall success |  |  |  |
| Action recall success |  |  |  |
| Symbol recall success |  |  |  |
| Compaction survival |  |  |  |
| Avg added latency |  |  |  |
| Avg injected chars |  |  |  |
| Privacy failures |  |  |  |

## Practical Recommendation

Treat this as a benchmark suite, not a one-off demo.

The most convincing result will come from:

- repeated runs
- fixed prompts
- fixed repo state
- measured outputs
- side-by-side comparison

## Next Step

A good next step is to build a lightweight evaluation harness that:

- defines benchmark tasks
- runs them across the three modes
- captures transcripts and timing
- stores raw results
- outputs a markdown or CSV comparison report

That will let this plugin compete on evidence instead of intuition.
