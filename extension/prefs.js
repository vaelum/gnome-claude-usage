'use strict';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

// The prefs base class lives at different resource paths across Shell
// versions: GNOME 45–49 ship js/extensionPreferences.js, while GNOME 50 moved
// it to js/extensions/prefs.js. Load whichever exists so prefs open on all.
let ExtensionPreferences, gettext;
try {
    ({ExtensionPreferences, gettext} =
        await import('resource:///org/gnome/Shell/Extensions/js/extensionPreferences.js'));
} catch (_e) {
    ({ExtensionPreferences, gettext} =
        await import('resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'));
}
const _ = gettext;

export default class ClaudeUsagePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        window.add(page);

        // ---- Display ----
        const disp = new Adw.PreferencesGroup({title: _('Display')});
        page.add(disp);

        const metricRow = new Adw.ComboRow({
            title: _('Panel metric'),
            subtitle: _('Which window drives the top-bar text'),
            model: new Gtk.StringList({
                strings: [_('5-hour window'), _('Weekly (7-day)'), _('Most constrained')],
            }),
        });
        metricRow.selected = settings.get_enum('bar-metric');
        metricRow.connect('notify::selected', () =>
            settings.set_enum('bar-metric', metricRow.selected));
        disp.add(metricRow);

        const countdownRow = new Adw.SwitchRow({
            title: _('Show reset countdown'),
            subtitle: _('Append time until reset, e.g. “· 2h13m”'),
        });
        settings.bind('show-countdown', countdownRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        disp.add(countdownRow);

        const usedRow = new Adw.SwitchRow({
            title: _('Show percent used'),
            subtitle: _('Show used % instead of remaining %'),
        });
        settings.bind('show-percent-used', usedRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        disp.add(usedRow);

        // ---- Colour thresholds ----
        const thr = new Adw.PreferencesGroup({
            title: _('Colour thresholds'),
            description: _('Remaining % at or below which the widget changes colour'),
        });
        page.add(thr);

        const warnRow = new Adw.SpinRow({
            title: _('Amber at or below (%)'),
            adjustment: new Gtk.Adjustment({lower: 0, upper: 100, step_increment: 1}),
        });
        settings.bind('warn-threshold', warnRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        thr.add(warnRow);

        const critRow = new Adw.SpinRow({
            title: _('Red at or below (%)'),
            adjustment: new Gtk.Adjustment({lower: 0, upper: 100, step_increment: 1}),
        });
        settings.bind('critical-threshold', critRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        thr.add(critRow);

        // ---- Updates ----
        const upd = new Adw.PreferencesGroup({title: _('Updates')});
        page.add(upd);

        const intervalRow = new Adw.SpinRow({
            title: _('Refresh interval (seconds)'),
            subtitle: _('How often to fetch fresh figures; the countdown ticks locally in between'),
            adjustment: new Gtk.Adjustment({lower: 15, upper: 3600, step_increment: 15}),
        });
        settings.bind('refresh-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        upd.add(intervalRow);

        const credRow = new Adw.EntryRow({
            title: _('Credentials path (blank = ~/.claude/.credentials.json)'),
        });
        settings.bind('credentials-path', credRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        upd.add(credRow);
    }
}
