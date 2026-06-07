#!/usr/bin/env bash
# Install the Claude Usage GNOME Shell extension for the current user.
set -euo pipefail

UUID="claude-usage@vaelum.de"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/extension"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "==> Installing $UUID"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$SRC/." "$DEST/"

echo "==> Compiling settings schema"
glib-compile-schemas "$DEST/schemas"

# Make the optional terminal helper runnable.
chmod +x "$HERE/bin/claude-usage" 2>/dev/null || true

echo "==> Enabling"
if gnome-extensions enable "$UUID" 2>/dev/null; then
    echo "    enabled."
else
    echo "    Could not enable yet — this is normal on Wayland for a freshly added extension."
fi

echo
echo "Done. If the widget is not visible yet:"
echo "  • Wayland: log out and back in, then run:  gnome-extensions enable $UUID"
echo "  • X11:     press Alt+F2, type 'r', Enter,  then:  gnome-extensions enable $UUID"
echo
echo "Tweak it from the Extensions app (or: gnome-extensions prefs $UUID)."
