/**
 * A hand-written type for Anchor's methods builder.
 *
 * Anchor generates fully-typed method signatures from `target/types/rubric.ts`,
 * but that file is a build artefact: it does not exist until someone has run
 * `anchor build`, and this app is required to compile and render without the
 * Rust toolchain. Rather than sprinkling `any` at every call site, the shape we
 * actually use is declared once, here.
 *
 * Once the toolchain is set up you can replace this with:
 *   import type { Rubric } from "@/lib/idl/rubric";
 *   const program = new Program<Rubric>(idl, provider);
 * and delete this file.
 */

import type { PublicKey, TransactionInstruction } from "@solana/web3.js";

export interface MethodsBuilder {
  accounts(accounts: Record<string, PublicKey>): MethodsBuilder;
  preInstructions(instructions: TransactionInstruction[]): MethodsBuilder;
  signers(signers: unknown[]): MethodsBuilder;
  rpc(): Promise<string>;
}

/** Anchor's `program.methods` namespace, keyed by instruction name. */
export type UntypedMethods = Record<
  string,
  (...args: unknown[]) => MethodsBuilder
>;

/** Narrow `program.methods` without scattering casts through the UI. */
export function methodsOf(program: { methods: unknown }): UntypedMethods {
  return program.methods as UntypedMethods;
}
