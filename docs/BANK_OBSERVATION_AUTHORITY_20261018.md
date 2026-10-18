# Bank observation authority

Transaction-bearing Bridge responses, including partial or empty histories, require
an explicit valid `fetchedAt`. Both accounts decode before reconciliation starts.
Legacy balance-only reads retain their local display-time fallback; the dedicated
`readBankSnapshotResult` boundary requires a Bridge observation for every durable
snapshot, including balance-only replies. Neither application invents snapshot time.

`bank_temporal_authority.test.mjs` covers flat/dual-account shapes, valid clocks,
missing observations and retained balance-only compatibility. Real Orders publication
and Kupa refresh owners prove zero archive/snapshot/local writes on rejection,
unchanged retained state and lease cleanup. The historical AST recomposition fixtures
explicitly isolate this intentional change from their original business-policy baseline.
