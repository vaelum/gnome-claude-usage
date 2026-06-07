'use strict';

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

// SpiderMonkey can choke on the 6-digit fractional seconds Anthropic returns;
// trim to milliseconds so Date.parse() succeeds.
function trimIso(iso) {
    return iso ? iso.replace(/(\.\d{3})\d+/, '$1') : iso;
}

function remainingPct(win) {
    if (!win || typeof win.utilization !== 'number')
        return null;
    return Math.max(0, Math.min(100, 100 - win.utilization));
}

function fmtCountdown(iso) {
    const t = Date.parse(trimIso(iso));
    if (isNaN(t))
        return '—';
    let s = Math.round((t - Date.now()) / 1000);
    if (s <= 0)
        return _('now');
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    if (d > 0)
        return `${d}d${h}h`;
    if (h > 0)
        return `${h}h${m}m`;
    if (m > 0)
        return `${m}m`;
    return `${s}s`;
}

function fmtResetClock(iso, weekly) {
    const t = Date.parse(trimIso(iso));
    if (isNaN(t))
        return '';
    const d = new Date(t);
    const time = d.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});
    if (weekly) {
        const day = d.toLocaleDateString(undefined, {weekday: 'short'});
        return `${day} ${time}`;
    }
    return time;
}

const ClaudeIndicator = GObject.registerClass(
class ClaudeIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.0, 'Claude Usage', false);
        this._ext = ext;
        this._settings = ext.getSettings();
        this._data = null;
        this._lastFetch = 0;
        this._lastError = null;

        this._cancellable = new Gio.Cancellable();
        this._session = new Soup.Session();
        this._session.timeout = 15;

        // ---- panel button ----
        this._box = new St.BoxLayout({style_class: 'panel-status-menu-box claude-usage-box'});
        this._icon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${ext.path}/icons/claude-symbolic.svg`),
            style_class: 'system-status-icon',
        });
        this._label = new St.Label({
            text: '…',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'claude-usage-label',
        });
        this._box.add_child(this._icon);
        this._box.add_child(this._label);
        this.add_child(this._box);

        this._buildMenu();

        // refresh whenever the menu is opened
        this.menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._fetch();
        });

        this._settings.connect('changed::refresh-interval', () => this._restartNetTimer());
        this._settings.connect('changed', () => this._updateDisplay());

        this._startTimers();
        this._fetch();
    }

    _buildMenu() {
        this._headerItem = new PopupMenu.PopupMenuItem(_('Claude usage'), {reactive: false});
        this._headerItem.label.add_style_class_name('claude-header');
        this.menu.addMenuItem(this._headerItem);

        this._fiveItem = this._infoItem(_('5-hour'));
        this._weekItem = this._infoItem(_('Weekly'));
        this._opusItem = this._infoItem(_('Weekly · Opus'));
        this._sonnetItem = this._infoItem(_('Weekly · Sonnet'));
        this._extraItem = this._infoItem(_('Extra usage'));
        for (const it of [this._fiveItem, this._weekItem, this._opusItem, this._sonnetItem, this._extraItem])
            this.menu.addMenuItem(it);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._updatedItem = this._infoItem(_('Updated'));
        this.menu.addMenuItem(this._updatedItem);

        const refresh = new PopupMenu.PopupMenuItem(_('Refresh now'));
        refresh.connect('activate', () => this._fetch());
        this.menu.addMenuItem(refresh);

        const prefs = new PopupMenu.PopupMenuItem(_('Settings'));
        prefs.connect('activate', () => this._ext.openPreferences());
        this.menu.addMenuItem(prefs);
    }

    _infoItem(title) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const left = new St.Label({text: title, y_align: Clutter.ActorAlign.CENTER});
        const right = new St.Label({
            text: '',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'claude-value',
        });
        item.add_child(left);
        item.add_child(right);
        item._value = right;
        return item;
    }

    _startTimers() {
        this._restartNetTimer();
        // keep the countdown live between network fetches
        this._uiTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            this._updateDisplay();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _restartNetTimer() {
        if (this._netTimer) {
            GLib.source_remove(this._netTimer);
            this._netTimer = null;
        }
        const interval = Math.max(15, this._settings.get_int('refresh-interval'));
        this._netTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._fetch();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _readToken() {
        let path = this._settings.get_string('credentials-path');
        if (!path)
            path = GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']);
        const file = Gio.File.new_for_path(path);
        const [ok, contents] = file.load_contents(null);
        if (!ok)
            throw new Error('cannot read credentials');
        const json = JSON.parse(new TextDecoder().decode(contents));
        const token = json?.claudeAiOauth?.accessToken;
        if (!token)
            throw new Error('no access token');
        return token;
    }

    _fetch() {
        let token;
        try {
            token = this._readToken();
        } catch (_e) {
            this._setError(_('No Claude login found'));
            return;
        }

        const msg = Soup.Message.new('GET', USAGE_URL);
        const headers = msg.get_request_headers();
        headers.append('Authorization', `Bearer ${token}`);
        headers.append('anthropic-version', '2023-06-01');
        headers.append('anthropic-beta', 'oauth-2025-04-20');
        headers.append('accept', 'application/json');

        this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancellable,
            (session, res) => {
                let bytes;
                try {
                    bytes = session.send_and_read_finish(res);
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        this._setError(_('Network error'));
                    return;
                }

                const status = msg.get_status();
                if (status !== Soup.Status.OK) {
                    if (status === Soup.Status.UNAUTHORIZED)
                        this._setError(_('Login expired — run claude'));
                    else
                        this._setError(`HTTP ${status}`);
                    return;
                }

                let data;
                try {
                    data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                } catch (_e) {
                    this._setError(_('Bad response'));
                    return;
                }

                this._data = data;
                this._lastFetch = Date.now();
                this._lastError = null;
                this._updateDisplay();
            });
    }

    _setError(text) {
        this._lastError = text;
        this._updateDisplay();
    }

    _barWindow() {
        const d = this._data;
        if (!d)
            return null;
        const metric = this._settings.get_string('bar-metric');
        if (metric === 'seven_day')
            return d.seven_day;
        if (metric === 'min') {
            const ra = remainingPct(d.five_hour);
            const rb = remainingPct(d.seven_day);
            if (ra == null)
                return d.seven_day;
            if (rb == null)
                return d.five_hour;
            return ra <= rb ? d.five_hour : d.seven_day;
        }
        return d.five_hour;
    }

    _updateDisplay() {
        if (this._lastError && !this._data) {
            this._label.text = '!';
            this._setStatusClass('crit');
        } else if (!this._data) {
            this._label.text = '…';
            this._setStatusClass(null);
        } else {
            const win = this._barWindow();
            const rem = remainingPct(win);
            const showUsed = this._settings.get_boolean('show-percent-used');
            const pct = rem == null ? '?' : Math.round(showUsed ? 100 - rem : rem);
            let text = `${pct}%`;
            if (this._settings.get_boolean('show-countdown') && win)
                text += ` · ${fmtCountdown(win.resets_at)}`;
            this._label.text = text;

            const warn = this._settings.get_int('warn-threshold');
            const crit = this._settings.get_int('critical-threshold');
            if (rem == null)
                this._setStatusClass(null);
            else if (rem <= crit)
                this._setStatusClass('crit');
            else if (rem <= warn)
                this._setStatusClass('warn');
            else
                this._setStatusClass('ok');
        }

        this._updateMenu();
    }

    _setStatusClass(state) {
        for (const c of ['claude-ok', 'claude-warn', 'claude-crit'])
            this._box.remove_style_class_name(c);
        if (state)
            this._box.add_style_class_name(`claude-${state}`);
    }

    _fillWindowItem(item, win, weekly) {
        const rem = remainingPct(win);
        if (rem == null) {
            item.visible = false;
            return;
        }
        item.visible = true;
        const showUsed = this._settings.get_boolean('show-percent-used');
        const pct = Math.round(showUsed ? 100 - rem : rem);
        const word = showUsed ? _('used') : _('left');
        item._value.text =
            `${pct}% ${word} · ${fmtCountdown(win.resets_at)} (${fmtResetClock(win.resets_at, weekly)})`;
    }

    _updateMenu() {
        const d = this._data;

        if (this._lastError && !d) {
            this._headerItem.label.text = this._lastError;
            for (const it of [this._fiveItem, this._weekItem, this._opusItem,
                              this._sonnetItem, this._extraItem, this._updatedItem])
                it.visible = false;
            return;
        }

        if (!d) {
            this._headerItem.label.text = _('Loading…');
            return;
        }

        this._headerItem.label.text = this._lastError ? this._lastError : _('Claude usage');
        this._fillWindowItem(this._fiveItem, d.five_hour, false);
        this._fillWindowItem(this._weekItem, d.seven_day, true);
        this._fillWindowItem(this._opusItem, d.seven_day_opus, true);
        this._fillWindowItem(this._sonnetItem, d.seven_day_sonnet, true);

        const ex = d.extra_usage;
        if (ex && ex.is_enabled) {
            this._extraItem.visible = true;
            const cur = ex.currency ? `${ex.currency} ` : '';
            const used = ex.used_credits ?? 0;
            const lim = ex.monthly_limit ?? 0;
            this._extraItem._value.text = `${cur}${used} / ${cur}${lim}`;
        } else {
            this._extraItem.visible = false;
        }

        this._updatedItem.visible = true;
        const ago = Math.max(0, Math.round((Date.now() - this._lastFetch) / 1000));
        this._updatedItem._value.text = ago < 5 ? _('just now') : `${ago}s ago`;
    }

    destroy() {
        if (this._netTimer) {
            GLib.source_remove(this._netTimer);
            this._netTimer = null;
        }
        if (this._uiTimer) {
            GLib.source_remove(this._uiTimer);
            this._uiTimer = null;
        }
        this._cancellable.cancel();
        this._session?.abort();
        super.destroy();
    }
});

export default class ClaudeUsageExtension extends Extension {
    enable() {
        this._indicator = new ClaudeIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
