# Scylla: a self-hardening firewall for AI agents

AI agents read our email, browse the web, open images and call real tools. One sentence hidden in any of those inputs can hijack them: prompt injection is OWASP's #1 LLM risk. **Scylla** sits between a tool-using agent and the world:

- **Ingress:** every untrusted input (email, web page, file, image, voicemail, tool output) goes through heuristics, learned rules, a guard model, Muse Spark vision, SAM 3.1 localization and Muse Voice Transcribe. It is allowed, sanitized or quarantined before the agent sees it.
- **Egress:** every side-effecting call (`send_email`, `http_post`, `pay_invoice`, `delete_file`, `create_calendar_event`) goes through DLP with runtime-canary taint tracking, learned tool policies and a Muse Spark judge that checks the call against what the user actually asked for. The call is allowed, blocked or held for a human.
- **Self-hardening:** a red-team agent invents new attacks. A blue-team agent proposes constrained rules, and a rule ships only if replaying the full corpus shows the bypass is now blocked and **zero** benign tasks regress.

Built for the Meta AI Developer Hackathon (Indie track). All code in this repo was written during the hackathon window.

## Results
| Run | Attack success | Benign utility and ingress |
|---|---:|---|
| Mock, Scylla off | 18/18 | — |
| Mock, Scylla enforce | 0/18 | 10/10 |
| Live Muse Spark, Scylla enforce | 0/18 | 10/10 completed; 17/18 ingress catches; 0/10 benign flags |
| Live adaptive search vs unprotected Muse Spark | 1 bypass in 28 variants (pays attacker's bank account; ~1 in 5 replays) | Scylla provenance holds that exact payment for approval |
| Mock layer ablation | provenance alone catches 14/18 | 10/10 utility, no model calls |

Muse Spark resisted the hand-written corpus even unprotected, but a Muse Spark attacker refining its own attacks found an invoice-fraud variant that got through; Scylla adds pre-model detection and model-independent egress control. See [the live results](docs/LIVE_RESULTS.md).

## Meta models used
| Model | Role |
|---|---|
| Muse Spark (`muse-spark-1.3-contributor`) | protected agent, egress judge, red team, blue team |
| Muse Spark vision | finds instructions hidden in images |
| SAM 3.1 | localizes the injected region |
| Muse Voice Transcribe | voicemail ingress |
| Muse Image | red-team image attacks |
| Muse Spark Open (Baseten) | open-weights guard model |

## Quickstart
```bash
npm install && (cd web && npm install)
npm run dev                 # API + WebSocket on :4100 (mock provider when no key is set)
(cd web && npm run dev)     # dashboard on :5180
npm run bench -- --mode off
npm run bench -- --mode enforce
```
Live mode: `export MODEL_API_KEY=...` (optional `BASETEN_API_KEY` for the open-weights guard), then run `npm run smoke:live`. For probes, run `npm run probe:exposure` with `SCYLLA_PROVIDER=live`, or `npm run probe:red` (live model calls). `SCYLLA_CALL_CAP` (default 400) hard-caps model calls per process; `SCYLLA_TIMEOUT_MS` (default 90000) sets the timeout for live API requests.

The sandbox is fictional (Northwind Robotics, `.example` domains). Secrets are runtime-generated canaries, so no side effect ever leaves the process.

See [DESIGN.md](DESIGN.md) for the architecture and scoring, and [docs/SUBMISSION.md](docs/SUBMISSION.md) for the submission kit.
