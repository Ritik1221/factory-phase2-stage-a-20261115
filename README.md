# Factory Phase 2 — Stage A

Disposable public integration fixture for testing the GitHub-only control plane.

- All application code and data are synthetic.
- Agent execution is disabled.
- No production credentials, product code, or customer data belong here.
- The repository may be deleted after the evidence has been retained.

The synthetic application exposes health and version behavior solely so CI and
the exact-main smoke gate can produce meaningful evidence.
