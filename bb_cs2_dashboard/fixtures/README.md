# CS2 demo fixtures (optional)

Awpy publishes checksums indirectly via their tests. A small **matchmaking** replay used in upstream CI:

| File (local) | Upstream manifest |
|----------------|-------------------|
| `sample.dem` (not committed) | [`tests/test_data.json`](https://github.com/pnxenopoulos/awpy/blob/main/tests/test_data.json) — key `match730_003736456444682174484_1173793269_201` |

**CDN (Figshare direct):** `https://figshare.com/ndownloader/files/52456259`

Many networks return an AWS WAF challenge to unattended `curl`; if automated fetch fails, download the `.dem` in a browser and save it here as `sample.dem`, then run:

```bash
sha256sum fixtures/sample.dem
```

Record the hash in your notes or CI cache. The repo **does not** commit `.dem` binaries by default (see `.gitignore` in this folder).

## Make target

From `bb_cs2_dashboard/`:

```bash
make fetch-demo-fixture
```

This runs `scripts/fetch_demo_fixture.sh`, which tries `curl -L` and prints next steps on failure.
