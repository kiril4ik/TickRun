# Contributing

TickRun is intentionally narrow. Contributions should keep the core workflow simple:

1. create a local job;
2. schedule it once or repeatedly;
3. run it;
4. inspect its logs.

Before opening a pull request:

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Please avoid introducing services, accounts, cloud dependencies, workflow DAGs, or other orchestration concepts without a strong reason.
