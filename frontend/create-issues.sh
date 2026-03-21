#!/bin/bash

# Make sure you are authenticated with 'gh auth login' before running this script

echo "Creating issue: Frontend Architecture & Global State Setup"
gh issue create \
  --title "feat(frontend): setup TanStack query and Zustand" \
  --body "
### Context
As defined in \`AGENTS.md\` and \`ARCHITECTURE_PLAN.md\`, we need to strictly isolate server state vs client state. 

### Implementation Checklist
- [x] Install \`@tanstack/react-query\` and \`zustand\` (pnpm only).
- [x] Wrap application root with \`QueryClientProvider\`.
- [x] Create \`src/stores/useConfigStore.ts\` for client-side state (UI visibility, filters).
- [ ] Add basic testing to ensure no server data is mixed into Zustand.
"

echo "Creating issue: Websocket & Real-time Hooks"
gh issue create \
  --title "feat(frontend): implement useWs and useCircularBuffer hooks" \
  --body "
### Context
Incoming news triggers and confidence scores update in real-time. Unbounded arrays in React state are prohibited by \`AGENTS.md\`. We also need a 200ms batched interval to flush websocket messages into TanStack Query to protect React from rendering thrash.

### Implementation Checklist
- [x] Implement \`src/hooks/useCircularBuffer.ts\` for strictly bounded data arrays.
- [x] Implement \`src/hooks/useWs.ts\` with a 200ms batched flush.
- [x] Ensure \`useWs.ts\` suspends flush when \`document.hidden\` is true (Page Visibility API).
- [ ] Add unit tests simulating blurred document to verify flush pause.
"

echo "Creating issue: Safety Components"
gh issue create \
  --title "feat(frontend): implement safety AutoTradingToggle" \
  --body "
### Context
System design strictly isolates automated real-money trading with defense-in-depth safety checks. A single misconfigured toggle cannot enable trading.

### Implementation Checklist
- [x] Implement \`AutoTradingToggle.tsx\` component.
- [x] Validate toggle requires typing the exact confirmation phrase: \"I understand the risks of real money trading\".
- [ ] Add \`@testing-library/react\` component tests verifying disabled state on typo.
"

echo "Creating issue: API Types & Client"
gh issue create \
  --title "feat(frontend): integrate generated OpenAPI types" \
  --body "
### Context
Server schemas dictate our REST communication boundary. All types and endpoints must be generated, no manual API client implementation.

### Implementation Checklist
- [ ] Add \`openapi.yaml\` base into repository root (dependency).
- [ ] Run \`pnpm dlx openapi-typescript openapi.yaml -o src/lib/api.types.ts\`.
- [ ] Create \`src/lib/api.client.ts\` utilizing \`openapi-fetch\`.
- [ ] Configure CI/package.json scripts to enforce strict sync.
"

echo "Done! Use these issues to create your branches and PRs."
