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
.card{position:fixed;display:none;width:min(380px,calc(100vw - 16px));max-height:70vh;overflow:auto;border-radius:14px;background:#F6F5F1;color:#14161F;
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
@media (prefers-reduced-motion:reduce){.spin,.artwork.loading{animation-duration:2.4s}}
h3{margin:0 0 4px;font-size:16px;font-weight:700}
p{margin:0 0 10px;color:#3A4050}
.bar{height:4px;border-radius:2px;background:#DAD8CF;overflow:hidden;margin:6px 0 12px}.bar i{display:block;height:100%;background:#0F8F83;transition:width .3s}
.row{display:flex;gap:12px}
.artwork{position:relative;margin:0 0 12px;overflow:hidden;border-radius:10px;background:#E6E4DC}
.artwork[hidden]{display:none}
.artwork.loading{display:grid;place-items:center;background:linear-gradient(110deg,#E6E4DC 20%,#F0EEE8 38%,#E6E4DC 56%);background-size:200% 100%;animation:artwork-load 1.4s ease-in-out infinite}
.artwork.hero.loading{aspect-ratio:16/9}
.artwork.loading figcaption{background:transparent}
@keyframes artwork-load{to{background-position-x:-200%}}
.artwork img{display:block;width:100%;height:auto;object-fit:cover}
.artwork img[hidden]{display:none}
.artwork.hero img{aspect-ratio:16/9}
.artwork.poster-art{width:104px;flex:none}
.artwork.poster-art img{aspect-ratio:2/3}
.artwork.scene-art img{aspect-ratio:16/9}
.artwork figcaption{padding:5px 8px;font-size:11px;color:#5A6070;background:#F6F5F1}
.music-cover{width:100%;max-width:250px;margin:0 auto 14px;box-shadow:0 6px 18px rgba(20,22,31,.18)}
.music-cover img{aspect-ratio:1/1}
.music-fallback{width:100%;max-width:250px;aspect-ratio:1/1;margin:0 auto 14px;border-radius:10px;
  display:grid;place-items:center;gap:12px;padding:20px;text-align:center;color:#EDEBE4;
  background:radial-gradient(circle at 75% 22%,rgba(56,225,198,.34),transparent 34%),linear-gradient(145deg,#222637,#10121A)}
.music-fallback[hidden]{display:none}
.record{width:112px;height:112px;border-radius:50%;display:grid;place-items:center;
  background:repeating-radial-gradient(circle,#171923 0 3px,#292C38 4px 5px);box-shadow:0 5px 16px #0b0c11}
.record:after{content:"";width:20px;height:20px;border-radius:50%;background:#38E1C6;box-shadow:inset 0 0 0 6px #F6F5F1}
.confidence{display:inline-block;padding:3px 9px;border-radius:12px;font-size:12px;font-weight:650;margin:2px 0 8px}
.confidence.medium{background:#F6E7B8;color:#6B4E00}
.confidence.low{background:#EBD0CC;color:#7A2A20}
.music-title{font-size:20px}
.poster{flex:none;width:84px;height:126px;border-radius:8px;object-fit:cover}
.meta{font-size:12px;color:#5A6070;margin:2px 0 8px}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:650;margin-bottom:6px}
.high{background:#CDEFE7;color:#0B5F56}.possible{background:#F6E7B8;color:#6B4E00}.low{background:#EBD0CC;color:#7A2A20}
.ov{font-size:13px;color:#3A4050;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;margin:0 0 8px}
.evidence{font-size:12px;color:#3A4050;margin:8px 0}.evidence b{display:block;margin-bottom:3px}.evidence ul{margin:0;padding-left:18px}
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
    const w = Math.min(380, window.innerWidth - 16);
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

  function isTmdbImageUrl(value) {
    if (typeof value !== 'string') return false;
    try {
      const url = new URL(value);
      return url.origin === 'https://image.tmdb.org'
        && /^\/t\/p\/(?:w\d{2,4}|original)\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(url.pathname)
        && !url.search && !url.hash;
    } catch {
      return false;
    }
  }

  function artworkSources(match, sceneFrame) {
    const sources = [];
    if (isTmdbImageUrl(match?.backdrop)) {
      sources.push({ url: match.backdrop, label: 'Official TMDB backdrop', kind: 'backdrop' });
    }
    if (isTmdbImageUrl(match?.poster)) {
      sources.push({ url: match.poster, label: 'Official TMDB poster', kind: 'poster' });
    }
    if (typeof sceneFrame?.dataUrl === 'string'
        && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(sceneFrame.dataUrl)) {
      sources.push({ dataUrl: sceneFrame.dataUrl, label: 'Scene analyzed', kind: 'scene' });
    }
    return sources;
  }

  function musicArtworkSource(track) {
    if (track?.artworkProvider !== 'iTunes' || typeof track.artworkUrl !== 'string') return [];
    try {
      const url = new URL(track.artworkUrl);
      if (url.protocol !== 'https:'
          || !/^[a-z0-9-]+\.mzstatic\.com$/i.test(url.hostname)
          || !/^\/image\/thumb\/[A-Za-z0-9_./-]+\.(?:jpe?g|png|webp)$/i.test(url.pathname)
          || url.search || url.hash) return [];
      const label = track.artworkType === 'single' ? 'Official single artwork'
        : track.artworkType === 'alternative_release' ? 'Verified alternative release artwork'
          : 'Official album artwork';
      return [{ url: url.toString(), label, kind: 'music' }];
    } catch {
      return [];
    }
  }

  function artworkFigure(label, className) {
    const image = h('img', { alt: label, loading: 'lazy', decoding: 'async', hidden: '' });
    const caption = h('figcaption', { text: label });
    const element = h('figure', { class: 'artwork ' + className, hidden: '', 'aria-busy': 'true' }, image, caption);
    return { element, image, caption };
  }

  async function loadArtwork(figure, sources, loadImage) {
    for (const source of sources) {
      try {
        figure.element.hidden = false;
        figure.element.classList.add('loading');
        figure.caption.textContent = `Loading ${source.label.toLowerCase()}…`;
        const url = source.dataUrl || await loadImage(source.url);
        if (!url) continue;
        const loaded = await new Promise((resolve) => {
          figure.image.onload = () => resolve(true);
          figure.image.onerror = () => resolve(false);
          figure.image.src = url;
        });
        if (!loaded) continue;
        figure.caption.textContent = source.label;
        figure.image.alt = source.label;
        figure.image.hidden = false;
        figure.element.hidden = false;
        figure.element.setAttribute('aria-busy', 'false');
        figure.element.classList.remove('loading');
        return source.kind;
      } catch {
        // A missing catalog image should fall through to the next verified source.
      }
    }
    figure.element.remove();
    return null;
  }

  function showMovie(matches, loadImage, { onRetry, onAnalyzeMore, status, sceneFrame, metadataUnavailable, message }) {
    const top = matches[0];
    const ambiguousStrongMatch = status === 'possible_match' && top.matchLevel === 'high';
    const multipleProductions = matches.length > 1;
    const hero = artworkFigure('Official TMDB artwork', 'hero');
    const poster = artworkFigure('Official poster', 'poster-art');
    const scene = artworkFigure('Scene analyzed', 'scene-art');
    const kind = top.mediaType === 'tv' ? 'TV show' : 'Movie';
    const meta = [kind, top.releaseYear, top.runtime ? top.runtime + ' min' : null, top.rating ? '★ ' + top.rating : null].filter(Boolean).join(', ');
    const catalogQuality = {
      exact_title_and_year: 'exact title and year',
      exact_title_year_close: 'exact title, close year',
      exact_title_year_unknown: 'exact title, year unknown',
      partial_title: 'similar title only',
    }[top.catalogMatchQuality];
    const evidenceLabel = top.evidenceQuality === 'multiple_clues' ? 'multiple visual clues' : 'limited visual clues';
    const parts = [
      hero.element,
      poster.element,
      scene.element,
      h('div', { class: 'row' }, h('div', {},
        h('span', {
          class: 'badge ' + (ambiguousStrongMatch ? 'possible' : top.matchLevel),
          text: ambiguousStrongMatch ? 'Possible match (ambiguous)' : LEVEL[top.matchLevel] || 'Possible match',
        }),
        h('h3', { text: top.title }), h('div', { class: 'meta', text: meta }),
        top.genres?.length ? h('div', { class: 'meta', text: top.genres.slice(0, 3).join(', ') }) : null)),
      h('div', { class: 'meta', text: [
        top.modelConfidence ? 'Model confidence: ' + top.modelConfidence : null,
        catalogQuality ? 'Catalog check: ' + catalogQuality : null,
        'Visual evidence: ' + evidenceLabel,
      ].filter(Boolean).join(' · ') }),
      top.timestamps?.length ? h('div', { class: 'meta', text: 'Seen at: ' + top.timestamps.map((time) => `${Number(time).toFixed(1)}s`).join(', ') }) : null,
      metadataUnavailable ? h('p', { class: 'ov', text: 'TMDB metadata is temporarily unavailable. This AI identification has not been catalog-verified.' }) : null,
      multipleProductions ? h('p', { class: 'ov', text: message || 'Multiple possible productions detected in this video.' }) : null,
      top.overview ? h('p', { class: 'ov', text: top.overview }) : null,
      top.director?.length ? h('div', { class: 'meta', text: (top.mediaType === 'tv' ? 'Created by ' : 'Directed by ') + top.director.join(', ') }) : null,
      top.cast?.length ? h('div', { class: 'meta', text: 'Cast: ' + top.cast.slice(0, 4).join(', ') }) : null,
      top.sceneDescription ? h('p', { class: 'ov', text: top.sceneDescription }) : null,
      top.evidence?.length ? h('div', { class: 'evidence' }, h('b', { text: 'Visual clues' }),
        h('ul', {}, top.evidence.map((entry) => h('li', { text: entry })))) : null,
      top.actorsOrCharacters?.length ? h('div', { class: 'meta', text: 'Possible actors or characters: ' + top.actorsOrCharacters.join(', ') }) : null,
    ];
    if (matches.length > 1) {
      parts.push(h('div', { class: 'sec', text: 'Also possible' }));
      matches.slice(1).forEach((m) => {
        const alt = artworkFigure('Official poster', 'poster-art');
        loadArtwork(alt, artworkSources(m), loadImage);
        parts.push(h('div', { class: 'alt' }, alt.element, h('div', {}, h('b', { text: m.title }),
          h('span', { text: [m.mediaType === 'tv' ? 'TV show' : 'Movie', m.releaseYear, LEVEL[m.matchLevel]].filter(Boolean).join(', ') }),
          m.timestamps?.length ? h('div', { class: 'meta', text: 'Seen at: ' + m.timestamps.map((time) => `${Number(time).toFixed(1)}s`).join(', ') }) : null,
          m.tmdbUrl ? h('div', {}, h('a', { class: 'meta', href: m.tmdbUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Details' })) : null)));
      });
    }
    if (onAnalyzeMore) {
      parts.push(h('p', { text: 'This is a possible match. More visual evidence may improve confidence.' }));
    }
    parts.push(h('div', { class: 'actions' },
      top.tmdbUrl ? h('a', { class: 'a p', href: top.tmdbUrl, target: '_blank', rel: 'noopener noreferrer', text: 'View on TMDB' }) : null,
      onAnalyzeMore ? h('button', { class: 'a', text: 'Analyze more of this video', onclick: onAnalyzeMore }) : null,
      h('button', { class: 'a', text: 'Try again', onclick: onRetry })));
    open(h('div', {}, header(multipleProductions ? 'Multiple possible productions' : status === 'possible_match' ? 'Possible match' : 'Identification result'), h('div', { class: 'body' }, parts)));
    const heroSources = artworkSources(top, sceneFrame);
    loadArtwork(hero, heroSources, loadImage).then((kind) => {
      if (kind === 'backdrop' && isTmdbImageUrl(top.poster)) {
        loadArtwork(poster, artworkSources({ poster: top.poster }), loadImage);
      } else {
        poster.element.remove();
      }
      if (sceneFrame?.dataUrl && kind !== 'scene') {
        const sceneSources = artworkSources({}, sceneFrame).map((source) => ({
          ...source,
          label: `Scene analyzed${Number.isFinite(sceneFrame.timestamp) ? ` · ${sceneFrame.timestamp.toFixed(1)}s` : ''}`,
        }));
        loadArtwork(scene, sceneSources, loadImage);
      } else {
        scene.element.remove();
      }
    });
  }

  function showMusic(track, loadImage, { onRetry }) {
    const cover = artworkFigure('Official album artwork', 'music-cover');
    const fallback = h('div', { class: 'music-fallback', hidden: '' },
      h('div', { class: 'record', 'aria-hidden': 'true' }),
      h('span', { text: 'No verified artwork available' }));
    const confidenceLabels = { high: 'High ACRCloud match', medium: 'Medium ACRCloud match', low: 'Low ACRCloud match' };
    const confidence = track.confidence && confidenceLabels[track.confidence]
      ? h('span', { class: 'confidence ' + track.confidence, text: confidenceLabels[track.confidence] })
      : h('span', { class: 'meta', text: 'ACRCloud match confidence unavailable' });
    const meta = [
      track.artists?.length ? track.artists.join(', ') : 'Artist unavailable',
      track.album,
      track.releaseDate?.slice(0, 4),
      track.genre,
      track.label,
      track.durationMs ? `${Math.round(track.durationMs / 1000 / 60)} min` : null,
      track.isrc ? `ISRC ${track.isrc}` : null,
    ].filter(Boolean);
    const content = h('div', { class: 'body' },
      cover.element,
      fallback,
      confidence,
      h('h3', { class: 'music-title', text: track.title || 'Unknown track' }),
      ...meta.map((value, index) => h('div', { class: 'meta', text: index === 0 ? value : value })),
      h('div', { class: 'actions' },
        ...(track.links || []).map((link, index) => h('a', {
          class: 'a' + (index === 0 ? ' p' : ''),
          href: link.url,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: 'Open in ' + link.label,
        })),
        h('button', { class: 'a', text: 'Try again', onclick: onRetry })));
    open(h('div', {}, header('Music identified'), content));
    const sources = musicArtworkSource(track);
    if (sources.length) {
      loadArtwork(cover, sources, loadImage).then((kind) => {
        if (!kind) {
          cover.element.remove();
          fallback.hidden = false;
        }
      });
    } else {
      cover.element.remove();
      fallback.hidden = false;
    }
  }

  MedDet.ui = {
    mount, setButton, closeAll, showProgress, showMessage, showMovie, showMusic,
    isOpen: () => cardOpen,
    onPick: (cb) => (pickCb = cb),
    onClose: (cb) => (onCloseCb = cb),
    hideForCapture: (on) => { if (host) host.style.visibility = on ? 'hidden' : 'visible'; },
    reopenMenu: () => { closeAll(); toggleMenu(); },
    artworkSources,
    musicArtworkSource,
    loadArtwork,
  };
})();
