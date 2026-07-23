(function(){
  const stage = document.getElementById('stage');
  const badgeLayer = document.getElementById('badgeLayer');
  const emptyState = document.getElementById('emptyState');
  const countLabel = document.getElementById('countLabel');
  const stageCaption = document.getElementById('stageCaption');
  const overlay = document.getElementById('overlay');
  const urlInput = document.getElementById('urlInput');
  const iconInput = document.getElementById('iconInput');
  const errorMsg = document.getElementById('errorMsg');
  const addBtn = document.getElementById('addBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const submitBtn = document.getElementById('submitBtn');

  const STORAGE_KEY = 'dock-apps';
  let apps = []; // {id, url, key, domain, name, faviconUrl, r}

  function hashStr(s){
    let h = 0;
    for (let i=0;i<s.length;i++){ h = (Math.imul(31,h) + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }
  function radiusFor(key){
    return 34 + (hashStr(key) % 20); // 34–54px
  }
  const PALETTE = ['#c9a05a','#4fa8a0','#7d6bb0','#c76b6b','#6b9bc7','#8fae67','#b8865b','#5f8f8a'];
  function colorFor(key){
    return PALETTE[hashStr(key) % PALETTE.length];
  }
  // Several sites (a lot of GitHub Pages projects among them) don't ship a
  // real favicon, or Google's lookup can't resolve one for a project-path
  // URL. Rather than one lookup, try a small chain of candidates in order:
  // 1) the site's own favicon.ico at that exact path
  // 2) Google's favicon service for the exact page URL
  // 3) Google's favicon service for the bare domain
  // If every candidate fails to load, the badge falls back to a coloured
  // letter avatar so the app is still distinguishable at a glance.
  function faviconCandidates(u){
    const path = u.pathname.endsWith('/') ? u.pathname : u.pathname + '/';
    return [
      `${u.origin}${path}favicon.ico`,
      `https://www.google.com/s2/favicons?sz=128&url=${encodeURIComponent(u.href)}`,
      `https://www.google.com/s2/favicons?sz=128&domain=${u.hostname}`,
    ];
  }
  // Two apps only count as "the same" if they share the full origin+path,
  // so multiple GitHub Pages projects under one username.github.io domain
  // are treated as distinct apps.
  function keyFor(u){
    return u.origin + u.pathname.replace(/\/+$/, '');
  }
  function niceName(u){
    const host = u.hostname;
    const segments = u.pathname.split('/').filter(Boolean);
    // GitHub/GitLab Pages: prefer the project name from the path over the
    // shared "username.github.io" host, since that's what actually
    // distinguishes one docked app from another.
    if ((host.endsWith('.github.io') || host.endsWith('.gitlab.io')) && segments.length){
      const proj = segments[0];
      return proj.charAt(0).toUpperCase() + proj.slice(1);
    }
    const base = host.split('.').slice(0, -1).join('.') || host;
    const core = base.includes('.') ? base.split('.').pop() : base;
    return core.charAt(0).toUpperCase() + core.slice(1);
  }
  function normalizeUrl(raw){
    let v = raw.trim();
    if (!v) return null;
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try{
      const u = new URL(v);
      if (!u.hostname.includes('.')) return null;
      return u;
    } catch(e){ return null; }
  }

  // Plain localStorage so the dock survives page refreshes, browser
  // restarts, and even a full computer restart — it's tied to this file's
  // origin in the browser, not to a session.
  function loadApps(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      apps = raw ? JSON.parse(raw) : [];
    } catch(e){ apps = []; }
    render();
  }
  function saveApps(){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(apps)); }
    catch(e){ console.error('Could not save dock', e); }
  }

  function layout(){
    const w = stage.clientWidth, h = stage.clientHeight;
    const cx = w/2, cy = h/2;
    const pad = 10;
    if (!apps.length) return;

    const nodes = apps.map(a => ({
      ...a,
      x: a._x ?? cx + (Math.random()-0.5)*40,
      y: a._y ?? cy + (Math.random()-0.5)*40,
    }));

    const sim = d3.forceSimulation(nodes)
      .force('collide', d3.forceCollide(d => d.r + pad).iterations(4))
      .force('x', d3.forceX(cx).strength(0.045))
      .force('y', d3.forceY(cy).strength(0.045))
      .stop();

    for (let i=0;i<260;i++){
      sim.tick();
      nodes.forEach(n => {
        n.x = Math.max(n.r+pad, Math.min(w-n.r-pad, n.x));
        n.y = Math.max(n.r+pad, Math.min(h-n.r-pad, n.y));
      });
    }

    nodes.forEach(n => {
      n._x = n.x; n._y = n.y;
      const app = apps.find(a => a.id === n.id);
      if (app){ app._x = n.x; app._y = n.y; }
    });

    return nodes;
  }

  function render(){
    emptyState.style.display = apps.length ? 'none' : 'flex';
    countLabel.textContent = apps.length === 1 ? '1 app docked' : `${apps.length} apps docked`;
    stageCaption.innerHTML = apps.length
      ? `click a badge to launch it in its own window`
      : '';

    const nodes = layout() || [];
    const existingIds = new Set(nodes.map(n => n.id));

    // remove badges no longer present
    [...badgeLayer.children].forEach(el => {
      if (!existingIds.has(el.dataset.id)) el.remove();
    });

    nodes.forEach(n => {
      let el = badgeLayer.querySelector(`[data-id="${n.id}"]`);
      const isNew = !el;
      if (isNew){
        // Back-compat: apps saved before the fallback-chain existed only
        // have a single `faviconUrl`. Wrap it in a candidate list so old
        // dock data keeps working.
        const candidates = n.iconCandidates || (n.faviconUrl ? [n.faviconUrl] : []);
        const color = n.color || colorFor(n.key || n.domain || n.id);
        const initial = n.initial || (n.name ? n.name.charAt(0).toUpperCase() : '?');

        el = document.createElement('button');
        el.className = 'badge';
        el.dataset.id = n.id;
        el.innerHTML = `
          <span class="badge-rivet"></span>
          <img alt="" loading="lazy">
          <span class="badge-fallback" style="background:${color}">${initial}</span>
          <span class="badge-tooltip">${n.name}</span>
          <span class="badge-remove" title="Remove">✕</span>
        `;

        const img = el.querySelector('img');
        const fallback = el.querySelector('.badge-fallback');
        let candidateIndex = 0;
        function tryNextCandidate(){
          if (candidateIndex >= candidates.length){
            img.style.display = 'none';
            fallback.classList.add('show');
            return;
          }
          img.src = candidates[candidateIndex];
          candidateIndex++;
        }
        img.addEventListener('error', tryNextCandidate);
        img.addEventListener('load', () => {
          // Some services return a tiny 16px generic globe icon instead of
          // a real favicon when nothing better is found — that's not a
          // load error, so catch it here and fall through to the next
          // candidate (or the letter avatar) instead of showing it.
          if (img.naturalWidth && img.naturalWidth <= 16 && candidateIndex < candidates.length){
            tryNextCandidate();
          }
        });
        tryNextCandidate();

        el.addEventListener('click', (e) => {
          if (e.target.classList.contains('badge-remove')){
            e.stopPropagation();
            removeApp(n.id);
            return;
          }
          window.open(n.url, '_blank', 'noopener,noreferrer,width=1280,height=860');
        });
        badgeLayer.appendChild(el);
      }
      el.style.width = (n.r*2) + 'px';
      el.style.height = (n.r*2) + 'px';
      el.style.left = n.x + 'px';
      el.style.top = n.y + 'px';
      if (isNew){
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('settled')));
      } else {
        el.classList.add('settled');
      }
    });
  }

  function removeApp(id){
    apps = apps.filter(a => a.id !== id);
    saveApps();
    render();
  }

  let ro;
  function watchResize(){
    if (ro) return;
    ro = new ResizeObserver(() => render());
    ro.observe(stage);
  }

  // ---- Modal wiring ----
  function openModal(){
    overlay.classList.add('open');
    errorMsg.textContent = '';
    urlInput.value = '';
    iconInput.value = '';
    setTimeout(() => urlInput.focus(), 50);
  }
  function closeModal(){ overlay.classList.remove('open'); }

  addBtn.addEventListener('click', openModal);
  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal(); });

  function submitUrl(){
    const parsed = normalizeUrl(urlInput.value);
    if (!parsed){
      errorMsg.textContent = 'Enter a valid website address, like example.com';
      return;
    }
    const key = keyFor(parsed);
    if (apps.some(a => a.key === key)){
      errorMsg.textContent = 'That app is already on the dock';
      return;
    }
    const customIcon = iconInput.value.trim();
    const name = niceName(parsed);
    const app = {
      id: key + '-' + Date.now(),
      url: parsed.href,
      key,
      domain: parsed.hostname,
      name,
      iconCandidates: customIcon ? [customIcon] : faviconCandidates(parsed),
      color: colorFor(key),
      initial: name.charAt(0).toUpperCase(),
      r: radiusFor(key),
    };
    apps.push(app);
    saveApps();
    render();
    closeModal();
  }
  submitBtn.addEventListener('click', submitUrl);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitUrl(); });
  iconInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitUrl(); });

  watchResize();
  loadApps();
})();
