/**
 * GET /api/idl - serve the program's IDL to the browser.
 *
 * The client needs the IDL to build `create_task` and `submit_work`
 * transactions, but the IDL is a build artefact that does not exist in a fresh
 * checkout. Serving it at runtime instead of importing it at build time means
 * the app compiles and the record pages render before you have ever run the
 * Rust toolchain - only the chain-touching actions report that it is missing.
 *
 * The IDL is public information; it is derivable from the deployed program.
 * Nothing secret passes through here.
 */

import { NextResponse } from "next/server";
import { loadIdl } from "@/lib/server/program";
import { programIdString, usdcMintString } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({
      idl: loadIdl(),
      programId: programIdString() ?? null,
      usdcMint: usdcMintString() ?? null,
    });
  } catch (error) {
    console.error("[idl] not available:", error);
    return NextResponse.json(
      {
        error:
          "The program IDL is not available. Run `anchor build` at the repo root, then `npm run sync:idl` from web/.",
      },
      { status: 503 }
    );
  }
}
