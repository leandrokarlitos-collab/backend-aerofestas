/* ============================================================
   Aero Festas v3 — Tema único (light/dark)
   Script clássico: incluir no <head>, ANTES do CSS da página,
   para aplicar a classe .dark antes do primeiro paint.
   Compatível com a key legada localStorage 'theme' ('dark'|'light').
   Emite window 'themechange' ({detail:{dark}}) — usado p/ repintar Chart.js.
   ============================================================ */
(function () {
    var KEY = 'theme';

    function applyToBody(dark) {
        if (document.body) {
            document.body.classList.toggle('dark', dark);
        } else {
            document.addEventListener('DOMContentLoaded', function () {
                document.body.classList.toggle('dark', dark);
            }, { once: true });
        }
    }

    function apply(dark, silent) {
        // CSS legado usa tanto html.dark quanto body.dark — aplicar nos dois
        document.documentElement.classList.toggle('dark', dark);
        applyToBody(dark);
        if (!silent) {
            try {
                window.dispatchEvent(new CustomEvent('themechange', { detail: { dark: dark } }));
            } catch (e) { /* IE-safe noop */ }
        }
    }

    var stored = null;
    try { stored = localStorage.getItem(KEY); } catch (e) { /* storage indisponível */ }
    // Default light — mesmo comportamento das páginas legadas
    var initialDark = stored === 'dark';
    apply(initialDark, true);

    window.Theme = {
        isDark: function () {
            return document.documentElement.classList.contains('dark');
        },
        set: function (dark) {
            try { localStorage.setItem(KEY, dark ? 'dark' : 'light'); } catch (e) { }
            apply(dark);
        },
        toggle: function () {
            this.set(!this.isDark());
        }
    };
})();
