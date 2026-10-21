# Blaze reward policy

New fittings and reservations created after this release receive `rewardPolicyVersion: 2` during validation. Existing records without that field retain policy 1; loading or saving an existing record does not assign the new version. No historical invoice is rewritten.

| Client source | Studio Blaze | External |
| --- | ---: | ---: |
| Blaze | 50% | 20% |
| ANIRAK | 0% | 20% |

The base is rental subtotal plus any fitting discount, capped by net received rental money plus that discount. Deposits are excluded. A rental accrues on return. Completed paid fittings earn Blaze 200 Kč only when `performedBy` is `partner`; ANIRAK fittings earn Blaze zero. Completion records the actual provider, defaulting to the client source, independently of the staff member pressing the button.

A linked fitting's already accrued Blaze reward is deducted from the rental reward, including negative differences. Example: external rental 900 Kč yields 180 Kč; prior Blaze fitting reward 200 Kč yields a rental adjustment of −20 Kč. Cancelled or unfinished rentals leave the standalone fitting reward in place. Monthly reward events capture deltas; existing invoices remain immutable.

Studio fitting discount links remain supported. `link-reward` associates a completed paid fitting with a confirmed/prepared/rented/returned policy-2 reservation without changing customer price, payment entries or invoice. It verifies same customer email and partner, locks the fitting in a transaction, and enforces one fitting per rental and one rental per fitting. Financial association is available from the admin and partner fitting cards. External rentals never receive the customer fitting discount; staff can link them for reward calculation.

Legacy fitting rewards remain governed by policy 1 even when associated with a policy-2 rental; their prior reward is deducted once. Future policy changes require a new version, not a retroactive change to historical calculations.
