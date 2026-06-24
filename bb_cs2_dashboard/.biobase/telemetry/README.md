# `.biobase/telemetry/` (pointer)

Operational notes for BIOBASE-aligned CS2 exporters / ingest spools stay in-repo under:

`docs/cs2/biobase-telemetry-v1.md`

Schema bundle (JSON Schema v1):

`docs/cs2/biobase-telemetry-v1.schema.json`

Local inspection / golden vs candidate QA:

```
python3 tools/biobase_demo_reconcile.py --telemetry path/to/bundle.json
python3 tools/biobase_demo_reconcile.py --telemetry golden.json --demo candidate.json
```

Compressed file-drop convention `{match_id}.jsonl.zst` is summarized in that doc alongside future HTTP ingestion hooks.
