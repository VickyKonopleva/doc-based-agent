# dynamic/ — tools the agent writes for itself

Everything here was (or will be) authored at run time by the agent through
`tool_create`, then loaded without restarting the server.

- One tool per file, named `<tool_name>.tool.ts`.
- `export default defineTool({ ... })`.
- Import the helpers from `./_sdk.js` (see [`_sdk.ts`](_sdk.ts)).
- `_sdk.ts` and anything not matching `*.tool.ts` is ignored by the loader.

These files are committed. A tool the agent invents during a ticket is reviewed
in the merge request like any other code — that is the point of keeping them as
source rather than as in-memory closures. Promote the ones that prove useful
into `src/tools/` as built-ins.

`create_merge_request.tool.ts` ships as a worked example; the agent is free to
rewrite or delete it.
