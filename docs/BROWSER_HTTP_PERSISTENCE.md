# Browser fixture socket persistence — 2026-10-25

Windows run `40172157324`, job `121105092083`, failed during an ordinary cold
module import with `net::ERR_NO_BUFFER_SPACE` for
`/assets/js/domains/documents/pdfjs-runtime-config.js`. This is an observed
network-resource failure in the isolated fixture; it is not an application
checkpoint failure or merely a CDP deadline.

The static server inherited HTTP/1.0 from `SimpleHTTPRequestHandler`, closing
connections between hundreds of ESM and worker-shell requests. In a sequential
controlled local Windows experiment, two disposable Orders cold profiles loaded
the same release and waited for an activated controlling worker. Native Chromium
NetLog counted:

| Static HTTP version | TCP connect attempts | Existing socket reuse events |
| --- | ---: | ---: |
| 1.0 | 927 | 0 |
| 1.1 | 35 | 892 |

The fixture now advertises HTTP/1.1; Python's existing static responses already
supply Content-Length. A two-request socket contract confirms that response
bodies and the exact same socket survive both requests. Eleven safety tests and
43 CI/harness contracts pass locally. This changes fixture transport only, with
no product worker, application request, storage, retry or timeout change.

This proves the connection-churn amplifier and removes it. It does not prove
that the earlier worker `cache.addAll` rejection had the same network error:
its original page-target diagnostics lacked the failed worker request. Keep
the native worker/network evidence and cold/cached/offline/upgrade acceptance;
passing reruns alone are not a root-cause claim.

The experiment is reproducible with
`python tools/probe-browser-http-persistence.py`. It owns separate loopback
origins/profiles and retains only aggregate counts and sanitized failure paths.
