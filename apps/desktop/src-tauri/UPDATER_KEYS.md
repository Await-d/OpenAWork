# Desktop Updater Key Management

## One-time Setup

Generate an Ed25519 signing keypair using the Tauri CLI:

```bash
pnpm tauri signer generate -w ~/.tauri/openAwork-updater-key.pem
```

This prints:
- **Private key** — add to GitHub secret `TAURI_SIGNING_PRIVATE_KEY`
- **Public key** — already set in `tauri.conf.json` → `plugins.updater.pubkey`

If the keypair needs rotation:
1. Generate a new keypair with the command above.
2. Update `tauri.conf.json` with the new public key.
3. Update the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret.
4. The old public key becomes invalid immediately — ship a release with the new key before retiring the old one.

## Required GitHub Secrets

| Secret | Description |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Ed25519 private key (PEM, base64-encoded) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the PEM file (leave empty if none) |
| `MACOS_CERTIFICATE` | Apple Developer certificate (p12, base64) |
| `MACOS_CERTIFICATE_PASSWORD` | p12 password |
| `APPLE_SIGNING_IDENTITY` | Developer ID Application: ... |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

## Channel Strategy

- **stable**: `releases/latest/download/latest.json` — points to the latest non-prerelease GitHub Release.
- **preview**: `releases/download/<tag>-preview/latest.json` — points directly to a prerelease tag.

The `release-desktop.yml` workflow sets `prerelease: true` for tags containing `-preview`, keeping stable and preview channels isolated.

## Security Notes

- Never commit the private key to source control.
- The private key is used only by GitHub Actions at build time.
- Rotate the keypair annually or immediately upon suspected compromise.
