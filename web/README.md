# web/

The Next.js app: frontend, API routes, and the AI judge. There is no separate
backend service.

- **[../README.md](../README.md)** — what Rubric is, the architecture, how to run
  it, and the known limitations. Start there.
- **[DESIGN.md](./DESIGN.md)** — the authority for every screen. Read it before
  writing any UI.

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest (guard + hash tests; live judge tests are opt-in)
npm run sync:idl     # copy the built Anchor IDL out of ../target
npm run db:push      # push the Prisma schema
npm run db:seed      # demo records, so the UI renders without a deployed program
```

The live judge tests call the real judge API. The default provider is Gemini's
free tier, so they consume quota rather than money. They are gated:

```bash
RUN_JUDGE_TESTS=1 npx vitest run lib/verifier.test.ts
```

Run them any time you change the system prompt in `lib/verifier.ts` — the
prompt-injection fixtures are the regression net for that file.
