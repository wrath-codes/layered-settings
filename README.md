# Layered Settings

Extendable and nested settings for VSCode with **full file watching**.

## Features

- **ESLint-style `extends`** — inherit from local files or URLs
- **Folder inheritance** — walks up the folder tree looking for config files
- **Full file watching** — watches ALL files in the inheritance chain
- **Debounced updates** — prevents rapid rebuilds on quick saves
- **Status bar indicator** — shows sync state
- **Array extends** — extend from multiple files

## Usage

Create `.vscode/layered-settings/config.json` in your workspace:

```json
{
  "root": true,
  "extends": ["./base.json", "./editor.json"],
  "settings": {
    "editor.fontSize": 14
  }
}
```

All config files live in `.vscode/layered-settings/`:

```
.vscode/
├── settings.json              # VSCode (managed by extension)
└── layered-settings/
    ├── config.json            # Main config
    ├── base.json
    ├── editor.json
    └── fonts.json
```

### Config Options

| Property | Type | Description |
|----------|------|-------------|
| `root` | `boolean` | Stop looking for parent configs |
| `extends` | `string \| string[]` | Path(s) or URL(s) to inherit from |
| `settings` | `object` | VSCode settings (highest priority) |

### Inheritance Order

Settings are merged with **later = higher priority**:

1. Parent folder configs (furthest ancestor first)
2. Extended files (in array order)
3. Local `settings` property

## Commands

- `Layered Settings: Refresh` — Force refresh all settings
- `Layered Settings: Open Config` — Open/create config file
- `Layered Settings: Show Status` — Show current status

## File Watching

Unlike other extensions, **layered-settings** watches:

- ✅ Your workspace's `config.json`
- ✅ All parent folder configs in the inheritance chain
- ✅ All extended files (recursive)
- ✅ New file creation in `.vscode/layered-settings/`

Changes to any watched file trigger an automatic settings rebuild (debounced 300ms).

## Example Structure

```
~/projects/
├── .vscode/
│   └── layered-settings/
│       └── config.json          # root: true, base settings
│
├── team-a/
│   ├── .vscode/
│   │   └── layered-settings/
│   │       ├── config.json      # extends parent + team overrides
│   │       └── team.json
│   │
│   └── project-1/
│       └── .vscode/
│           └── layered-settings/
│               ├── config.json  # project-specific
│               └── local.json
```

## License

MIT
