# Numerical jobs

The four structural and Quick `analyze_*lightweighting` / `request_*lightweighting` tools start
browser-owned jobs on both local and paired remote MCP. They return immediately with `jobId`,
`tool`, `documentId`, `baseRevision` and `status: "running"`; this receipt is not an analysis or a
saved result. Computation has no execution deadline and does not occupy the transport operation
slot. `model_info` and the job controls remain available during computation.

The built-in browser API gateway has no MCP request boundary and instead waits directly for the
original final numerical result. It does not advertise job controls. Its CAD execution and whole
assistant turn have no execution deadline; individual language-provider requests retain their
separate timeout. Stop or disposal still cancels its ordinary numerical coordinator.

## Embedded native chat

The built-in native assistant receives lifecycle events from its paired browser session. The chat
shows active numerical work even after the model turn ends. After a start receipt, end the current
turn and wait: do not poll `get_numerical_job` or restart the calculation. Completion automatically
starts one continuation in the initiating chat with the original final result, including physical
or runtime failures. This is an internal completion event, not a new user request or additional
permission to change the model. Respect the latest user instructions and the captured revision.

The host defers delivery while a model turn, user question or checkpoint boundary is pending.
Stop suppresses pending completion continuations; disconnect, session replacement and disposal
discard them. A stale or foreign chat cannot receive another session's result. Large results use
a text attachment when supported and the complete result fits the attachment contract; otherwise
the notification requests one final retrieval of the already completed result, never repeated
status checks.

## External clients

External MCP clients do not automatically receive a model turn from the embedded chat host.
Their status controls remain available for explicit retrieval and compatibility:

1. Call the appropriate analysis or snapshot request once with the complete captured inputs.
2. Retain the receipt and call `get_numerical_job` with its `jobId`. Each status call returns
   promptly. Allow time between checks; do not start duplicate calculations or loop continuously.
3. `running` and `cancelling` have `result: null`. Only `completed` contains the original tool
   result. Inspect its nested `ok`: a completed job can contain a physical, runtime or cancellation
   diagnostic. Outer `ok: true` means the status was read successfully.
4. Apply the analysis-specific acceptance checks to `result.value` only after nested `ok: true`.
   A snapshot exists only when the completed request identifies its actual committed `snapshot`.

An `infeasible-baseline` diagnostic identifies controlling load cases, measured stress/safety and
displacement, and the requested limits. It is a physical failure, not a timeout. Finer sampling
does not by itself establish feasibility; do not relax the user's constraints to obtain success.

Use `cancel_numerical_job` with the same `jobId` for explicit cancellation. Cancellation can report
`cancelling` until the worker/review settles. An atomic persistence transaction already accepted
must report its actual outcome; never interpret a cancel receipt as proof that nothing was saved.
Stop AI, the built-in chat's Stop, disconnect, project replacement and session disposal also interrupt active jobs. A source
revision change cancels pending computation, and existing body/hash/revision checks still reject
stale results. A successful snapshot's own committed revision does not invalidate its receipt.

One numerical job runs at a time per paired browser session. An identical start while it is running
returns the existing receipt; a different start reports `busy` and identifies the active job.
Completed results remain in session memory until the owner is disposed. They do not survive reload,
Stop AI or reconnect and cannot be read by a different actor/session. Native chat Stop cancels
active work without discarding results from its retained session. A missing job is not an empty
model or proof that a write failed: inspect the saved revision before retrying an uncertain write.

Older builds can return the original final result directly. Inspect live schemas and branch on the
presence of a receipt rather than assuming every `ok: true` already contains metrics. Ordinary
short MCP calls can still have client-side request deadlines; those deadlines do not bound an
already started numerical job. Do not increase them as a substitute for this workflow.
