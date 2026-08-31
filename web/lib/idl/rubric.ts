/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/rubric.json`.
 */
export type Rubric = {
  "address": "F2Uo5JUfGQtho8s9ZbwcpWBd8iJ4XvBqamUaqdjcrRxz",
  "metadata": {
    "name": "rubric",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Rubric - AI-judged escrow on Solana. Pay on proof, not on trust."
  },
  "instructions": [
    {
      "name": "createTask",
      "docs": [
        "Seal a rubric and fund its escrow. The poster signs."
      ],
      "discriminator": [
        194,
        80,
        6,
        180,
        232,
        127,
        48,
        171
      ],
      "accounts": [
        {
          "name": "creator",
          "docs": [
            "The poster. Signs, pays rent for the Task and escrow accounts, and is the",
            "source of the bounty."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "The singleton Config. Read-only here; we only need it to exist so that a",
            "task cannot be created against an uninitialized protocol.",
            "",
            "Re-derived from its seeds so a caller cannot pass a look-alike account."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "task",
          "docs": [
            "The Task PDA at seeds `[b\"task\", creator, task_id]`.",
            "",
            "`init` means this fails if the task already exists, so a task id can never",
            "be reused to overwrite a live escrow. Including `creator` in the seeds",
            "means two posters can both use `task_id = 1` without colliding, and no",
            "poster can squat on another's id. The address is derived by the program,",
            "so the caller cannot point this at an account they control."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "taskId"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "The SPL token the bounty is denominated in - USDC in production.",
            "",
            "`address = config.bounty_mint` pins it to the single mint this deployment",
            "was configured for. It is passed in rather than hardcoded so the same",
            "program works with devnet and mainnet USDC without a code change, but it",
            "is NOT free choice: without this constraint a poster could escrow a token",
            "they minted themselves, and `MAX_BOUNTY` - which is denominated in base",
            "units and assumes 6 decimals - would stop meaning what it says."
          ]
        },
        {
          "name": "creatorTokenAccount",
          "docs": [
            "The poster's own token account, which the bounty comes out of.",
            "",
            "The `associated_token::*` constraints require this to be exactly the",
            "canonical ATA for (creator, mint). That means we are provably debiting the",
            "signer's own account and not some third party's account they happened to",
            "pass in."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "escrow",
          "docs": [
            "THE ESCROW. An associated token account owned by the Task PDA.",
            "",
            "This is the most important constraint in the instruction. The address is",
            "DERIVED from (task, mint) - it is never accepted as an arbitrary account",
            "from the client. Without this, an attacker could pass their own token",
            "account as \"the escrow\", have the bounty deposited straight into their",
            "wallet, and leave the task looking funded.",
            "",
            "Its authority is the Task PDA, which has no private key. Only this program",
            "can move these tokens, and only through `submit_verdict` or",
            "`reclaim_expired`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "task"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Anchor verifies these are the real SPL Token, Associated Token and System",
            "programs. Passing a counterfeit \"token program\" that fakes a transfer is a",
            "classic Solana attack; these three type checks close it."
          ],
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "taskId",
          "type": "u64"
        },
        {
          "name": "rubricHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "bountyAmount",
          "type": "u64"
        },
        {
          "name": "deadline",
          "type": "i64"
        }
      ]
    },
    {
      "name": "initializeConfig",
      "docs": [
        "Create the singleton `Config`. Run once per deployment.",
        "",
        "The signer must be the program's upgrade authority - see the instruction",
        "for why anything weaker loses the protocol to whoever calls this first."
      ],
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "The admin. Signs, and pays the rent for the Config account.",
            "",
            "`mut` because lamports leave this account to fund the new one. `Signer`",
            "means the transaction is invalid unless this key actually signed it. On",
            "its own that is not enough - see `program_data` below, which is what ties",
            "this signer to the person who deployed the program."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "The Config PDA at seeds `[b\"config\"]`.",
            "",
            "`init` prevents this from running twice: creating an account that already",
            "exists fails at the system-program level, so the config cannot be",
            "re-initialized to install a different verifier authority. `seeds` + `bump`",
            "mean the address is derived by the program, not chosen by the caller, so",
            "there is exactly one config account and its address is fixed forever.",
            "`space` is 8 bytes of Anchor discriminator plus the derived struct size."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "docs": [
            "This program, used only to find its ProgramData account.",
            "",
            "`Program<'info, Rubric>` makes Anchor check that the account really is",
            "this program, so a caller cannot point it at some other program whose",
            "upgrade authority they happen to hold."
          ],
          "address": "F2Uo5JUfGQtho8s9ZbwcpWBd8iJ4XvBqamUaqdjcrRxz"
        },
        {
          "name": "programData",
          "docs": [
            "The program's ProgramData account, which records who may upgrade it.",
            "",
            "THE CHECK THAT CLOSES THE INIT RACE: the signer must be the program's",
            "upgrade authority. Only the deployer holds that key, so nobody can",
            "front-run the operator's initialization transaction.",
            "",
            "Consequence worth knowing: if the program is ever made immutable (upgrade",
            "authority set to None) BEFORE the config is initialized, this instruction",
            "becomes uncallable and the deployment is dead. Initialize first, then make",
            "it immutable."
          ]
        },
        {
          "name": "systemProgram",
          "docs": [
            "Required by `init` to actually allocate the account. Anchor checks that",
            "the address really is the system program, so a fake one cannot be passed."
          ],
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "verifierAuthority",
          "type": "pubkey"
        },
        {
          "name": "bountyMint",
          "type": "pubkey"
        },
        {
          "name": "feeBps",
          "type": "u16"
        },
        {
          "name": "feeDestination",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "reclaimExpired",
      "docs": [
        "Take back a bounty nobody resolved. The poster signs.",
        "",
        "`Open` past the deadline, or `Submitted` past the deadline plus the",
        "verdict grace period. Never a terminal task."
      ],
      "discriminator": [
        125,
        185,
        48,
        75,
        0,
        71,
        93,
        98
      ],
      "accounts": [
        {
          "name": "creator",
          "docs": [
            "The poster. Must be the creator recorded on the task - enforced by",
            "`has_one = creator` below, so a stranger cannot reclaim someone else's",
            "expired bounty into their own wallet."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "task"
          ]
        },
        {
          "name": "task",
          "docs": [
            "The expired task.",
            "",
            "Re-derived from its seeds with the stored bump so it is provably one of",
            "ours. `has_one = creator` ties it to the signer above."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "task.creator",
                "account": "task"
              },
              {
                "kind": "account",
                "path": "task.taskId",
                "account": "task"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "Pinned to the mint recorded at creation, so the refund is denominated in",
            "the token that was actually escrowed."
          ]
        },
        {
          "name": "escrow",
          "docs": [
            "THE ESCROW. Derived from (task, mint), never accepted from the caller, so",
            "this instruction provably drains the task's own escrow and nothing else."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "task"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "creatorTokenAccount",
          "docs": [
            "Where the refund lands. Derived as the canonical ATA for (creator, mint),",
            "so the poster cannot redirect it and nobody can redirect it for them."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Anchor verifies this is the genuine SPL Token program."
          ],
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "setVerifierAuthority",
      "docs": [
        "Rotate the verifier authority. Admin only.",
        "",
        "Exists because the verifier key is a single point of failure in the MVP:",
        "if it leaks, the admin must be able to cut it off without redeploying."
      ],
      "discriminator": [
        249,
        38,
        8,
        243,
        167,
        92,
        97,
        245
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "Must be the admin recorded in Config.",
            "",
            "`Signer` proves the key authorized this transaction. The `has_one`",
            "constraint on `config` below is what proves it is the *right* key."
          ],
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "docs": [
            "The singleton Config.",
            "",
            "`seeds` + `bump = config.bump` re-derive the one legitimate config address",
            "and reject any substitute account. `has_one = admin` requires",
            "`config.admin == admin.key()`, so a stranger who signs cannot rotate the",
            "verifier - this is the check that makes the instruction safe."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newVerifierAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "submitVerdict",
      "docs": [
        "Rule on a submission and settle the escrow. ONLY the verifier authority",
        "may sign this. It is the single most security-critical instruction here."
      ],
      "discriminator": [
        138,
        102,
        56,
        22,
        229,
        130,
        105,
        118
      ],
      "accounts": [
        {
          "name": "verifier",
          "docs": [
            "The verifier. Must be exactly `config.verifier_authority`.",
            "",
            "`Signer` proves this key authorized the transaction; the `constraint` on",
            "`config` below proves it is the right key. Both are required: a signature",
            "from the wrong key, or the right key without a signature, both fail."
          ],
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "The singleton Config, re-derived from its seeds so a look-alike config",
            "(with the attacker's key as verifier_authority) cannot be substituted.",
            "",
            "THE CHECK THAT MATTERS: `config.verifier_authority == verifier.key()`.",
            "Nothing else in this program can release escrow, and this line is what",
            "stops anyone else from doing it. If this constraint is ever removed or",
            "weakened, any wallet on Solana can drain every open task."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "task",
          "docs": [
            "The task being ruled on.",
            "",
            "Re-derived from its seeds with the stored bump, so it is provably a Task",
            "this program created. `has_one = creator` requires the `creator` account",
            "passed below to be the poster recorded at creation - that is what stops a",
            "refund from being routed to an attacker's wallet."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "task.creator",
                "account": "task"
              },
              {
                "kind": "account",
                "path": "task.taskId",
                "account": "task"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "The mint recorded on the task.",
            "",
            "Pinned with `address = task.mint`. Without this, a caller could pass a",
            "worthless mint they control, and every token account below would be",
            "derived for that mint instead - paying the worker in fake tokens while the",
            "real USDC stayed in escrow."
          ]
        },
        {
          "name": "escrow",
          "docs": [
            "THE ESCROW. Derived from (task, mint), never accepted from the caller.",
            "",
            "This is the account being drained, so its derivation is what guarantees we",
            "are draining the right one. Its authority is the Task PDA, so only this",
            "program can sign for it."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "task"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "worker",
          "docs": [
            "worker's token account is derived from. It is pinned to the worker",
            "recorded on the task at `submit_work` time by the `constraint` below, so",
            "the payout cannot be redirected to anyone else."
          ]
        },
        {
          "name": "workerTokenAccount",
          "docs": [
            "Where an approved payout goes.",
            "",
            "Derived as the canonical ATA for (worker, mint). `submit_work` already",
            "required this account to exist, so an approval cannot fail here and strand",
            "the task in `Submitted`.",
            "",
            "`dup` is required because Anchor 1.0 rejects two mutable `Account` fields",
            "that resolve to the same address. That collision is legitimate here: a",
            "poster is allowed to do their own task, in which case this account and",
            "`creator_token_account` are the same one. Without `dup` those tasks would",
            "be permanently unsettleable. It is safe because nothing below re-reads a",
            "cached balance after a transfer - every amount is computed up front."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "worker"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "creator",
          "docs": [
            "to `task.creator` by the `has_one = creator` constraint on the task",
            "account above.",
            "",
            "`mut` is REQUIRED, and not for the reason it usually is: this account",
            "receives the escrow token account's rent lamports when the escrow is",
            "closed at the end of this instruction. An account whose lamports change",
            "must be writable, and without `mut` Anchor marks it read-only in the",
            "account metas, so the close would fail and every settlement would revert."
          ],
          "writable": true,
          "relations": [
            "task"
          ]
        },
        {
          "name": "creatorTokenAccount",
          "docs": [
            "Where a rejected bounty is refunded, and where the escrow account's rent",
            "goes when it is closed (the creator paid that rent at creation).",
            "",
            "`dup` for the same reason as the worker account above: creator, worker and",
            "fee destination are three roles that a single wallet may legitimately hold."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "feeDestination",
          "docs": [
            "derived from. Pinned to `config.fee_destination` so fees cannot be",
            "diverted, not even by the verifier."
          ]
        },
        {
          "name": "feeDestinationTokenAccount",
          "docs": [
            "Where the protocol fee goes on an approval. Derived from",
            "(config.fee_destination, mint). Must already exist - the admin creates it",
            "once when setting up the protocol.",
            "",
            "`dup` because the fee destination may be the same wallet as the poster or",
            "the worker, especially in local tests."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "feeDestination"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Anchor verifies this is the genuine SPL Token program, so a counterfeit",
            "program cannot be passed to fake the transfers."
          ],
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "approved",
          "type": "bool"
        },
        {
          "name": "confidence",
          "type": "u8"
        },
        {
          "name": "reasoningHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "submitWork",
      "docs": [
        "Claim a task by submitting work. The worker signs."
      ],
      "discriminator": [
        158,
        80,
        101,
        51,
        114,
        130,
        101,
        253
      ],
      "accounts": [
        {
          "name": "worker",
          "docs": [
            "The worker. Whoever signs this becomes the payee if the verdict approves,",
            "so the signature is what binds the payout address."
          ],
          "signer": true
        },
        {
          "name": "task",
          "docs": [
            "The task being claimed.",
            "",
            "Re-derived from `[b\"task\", task.creator, task.task_id]` with the stored",
            "bump. This proves the account really is a Task this program created, and",
            "not a look-alike account an attacker crafted with a state field set to",
            "`Open` and a bounty they do not own."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "task.creator",
                "account": "task"
              },
              {
                "kind": "account",
                "path": "task.taskId",
                "account": "task"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "The mint the task was funded in.",
            "",
            "`address = task.mint` pins it to the mint recorded at creation, so the",
            "worker token account checked below is checked against the right token."
          ]
        },
        {
          "name": "workerTokenAccount",
          "docs": [
            "The worker's USDC account, checked to exist here for a liveness reason.",
            "",
            "`submit_verdict` has to pay this exact account. If the worker had no token",
            "account at verdict time, the payout transfer would fail and the task would",
            "be stuck in `Submitted` forever with the money trapped - there is no",
            "reclaim path out of `Submitted`. Requiring the account up front makes that",
            "failure impossible to reach by accident.",
            "",
            "The `associated_token::*` constraints derive the canonical ATA for",
            "(worker, mint), so the worker cannot nominate somebody else's account."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "worker"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        }
      ],
      "args": [
        {
          "name": "submissionHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "task",
      "discriminator": [
        79,
        34,
        229,
        55,
        88,
        90,
        55,
        84
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "feeTooHigh",
      "msg": "Fee is above the 10% ceiling (1000 basis points)."
    },
    {
      "code": 6001,
      "name": "amountZero",
      "msg": "Bounty amount must be greater than zero."
    },
    {
      "code": 6002,
      "name": "amountTooLarge",
      "msg": "Bounty amount is above the MVP maximum."
    },
    {
      "code": 6003,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow while computing amounts."
    },
    {
      "code": 6004,
      "name": "escrowUnderfunded",
      "msg": "Escrow balance is lower than the recorded bounty."
    },
    {
      "code": 6005,
      "name": "deadlineInPast",
      "msg": "Deadline must be in the future."
    },
    {
      "code": 6006,
      "name": "deadlineTooFar",
      "msg": "Deadline is further out than the maximum allowed work window."
    },
    {
      "code": 6007,
      "name": "deadlinePassed",
      "msg": "The deadline for this task has already passed."
    },
    {
      "code": 6008,
      "name": "deadlineNotPassed",
      "msg": "The deadline has not passed yet."
    },
    {
      "code": 6009,
      "name": "invalidState",
      "msg": "Task is not in the required state for this instruction."
    },
    {
      "code": 6010,
      "name": "notVerifierAuthority",
      "msg": "Signer is not the configured verifier authority."
    },
    {
      "code": 6011,
      "name": "notAdmin",
      "msg": "Signer is not the config admin."
    },
    {
      "code": 6012,
      "name": "workerMismatch",
      "msg": "Destination token account does not belong to the recorded worker."
    },
    {
      "code": 6013,
      "name": "creatorMismatch",
      "msg": "Account is not the creator recorded on the task."
    },
    {
      "code": 6014,
      "name": "missingWorker",
      "msg": "Task has no recorded worker."
    },
    {
      "code": 6015,
      "name": "confidenceOutOfRange",
      "msg": "Confidence must be between 0 and 100."
    },
    {
      "code": 6016,
      "name": "emptyHash",
      "msg": "Hash must not be all zeroes."
    },
    {
      "code": 6017,
      "name": "mintMismatch",
      "msg": "Mint does not match the mint recorded on the task."
    },
    {
      "code": 6018,
      "name": "feeDestinationMismatch",
      "msg": "Fee destination does not match the configured fee destination."
    }
  ],
  "types": [
    {
      "name": "config",
      "docs": [
        "Singleton protocol configuration.",
        "",
        "PDA seeds: `[b\"config\"]` - there is exactly one, and its address is fixed for",
        "the life of the program."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "May rotate `verifier_authority`. Nothing else."
            ],
            "type": "pubkey"
          },
          {
            "name": "verifierAuthority",
            "docs": [
              "The ONLY key permitted to call `submit_verdict`. This is the MVP's",
              "centralization point and it is documented as such in the README."
            ],
            "type": "pubkey"
          },
          {
            "name": "bountyMint",
            "docs": [
              "The ONE SPL mint this deployment escrows in (USDC).",
              "",
              "Without this, `create_task` accepted any mint the poster passed, which",
              "made `MAX_BOUNTY` meaningless: \"50_000_000 base units\" is 50 USDC at 6",
              "decimals but 50 million whole tokens against a 0-decimal mint the poster",
              "minted themselves. The cap is the MVP's blast-radius limit, so the mint",
              "it is denominated in has to be fixed too."
            ],
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "docs": [
              "Protocol fee in basis points (200 = 2%). Capped at `MAX_FEE_BPS`."
            ],
            "type": "u16"
          },
          {
            "name": "feeDestination",
            "docs": [
              "Wallet that owns the token account fees are paid into."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "docs": [
              "Stored bump so we never have to re-derive it (and so we never trust a",
              "bump supplied by a caller)."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "task",
      "docs": [
        "One posted matter: the sealed criteria, the money, and the ruling.",
        "",
        "PDA seeds: `[b\"task\", creator.key(), task_id.to_le_bytes()]`",
        "",
        "Keying on the creator means two different posters can independently use",
        "`task_id = 1` without colliding, and a poster cannot squat on someone else's",
        "task id."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "docs": [
              "Who posted and funded this task. Receives the refund on rejection or",
              "expiry."
            ],
            "type": "pubkey"
          },
          {
            "name": "taskId",
            "docs": [
              "The caller-chosen id, part of the PDA seeds. Stored so clients can read",
              "it back off a fetched account without re-deriving."
            ],
            "type": "u64"
          },
          {
            "name": "worker",
            "docs": [
              "Set when work is submitted. Receives the payout on approval."
            ],
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "mint",
            "docs": [
              "The SPL mint the bounty is denominated in (USDC on devnet/mainnet).",
              "Recorded at creation so payout cannot be redirected to a different token."
            ],
            "type": "pubkey"
          },
          {
            "name": "rubricHash",
            "docs": [
              "SHA-256 of the canonical clause text. THE central commitment: written at",
              "creation, never mutated by any instruction in this program."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "submissionHash",
            "docs": [
              "SHA-256 of the submitted deliverable, set once on `submit_work`."
            ],
            "type": {
              "option": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "bountyAmount",
            "docs": [
              "Amount held in escrow, in the mint's base units."
            ],
            "type": "u64"
          },
          {
            "name": "deadline",
            "docs": [
              "Unix timestamp after which the creator may reclaim an unworked task."
            ],
            "type": "i64"
          },
          {
            "name": "state",
            "docs": [
              "Current lifecycle position. See `TaskState`."
            ],
            "type": {
              "defined": {
                "name": "taskState"
              }
            }
          },
          {
            "name": "verdict",
            "docs": [
              "The verifier's ruling, once one exists."
            ],
            "type": {
              "option": {
                "defined": {
                  "name": "verdictRecord"
                }
              }
            }
          },
          {
            "name": "bump",
            "docs": [
              "Stored bump for the task PDA. Used to sign escrow transfers as the PDA."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "taskState",
      "docs": [
        "The lifecycle of a task.",
        "",
        "Legal transitions, and nothing else:",
        "",
        "```text",
        "submit_work            submit_verdict(approved)",
        "Open  ------------------>  Submitted -----------------------> Settled",
        "|                            |",
        "| reclaim_expired            | submit_verdict(!approved)",
        "v                            v",
        "Refunded  <---------------------+",
        "```",
        "",
        "`Settled` and `Refunded` are TERMINAL. No instruction in this program accepts",
        "a task in either state - every handler requires an explicit prior state, so",
        "there is no path that moves money out of a task twice."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "submitted"
          },
          {
            "name": "settled"
          },
          {
            "name": "refunded"
          }
        ]
      }
    },
    {
      "name": "verdictRecord",
      "docs": [
        "The verifier's ruling, recorded permanently on the task.",
        "",
        "`reasoning_hash` is a SHA-256 of the full JSON verdict (per-clause pass/fail",
        "and reasoning) that the off-chain judge produced. The chain stores the hash,",
        "not the prose - prose is expensive and the hash is enough to prove the public",
        "reasoning was not edited after the fact."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "approved",
            "docs": [
              "True if every sealed clause passed."
            ],
            "type": "bool"
          },
          {
            "name": "confidence",
            "docs": [
              "The judge's self-reported confidence, 0-100."
            ],
            "type": "u8"
          },
          {
            "name": "reasoningHash",
            "docs": [
              "SHA-256 of the canonical JSON verdict published off-chain."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "decidedAt",
            "docs": [
              "Unix timestamp of the ruling, taken from the on-chain clock."
            ],
            "type": "i64"
          }
        ]
      }
    }
  ]
};
