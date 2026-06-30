# Architecture

Velora is split into a Heroku-hosted control plane and a local desktop data plane.

- Control plane: registration, licenses, device enrollment, bootstrap data, authoritative zone review.
- Data plane: local browsing, local search index, cache, peer connectivity and future libp2p services.
