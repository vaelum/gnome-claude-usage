# Claude Usage — GNOME top-bar widget

A GNOME Shell extension that shows how much **Claude usage you have left** and
**when it resets**, right in the top bar:

```
 ▦ 65% · 2h13m
```

Click it for the full breakdown (5-hour window, weekly, weekly Opus/Sonnet, and
any extra-usage credits), each with a percentage and reset countdown.

The numbers are the **real** figures Anthropic reports — the same ones Claude
Code shows under `/usage`. There is no estimation: the widget reads your local
Claude Code OAuth token and queries
`https://api.anthropic.com/api/oauth/usage`.

## Requirements

- GNOME Shell 45–50 (built/tested on 50, Wayland).
- A logged-in **Claude Code** install (`~/.claude/.credentials.json` must exist).
- `glib-compile-schemas` (ships with GLib). `jq` + `curl` only for the optional
  terminal helper.

## Install

```sh
./install.sh
```

On **Wayland** a freshly added extension is only picked up after the shell
reloads, so:

1. Log out and back in.
2. `gnome-extensions enable claude-usage@vaelum.de`

On **X11** you can instead press `Alt+F2`, type `r`, Enter, then enable it.

Open settings with `gnome-extensions prefs claude-usage@vaelum.de` or from the
Extensions app.

## How it works

- Every `refresh-interval` seconds (default 120) it reads the `accessToken` from
  `~/.claude/.credentials.json` and GETs the usage endpoint over libsoup 3.
- Between fetches the reset **countdown** ticks locally, so the display stays
  live without extra network calls.
- `remaining % = 100 − utilization`. The panel turns **amber**, then **red**, as
  the chosen window's remaining % crosses the configurable thresholds.
- The token is re-read from disk on **every** fetch, so when Claude Code
  refreshes its login the widget transparently picks up the new token. The
  extension deliberately does **not** refresh the token itself — Anthropic's
  refresh tokens rotate, and refreshing here could invalidate Claude Code's own
  session.

### Settings

| Setting | Default | Notes |
|---|---|---|
| Panel metric | 5-hour window | Or weekly, or "most constrained" (lowest remaining) |
| Show reset countdown | on | `· 2h13m` after the percentage |
| Show percent used | off | Flip to display used instead of remaining |
| Amber / red thresholds | 25% / 10% | Remaining % at which the colour changes |
| Refresh interval | 120s | 15–3600 |
| Credentials path | (default) | Override if your `.credentials.json` lives elsewhere |

## Terminal helper

`bin/claude-usage` prints the same data without GNOME — handy for testing or a
shell prompt:

```sh
$ bin/claude-usage
Claude usage remaining
  5-hour: 65% left   resets 2026-06-04 14:00
  Weekly (7d): 94% left   resets 2026-06-05 17:00

$ bin/claude-usage --json   # raw API response
```

## Troubleshooting

- **"No Claude login found"** — `~/.claude/.credentials.json` is missing. Run
  `claude` and sign in. (Set a custom path in settings if needed.)
- **"Login expired — run claude"** — the token expired and Claude Code hasn't
  refreshed it yet; open Claude Code once.
- **Widget missing after install on Wayland** — log out/in, then
  `gnome-extensions enable claude-usage@vaelum.de`.
- **Logs:** `journalctl -f -o cat /usr/bin/gnome-shell` while reproducing.

## Uninstall

```sh
gnome-extensions disable claude-usage@vaelum.de
rm -rf ~/.local/share/gnome-shell/extensions/claude-usage@vaelum.de
```
