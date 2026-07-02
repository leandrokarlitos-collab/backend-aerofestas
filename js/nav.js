/* ============================================================
   Aero Festas v3 — Navegação unificada
   Injeta: sidebar (desktop ≥1024px) + bottom nav (mobile) + sheet "Mais".
   Script clássico — incluir ANTES de js/protect.js nas páginas autenticadas.
   Página ativa: <body data-page="..."> ou detecção por location.pathname.
   Estado do collapse: localStorage 'aero_nav_collapsed'.
   ============================================================ */
(function () {
    'use strict';

    var ITEMS = [
        { key: 'home',      label: 'Início',       icon: 'fa-house',          href: './Dashboard.html' },
        { key: 'agenda',    label: 'Agenda',       icon: 'fa-calendar-days',  href: './Agenda de eventos.html' },
        { key: 'financas',  label: 'Financeiro',   icon: 'fa-chart-pie',      href: './Sistema Gestão Financeira.html' },
        { key: 'clientes',  label: 'Clientes',     icon: 'fa-users',          href: './Sistema de CRM.html' },
        { key: 'equip',     label: 'Equipamentos', icon: 'fa-cubes',          href: './Equipamentos.html' },
        { key: 'propostas', label: 'Propostas',    icon: 'fa-file-signature', href: './Propostas.html' }
        // { key: 'equipe', label: 'Equipe', icon: 'fa-people-group', href: './equipe.html' } — ativado na fase Equipe (F2)
    ];
    // Itens do bottom nav mobile (4 principais + Mais)
    var BOTTOM_KEYS = ['home', 'agenda', 'financas', 'clientes'];

    function getUser() {
        try { return JSON.parse(localStorage.getItem('userData') || '{}') || {}; }
        catch (e) { return {}; }
    }

    function currentPageKey() {
        var forced = document.body && document.body.getAttribute('data-page');
        if (forced) return forced;
        var path = '';
        try { path = decodeURIComponent(location.pathname); } catch (e) { path = location.pathname; }
        var file = path.split('/').pop() || 'index.html';
        for (var i = 0; i < ITEMS.length; i++) {
            if (ITEMS[i].href.split('/').pop() === file) return ITEMS[i].key;
        }
        if (file === 'profile.html') return 'profile';
        if (file === 'admin.html') return 'admin';
        return '';
    }

    function initials(name) {
        var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        var first = parts[0][0] || '';
        var last = parts.length > 1 ? parts[parts.length - 1][0] : '';
        return (first + last).toUpperCase();
    }

    function avatarHtml(user, extraClass) {
        var cls = 'sn-avatar' + (extraClass ? ' ' + extraClass : '');
        if (user.photoUrl) {
            return '<span class="' + cls + '"><img src="' + user.photoUrl + '" alt="" /></span>';
        }
        return '<span class="' + cls + '">' + initials(user.name) + '</span>';
    }

    function themeIcon() {
        var dark = window.Theme ? window.Theme.isDark() : document.documentElement.classList.contains('dark');
        return dark ? 'fa-sun' : 'fa-moon';
    }

    function logout() {
        try {
            localStorage.removeItem('authToken');
            localStorage.removeItem('userData');
        } catch (e) { }
        window.location.href = './login.html';
    }

    function build() {
        var user = getUser();
        var active = currentPageKey();
        var isAdmin = user.isAdmin === true;

        document.body.classList.add('has-aero-nav');
        var collapsed = false;
        try { collapsed = localStorage.getItem('aero_nav_collapsed') === '1'; } catch (e) { }
        if (collapsed) document.body.classList.add('aero-nav-collapsed');

        /* ---------- Sidebar (desktop) ---------- */
        var sidebar = document.createElement('aside');
        sidebar.id = 'aero-sidebar';

        var navLinks = ITEMS.map(function (it) {
            return '<a class="sn-item' + (it.key === active ? ' active' : '') + '" href="' + it.href + '" title="' + it.label + '">' +
                '<i class="fas ' + it.icon + '"></i><span class="sn-label">' + it.label + '</span></a>';
        }).join('');
        if (isAdmin) {
            navLinks += '<a class="sn-item' + (active === 'admin' ? ' active' : '') + '" href="./admin.html" title="Administração">' +
                '<i class="fas fa-shield-halved"></i><span class="sn-label">Admin</span></a>';
        }

        sidebar.innerHTML =
            '<div class="sn-header">' +
                '<span class="sn-logo"><i class="fas fa-plane-up"></i></span>' +
                '<span class="sn-wordmark">Aero Festas</span>' +
                '<button type="button" class="sn-collapse" id="aero-nav-collapse" title="Recolher menu"><i class="fas fa-angles-left"></i></button>' +
            '</div>' +
            '<nav class="sn-nav">' + navLinks + '</nav>' +
            '<div class="sn-footer">' +
                '<a class="sn-user" href="./profile.html" title="Meu perfil">' +
                    avatarHtml(user) +
                    '<span class="sn-user-name">' + (user.name ? String(user.name).split(' ')[0] : 'Perfil') + '</span>' +
                '</a>' +
                '<button type="button" class="btn btn-ghost btn-icon" id="aero-theme-toggle-desktop" title="Alternar tema"><i class="fas ' + themeIcon() + '"></i></button>' +
                '<button type="button" class="btn btn-ghost btn-icon" id="aero-logout-desktop" title="Sair"><i class="fas fa-arrow-right-from-bracket"></i></button>' +
            '</div>';

        /* ---------- Bottom nav (mobile) ---------- */
        var bottom = document.createElement('nav');
        bottom.id = 'aero-bottomnav';
        var bottomHtml = '';
        BOTTOM_KEYS.forEach(function (key) {
            var it = ITEMS.filter(function (x) { return x.key === key; })[0];
            if (!it) return;
            bottomHtml += '<a class="bn-item' + (it.key === active ? ' active' : '') + '" href="' + it.href + '">' +
                '<i class="fas ' + it.icon + '"></i><span>' + it.label + '</span></a>';
        });
        var moreActive = active && BOTTOM_KEYS.indexOf(active) === -1;
        bottomHtml += '<button type="button" class="bn-item' + (moreActive ? ' active' : '') + '" id="aero-more-btn">' +
            '<i class="fas fa-ellipsis"></i><span>Mais</span></button>';
        bottom.innerHTML = bottomHtml;

        document.body.appendChild(sidebar);
        document.body.appendChild(bottom);

        /* ---------- Sheet "Mais" ---------- */
        function openMoreSheet() {
            var user2 = getUser();
            var gridItems = ITEMS.filter(function (it) { return BOTTOM_KEYS.indexOf(it.key) === -1; })
                .map(function (it) {
                    return '<a class="sheet-item" href="' + it.href + '"><i class="fas ' + it.icon + '"></i>' + it.label + '</a>';
                }).join('');
            gridItems += '<a class="sheet-item" href="./profile.html"><i class="fas fa-user"></i>Perfil</a>';
            if (user2.isAdmin === true) {
                gridItems += '<a class="sheet-item" href="./admin.html"><i class="fas fa-shield-halved"></i>Admin</a>';
            }

            var m = window.UI.modal({
                title: 'Mais',
                html: '<div class="sheet-grid" style="padding:0;">' + gridItems + '</div>',
                footerHtml:
                    '<button type="button" class="btn btn-ghost" id="aero-theme-toggle-mobile"><i class="fas ' + themeIcon() + '"></i>&nbsp; Tema</button>' +
                    '<button type="button" class="btn btn-danger-soft" id="aero-logout-mobile"><i class="fas fa-arrow-right-from-bracket"></i>&nbsp; Sair</button>'
            });
            m.backdrop.id = 'aero-more-sheet';
            var t = m.box.querySelector('#aero-theme-toggle-mobile');
            if (t) t.addEventListener('click', function () {
                if (window.Theme) window.Theme.toggle();
                var icon = t.querySelector('i');
                if (icon) icon.className = 'fas ' + themeIcon();
            });
            var lo = m.box.querySelector('#aero-logout-mobile');
            if (lo) lo.addEventListener('click', logout);
        }

        /* ---------- Comportamento ---------- */
        var collapseBtn = document.getElementById('aero-nav-collapse');
        if (collapseBtn) {
            collapseBtn.addEventListener('click', function () {
                var isCollapsed = document.body.classList.toggle('aero-nav-collapsed');
                try { localStorage.setItem('aero_nav_collapsed', isCollapsed ? '1' : '0'); } catch (e) { }
                collapseBtn.querySelector('i').className = 'fas ' + (isCollapsed ? 'fa-angles-right' : 'fa-angles-left');
            });
            if (collapsed) collapseBtn.querySelector('i').className = 'fas fa-angles-right';
        }

        var themeBtnDesktop = document.getElementById('aero-theme-toggle-desktop');
        if (themeBtnDesktop) {
            themeBtnDesktop.addEventListener('click', function () {
                if (window.Theme) window.Theme.toggle();
            });
        }
        window.addEventListener('themechange', function () {
            var icon = themeBtnDesktop && themeBtnDesktop.querySelector('i');
            if (icon) icon.className = 'fas ' + themeIcon();
        });

        var logoutDesktop = document.getElementById('aero-logout-desktop');
        if (logoutDesktop) logoutDesktop.addEventListener('click', logout);

        var moreBtn = document.getElementById('aero-more-btn');
        if (moreBtn) moreBtn.addEventListener('click', openMoreSheet);
    }

    if (document.body) build();
    else document.addEventListener('DOMContentLoaded', build, { once: true });
})();
