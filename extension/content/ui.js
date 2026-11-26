// MedDet UI. Lives in a closed-off Shadow DOM so site styles cannot break it and it cannot break the site.
// All text is set with textContent (never innerHTML) because results come from the network.
(function () {
  const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.layer{position:fixed;inset:0;pointer-events:none;z-index:2147483647}
.layer>*{pointer-events:auto}
.btn{position:fixed;display:none;align-items:center;gap:0;height:40px;min-width:40px;padding:0 10px;border:0;border-radius:20px;
  background:rgba(20,22,31,.86);color:#F6F5F1;cursor:pointer;backdrop-filter:blur(6px);
  box-shadow:0 0 0 1.5px rgba(56,225,198,.9),0 4px 14px rgba(0,0,0,.35);transition:gap .18s,padding .18s}
.btn svg{flex:none}
.btn .lbl{max-width:0;overflow:hidden;white-space:nowrap;font-size:13px;font-weight:600;transition:max-width .18s}
.btn:hover,.btn:focus-visible,.btn[aria-expanded=true]{gap:8px;padding:0 14px 0 10px}
.btn:hover .lbl,.btn:focus-visible .lbl,.btn[aria-expanded=true] .lbl{max-width:80px}
.btn:focus-visible{outline:2px solid #fff;outline-offset:2px}
.card{position:fixed;display:none;width:312px;max-height:70vh;overflow:auto;border-radius:14px;background:#F6F5F1;color:#14161F;
  box-shadow:0 12px 40px rgba(0,0,0,.45);font-size:14px;line-height:1.4}
.menu{padding:6px}
.opt{display:flex;align-items:center;gap:12px;width:100%;padding:12px;border:0;border-radius:10px;background:none;color:inherit;text-align:left;cursor:pointer;font-size:14px}
.opt:hover,.opt:focus-visible{background:#E6EFEC;outline:none}
.opt b{display:block;font-weight:650}.opt span{display:block;font-size:12px;color:#5A6070}
.head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 0}
.head .t{font-size:12px;color:#5A6070;font-weight:600}
.x{border:0;background:none;font-size:18px;line-height:1;color:#5A6070;cursor:pointer;border-radius:6px;padding:2px 6px}
.x:hover{background:#E6E4DC}
.body{padding:12px 14px 14px}
.spin{width:28px;height:28px;border-radius:50%;border:3px solid #CFE3DF;border-top-color:#0F8F83;animation:s .8s linear infinite;margin-bottom:12px}
@keyframes s{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation-duration:2.4s}}
h3{margin:0 0 4px;font-size:16px;font-weight:700}
p{margin:0 0 10px;color:#3A4050}
.bar{height:4px;border-radius:2px;background:#DAD8CF;overflow:hidden;margin:6px 0 12px}.bar i{display:block;height:100%;background:#0F8F83;transition:width .3s}
.row{display:flex;gap:12px}
.poster{flex:none;width:84px;height:126px;border-radius:8px;background:#DAD8CF;object-fit:cover}
.meta{font-size:12px;color:#5A6070;margin:2px 0 8px}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:650;margin-bottom:6px}
.high{background:#CDEFE7;color:#0B5F56}.possible{background:#F6E7B8;color:#6B4E00}.low{background:#EBD0CC;color:#7A2A20}
.ov{font-size:13px;color:#3A4050;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;margin:0 0 8px}
.alt{display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid #DAD8CF}
.alt img{width:34px;height:51px;border-radius:5px;object-fit:cover;background:#DAD8CF}
.alt div b{display:block;font-size:13px}.alt div span{font-size:12px;color:#5A6070}
.sec{font-size:12px;font-weight:650;color:#5A6070;margin:12px 0 0}
.actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.a{padding:8px 12px;border-radius:8px;border:1px solid #14161F;background:none;color:#14161F;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none}
.a.p{background:#14161F;color:#F6F5F1}
.a:focus-visible,.x:focus-visible{outline:2px solid #0F8F83;outline-offset:2px}
`;

  const SVGNS = 'http://www.w3.org/2000/svg';
  function icon(kind, size = 20, color = '#38E1C6') {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', color); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    const d = {
      reticle: ['M4 9V5a1 1 0 0 1 1-1h4', 'M15 4h4a1 1 0 0 1 1 1v4', 'M20 15v4a1 1 0 0 1-1 1h-4', 'M9 20H5a1 1 0 0 1-1-1v-4', 'M12 12h.01'],
      film: ['M4 4h16v16H4z', 'M8 4v16', 'M16 4v16', 'M4 9h4', 'M4 15h4', 'M16 9h4', 'M16 15h4'],
      note: ['M9 18V6l10-2v12', 'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', 'M19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
    }[kind];
    d.forEach((p) => { const e = document.createElementNS(SVGNS, 'path'); e.setAttribute('d', p); s.appendChild(e); });
    return s;
  }

  function h(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    kids.flat().forEach((c) => c != null && e.append(c));
    return e;
  }

  let host, root, layer, btn, card, pickCb, btnRect = { x: 0, y: 0 }, cardOpen = false;

  function mount() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'meddet-root';
    root = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet(); // constructed sheet: not blocked by page CSP
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];

    layer = h('div', { class: 'layer' });
    btn = h('button', { class: 'btn', 'aria-label': 'MedDet: identify what is playing', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: toggleMenu },
      icon('reticle', 20), h('span', { class: 'lbl', text: 'Identify' }));
    card = h('div', { class: 'card', role: 'dialog' });
    layer.append(btn, card);
    root.append(layer);
    // Keep clicks/keys inside MedDet from reaching the site's players and hotkeys.
    ['click', 'pointerdown', 'mousedown', 'keydown', 'keyup', 'dblclick', 'touchstart'].forEach((t) =>
      host.addEventListener(t, (e) => e.stopPropagation()));
    attach();
    document.addEventListener('fullscreenchange', attach);
  }

  function attach() {
    (document.fullscreenElement || document.documentElement).appendChild(host);
  }

  function placeCard() {
    if (!cardOpen) return;
    const w = 312;
    const left = Math.min(Math.max(8, btnRect.x + 40 - w), window.innerWidth - w - 8);
    const top = Math.min(btnRect.y + 48, Math.max(8, window.innerHeight - 160));
    card.style.left = left + 'px'; card.style.top = top + 'px';
    card.style.maxHeight = Math.max(160, window.innerHeight - top - 12) + 'px';
  }

  function setButton(pos) {
    if (!host) return;
    if (!pos) { btn.style.display = 'none'; return; }
    btnRect = pos;
    btn.style.display = 'flex';
    btn.style.left = pos.x + 'px'; btn.style.top = pos.y + 'px';
    placeCard();
  }

  function open(node) { card.replaceChildren(node); card.style.display = 'block'; cardOpen = true; placeCard(); }
  function closeAll() { card.style.display = 'none'; card.replaceChildren(); cardOpen = false; btn.setAttribute('aria-expanded', 'false'); }
  const header = (title) => h('div', { class: 'head' }, h('span', { class: 't', text: title }), h('button', { class: 'x', 'aria-label': 'Close', text: '×', onclick: () => { closeAll(); onCloseCb?.(); } }));
  let onCloseCb;

  function toggleMenu() {
    if (cardOpen) { closeAll(); onCloseCb?.(); return; }
    btn.setAttribute('aria-expanded', 'true');
    const optBtn = (kind, ic, t, s) => h('button', { class: 'opt', role: 'menuitem', onclick: () => pickCb?.(kind) }, icon(ic, 22, '#0F8F83'), h('div', {}, h('b', { text: t }), h('span', { text: s })));
    const menu = h('div', { class: 'menu', role: 'menu' },
      optBtn('movie', 'film', 'Identify movie or show', 'Scans a few moments of the video'),
      optBtn('music', 'note', 'Identify song', 'Listens for about 12 seconds'));
    open(menu);
    menu.querySelector('.opt').focus();
  }

  function showProgress(title, detail, { onCancel, fraction } = {}) {
    const body = h('div', { class: 'body' }, h('div', { class: 'spin' }), h('h3', { text: title }), h('p', { text: detail }),
      fraction != null ? h('div', { class: 'bar' }, (() => { const i = h('i'); i.style.width = Math.round(fraction * 100) + '%'; return i; })()) : null,
      onCancel ? h('div', { class: 'actions' }, h('button', { class: 'a', text: 'Cancel', onclick: onCancel })) : null);
    open(h('div', {}, header('MedDet'), body));
  }

  function showMessage({ title, body, actionLabel, onAction, secondaryActionLabel, onSecondaryAction }) {
    open(h('div', {}, header('MedDet'), h('div', { class: 'body' }, h('h3', { text: title }), h('p', { text: body }),
      actionLabel || secondaryActionLabel ? h('div', { class: 'actions' },
        actionLabel ? h('button', { class: 'a p', text: actionLabel, onclick: onAction }) : null,
        secondaryActionLabel ? h('button', { class: 'a', text: secondaryActionLabel, onclick: onSecondaryAction }) : null) : null)));
  }

  const LEVEL = { high: 'Strong match', possible: 'Possible match', low: 'Weak match' };

  function posterEl(cls) { const i = h('img', { class: cls, alt: '' }); return i; }

  function showMovie(matches, loadImage, { onRetry, onAnalyzeMore, status }) {
    const top = matches[0];
    const poster = posterEl('poster');
    loadImage(top.poster).then((u) => u && (poster.src = u));
    const kind = top.mediaType === 'tv' ? 'TV show' : 'Movie';
    const meta = [kind, top.releaseYear, top.runtime ? top.runtime + ' min' : null, top.rating ? '★ ' + top.rating : null].filter(Boolean).join(', ');
    const parts = [
      h('div', { class: 'row' }, poster, h('div', {},
        h('span', { class: 'badge ' + top.matchLevel, text: LEVEL[top.matchLevel] || 'Possible match' }),
        h('h3', { text: top.title }), h('div', { class: 'meta', text: meta }),
        top.genres?.length ? h('div', { class: 'meta', text: top.genres.slice(0, 3).join(', ') }) : null)),
      top.overview ? h('p', { class: 'ov', text: top.overview }) : null,
      top.director?.length ? h('div', { class: 'meta', text: (top.mediaType === 'tv' ? 'Created by ' : 'Directed by ') + top.director.join(', ') }) : null,
      top.cast?.length ? h('div', { class: 'meta', text: 'Cast: ' + top.cast.slice(0, 4).join(', ') }) : null,
    ];
    if (matches.length > 1) {
      parts.push(h('div', { class: 'sec', text: 'Also possible' }));
      matches.slice(1).forEach((m) => {
        const im = posterEl('');
        loadImage(m.poster).then((u) => u && (im.src = u));
        parts.push(h('div', { class: 'alt' }, im, h('div', {}, h('b', { text: m.title }),
          h('span', { text: [m.mediaType === 'tv' ? 'TV show' : 'Movie', m.releaseYear, LEVEL[m.matchLevel]].filter(Boolean).join(', ') }),
          h('div', {}, h('a', { class: 'meta', href: m.tmdbUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Details' })))));
      });
    }
    if (onAnalyzeMore) {
      parts.push(h('p', { text: 'This is a possible match. More visual evidence may improve confidence.' }));
    }
    parts.push(h('div', { class: 'actions' },
      h('a', { class: 'a p', href: top.tmdbUrl, target: '_blank', rel: 'noopener noreferrer', text: 'View on TMDB' }),
      onAnalyzeMore ? h('button', { class: 'a', text: 'Analyze more of this video', onclick: onAnalyzeMore }) : null,
      h('button', { class: 'a', text: 'Try again', onclick: onRetry })));
    open(h('div', {}, header(status === 'possible_match' ? 'Possible match' : 'Identification result'), h('div', { class: 'body' }, parts)));
  }

  function showMusic(track, { onRetry }) {
    const meta = [track.artists?.join(', '), track.album, track.releaseDate?.slice(0, 4)].filter(Boolean);
    open(h('div', {}, header('Found it'), h('div', { class: 'body' },
      h('h3', { text: track.title }),
      ...meta.map((m) => h('div', { class: 'meta', text: m })),
      h('div', { class: 'actions' },
        ...(track.links || []).map((l, i) => h('a', { class: 'a' + (i === 0 ? ' p' : ''), href: l.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open in ' + l.label })),
        h('button', { class: 'a', text: 'Try again', onclick: onRetry })))));
  }

  MedDet.ui = {
    mount, setButton, closeAll, showProgress, showMessage, showMovie, showMusic,
    isOpen: () => cardOpen,
    onPick: (cb) => (pickCb = cb),
    onClose: (cb) => (onCloseCb = cb),
    hideForCapture: (on) => { if (host) host.style.visibility = on ? 'hidden' : 'visible'; },
    reopenMenu: () => { closeAll(); toggleMenu(); },
  };
})();
