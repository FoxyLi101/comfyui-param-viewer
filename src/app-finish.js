  // ---------------------------------------------------------------------------
  // Markdown
  // ---------------------------------------------------------------------------

  function buildMarkdown(report) {
    var s = report.summary;
    var bt = String.fromCharCode(96);
    var fence = bt + bt + bt;
    var lines = [];
    lines.push('# ComfyUI 参数 · ' + report.file.name);
    lines.push('');
    lines.push('- 容器：' + report.container);
    lines.push('- 大小：' + CM.formatBytes(report.file.size));
    lines.push('- 元数据：' + (report.detection.length ? report.detection.join('；') : '未找到'));
    lines.push('- 节点数：' + report.nodes.length);
    if (s.modelName) lines.push('- 模型：' + bt + s.modelName + bt);
    if (s.loras.length) lines.push('- LoRA：' + s.loras.map(function (l) { return bt + (l.name || '') + bt; }).join('、'));
    if (s.sampler) {
      var bits = [];
      if (s.sampler.samplerName) bits.push('采样器 ' + s.sampler.samplerName);
      if (s.sampler.scheduler) bits.push('调度器 ' + s.sampler.scheduler);
      if (s.sampler.steps !== undefined) bits.push('步数 ' + s.sampler.steps);
      if (s.sampler.cfg !== undefined) bits.push('CFG ' + s.sampler.cfg);
      if (s.sampler.seed !== undefined) bits.push('种子 ' + s.sampler.seed);
      if (bits.length) lines.push('- 采样：' + bits.join(' · '));
    }
    if (s.latent && s.latent.width) lines.push('- 尺寸：' + s.latent.width + ' × ' + s.latent.height + (s.latent.batch ? ' · batch ' + s.latent.batch : ''));
    lines.push('');

    if (s.positive) {
      lines.push('## 正向提示词');
      lines.push(fence + 'text');
      lines.push(s.positive);
      lines.push(fence);
      lines.push('');
    }
    if (s.negative) {
      lines.push('## 负向提示词');
      lines.push(fence + 'text');
      lines.push(s.negative);
      lines.push(fence);
      lines.push('');
    }

    lines.push('## 节点参数');
    lines.push('');
    report.nodes.forEach(function (n) {
      lines.push('### #' + n.id + ' ' + (n.title || n.classType));
      if (n.title !== n.classType) lines.push(bt + n.classType + bt);
      lines.push('');
      if (!n.inputs.length) { lines.push('（无输入参数）'); lines.push(''); return; }
      lines.push('| 参数 | 值 |');
      lines.push('| --- | --- |');
      n.inputs.forEach(function (i) {
        lines.push('| ' + bt + mdCell(i.key) + bt + ' | ' + mdCell(mdValue(i, report)) + ' |');
      });
      lines.push('');
    });

    if (report.warnings && report.warnings.length) {
      lines.push('## 提示');
      report.warnings.forEach(function (w) { lines.push('- ' + w); });
      lines.push('');
    }
    return lines.join('\n');
  }

  function mdValue(inp, report) {
    if (inp.link) {
      var links = Array.isArray(inp.link) ? inp.link : [inp.link];
      var map = new Map();
      report.nodes.forEach(function (n) { map.set(String(n.id), n); });
      return links.map(function (l) {
        var n = map.get(String(l.id));
        return '← #' + l.id + ' ' + (n ? n.title : '未知节点') + (l.slot ? ' [' + l.slot + ']' : '');
      }).join(' / ');
    }
    if (inp.value === null || inp.value === undefined) return 'null';
    if (typeof inp.value === 'string') return inp.value;
    try { return JSON.stringify(inp.value); } catch (e) { return String(inp.value); }
  }

  function mdCell(s) {
    return String(s === null || s === undefined ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  }

  // ---------------------------------------------------------------------------
  // 通用工具
  // ---------------------------------------------------------------------------

  function copyText(text, message) {
    if (!text) { toast('没有可复制的内容', 'err'); return; }
    var done = function () { toast(message || '已复制', 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { toast('复制失败，请手动选择文本', 'err'); }
    ta.remove();
  }

  function toast(msg, kind) {
    var t = els.toast;
    t.textContent = msg;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast' + (kind ? ' ' + kind : ''); }, 2600);
  }

  function downloadJson(obj, filename) { downloadText(JSON.stringify(obj, null, 2), filename, 'application/json'); }

  function downloadText(text, filename, type) {
    var blob = new Blob([text], { type: (type || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function safeBase(name) {
    return String(name || 'comfyui').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 90) || 'comfyui';
  }

  function openModal() { els.modal.hidden = false; }
  function closeModal() { els.modal.hidden = true; }

  function updateExportAll() {
    if (!els.btnExportAll) return;
    els.btnExportAll.disabled = !state.files.length || state.busy;
  }

  window.ComfyApp = {
    loadFiles: function (files) { return addFiles(files); },
    whenIdle: whenIdle,
    select: selectIndex,
    setTab: setTab,
    setRawTab: function (t) { state.rawTab = t; var rec = current(); if (rec) renderTabs(rec); },
    clear: clearAll,
    getState: function () { return state; },
    _test: { buildMarkdown: buildMarkdown, exportObject: exportObject }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
