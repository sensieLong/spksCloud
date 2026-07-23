(function(){
  const stage = document.getElementById('stage');
  const badgeLayer = document.getElementById('badgeLayer');
  const emptyState = document.getElementById('emptyState');
  const countLabel = document.getElementById('countLabel');
  const stageCaption = document.getElementById('stageCaption');
  const overlay = document.getElementById('overlay');
  const urlInput = document.getElementById('urlInput');
  const iconInput = document.getElementById('iconInput');
  const iconFile = document.getElementById('iconFile');
  const iconPreview = document.getElementById('iconPreview');
  const uploadFilename = document.getElementById('uploadFilename');
  const uploadClear = document.getElementById('uploadClear');
  const errorMsg = document.getElementById('errorMsg');
  const addBtn = document.getElementById('addBtn');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  const cancelBtn = document.getElementById('cancelBtn');
  const submitBtn = document.getElementById('submitBtn');

  const STORAGE_KEY = 'dock-apps';
  let apps = []; // {id, url, key, domain, name, iconCandidates, color, initial, r}
  let uploadedIcon = null; // data URL of a user-uploaded icon, if any, for the app currently being added

  function hashStr(s){
    let h = 0;
    for (let i=0;i<s.length;i++){ h = (Math.imul(31,h) + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }
  function radiusFor(key){
    return 34 + (hashStr(key) % 20); // 34–54px
  }
  const PALETTE = ['#ff2bd6','#05f2f2','#9b30ff','#ff6b6b','#00c2ff','#7cff5c','#ffb020','#ff5ca8'];
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

  // Turns a config-file entry into a fully-formed app object. Accepts either
  // a minimal hand-written entry (just a "url", optionally "name"/"icon")
  // or a complete previously-exported entry — anything missing gets filled
  // in the same way a manually-added app would be.
  function normalizeAppEntry(raw){
    if (!raw || !raw.url) return null;
    const parsed = normalizeUrl(raw.url);
    if (!parsed) return null;
    const key = raw.key || keyFor(parsed);
    const name = raw.name || niceName(parsed);
    return {
      id: raw.id || (key + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)),
      url: raw.url,
      key,
      domain: raw.domain || parsed.hostname,
      name,
      iconCandidates: raw.iconCandidates || (raw.icon ? [raw.icon] : faviconCandidates(parsed)),
      color: raw.color || colorFor(key),
      initial: raw.initial || name.charAt(0).toUpperCase(),
      r: raw.r || radiusFor(key),
    };
  }

  // Resize an uploaded image down to a small square PNG before storing it,
  // so a full-resolution photo doesn't blow through localStorage's ~5–10MB
  // quota after a handful of uploads. Output lands around 5–20KB regardless
  // of the original file size.
  function resizeImageFile(file, maxSize = 128){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = maxSize;
          canvas.height = maxSize;
          const ctx = canvas.getContext('2d');
          const scale = Math.min(maxSize / img.width, maxSize / img.height, 1) || 1;
          const w = img.width * scale, h = img.height * scale;
          ctx.clearRect(0, 0, maxSize, maxSize);
          ctx.drawImage(img, (maxSize - w) / 2, (maxSize - h) / 2, w, h);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('That file isn\'t a readable image'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('Could not read that file'));
      reader.readAsDataURL(file);
    });
  }

  const CONFIG_FILE = './spksConfig.json';

  // On a brand-new device/browser (no dock-apps in localStorage yet), pull
  // the repo's spksConfig.json so the dock shows up pre-populated before
  // the person adds anything themselves. Once localStorage has data, this
  // is never consulted again — local edits always win from then on.
  async function loadDefaultConfig(){
    try{
      const res = await fetch(CONFIG_FILE, {cache: 'no-store'});
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];
      const seen = new Set();
      const out = [];
      data.forEach(raw => {
        const app = normalizeAppEntry(raw);
        if (app && !seen.has(app.key)){ seen.add(app.key); out.push(app); }
      });
      return out;
    } catch(e){
      // Missing file, bad JSON, or (if opened via file:// instead of a real
      // server/GitHub Pages) a blocked local fetch — fail quietly to an
      // empty dock rather than breaking the page.
      return [];
    }
  }

  async function loadApps(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw){
        apps = JSON.parse(raw);
      } else {
        apps = await loadDefaultConfig();
        if (apps.length) saveApps();
      }
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

  // ---- Export / Import (carry your dock between devices) ----
  function exportApps(){
    // Strip transient layout coordinates before exporting — only the
    // durable app data should travel between devices.
    const clean = apps.map(({_x, _y, ...rest}) => rest);
    const blob = new Blob([JSON.stringify(clean, null, 2)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dock-apps-backup.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  function importApps(file){
    const reader = new FileReader();
    reader.onload = () => {
      let incoming;
      try{ incoming = JSON.parse(reader.result); }
      catch(e){ alert('That file isn\'t valid dock export JSON.'); return; }
      if (!Array.isArray(incoming)){ alert('That file isn\'t a valid dock export.'); return; }

      const existingKeys = new Set(apps.map(a => a.key));
      let added = 0;
      incoming.forEach(a => {
        if (a && a.key && !existingKeys.has(a.key)){
          apps.push(a);
          existingKeys.add(a.key);
          added++;
        }
      });
      saveApps();
      render();
      alert(added
        ? `Imported ${added} app${added === 1 ? '' : 's'}.`
        : 'Nothing new to import — those apps are already docked.');
    };
    reader.onerror = () => alert('Could not read that file.');
    reader.readAsText(file);
  }

  exportBtn.addEventListener('click', exportApps);
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => {
    const file = importFile.files && importFile.files[0];
    if (file) importApps(file);
    importFile.value = '';
  });

  let ro;
  function watchResize(){
    if (ro) return;
    ro = new ResizeObserver(() => render());
    ro.observe(stage);
  }

  // ---- Modal wiring ----
  function resetUpload(){
    uploadedIcon = null;
    iconFile.value = '';
    iconPreview.src = '';
    iconPreview.classList.remove('show');
    uploadFilename.textContent = 'No file selected';
    uploadClear.classList.remove('show');
  }
  iconFile.addEventListener('change', async () => {
    const file = iconFile.files && iconFile.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')){
      errorMsg.textContent = 'Please choose an image file';
      resetUpload();
      return;
    }
    if (file.size > 8 * 1024 * 1024){
      errorMsg.textContent = 'That image is too large — please pick one under 8MB';
      resetUpload();
      return;
    }
    try{
      errorMsg.textContent = '';
      uploadedIcon = await resizeImageFile(file);
      iconPreview.src = uploadedIcon;
      iconPreview.classList.add('show');
      uploadFilename.textContent = file.name;
      uploadClear.classList.add('show');
    } catch(e){
      errorMsg.textContent = e.message || 'Could not process that image';
      resetUpload();
    }
  });
  uploadClear.addEventListener('click', resetUpload);

  function openModal(){
    overlay.classList.add('open');
    errorMsg.textContent = '';
    urlInput.value = '';
    iconInput.value = '';
    resetUpload();
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
      iconCandidates: uploadedIcon ? [uploadedIcon] : (customIcon ? [customIcon] : faviconCandidates(parsed)),
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
