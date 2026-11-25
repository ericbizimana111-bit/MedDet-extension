// Detects which supported site we are on. Each site can get its own tuning here
// without touching the rest of the code, so one site changing its layout cannot break the others.
(function () {
  const h = location.hostname;
  const name = /(^|\.)youtube\.com$/.test(h) ? 'youtube'
    : /(^|\.)instagram\.com$/.test(h) ? 'instagram'
    : /(^|\.)tiktok\.com$/.test(h) ? 'tiktok'
    : /(^|\.)facebook\.com$/.test(h) ? 'facebook' : 'other';

  // Where the button sits inside the playing video (px from the video's top-right corner).
  const OFFSETS = {
    youtube:   { top: 12, right: 12 },
    instagram: { top: 12, right: 12 },
    tiktok:    { top: 12, right: 12 },
    facebook:  { top: 12, right: 12 },
    other:     { top: 12, right: 12 },
  };

  globalThis.MedDet = globalThis.MedDet || {};
  MedDet.platform = { name, offset: OFFSETS[name] };
})();
