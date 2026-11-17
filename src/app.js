/* ComfyUI 参数查看器 · UI */
(function () {
  'use strict';

  var CM = window.ComfyMeta;
  if (!CM) {
    document.body.innerHTML = '<div style="padding:40px;color:#f88;font:14px sans-serif">解析核心未加载。</div>';
    return;
  }

  var EXT_SET = { png: 1, jpg: 1, jpeg: 1, jpe: 1, webp: 1, gif: 1, avif: 1, mp4: 1, m4v: 1, mov: 1, webm: 1, mkv: 1, json: 1 };
  var IMAGE_EXT = { png: 1, jpg: 1, jpeg: 1, jpe: 1, webp: 1, gif: 1, avif: 1 };
  var VIDEO_EXT = { mp4: 1, m4v: 1, mov: 1, webm: 1, mkv: 1 };

  var state = {
    files: [], selected: -1, tab: 'overview', rawTab: 'prompt',
    nodeSearch: '', nodeCategory: 'all', expandAll: false,
    fileQuery: '', dragDepth: 0, pending: new Set(), busy: false, nextId: 1
  };

  var els = {};
  var toastTimer = 0;

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function svgIcon(paths, size) {
    var s = size || 16;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }

  var ICON = {
    copy: svgIcon('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', 14),
    download: svgIcon('<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>', 14),
    alert: svgIcon('<path d="M12 3 2.7 20a1 1 0 0 0 .9 1.5h16.8a1 1 0 0 0 .9-1.5L12 3z"/><path d="M12 9v5"/><path d="M12 18h.01"/>', 16),
    image: svgIcon('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 3.5 3 2.5-2 5 4"/>', 30),
    json: svgIcon('<path d="M8 3H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2"/><path d="M16 3h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2"/>', 30),
    video: svgIcon('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>', 30),
    cube: svgIcon('<path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2z"/><path d="m4 6.5 8 4.5 8-4.5M12 11v9"/>', 14),
    refresh: svgIcon('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', 14),
    search: svgIcon('<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/>', 14)
  };

  function init() {
    ['fileInput', 'folderInput', 'fileList', 'fileCount', 'sideSearchWrap', 'fileFilter',
      'sideEmpty', 'welcome', 'welcomeDrop', 'detail', 'previewBox', 'fileInfo', 'fileName',
      'fileMeta', 'tabBody', 'tabs', 'tabNodeCount', 'btnFiles', 'btnFolder', 'btnExportAll',
      'btnHelp', 'btnClear', 'btnCopyMd', 'btnExport', 'btnWelcomeFiles', 'btnWelcomeFolder',
      'dropOverlay', 'toast', 'modal', 'btnCloseModal', 'scrollRail', 'scrollThumb'].forEach(function (id) { els[id] = $(id); });
    bind();
    bindScrollbar();
    renderFileList();
    updateExportAll();
    showWelcome();
  }

  function bind() {
    els.btnFiles.addEventListener('click', function () { els.fileInput.click(); });
    els.btnWelcomeFiles.addEventListener('click', function (e) { e.stopPropagation(); els.fileInput.click(); });
    els.btnFolder.addEventListener('click', function () { els.folderInput.click(); });
    els.btnWelcomeFolder.addEventListener('click', function (e) { e.stopPropagation(); els.folderInput.click(); });

    els.fileInput.addEventListener('change', function () {
      addFiles(els.fileInput.files);
      els.fileInput.value = '';
    });
    els.folderInput.addEventListener('change', function () {
      addFiles(els.folderInput.files);
      els.folderInput.value = '';
    });

    els.welcomeDrop.addEventListener('click', function () { els.fileInput.click(); });
    els.welcomeDrop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
    });

    els.fileList.addEventListener('click', function (e) {
      var item = e.target.closest('.file-item');
      if (!item) return;
      var idx = Number(item.dataset.index);
      if (e.target.closest('.file-remove')) { e.stopPropagation(); removeFile(idx); return; }
      selectIndex(idx);
    });

    els.fileFilter.addEventListener('input', function () {
      state.fileQuery = els.fileFilter.value.trim();
      renderFileList();
    });

    els.tabs.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (!b) return;
      setTab(b.dataset.tab);
    });

    els.btnExport.addEventListener('click', function () {
      var rec = current();
      if (!rec || !rec.report) return;
      downloadJson(exportObject(rec.report), safeBase(rec.name) + '-comfyui-params.json');
      toast('已导出参数 JSON', 'ok');
    });

    els.btnCopyMd.addEventListener('click', function () {
      var rec = current();
      if (!rec || !rec.report) return;
      copyText(buildMarkdown(rec.report), '已复制 Markdown 参数表');
    });

    els.btnExportAll.addEventListener('click', exportAll);

    els.btnClear.addEventListener('click', function () {
      if (!state.files.length) return;
      if (window.confirm('清空已载入的 ' + state.files.length + ' 个文件？')) clearAll();
    });

    els.btnHelp.addEventListener('click', openModal);
    els.btnCloseModal.addEventListener('click', closeModal);
    els.modal.addEventListener('click', function (e) { if (e.target === els.modal) closeModal(); });
    els.dropOverlay.addEventListener('click', function () { els.fileInput.click(); });

    // 三栏布局下，鼠标停在预览/标题/标签栏上时，把滚轮转给右侧内容区
    els.detail.addEventListener('wheel', function (e) {
      if (window.innerWidth <= 1080) return;
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      var tb = els.tabBody;
      if (!tb || tb.contains(e.target)) return;
      if (tb.scrollHeight <= tb.clientHeight) return;
      tb.scrollTop += e.deltaY;
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); els.fileInput.click(); }
      if (e.key === 'Escape') {
        if (!els.modal.hidden) closeModal();
        document.body.classList.remove('dragging');
        state.dragDepth = 0;
      }
    });

    var hasFiles = function (e) {
      var t = e.dataTransfer && e.dataTransfer.types;
      if (!t) return false;
      for (var i = 0; i < t.length; i++) if (t[i] === 'Files') return true;
      return false;
    };
    window.addEventListener('dragenter', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      state.dragDepth++;
      document.body.classList.add('dragging');
    });
    window.addEventListener('dragover', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', function (e) {
      if (!hasFiles(e)) return;
      state.dragDepth = Math.max(0, state.dragDepth - 1);
      if (!state.dragDepth) document.body.classList.remove('dragging');
    });
    window.addEventListener('drop', function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      state.dragDepth = 0;
      document.body.classList.remove('dragging');
      handleDrop(e.dataTransfer);
    });
  }

  function clampNum(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function updateScrollbar() {
    var rail = els.scrollRail;
    var thumb = els.scrollThumb;
    var body = els.tabBody;
    if (!rail || !thumb || !body) return;
    var sh = body.scrollHeight;
    var ch = body.clientHeight;
    if (!ch || sh <= ch + 2) { rail.hidden = true; return; }
    rail.hidden = false;
    var track = rail.clientHeight;
    if (!track) { rail.hidden = true; return; }
    var th = clampNum(Math.round(track * ch / sh), 24, track);
    thumb.style.height = th + 'px';
    var maxTop = Math.max(0, track - th);
    var maxScroll = Math.max(1, sh - ch);
    var top = clampNum(Math.round(body.scrollTop / maxScroll * maxTop), 0, maxTop);
    thumb.style.top = top + 'px';
  }

  function queueScrollbarUpdate() {
    if (window.requestAnimationFrame) requestAnimationFrame(updateScrollbar);
    else updateScrollbar();
  }

  function bindScrollbar() {
    var rail = els.scrollRail;
    var thumb = els.scrollThumb;
    var body = els.tabBody;
    if (!rail || !thumb || !body) return;

    body.addEventListener('scroll', updateScrollbar, { passive: true });
    body.addEventListener('click', function () { setTimeout(updateScrollbar, 30); }, true);
    window.addEventListener('resize', queueScrollbarUpdate);
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { queueScrollbarUpdate(); });
      ro.observe(body);
      ro.observe(rail);
    }

    thumb.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      var startY = e.clientY;
      var startTop = thumb.offsetTop;
      var maxTop = Math.max(0, rail.clientHeight - thumb.offsetHeight);
      var maxScroll = Math.max(0, body.scrollHeight - body.clientHeight);
      if (!maxTop || !maxScroll) return;
      function onMove(ev) {
        var top = clampNum(startTop + ev.clientY - startY, 0, maxTop);
        body.scrollTop = top / maxTop * maxScroll;
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });

    rail.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target === thumb) return;
      e.preventDefault();
      var rect = rail.getBoundingClientRect();
      var maxTop = Math.max(0, rail.clientHeight - thumb.offsetHeight);
      var maxScroll = Math.max(0, body.scrollHeight - body.clientHeight);
      if (!maxTop || !maxScroll) return;
      var y = e.clientY - rect.top - thumb.offsetHeight / 2;
      body.scrollTop = clampNum(y / maxTop, 0, 1) * maxScroll;
      updateScrollbar();
    });

    queueScrollbarUpdate();
  }

  // ---------------------------------------------------------------------------
  // 文件管理
  // ---------------------------------------------------------------------------

  function extOf(name) {
    var m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  function isSupported(file) {
    var ext = extOf(file.name);
    if (EXT_SET[ext]) return true;
    return /^image\//.test(file.type || '') || /^video\//.test(file.type || '');
  }

  function signature(file) {
    return [file.name, file.size, file.lastModified || 0].join('|');
  }

  function isImageRecord(rec) {
    return !!IMAGE_EXT[rec.ext] || (/^image\//.test(rec.type || '') && rec.ext !== 'json');
  }

  function isVideoRecord(rec) {
    return !!VIDEO_EXT[rec.ext] || /^video\//.test(rec.type || '');
  }

  async function addFiles(fileList) {
    var incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    var existing = new Set(state.files.map(function (r) { return signature(r.file); }));
    var accepted = [];
    var skipped = 0, dup = 0;
    for (var i = 0; i < incoming.length; i++) {
      var f = incoming[i];
      if (!isSupported(f)) { skipped++; continue; }
      if (existing.has(signature(f))) { dup++; continue; }
      existing.add(signature(f));
      accepted.push(f);
    }
    if (!accepted.length) {
      if (skipped) toast('没有可读取的图片 / 视频 / JSON 文件', 'err');
      else if (dup) toast('这些文件已经在列表里了');
      return;
    }

    var made = [];
    for (var j = 0; j < accepted.length; j++) {
      var file = accepted[j];
      var ext = extOf(file.name);
      var rec = {
        id: 'f' + (state.nextId++), file: file, name: file.name, size: file.size,
        type: file.type || '', ext: ext, url: null, report: null, error: null,
        status: 'pending', dim: null, video: null, promise: null
      };
      if (isImageRecord(rec) || isVideoRecord(rec)) {
        try { rec.url = URL.createObjectURL(file); } catch (e) {}
      }
      state.files.push(rec);
      made.push(rec);
    }

    var wasEmpty = state.selected < 0;
    renderFileList();
    updateExportAll();
    if (wasEmpty) selectIndex(state.files.length - made.length);
    else renderFileList();

    var msg = '已载入 ' + made.length + ' 个文件';
    if (skipped) msg += '，跳过 ' + skipped + ' 个不支持的文件';
    if (dup) msg += '，跳过 ' + dup + ' 个重复文件';
    toast(msg, 'ok');
  }

  async function handleDrop(dt) {
    var entries = [];
    try {
      for (var i = 0; i < dt.items.length; i++) {
        var entry = dt.items[i].webkitGetAsEntry && dt.items[i].webkitGetAsEntry();
        if (entry) entries.push(entry);
      }
    } catch (e) {}

    if (entries.length) {
      toast('正在读取文件夹…');
      var files = [];
      for (var e = 0; e < entries.length; e++) await walkEntry(entries[e], files, 0);
      if (files.length) await addFiles(files);
      else toast('文件夹里没有可读取的图片 / 视频 / JSON', 'err');
      return;
    }
    if (dt.files && dt.files.length) await addFiles(dt.files);
  }

  function walkEntry(entry, out, depth) {
    return new Promise(function (resolve) {
      if (!entry || depth > 12) return resolve();
      if (entry.isFile) {
        entry.file(function (f) {
          if (isSupported(f)) out.push(f);
          resolve();
        }, function () { resolve(); });
        return;
      }
      if (!entry.isDirectory) return resolve();
      var reader = entry.createReader();
      var all = [];
      var read = function () {
        reader.readEntries(function (batch) {
          if (!batch.length) {
            (async function () {
              for (var i = 0; i < all.length; i++) await walkEntry(all[i], out, depth + 1);
              resolve();
            })();
            return;
          }
          for (var i = 0; i < batch.length; i++) all.push(batch[i]);
          read();
        }, function () { resolve(); });
      };
      read();
    });
  }

  function current() { return state.selected >= 0 ? state.files[state.selected] : null; }

  function selectIndex(index) {
    if (index < 0 || index >= state.files.length) {
      state.selected = -1;
      renderFileList();
      showWelcome();
      return;
    }
    if (state.selected !== index) {
      state.nodeSearch = '';
      state.nodeCategory = 'all';
    }
    state.selected = index;
    var rec = state.files[index];
    renderFileList();
    els.welcome.hidden = true;
    els.detail.hidden = false;
    renderPreview(rec);
    renderHeader(rec);
    renderTabs(rec);
    if (!rec.report && rec.status !== 'parsing' && rec.status !== 'error') parseRecord(rec);
  }

  function removeFile(index) {
    var rec = state.files[index];
    if (!rec) return;
    if (rec.url) { try { URL.revokeObjectURL(rec.url); } catch (e) {} }
    state.files.splice(index, 1);
    if (!state.files.length) {
      state.selected = -1;
      showWelcome();
    } else if (state.selected === index) {
      state.selected = Math.min(index, state.files.length - 1);
      selectIndex(state.selected);
    } else if (state.selected > index) {
      state.selected--;
    }
    renderFileList();
    updateExportAll();
  }

  function clearAll() {
    for (var i = 0; i < state.files.length; i++) {
      if (state.files[i].url) { try { URL.revokeObjectURL(state.files[i].url); } catch (e) {} }
    }
    state.files = [];
    state.selected = -1;
    state.nodeSearch = '';
    state.nodeCategory = 'all';
    state.fileQuery = '';
    if (els.fileFilter) els.fileFilter.value = '';
    state.tab = 'overview';
    state.rawTab = 'prompt';
    renderFileList();
    updateExportAll();
    showWelcome();
    toast('列表已清空');
  }

  function showWelcome() {
    els.welcome.hidden = false;
    els.detail.hidden = true;
  }

  // ---------------------------------------------------------------------------
  // 解析
  // ---------------------------------------------------------------------------

  function parseRecord(rec) {
    if (rec.promise) return rec.promise;
    if (rec.report) return Promise.resolve(rec.report);
    rec.status = 'parsing';
    rec.error = null;
    renderFileList();
    var p = CM.parseFile(rec.file).then(function (report) {
      rec.report = report;
      rec.status = 'ready';
      rec.error = null;
      return report;
    }).catch(function (e) {
      rec.status = 'error';
      rec.error = (e && e.message) ? e.message : String(e);
      return null;
    }).finally(function () {
      rec.promise = null;
      state.pending.delete(p);
      var idx = state.files.indexOf(rec);
      if (idx < 0) return;
      renderFileList();
      if (state.selected === idx) {
        renderHeader(rec);
        renderTabs(rec);
      }
    });
    rec.promise = p;
    state.pending.add(p);
    return p;
  }

  async function whenIdle() {
    while (state.pending.size) await Promise.all(Array.from(state.pending));
  }

  // ---------------------------------------------------------------------------
  // 侧栏
  // ---------------------------------------------------------------------------

  function renderFileList() {
    var list = els.fileList;
    list.textContent = '';
    var q = state.fileQuery.toLowerCase();
    var shown = 0;
    for (var i = 0; i < state.files.length; i++) {
      var rec = state.files[i];
      if (q && rec.name.toLowerCase().indexOf(q) === -1) continue;
      shown++;
      list.appendChild(fileItem(rec, i));
    }

    els.fileCount.textContent = String(state.files.length);
    els.sideEmpty.hidden = state.files.length > 0;
    els.sideSearchWrap.hidden = state.files.length < 5 && !state.fileQuery;
    updateExportAll();

    if (!shown && state.files.length) {
      var li = el('li', 'side-empty');
      li.style.padding = '30px 10px';
      li.style.display = 'flex';
      li.appendChild(el('span', '', '没有匹配的文件'));
      list.appendChild(li);
    }
    var active = list.querySelector('.file-item.active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function fileItem(rec, index) {
    var li = el('li', 'file-item' + (index === state.selected ? ' active' : ''));
    li.dataset.index = String(index);
    li.title = rec.name;

    var thumb = el('div', 'file-thumb');
    if (rec.url && isImageRecord(rec)) {
      var img = document.createElement('img');
      img.src = rec.url;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = function () { img.remove(); thumb.textContent = (rec.ext || '?').toUpperCase(); };
      thumb.appendChild(img);
    } else if (isVideoRecord(rec)) {
      thumb.classList.add('video');
    } else if (rec.ext === 'json') {
      thumb.classList.add('json');
      thumb.textContent = '{ }';
    } else {
      thumb.textContent = (rec.ext || '?').toUpperCase().slice(0, 5);
    }
    if (rec.ext) thumb.appendChild(el('span', 'ext', rec.ext.toUpperCase().slice(0, 4)));
    li.appendChild(thumb);

    var text = el('div', 'file-text');
    text.appendChild(el('div', 'file-name', rec.name));
    var sub = el('div', 'file-sub');
    var nodes = rec.report ? rec.report.nodes.length : 0;
    if (rec.status === 'parsing') {
      sub.textContent = '解析中…';
      sub.classList.add('warn');
    } else if (rec.status === 'error') {
      sub.textContent = '读取失败';
      sub.classList.add('err');
    } else if (rec.report) {
      var hasMeta = rec.report.metadata.prompt || rec.report.metadata.workflow;
      sub.textContent = rec.report.container + ' · ' + (hasMeta ? nodes + ' 节点' : '无元数据');
      sub.classList.add(hasMeta ? 'ok' : 'warn');
    } else {
      sub.textContent = (rec.ext || '未知').toUpperCase();
    }
    text.appendChild(sub);
    li.appendChild(text);

    var rm = el('button', 'file-remove', '×');
    rm.type = 'button';
    rm.title = '移除';
    rm.setAttribute('aria-label', '移除 ' + rec.name);
    li.appendChild(rm);
    return li;
  }

  // ---------------------------------------------------------------------------
  // 预览 / 头部
  // ---------------------------------------------------------------------------

  function renderPreview(rec) {
    var box = els.previewBox;
    box.textContent = '';
    box.classList.remove('has-image');
    box.style.removeProperty('--preview-bg');
    if (rec.url && isImageRecord(rec)) {
      box.classList.add('has-image');
      box.style.setProperty('--preview-bg', 'url("' + rec.url + '")');
      var img = document.createElement('img');
      img.src = rec.url;
      img.alt = rec.name;
      img.title = '点击查看原图';
      img.onload = function () {
        rec.dim = { w: img.naturalWidth, h: img.naturalHeight };
        if (state.selected >= 0 && state.files[state.selected] === rec) renderFileInfo(rec);
      };
      img.onerror = function () {
        box.classList.remove('has-image');
        box.textContent = '';
        box.appendChild(previewIcon('image', '无法预览'));
      };
      img.onclick = function () {
        try { window.open(rec.url, '_blank', 'noopener'); } catch (e) {}
      };
      box.appendChild(img);
      return;
    }
    if (rec.url && isVideoRecord(rec)) {
      var video = document.createElement('video');
      video.src = rec.url;
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.onloadedmetadata = function () {
        rec.video = { w: video.videoWidth, h: video.videoHeight, duration: video.duration };
        if (state.selected >= 0 && state.files[state.selected] === rec) renderFileInfo(rec);
      };
      video.onerror = function () {
        box.textContent = '';
        box.appendChild(previewIcon('video', '无法预览'));
      };
      box.appendChild(video);
      return;
    }
    if (rec.ext === 'json') { box.appendChild(previewIcon('json', 'JSON')); return; }
    if (isVideoRecord(rec)) box.appendChild(previewIcon('video', 'VIDEO'));
    else if (isImageRecord(rec)) box.appendChild(previewIcon('image', 'IMAGE'));
    else box.appendChild(previewIcon('json', (rec.ext || '?').toUpperCase()));
  }

  function previewIcon(kind, label) {
    var wrap = el('div', 'preview-icon');
    wrap.innerHTML = (kind === 'json' ? ICON.json : kind === 'video' ? ICON.video : ICON.image) + '<span>' + label + '</span>';
    return wrap;
  }

  function renderHeader(rec) {
    els.fileName.textContent = rec.name;
    els.fileName.title = rec.name;
    var meta = els.fileMeta;
    meta.textContent = '';
    if (rec.report) {
      meta.appendChild(el('span', '', rec.report.container));
      meta.appendChild(el('span', 'dot'));
      meta.appendChild(el('span', '', CM.formatBytes(rec.size)));
      if (rec.report.nodes.length) {
        meta.appendChild(el('span', 'dot'));
        meta.appendChild(el('span', '', rec.report.nodes.length + ' 个节点'));
      }
      if (rec.report.metadata.prompt) meta.appendChild(badge('prompt', 'violet'));
      if (rec.report.metadata.workflow) meta.appendChild(badge('workflow', 'green'));
      if (!rec.report.metadata.prompt && !rec.report.metadata.workflow) meta.appendChild(badge('无元数据', 'amber'));
      if (rec.report.metadata.prompt && !rec.report.metadata.workflow) meta.appendChild(badge('仅 API', 'cyan'));
    } else if (rec.status === 'parsing') {
      meta.appendChild(el('span', '', '正在解析元数据…'));
    } else if (rec.status === 'error') {
      meta.appendChild(badge('读取失败', 'red'));
    } else {
      meta.appendChild(el('span', '', (rec.ext || '').toUpperCase()));
      meta.appendChild(el('span', 'dot'));
      meta.appendChild(el('span', '', CM.formatBytes(rec.size)));
    }
    els.btnExport.disabled = !rec.report;
    els.btnCopyMd.disabled = !rec.report;
    els.tabNodeCount.textContent = rec.report ? String(rec.report.nodes.length) : '0';
    renderFileInfo(rec);
  }

  function renderFileInfo(rec) {
    var box = els.fileInfo;
    box.textContent = '';
    var grid = el('div', 'info-grid');
    function item(k, v, mono) {
      var n = el('div', 'info-item');
      n.appendChild(el('div', 'info-k', k));
      var val = el('div', 'info-v', v || '—');
      if (mono === false) val.style.fontFamily = 'var(--sans)';
      n.appendChild(val);
      grid.appendChild(n);
    }
    item('格式', rec.report ? rec.report.container : (rec.ext || '未知').toUpperCase(), false);
    item('大小', CM.formatBytes(rec.size));
    if (rec.dim) item('图片尺寸', rec.dim.w + ' × ' + rec.dim.h);
    else if (rec.video && rec.video.w) item('视频尺寸', rec.video.w + ' × ' + rec.video.h);
    else if (rec.report && rec.report.extra && rec.report.extra.width) item('图片尺寸', rec.report.extra.width + ' × ' + rec.report.extra.height);
    else if (rec.report && rec.report.summary.latent && rec.report.summary.latent.width) item('生成尺寸', rec.report.summary.latent.width + ' × ' + rec.report.summary.latent.height);
    if (rec.video && isFinite(rec.video.duration)) item('时长', formatDuration(rec.video.duration));
    if (rec.report) {
      var p = !!rec.report.metadata.prompt, w = !!rec.report.metadata.workflow;
      item('元数据', p && w ? 'prompt + workflow' : p ? 'prompt' : w ? 'workflow' : '未找到', false);
    } else item('状态', rec.status === 'parsing' ? '解析中…' : '待解析', false);
    box.appendChild(grid);

    if (rec.report && rec.report.detection && rec.report.detection.length) {
      var badges = el('div', 'info-badges');
      rec.report.detection.forEach(function (d) {
        badges.appendChild(badge(d, d.indexOf('prompt') === 0 ? 'violet' : 'green'));
      });
      box.appendChild(badges);
    }
  }

  function formatDuration(sec) {
    if (!isFinite(sec)) return '—';
    var s = Math.max(0, sec);
    var m = Math.floor(s / 60);
    var r = s - m * 60;
    if (m >= 60) {
      var h = Math.floor(m / 60);
      m = m - h * 60;
      return h + ':' + String(m).padStart(2, '0') + ':' + String(Math.floor(r)).padStart(2, '0');
    }
    return m + ':' + r.toFixed(1).padStart(4, '0');
  }

  function badge(text, kind) { return el('span', 'badge' + (kind ? ' ' + kind : ''), text); }

  // ---------------------------------------------------------------------------
  // 标签页
  // ---------------------------------------------------------------------------

  function setTab(tab) {
    state.tab = tab;
    var rec = current();
    if (rec) {
      renderTabs(rec);
      if (els.tabBody) els.tabBody.scrollTop = 0;
    }
  }

  function renderTabs(rec) {
    var tabs = els.tabs.querySelectorAll('[data-tab]');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].dataset.tab === state.tab);
    els.tabNodeCount.textContent = rec.report ? String(rec.report.nodes.length) : '0';
    var body = els.tabBody;
    body.textContent = '';

    if (rec.status === 'error') { body.appendChild(renderError(rec)); queueScrollbarUpdate(); return; }
    if (!rec.report) { body.appendChild(renderSkeleton()); queueScrollbarUpdate(); return; }
    var report = rec.report;
    if (state.tab === 'overview') body.appendChild(renderOverview(report));
    else if (state.tab === 'nodes') body.appendChild(renderNodesTab(report));
    else if (state.tab === 'workflow') body.appendChild(renderWorkflowTab(report));
    else body.appendChild(renderRawTab(report, rec));
    queueScrollbarUpdate();
  }

  function renderSkeleton() {
    var wrap = el('div', 'parse-wait');
    for (var i = 0; i < 4; i++) wrap.appendChild(el('div', 'skeleton'));
    return wrap;
  }

  function renderError(rec) {
    var wrap = el('div', 'empty-state');
    var orb = el('div', 'empty-orb');
    orb.innerHTML = ICON.alert;
    wrap.appendChild(orb);
    wrap.appendChild(el('h3', '', '这个文件读取失败了'));
    wrap.appendChild(el('p', '', rec.error || '未知错误'));
    var btn = el('button', 'btn ghost', '重试');
    btn.type = 'button';
    btn.onclick = function () {
      rec.status = 'pending';
      rec.error = null;
      renderTabs(rec);
      parseRecord(rec);
    };
    wrap.appendChild(btn);
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // 概览
  // ---------------------------------------------------------------------------

  function renderOverview(report) {
    var wrap = el('div', 'overview');
    var s = report.summary;
    if (!report.metadata.prompt && !report.metadata.workflow) return renderNoMetadata(report);

    var source = el('div', 'source-line');
    source.appendChild(el('span', '', '已读取'));
    (report.detection || []).forEach(function (d) {
      source.appendChild(badge(d, d.indexOf('prompt') === 0 ? 'violet' : 'green'));
    });
    source.appendChild(el('span', '', '·'));
    source.appendChild(el('span', '', report.nodes.length + ' 个节点'));
    wrap.appendChild(source);

    if (s.positive) wrap.appendChild(promptCard('正向提示词', s.positive, s.positiveNodes));
    if (s.negative) {
      var neg = promptCard('负向提示词', s.negative, s.negativeNodes);
      neg.classList.add('negative');
      wrap.appendChild(neg);
    }

    if (s.modelName || s.loras.length || s.others.length) {
      wrap.appendChild(sectionTitle('模型'));
      var model = el('div', 'model-card');
      if (s.modelName) {
        var mrow = el('div', 'model-name');
        mrow.innerHTML = ICON.cube;
        mrow.appendChild(el('span', '', s.modelName));
        model.appendChild(mrow);
      }
      if (s.loras.length) {
        var loras = el('div', 'lora-list');
        s.loras.forEach(function (l) {
          var chip = el('span', 'lora-chip');
          chip.appendChild(el('span', '', l.name || 'LoRA'));
          if (l.strengthModel !== undefined && l.strengthModel !== null) chip.appendChild(el('small', '', 'model ' + l.strengthModel));
          loras.appendChild(chip);
        });
        model.appendChild(loras);
      }
      if (s.others.length) {
        var list = el('div', 'mini-list');
        s.others.forEach(function (o) {
          var row = el('div', 'mini-row');
          row.appendChild(el('span', 'tag', o.kind));
          row.appendChild(el('span', '', o.name || '—'));
          list.appendChild(row);
        });
        model.appendChild(list);
      }
      wrap.appendChild(model);
    }

    var cards = [];
    if (s.sampler) {
      var samplerValue = [s.sampler.samplerName, s.sampler.scheduler].filter(Boolean).join(' / ');
      if (samplerValue) cards.push(['采样器', samplerValue, sourceTag(s.sampler.sources.sampler), false]);
      if (s.sampler.steps !== undefined) cards.push(['步数', String(s.sampler.steps), sourceTag(s.sampler.sources.steps), true]);
      if (s.sampler.cfg !== undefined) cards.push(['CFG', String(s.sampler.cfg), sourceTag(s.sampler.sources.cfg), true]);
      if (s.sampler.seed !== undefined) cards.push(['种子', String(s.sampler.seed), sourceTag(s.sampler.sources.seed), true]);
      if (s.sampler.denoise !== undefined && Number(s.sampler.denoise) !== 1) cards.push(['降噪', String(s.sampler.denoise), sourceTag(s.sampler.sources.seed), true]);
    }
    if (s.latent && s.latent.width && s.latent.height) cards.push(['尺寸', s.latent.width + ' × ' + s.latent.height, sourceTag(s.latent.source), true]);
    if (s.latent && s.latent.batch && Number(s.latent.batch) > 1) cards.push(['批次', String(s.latent.batch), '', true]);
    if (s.latent && s.latent.frames) cards.push(['帧数', String(s.latent.frames), '', true]);
    if (s.loras.length) cards.push(['LoRA', s.loras.length + ' 个', '', false]);

    if (cards.length) {
      wrap.appendChild(sectionTitle('关键参数'));
      var grid = el('div', 'param-grid');
      cards.forEach(function (c) {
        var p = el('div', 'param');
        p.appendChild(el('div', 'k', c[0]));
        p.appendChild(el('div', 'v' + (c[3] ? ' mono' : ''), c[1]));
        if (c[2]) p.appendChild(el('div', 's', c[2]));
        grid.appendChild(p);
      });
      wrap.appendChild(grid);
    } else if (!report.metadata.prompt) {
      wrap.appendChild(sectionTitle('工作流'));
      var wfStats = el('div', 'param-grid');
      [['节点', report.nodes.length], ['连线', report.workflowInfo ? report.workflowInfo.linkCount : 0], ['分组', report.workflowInfo ? report.workflowInfo.groupCount : 0]].forEach(function (x) {
        var p = el('div', 'param');
        p.appendChild(el('div', 'k', x[0]));
        p.appendChild(el('div', 'v mono', String(x[1])));
        wfStats.appendChild(p);
      });
      wrap.appendChild(wfStats);
    }

    if (s.samplers.length > 1) {
      wrap.appendChild(sectionTitle('采样器链', s.samplers.length + ' 个'));
      var sl = el('div', 'output-list');
      s.samplers.forEach(function (sm) {
        var row = el('div', 'output-row');
        row.appendChild(el('span', 'out-class', '#' + sm.nodeId + ' ' + (sm.title || sm.classType)));
        if (sm.samplerName) row.appendChild(kv('采样器', sm.samplerName));
        if (sm.steps !== undefined) row.appendChild(kv('步数', String(sm.steps)));
        if (sm.cfg !== undefined) row.appendChild(kv('CFG', String(sm.cfg)));
        if (sm.seed !== undefined) row.appendChild(kv('种子', String(sm.seed)));
        sl.appendChild(row);
      });
      wrap.appendChild(sl);
    }

    if (s.outputs.length) {
      wrap.appendChild(sectionTitle('输出'));
      var outputs = el('div', 'output-list');
      s.outputs.forEach(function (o) {
        var row = el('div', 'output-row');
        row.appendChild(el('span', 'out-class', '#' + o.nodeId + ' ' + (o.title || o.classType)));
        if (o.filenamePrefix) row.appendChild(kv('前缀', o.filenamePrefix));
        if (o.format) row.appendChild(kv('格式', o.format));
        if (o.fps !== undefined) row.appendChild(kv('FPS', String(o.fps)));
        if (o.frames !== undefined) row.appendChild(kv('帧数', String(o.frames)));
        if (o.crf !== undefined) row.appendChild(kv('CRF', String(o.crf)));
        if (o.saveMetadata !== undefined) row.appendChild(kv('元数据', o.saveMetadata ? '开' : '关'));
        outputs.appendChild(row);
      });
      wrap.appendChild(outputs);
    }

    if (Object.keys(s.counts.byClass).length) {
      wrap.appendChild(sectionTitle('节点构成'));
      var cloud = el('div', 'class-cloud');
      Object.keys(s.counts.byClass).sort(function (a, b) { return s.counts.byClass[b] - s.counts.byClass[a]; }).forEach(function (cls) {
        var chip = el('button', 'class-chip');
        chip.type = 'button';
        chip.appendChild(el('span', '', cls));
        chip.appendChild(el('b', '', '×' + s.counts.byClass[cls]));
        chip.onclick = function () { showClass(cls); };
        cloud.appendChild(chip);
      });
      wrap.appendChild(cloud);
    }

    var keys = unique(report.metadata.entries.map(function (e) { return e.key; }));
    if (keys.length) {
      wrap.appendChild(sectionTitle('内嵌字段'));
      var kc = el('div', 'meta-key-row');
      keys.forEach(function (k) { kc.appendChild(el('span', 'meta-key', k)); });
      wrap.appendChild(kc);
    }

    if (report.warnings && report.warnings.length) {
      var alert = el('div', 'alert');
      alert.innerHTML = ICON.alert;
      var div = el('div');
      var ul = el('ul');
      report.warnings.forEach(function (w) { ul.appendChild(el('li', '', w)); });
      div.appendChild(ul);
      alert.appendChild(div);
      wrap.appendChild(alert);
    }
    return wrap;
  }

  function sourceTag(id) { return id ? '#' + id : ''; }

  function kv(k, v) {
    var s = el('span', 'out-kv');
    s.appendChild(document.createTextNode(k + ' '));
    s.appendChild(el('b', '', v));
    return s;
  }

  function promptCard(title, text, nodes) {
    var card = el('div', 'prompt-card');
    var head = el('div', 'prompt-head');
    head.appendChild(el('h3', '', title));
    head.appendChild(el('span', 'prompt-len', Array.from(text).length + ' 字符'));
    if (nodes && nodes.length) head.appendChild(badge(nodes.map(function (n) { return '#' + n.nodeId; }).join(' '), 'violet'));
    var actions = el('div', 'prompt-actions');
    var copy = iconButton(ICON.copy, '复制' + title);
    copy.onclick = function (e) { e.stopPropagation(); copyText(text, '已复制' + title); };
    actions.appendChild(copy);
    head.appendChild(actions);
    card.appendChild(head);

    var body = el('div', 'prompt-text');
    body.textContent = text;
    card.appendChild(body);
    // 默认完整显示；超长提示词提供“收起”，避免用户误以为内容被截断
    if (Array.from(text).length > 600) {
      var toggle = el('button', 'prompt-toggle', '收起提示词');
      toggle.type = 'button';
      toggle.onclick = function () {
        var collapsed = body.classList.toggle('collapsed');
        toggle.textContent = collapsed ? '展开全部' : '收起提示词';
        queueScrollbarUpdate();
      };
      card.appendChild(toggle);
    }
    return card;
  }

  function iconButton(html, title) {
    var b = el('button', 'icon-btn');
    b.type = 'button';
    b.title = title || '';
    b.innerHTML = html;
    b.style.width = '26px';
    b.style.height = '26px';
    return b;
  }

  function sectionTitle(text, right) {
    var d = el('div', 'section-title');
    d.appendChild(el('span', '', text));
    if (right) d.appendChild(el('span', '', right));
    return d;
  }

  function unique(arr) {
    var seen = new Set();
    var out = [];
    arr.forEach(function (x) { if (!seen.has(x)) { seen.add(x); out.push(x); } });
    return out;
  }

  function renderNoMetadata(report) {
    var wrap = el('div', 'empty-state');
    var orb = el('div', 'empty-orb');
    orb.innerHTML = ICON.alert;
    wrap.appendChild(orb);
    wrap.appendChild(el('h3', '', '没有找到 ComfyUI 元数据'));
    wrap.appendChild(el('p', '', '这个文件里没有可读取的 prompt / workflow。可能是保存时关闭了元数据，或文件被其它软件重新编码过。'));

    var tips = el('div', 'alert');
    tips.style.maxWidth = '560px';
    tips.style.textAlign = 'left';
    tips.style.marginTop = '18px';
    tips.innerHTML = ICON.alert;
    var d = el('div');
    d.appendChild(el('div', '', '可以检查：'));
    var ul = el('ul');
    ['ComfyUI 是否用了 --disable-metadata，或保存节点的 save_metadata 关闭。',
      '图片是否经过微信 / 截图 / 图床 / 压缩工具二次处理。',
      '视频保存节点是否把 prompt / workflow 写入容器标签。',
      '文件是否只有 workflow —— 这种情况仍会显示节点。'].forEach(function (t) { ul.appendChild(el('li', '', t)); });
    d.appendChild(ul);
    tips.appendChild(d);
    wrap.appendChild(tips);

    if (report.metadata.entries.length) {
      var details = document.createElement('details');
      details.className = 'raw-details';
      details.style.width = '100%';
      details.style.maxWidth = '600px';
      details.appendChild(el('summary', '', '已读取到的文本字段（' + report.metadata.entries.length + '）'));
      var list = el('div');
      list.style.textAlign = 'left';
      report.metadata.entries.forEach(function (entry) {
        var row = el('div', 'mini-row');
        row.appendChild(el('span', 'tag', entry.key));
        row.appendChild(el('span', '', entry.text.slice(0, 240) + (entry.text.length > 240 ? '…' : '')));
        list.appendChild(row);
      });
      details.appendChild(list);
      wrap.appendChild(details);
    }

    var btn = el('button', 'btn ghost', '查看原始数据');
    btn.type = 'button';
    btn.onclick = function () { setTab('raw'); };
    wrap.appendChild(btn);
    return wrap;
  }

  function showClass(cls) {
    var rec = current();
    if (!rec) return;
    state.nodeSearch = cls;
    state.nodeCategory = 'all';
    state.tab = 'nodes';
    renderTabs(rec);
    els.tabBody.scrollTop = 0;
  }

  // ---------------------------------------------------------------------------
  // 节点
  // ---------------------------------------------------------------------------

  function renderNodesTab(report) {
    var wrap = el('div');
    if (!report.nodes.length) {
      wrap.appendChild(el('div', 'raw-empty', '这个文件没有可展示的节点。'));
      return wrap;
    }
    if (!report.metadata.prompt) {
      var note = el('div', 'alert');
      note.style.marginBottom = '12px';
      note.innerHTML = ICON.alert;
      note.appendChild(el('div', '', '当前文件只有 UI workflow：参数名按常见节点的 widgets_values 顺序推断，可能不完全准确。'));
      wrap.appendChild(note);
    }
    var map = new Map();
    report.nodes.forEach(function (n) { map.set(String(n.id), n); });

    var toolbar = el('div', 'nodes-toolbar');
    var search = el('div', 'search-box');
    search.innerHTML = ICON.search;
    var input = document.createElement('input');
    input.type = 'search';
    input.placeholder = '搜索节点、参数或值…';
    input.value = state.nodeSearch;
    input.autocomplete = 'off';
    search.appendChild(input);
    toolbar.appendChild(search);

    var select = document.createElement('select');
    select.className = 'select';
    var cats = { all: '全部类别' };
    report.nodes.forEach(function (n) { cats[n.category] = CM.categoryLabel(n.category); });
    Object.keys(cats).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = cats[k];
      select.appendChild(o);
    });
    select.value = cats[state.nodeCategory] ? state.nodeCategory : 'all';
    state.nodeCategory = select.value;
    toolbar.appendChild(select);

    var expand = el('button', 'btn ghost small', state.expandAll ? '收起全部' : '展开全部');
    expand.type = 'button';
    toolbar.appendChild(expand);
    var count = el('span', 'toolbar-count');
    toolbar.appendChild(count);
    wrap.appendChild(toolbar);

    var list = el('div', 'node-list');
    wrap.appendChild(list);

    function renderList() {
      list.textContent = '';
      var q = state.nodeSearch.trim().toLowerCase();
      var filtered = report.nodes.filter(function (n) {
        if (state.nodeCategory !== 'all' && n.category !== state.nodeCategory) return false;
        if (!q) return true;
        return haystack(n).indexOf(q) !== -1;
      });
      count.textContent = filtered.length + ' / ' + report.nodes.length;
      if (!filtered.length) {
        list.appendChild(el('div', 'raw-empty', '没有匹配的节点，换个关键词试试。'));
        queueScrollbarUpdate();
        return;
      }
      var frag = document.createDocumentFragment();
      filtered.forEach(function (n) { frag.appendChild(nodeCard(n, map)); });
      list.appendChild(frag);
      queueScrollbarUpdate();
    }

    input.addEventListener('input', function () { state.nodeSearch = input.value; renderList(); });
    select.addEventListener('change', function () { state.nodeCategory = select.value; renderList(); });
    expand.addEventListener('click', function () {
      state.expandAll = !state.expandAll;
      expand.textContent = state.expandAll ? '收起全部' : '展开全部';
      renderList();
    });

    renderList();
    return wrap;
  }

  function haystack(node) {
    var parts = [node.id, node.title, node.classType];
    node.inputs.forEach(function (inp) {
      parts.push(inp.key);
      if (typeof inp.value === 'string') parts.push(inp.value);
      else if (typeof inp.value === 'number' || typeof inp.value === 'boolean') parts.push(String(inp.value));
      if (inp.link) {
        if (Array.isArray(inp.link)) inp.link.forEach(function (l) { parts.push(l.id); });
        else parts.push(inp.link.id);
      }
    });
    return parts.join(' ').toLowerCase();
  }

  function nodeCard(node, map) {
    var card = el('article', 'node-card');
    card.dataset.nodeCard = node.id;
    card.style.setProperty('--cat', CM.categoryColor(node.category));

    var head = el('div', 'node-head');
    head.appendChild(el('span', 'node-id', '#' + node.id));
    head.appendChild(el('span', 'node-title', node.title));
    if (node.classType && node.classType !== node.title) head.appendChild(el('span', 'node-class', node.classType));
    if (node.mode === 2) head.appendChild(el('span', 'node-mode', '静音'));
    if (node.mode === 4) head.appendChild(el('span', 'node-mode', '绕过'));
    head.appendChild(el('span', 'node-cat', CM.categoryLabel(node.category)));
    var copy = el('button', 'node-copy');
    copy.type = 'button';
    copy.title = '复制节点 JSON';
    copy.innerHTML = ICON.copy;
    copy.onclick = function () { copyText(JSON.stringify(node.raw, null, 2), '已复制节点 JSON'); };
    head.appendChild(copy);
    card.appendChild(head);

    var body = el('div', 'node-body');
    if (!node.inputs.length) {
      body.appendChild(el('div', 'node-empty', '没有输入参数'));
    } else {
      var table = el('table', 'param-table');
      var tbody = document.createElement('tbody');
      node.inputs.forEach(function (inp) {
        var tr = document.createElement('tr');
        tr.appendChild(el('td', 'k', inp.key));
        var td = el('td', 'v');
        td.appendChild(renderValue(inp, map));
        tr.appendChild(td);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      body.appendChild(table);
    }
    card.appendChild(body);
    return card;
  }

  function renderValue(inp, map) {
    var v = inp.value;
    if (inp.link) {
      var wrap = el('div', 'link-list');
      var links = Array.isArray(inp.link) ? inp.link : [inp.link];
      links.forEach(function (l) {
        var target = map.get(String(l.id));
        var b = el('button', 'link-pill');
        b.type = 'button';
        b.dataset.goto = String(l.id);
        b.title = '跳到节点 #' + l.id;
        b.appendChild(el('span', 'arr', '←'));
        b.appendChild(el('span', '', '#' + l.id));
        b.appendChild(el('span', 'lt', target ? target.title : '未找到节点'));
        if (l.slot) b.appendChild(el('span', 'arr', '[' + l.slot + ']'));
        wrap.appendChild(b);
      });
      return wrap;
    }
    if (v === null || v === undefined) return el('span', 'value-null', 'null');
    if (typeof v === 'number') return el('span', 'value-num', String(v));
    if (typeof v === 'boolean') return el('span', 'value-bool', v ? 'true' : 'false');
    if (typeof v === 'string') {
      var isLong = v.indexOf('\n') !== -1 || Array.from(v).length > 180;
      var box = el('span', 'value-text' + (isLong ? ' clamped' : ''), v);
      if (!isLong) return box;
      var wrap2 = el('div');
      wrap2.appendChild(box);
      var btn = el('button', 'value-expand', '展开');
      btn.type = 'button';
      btn.onclick = function () {
        var expanded = box.classList.toggle('clamped');
        btn.textContent = expanded ? '展开' : '收起';
        btn.style.display = expanded ? '' : 'none';
        queueScrollbarUpdate();
      };
      box.addEventListener('click', function () {
        box.classList.remove('clamped');
        btn.textContent = '收起';
        btn.style.display = '';
        queueScrollbarUpdate();
      });
      if (state.expandAll) { box.classList.remove('clamped'); btn.textContent = '收起'; }
      wrap2.appendChild(btn);
      return wrap2;
    }
    var json;
    try { json = JSON.stringify(v, null, 2); } catch (e) { json = String(v); }
    if (json && json.length > 6000) json = json.slice(0, 6000) + '\n…';
    return el('pre', 'json-mini', json);
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-goto]');
    if (!b) return;
    var id = b.dataset.goto;
    var card = null;
    var all = document.querySelectorAll('[data-node-card]');
    for (var i = 0; i < all.length; i++) if (all[i].dataset.nodeCard === id) { card = all[i]; break; }
    if (!card) {
      var rec = current();
      if (!rec) return;
      state.nodeSearch = '';
      state.nodeCategory = 'all';
      state.tab = 'nodes';
      renderTabs(rec);
      all = document.querySelectorAll('[data-node-card]');
      for (var j = 0; j < all.length; j++) if (all[j].dataset.nodeCard === id) { card = all[j]; break; }
    }
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('flash');
      setTimeout(function () { card.classList.remove('flash'); }, 1200);
    }
  });

  // ---------------------------------------------------------------------------
  // 工作流
  // ---------------------------------------------------------------------------

  function renderWorkflowTab(report) {
    var wrap = el('div');
    if (!report.workflowInfo) {
      var empty = el('div', 'empty-state');
      var orb = el('div', 'empty-orb');
      orb.innerHTML = ICON.alert;
      empty.appendChild(orb);
      empty.appendChild(el('h3', '', '没有 UI workflow'));
      empty.appendChild(el('p', '', '这个文件只包含 API prompt（执行图），没有前端画布数据。节点参数仍可在“节点参数”中查看。'));
      var btn = el('button', 'btn ghost', '去看节点参数');
      btn.type = 'button';
      btn.onclick = function () { setTab('nodes'); };
      empty.appendChild(btn);
      wrap.appendChild(empty);
      return wrap;
    }
    var info = report.workflowInfo;
    var stats = el('div', 'wf-stats');
    [[info.nodeCount, '节点'], [info.linkCount, '连线'], [info.groupCount, '分组'], [info.muted.length + info.bypassed.length, '静音 / 绕过']].forEach(function (x) {
      var c = el('div', 'wf-stat');
      c.appendChild(el('div', 'n', String(x[0])));
      c.appendChild(el('div', 'l', x[1]));
      stats.appendChild(c);
    });
    wrap.appendChild(stats);

    var graph = renderWorkflowGraph(report.metadata.workflow);
    if (graph) {
      wrap.appendChild(createGraphViewport(graph, report));
      var legend = el('div', 'wf-legend');
      ['loader', 'sampler', 'condition', 'latent', 'output', 'other'].forEach(function (cat) {
        var s = el('span');
        var i = document.createElement('i');
        i.style.background = CM.categoryColor(cat);
        s.appendChild(i);
        s.appendChild(el('span', '', CM.categoryLabel(cat)));
        legend.appendChild(s);
      });
      wrap.appendChild(legend);
    } else {
      wrap.appendChild(el('div', 'raw-empty', 'workflow 中没有可绘制的位置坐标，已跳过流程图。'));
    }

    if (info.groups.length) {
      wrap.appendChild(sectionTitle('分组'));
      var gl = el('div', 'group-list');
      info.groups.forEach(function (g) {
        var chip = el('span', 'group-chip');
        var i = document.createElement('i');
        i.style.background = g.color || '#64748b';
        chip.appendChild(i);
        chip.appendChild(el('span', '', g.title));
        gl.appendChild(chip);
      });
      wrap.appendChild(gl);
    }

    if (info.muted.length || info.bypassed.length) {
      var alert = el('div', 'alert');
      alert.innerHTML = ICON.alert;
      var d = el('div');
      var parts = [];
      if (info.muted.length) parts.push('静音：' + info.muted.map(function (x) { return '#' + x.id + ' ' + x.title; }).join('、'));
      if (info.bypassed.length) parts.push('绕过：' + info.bypassed.map(function (x) { return '#' + x.id + ' ' + x.title; }).join('、'));
      d.textContent = parts.join('；') + '。这些节点不会按正常逻辑执行。';
      alert.appendChild(d);
      wrap.appendChild(alert);
    }

    var details = document.createElement('details');
    details.className = 'raw-details';
    details.appendChild(el('summary', '', '查看工作流节点表（' + info.nodeCount + '）'));
    var table = el('table', 'wf-node-table');
    var thead = document.createElement('thead');
    var trh = document.createElement('tr');
    ['ID', '类型', '标题', '状态'].forEach(function (h) { trh.appendChild(el('th', '', h)); });
    thead.appendChild(trh);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    (report.metadata.workflow.nodes || []).forEach(function (n) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', 'mono', '#' + n.id));
      tr.appendChild(el('td', 'mono', n.type || ''));
      tr.appendChild(el('td', '', n.title || ''));
      var st = el('td');
      st.appendChild(el('span', 'mode-dot' + (n.mode === 2 ? ' muted' : n.mode === 4 ? ' bypassed' : '')));
      st.appendChild(el('span', '', n.mode === 2 ? '静音' : n.mode === 4 ? '绕过' : '正常'));
      tr.appendChild(st);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    details.appendChild(table);
    wrap.appendChild(details);

    var wfExtra = report.metadata.workflow.extra || {};
    if (info.version !== undefined || wfExtra.frontendVersion) {
      var foot = el('div', 'wf-legend');
      if (info.version !== undefined) foot.appendChild(el('span', '', 'workflow version ' + info.version));
      if (wfExtra.frontendVersion) foot.appendChild(el('span', '', 'frontend ' + wfExtra.frontendVersion));
      wrap.appendChild(foot);
    }
    return wrap;
  }

  // __APPEND__