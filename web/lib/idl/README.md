# lib/idl/

Build artefacts, copied here by `npm run sync:idl` after `anchor build`.

- `rubric.json` — the IDL. Served to the browser by `/api/idl` and read by
  `lib/server/program.ts`. Both fail with a clear message until it exists.
- `rubric.ts` — the generated TypeScript types. Once this is here you can replace
  `lib/anchor-methods.ts` with real typing:

  ```ts
  import type { Rubric } from "@/lib/idl/rubric";
  const program = new Program<Rubric>(idl, provider);
  ```

These files are deliberately **not** gitignored: Vercel only uploads `web/`, so
the deployed app needs its own copy of the IDL. Re-run `npm run sync:idl` and
commit the result whenever the program's interface changes.
