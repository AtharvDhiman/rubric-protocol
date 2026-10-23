/**
 * GET /api/review/eligibility?address=<wallet> - may this wallet review?
 *
 * The task page uses it to decide whether to show the review panel at all. It is a
 * convenience, not a control: the review route re-checks the allowlist itself.
 *
 * It answers about ONE address at a time and never lists the allowlist. Whether a given
 * address is a reviewer is not a secret - a human ruling is published with the
 * reviewer's address in it - so this reveals nothing the public record does not.
 */

import { NextResponse } from "next/server";
import { isReviewer, parseReviewers } from "@/lib/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const reviewers = parseReviewers(process.env.REVIEWER_ADDRESSES);
  const address = new URL(request.url).searchParams.get("address") ?? "";

  return NextResponse.json(
    {
      enabled: reviewers.addresses.length > 0,
      eligible: address.length > 0 && isReviewer(address, reviewers),
    },
    { headers: { "cache-control": "no-store" } }
  );
}
