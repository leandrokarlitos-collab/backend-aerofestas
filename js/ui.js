/* ============================================================
   Aero Festas v3 — Toolkit de UI (window.UI)
   Script clássico global. Requer css/aero.css.
   Instala shims window.showToast / window.showToastModal para
   compatibilidade com as páginas legadas durante a migração.
   ============================================================ */
(function () {
    'use strict';

    var ICONS = {
        success: 'fa-check',
        error: 'fa-xmark',
        warning: 'fa-triangle-exclamation',
        info: 'fa-circle-info'
    };

    function el(tag, className, html) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (html != null) node.innerHTML = html;
        return node;
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function onReady(fn) {
        if (document.body) fn();
        else document.addEventListener('DOMContentLoaded', fn, { once: true });
    }

    /* ---------------- Toast ---------------- */
    function getToastRoot() {
        var root = document.getElementById('aero-toasts');
        if (!root) {
            root = el('div');
            root.id = 'aero-toasts';
            root.setAttribute('role', 'status');
            root.setAttribute('aria-live', 'polite');
            document.body.appendChild(root);
        }
        return root;
    }

    /**
     * UI.toast('Salvo!')                       → success
     * UI.toast('Falhou', 'error')              → tipo explícito
     * UI.toast('Falhou', true)                 → legado (isError)
     * UI.toast('Atenção', { type:'warning', duration: 5000 })
     */
    function toast(message, opts) {
        var type = 'success';
        var duration = 3200;
        if (typeof opts === 'boolean') {
            type = opts ? 'error' : 'success';
        } else if (typeof opts === 'string') {
            type = opts;
        } else if (opts && typeof opts === 'object') {
            if (opts.type) type = opts.type;
            if (opts.duration) duration = opts.duration;
        }
        if (!ICONS[type]) type = 'info';
        if (type === 'error') duration = Math.max(duration, 4200);

        onReady(function () {
            var root = getToastRoot();
            var node = el('div', 'toast toast-' + type,
                '<span class="toast-dot"><i class="fas ' + ICONS[type] + '"></i></span>' +
                '<span>' + escapeHtml(message) + '</span>');
            root.appendChild(node);
            // Máx. 3 toasts simultâneos
            while (root.children.length > 3) root.removeChild(root.firstChild);
            setTimeout(function () {
                node.classList.add('leaving');
                setTimeout(function () { node.remove(); }, 260);
            }, duration);
        });
    }

    /* ---------------- Modal base ---------------- */
    function buildModal(opts) {
        var backdrop = el('div', 'modal-backdrop sheet-on-mobile');
        var box = el('div', 'modal-box');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');

        var html = '';
        html += '<div class="modal-header">';
        html += '<div class="modal-title">' + escapeHtml(opts.title || '') + '</div>';
        if (opts.closeButton !== false) {
            html += '<button type="button" class="btn btn-ghost btn-icon" data-aero-close aria-label="Fechar"><i class="fas fa-xmark"></i></button>';
        }
        html += '</div>';
        html += '<div class="modal-body">' + (opts.html != null ? opts.html : escapeHtml(opts.message || '')) + '</div>';
        if (opts.footerHtml) {
            html += '<div class="modal-footer">' + opts.footerHtml + '</div>';
        }
        box.innerHTML = html;
        backdrop.appendChild(box);

        function close(result) {
            backdrop.remove();
            document.removeEventListener('keydown', onKey);
            if (opts.onClose) opts.onClose(result);
        }
        function onKey(e) {
            if (e.key === 'Escape') close(opts.escapeResult);
        }
        backdrop.addEventListener('mousedown', function (e) {
            if (e.target === backdrop && opts.dismissible !== false) close(opts.escapeResult);
        });
        box.querySelectorAll('[data-aero-close]').forEach(function (btn) {
            btn.addEventListener('click', function () { close(opts.escapeResult); });
        });
        if (opts.dismissible !== false) document.addEventListener('keydown', onKey);

        document.body.appendChild(backdrop);
        return { backdrop: backdrop, box: box, close: close };
    }

    /**
     * UI.confirm({ title, message, confirmText, cancelText, danger }) → Promise<boolean>
     * UI.confirm('Excluir este item?') → atalho
     */
    function confirm(opts) {
        if (typeof opts === 'string') opts = { message: opts };
        opts = opts || {};
        return new Promise(function (resolve) {
            var settled = false;
            var m = buildModal({
                title: opts.title || 'Confirmar',
                message: opts.message || 'Tem certeza?',
                closeButton: false,
                escapeResult: false,
                footerHtml:
                    '<button type="button" class="btn btn-ghost" data-aero-cancel>' + escapeHtml(opts.cancelText || 'Cancelar') + '</button>' +
                    '<button type="button" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-aero-ok>' + escapeHtml(opts.confirmText || 'Confirmar') + '</button>',
                onClose: function (result) {
                    if (!settled) { settled = true; resolve(result === true); }
                }
            });
            m.box.querySelector('[data-aero-ok]').addEventListener('click', function () { m.close(true); });
            m.box.querySelector('[data-aero-cancel]').addEventListener('click', function () { m.close(false); });
            var okBtn = m.box.querySelector('[data-aero-ok]');
            if (okBtn) okBtn.focus();
        });
    }

    /** UI.alert({ title, message }) → Promise<void> */
    function alertDialog(opts) {
        if (typeof opts === 'string') opts = { message: opts };
        opts = opts || {};
        return new Promise(function (resolve) {
            var m = buildModal({
                title: opts.title || 'Aviso',
                message: opts.message || '',
                escapeResult: undefined,
                footerHtml: '<button type="button" class="btn btn-primary" data-aero-ok>OK</button>',
                onClose: function () { resolve(); }
            });
            m.box.querySelector('[data-aero-ok]').addEventListener('click', function () { m.close(); });
        });
    }

    /** UI.modal({ title, html, footerHtml, dismissible }) → { box, close } */
    function modal(opts) {
        return buildModal(opts || {});
    }

    /* ---------------- Skeleton / Empty ---------------- */
    /**
     * UI.skeleton(el, 'lines' | 'cards' | 'table' | 'kpis', count)
     * Substitui o conteúdo do elemento por placeholders shimmer.
     */
    function skeleton(target, kind, count) {
        if (!target) return;
        kind = kind || 'lines';
        count = count || (kind === 'kpis' ? 4 : 3);
        var html = '';
        var i;
        if (kind === 'kpis') {
            html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;">';
            for (i = 0; i < count; i++) {
                html += '<div class="surface" style="padding:16px;"><div class="skeleton" style="width:50%;height:12px;margin-bottom:10px;"></div><div class="skeleton" style="width:75%;height:24px;"></div></div>';
            }
            html += '</div>';
        } else if (kind === 'cards') {
            for (i = 0; i < count; i++) {
                html += '<div class="surface" style="padding:16px;margin-bottom:12px;"><div class="skeleton" style="width:40%;height:16px;margin-bottom:10px;"></div><div class="skeleton" style="width:90%;height:12px;margin-bottom:6px;"></div><div class="skeleton" style="width:65%;height:12px;"></div></div>';
            }
        } else if (kind === 'table') {
            for (i = 0; i < count; i++) {
                html += '<div style="display:flex;gap:12px;padding:10px 0;"><div class="skeleton" style="flex:2;height:14px;"></div><div class="skeleton" style="flex:1;height:14px;"></div><div class="skeleton" style="flex:1;height:14px;"></div></div>';
            }
        } else {
            for (i = 0; i < count; i++) {
                html += '<div class="skeleton" style="width:' + (90 - i * 12) + '%;height:14px;margin-bottom:10px;"></div>';
            }
        }
        target.innerHTML = html;
    }

    /**
     * UI.empty(el, { icon, title, text, cta: { label, onClick } })
     */
    function empty(target, opts) {
        if (!target) return;
        opts = opts || {};
        var node = el('div', 'empty-state');
        var html = '<div class="empty-icon"><i class="fas ' + (opts.icon || 'fa-inbox') + '"></i></div>';
        if (opts.title) html += '<div class="empty-title">' + escapeHtml(opts.title) + '</div>';
        if (opts.text) html += '<div class="empty-text">' + escapeHtml(opts.text) + '</div>';
        node.innerHTML = html;
        if (opts.cta && opts.cta.label) {
            var btn = el('button', 'btn btn-primary btn-sm', '<i class="fas fa-plus"></i> ' + escapeHtml(opts.cta.label));
            btn.type = 'button';
            if (opts.cta.onClick) btn.addEventListener('click', opts.cta.onClick);
            node.appendChild(btn);
        }
        target.innerHTML = '';
        target.appendChild(node);
    }

    /* ---------------- Count-up ---------------- */
    /**
     * UI.countUp(el, 1234.56, { prefix:'R$ ', decimals: 2, duration: 700 })
     * Respeita prefers-reduced-motion (aplica valor direto).
     */
    function countUp(target, value, opts) {
        if (!target) return;
        opts = opts || {};
        var decimals = opts.decimals != null ? opts.decimals : 0;
        var prefix = opts.prefix || '';
        var suffix = opts.suffix || '';
        var duration = opts.duration || 700;

        function fmt(v) {
            return prefix + v.toLocaleString('pt-BR', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            }) + suffix;
        }

        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced || !isFinite(value)) {
            target.textContent = fmt(value || 0);
            return;
        }

        var start = null;
        var from = 0;
        function frame(ts) {
            if (!start) start = ts;
            var p = Math.min((ts - start) / duration, 1);
            var eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
            target.textContent = fmt(from + (value - from) * eased);
            if (p < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    /* ---------------- Exposição global + shims legados ---------------- */
    window.UI = {
        toast: toast,
        confirm: confirm,
        alert: alertDialog,
        modal: modal,
        skeleton: skeleton,
        empty: empty,
        countUp: countUp
    };

    // Shims de compatibilidade: páginas legadas chamam showToast(msg, isError)
    // ou showToastModal(msg, isError). Páginas ainda não migradas que definem
    // suas próprias versões vão sobrescrever estes shims (carregam depois) —
    // comportamento desejado durante a migração incremental.
    window.showToast = function (message, isError) { toast(message, !!isError); };
    window.showToastModal = function (message, isError) { toast(message, !!isError); };
})();
