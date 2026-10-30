# Static release cache integrity

Both sites keep an application's public shell in a release-specific Service Worker cache. A response is accepted only when `X-Netunim-Release` matches the worker's release. Existing tabs retain their controller, and a newly installed worker waits until those tabs close. Financial requests, business-data paths and cross-origin requests bypass this cache.

On 26.10.2026, the public custom domain returned historical release headers for unchanged assets after CDN revalidation, while a fresh query URL returned the current release. This made cold worker installation fail with `shell_release_mismatch`. Cloudflare documents that custom-domain caching can serve stale assets after a Pages deployment. [Cloudflare Pages serving behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/).

Worker network requests now carry `__netunim_release=<this worker's release>` and request browser revalidation. The header must still match exactly. Responses are written under their original canonical cache keys, including during installation, so offline lookup and old cache cleanup retain the same behavior. The install promise completes only after every shell response has been validated and stored. A failed install cannot activate a partial shell. Lazy vendor responses still wait for their cache write before resolving.

The query parameter does not select an old server deployment: if an old running worker receives newer-release bytes, it rejects them and uses its own validated cache. This maintains the existing release fence.

`runtime_worker_release_cache.py` uses real Chromium with synthetic stale headers on ordinary URLs and current headers on release-bound URLs. It verifies cold installation, canonical cache keys, lazy loading and identical offline bytes. `runtime_release_compatibility.py` continues to verify rejection of a newer incompatible deployment and retention of local preferences. The Node cold-install checks verify that an incorrect response header remains rejected even on a release-bound URL.

After a successful deployment, close all tabs and installed-app windows for the site, then reopen it to allow the waiting worker to activate. This does not require clearing application storage or changing Supabase settings.

All bootstrap update phases share one monotonic 20-second deadline. Before an
activation request has been sent, a timed-out update check can safely continue
using the controlling old release. An explicit denial from another open tab also
retains that release. After an activation request is sent, a missing reply or a
delayed controller replacement cannot authorize business imports: a small local
refresh screen remains in place. Even if the worker takes over later, that
document stays paused until a fresh navigation obtains consistent HTML and code.
Message ports and event listeners are released after every outcome. The compiled
Chromium test delays a genuine activation message past the deadline, releases it,
and proves that business code stays unloaded and local data survives the refresh.
