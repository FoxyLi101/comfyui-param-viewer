/**
 * ComfyUI 参数解析核心
 * 支持：PNG / JPEG / WebP / GIF / MP4 / MOV / WebM / MKV / JSON
 *
 * 浏览器中暴露为 window.ComfyMeta，Node 中可 require。
 * 所有解析都在本地完成，不访问网络。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ComfyMeta = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var MB = 1024 * 1024;
  var FULL_READ_LIMIT = 128 * MB;
  var IMAGE_HEAD_LIMIT = 40 * MB;
  var VIDEO_TAIL_LIMIT = 40 * MB;
  var MAX_DECOMPRESSED = 64 * MB;
  var MAX_JSON_SCAN = 64 * MB;

  // ---------------------------------------------------------------------------
  // 基础工具
  // ---------------------------------------------------------------------------

  function ascii(u8, off, len) {
    var s = '';
    for (var i = 0; i < len && off + i < u8.length; i++) s += String.fromCharCode(u8[off + i]);
    return s;
  }

  function hex(u8, start, len) {
    var s = '';
    for (var i = 0; i < (len || u8.length); i++) {
      var b = u8[(start || 0) + i];
      s += (b < 16 ? '0' : '') + b.toString(16);
    }
    return s;
  }

  function u16be(u8, o) { return (u8[o] << 8) | u8[o + 1]; }
  function u16le(u8, o) { return u8[o] | (u8[o + 1] << 8); }
  function u32be(u8, o) { return ((u8[o] << 24) >>> 0) + (u8[o + 1] << 16) + (u8[o + 2] << 8) + u8[o + 3]; }
  function u32le(u8, o) { return (u8[o] + (u8[o + 1] << 8) + (u8[o + 2] << 16) + ((u8[o + 3] << 24) >>> 0)); }
  function u64be(u8, o) { return u32be(u8, o) * 4294967296 + u32be(u8, o + 4); }

  var utf8Strict = null;
  var utf8Loose = null;
  var latin1 = null;
  try { utf8Strict = new TextDecoder('utf-8', { fatal: true }); } catch (e) {}
  try { utf8Loose = new TextDecoder('utf-8'); } catch (e) {}
  try { latin1 = new TextDecoder('latin1'); } catch (e) {}

  function decodeSmart(bytes) {
    if (!bytes || !bytes.length) return '';
    // BOM
    if (bytes.length >= 2) {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        try { return new TextDecoder('utf-16le').decode(bytes.subarray(2)); } catch (e) {}
      }
      if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        try { return new TextDecoder('utf-16be').decode(bytes.subarray(2)); } catch (e) {}
      }
    }
    if (utf8Strict) {
      try { return utf8Strict.decode(bytes); } catch (e) {}
    }
    if (utf8Loose) {
      var s = utf8Loose.decode(bytes);
      if (s.indexOf('\ufffd') === -1) return s;
    }
    if (latin1) return latin1.decode(bytes);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }

  function decodeAsciiOrUtf8(bytes) {
    if (!bytes || !bytes.length) return '';
    return decodeSmart(bytes);
  }

  function stripTrailingNul(s) {
    return String(s || '').replace(/\u0000+$/g, '');
  }

  function inflateBytes(bytes) {
    if (typeof DecompressionStream === 'undefined' || typeof Blob === 'undefined' || typeof Response === 'undefined') {
      return Promise.reject(new Error('当前浏览器不支持解压 PNG 压缩文本块'));
    }
    var ds = new DecompressionStream('deflate');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (ab) {
      if (ab.byteLength > MAX_DECOMPRESSED) throw new Error('解压后的元数据过大');
      return new Uint8Array(ab);
    });
  }

  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < MB) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    if (n < 1024 * MB) return (n / MB).toFixed(n < 10 * MB ? 2 : 1) + ' MB';
    return (n / (1024 * MB)).toFixed(2) + ' GB';
  }

  function extOf(name) {
    var m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function firstDefined() {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
    }
    return undefined;
  }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function uniqueBy(arr, keyFn) {
    var seen = new Set();
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var k = keyFn(arr[i], i);
      if (!seen.has(k)) { seen.add(k); out.push(arr[i]); }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // JSON 识别
  // ---------------------------------------------------------------------------

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function looksLikePrompt(obj) {
    if (!isPlainObject(obj)) return false;
    var keys = Object.keys(obj);
    if (!keys.length) return false;
    var hits = 0;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (isPlainObject(v) && typeof v.class_type === 'string') hits++;
    }
    return hits > 0;
  }

  function looksLikeWorkflow(obj) {
    if (!isPlainObject(obj) || !Array.isArray(obj.nodes)) return false;
    if (!obj.nodes.length) return Array.isArray(obj.links);
    return obj.nodes.some(function (n) { return isPlainObject(n) && typeof n.type === 'string'; })
      && (Array.isArray(obj.links) || typeof obj.last_node_id === 'number' || typeof obj.version === 'number');
  }

  function classifyJson(obj) {
    if (!isPlainObject(obj)) return null;
    // 常见包装：{ prompt: {...}, workflow: {...} }
    if (looksLikePrompt(obj.prompt)) return 'prompt';
    if (looksLikeWorkflow(obj.workflow)) return 'workflow';
    if (looksLikePrompt(obj)) return 'prompt';
    if (looksLikeWorkflow(obj)) return 'workflow';
    return null;
  }

  function matchJsonObject(text, start) {
    var depth = 0, inStr = false, esc = false;
    for (var i = start; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (inStr) {
        if (esc) { esc = false; }
        else if (c === 92) { esc = true; }
        else if (c === 34) { inStr = false; }
        continue;
      }
      if (c === 34) { inStr = true; continue; }
      if (c === 123) { depth++; }
      else if (c === 125) {
        depth--;
        if (depth === 0) return i;
        if (depth < 0) return -1;
      }
    }
    return -1;
  }

  function scoreJson(kind, obj) {
    if (kind === 'prompt') {
      var n = 0;
      for (var k in obj) if (isPlainObject(obj[k]) && typeof obj[k].class_type === 'string') n++;
      return n;
    }
    if (kind === 'workflow') return Array.isArray(obj.nodes) ? obj.nodes.length : 0;
    return 0;
  }

  function collectWrapper(obj, kind, raw, push) {
    if (!isPlainObject(obj)) return;
    if (kind === 'wrapper') {
      if (looksLikePrompt(obj.prompt)) push({ kind: 'prompt', obj: obj.prompt, raw: JSON.stringify(obj.prompt), source: '包装字段 prompt' });
      if (looksLikeWorkflow(obj.workflow)) push({ kind: 'workflow', obj: obj.workflow, raw: JSON.stringify(obj.workflow), source: '包装字段 workflow' });
    } else if (kind) {
      push({ kind: kind, obj: obj, raw: raw, source: 'JSON' });
    }
  }

  function analyzeJsonText(text, source, depth) {
    var out = [];
    if (!text || typeof text !== 'string') return out;
    depth = depth || 0;
    if (depth > 3) return out;
    var t = text.trim();
    if (!t) return out;

    // 去掉 prompt: / workflow: 前缀后再试
    var prefixed = t.match(/^(prompt|workflow)\s*[:=]\s*/i);
    if (prefixed) {
      var after = t.slice(prefixed[0].length).trim();
      var inner = analyzeJsonText(after, source, depth + 1);
      for (var pi = 0; pi < inner.length; pi++) {
        var tag = prefixed[1].toLowerCase();
        inner[pi].source = inner[pi].kind === tag ? source + ' · ' + tag : source;
        out.push(inner[pi]);
      }
      if (inner.length) return out;
    }

    if (t[0] === '{' || t[0] === '[') {
      try {
        var parsed = JSON.parse(t);
        if (typeof parsed === 'string') {
          return analyzeJsonText(parsed, source, depth + 1);
        }
        if (isPlainObject(parsed)) {
          if (looksLikePrompt(parsed.prompt) || looksLikeWorkflow(parsed.workflow)) {
            collectWrapper(parsed, 'wrapper', t, function (c) { c.source = source; out.push(c); });
          } else {
            var kind = classifyJson(parsed);
            if (kind) out.push({ kind: kind, obj: parsed, raw: t, source: source });
            else {
              // 可能是任意包装，继续找里面的 ComfyUI JSON
              var nested = findJsonObjects(t, source);
              for (var ni = 0; ni < nested.length; ni++) out.push(nested[ni]);
            }
          }
        } else if (Array.isArray(parsed)) {
          for (var ai = 0; ai < parsed.length; ai++) {
            var item = parsed[ai];
            var ik = classifyJson(item);
            if (ik) out.push({ kind: ik, obj: item, raw: JSON.stringify(item), source: source });
          }
        }
        if (out.length) return dedupeCandidates(out);
      } catch (e) { /* 继续做子串扫描 */ }
    }

    var found = findJsonObjects(t, source);
    return dedupeCandidates(found);
  }

  function findJsonObjects(text, source) {
    if (!text || typeof text !== 'string') return [];
    if (text.length > MAX_JSON_SCAN) text = text.slice(0, MAX_JSON_SCAN);
    var markers = ['"last_node_id"', '"class_type"', '"nodes"'];
    var out = [];
    var seenRaw = new Set();
    for (var mi = 0; mi < markers.length; mi++) {
      var marker = markers[mi];
      var from = 0;
      var count = 0;
      while (count < 80) {
        var idx = text.indexOf(marker, from);
        if (idx < 0) break;
        count++;
        from = idx + marker.length;
        var b = idx;
        var tries = 0;
        while (tries < 40) {
          b = text.lastIndexOf('{', b - 1);
          if (b < 0) break;
          tries++;
          var end = matchJsonObject(text, b);
          if (end <= idx) continue;
          var raw = text.slice(b, end + 1);
          if (seenRaw.has(raw)) break;
          try {
            var obj = JSON.parse(raw);
            var kind = classifyJson(obj);
            if (kind) {
              if (!seenRaw.has(raw)) {
                seenRaw.add(raw);
                out.push({ kind: kind, obj: obj, raw: raw, source: source });
              }
              break;
            }
          } catch (e) { /* 尝试更外层的 { */ }
        }
      }
    }
    return dedupeCandidates(out);
  }

  function dedupeCandidates(arr) {
    var seen = new Set();
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var c = arr[i];
      if (!c || !c.obj) continue;
      var key = c.kind + ':' + (c.raw ? c.raw.length + ':' + c.raw.slice(0, 80) : JSON.stringify(c.obj).slice(0, 80));
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // EXIF / TIFF
  // ---------------------------------------------------------------------------

  function parseExifTiff(input, source, out, warnings) {
    var base = 0;
    if (input.length >= 6 && ascii(input, 0, 6) === 'Exif\u0000\u0000') base = 6;
    if (input.length < base + 8) return;
    var le = input[base] === 0x49 && input[base + 1] === 0x49;
    var be = input[base] === 0x4d && input[base + 1] === 0x4d;
    if (!le && !be) return;
    function g16(o) { return le ? u16le(input, o) : u16be(input, o); }
    function g32(o) { return le ? u32le(input, o) : u32be(input, o); }
    var typeSize = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
    var seen = new Set();

    function readIfd(off, depth) {
      if (depth > 4 || off < 0 || base + off + 2 > input.length) return;
      if (seen.has(off)) return;
      seen.add(off);
      var p = base + off;
      var n = g16(p);
      if (n > 512) return;
      for (var i = 0; i < n; i++) {
        var e = p + 2 + i * 12;
        if (e + 12 > input.length) break;
        var tag = g16(e);
        var type = g16(e + 2);
        var count = g32(e + 4);
        var size = count * (typeSize[type] || 1);
        if (size < 0 || size > 32 * MB) continue;
        var valOff = size <= 4 ? e + 8 : base + g32(e + 8);
        if (valOff < 0 || valOff + Math.min(size, 32 * MB) > input.length) continue;

        if (tag === 0x8769) { readIfd(g32(e + 8), depth + 1); continue; }
        if (tag === 0x8825) continue;
        var name = null;
        if (tag === 0x010e) name = 'ImageDescription';
        else if (tag === 0x0131) name = 'Software';
        else if (tag === 0x013b) name = 'Artist';
        else if (tag === 0x8298) name = 'Copyright';
        else if (tag === 0x9286) name = 'UserComment';
        else if (tag === 0x9c9b) name = 'XPTitle';
        else if (tag === 0x9c9c) name = 'XPComment';
        else if (tag === 0x9c9d) name = 'XPAuthor';
        else if (tag === 0x9c9e) name = 'XPKeywords';
        else if (tag === 0x9c9f) name = 'XPSubject';
        if (!name) continue;

        var bytes = input.subarray(valOff, valOff + size);
        var txt = '';
        if (tag === 0x9286) txt = decodeUserComment(bytes);
        else if (type === 2) txt = stripTrailingNul(decodeSmart(bytes));
        else if (tag >= 0x9c9b && tag <= 0x9c9f) txt = decodeUtf16(bytes, le);
        else txt = decodeSmart(bytes);
        txt = stripTrailingNul(txt);
        if (txt && txt.trim()) {
          out.push({ key: 'EXIF:' + name, text: txt, source: source });
        }
      }
    }

    try { readIfd(g32(base + 4), 0); } catch (e) { warnings.push('EXIF 解析失败：' + e.message); }
  }

  function decodeUtf16(bytes, le) {
    if (bytes.length >= 2) {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) le = true;
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) le = false;
    }
    try {
      return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(bytes);
    } catch (e) {
      return decodeSmart(bytes);
    }
  }

  function decodeUserComment(bytes) {
    if (!bytes.length) return '';
    var head = ascii(bytes, 0, Math.min(8, bytes.length));
    if (head.indexOf('UNICODE') === 0) return stripTrailingNul(decodeUtf16(bytes.subarray(8), false));
    if (head.indexOf('ASCII') === 0) return stripTrailingNul(decodeSmart(bytes.subarray(8)));
    if (head.indexOf('JIS') === 0) return stripTrailingNul(decodeSmart(bytes.subarray(8)));
    return stripTrailingNul(decodeSmart(bytes));
  }

  // ---------------------------------------------------------------------------
  // PNG
  // ---------------------------------------------------------------------------

  function parsePng(u8, warnings) {
    var texts = [];
    var extra = {};
    if (u8.length < 8 || u8[0] !== 0x89 || u8[1] !== 0x50 || u8[2] !== 0x4e || u8[3] !== 0x47) {
      throw new Error('不是有效的 PNG 文件');
    }
    var off = 8;
    var guard = 0;
    while (off + 12 <= u8.length && guard++ < 200000) {
      var len = u32be(u8, off);
      var type = ascii(u8, off + 4, 4);
      if (len > 128 * MB) { warnings.push('PNG 数据块过大，已停止解析'); break; }
      if (off + 12 + len > u8.length) {
        warnings.push('PNG 文件被截断，部分文本块可能未读取');
        break;
      }
      var data = u8.subarray(off + 8, off + 8 + len);
      if (type === 'IHDR' && len >= 8) {
        extra.width = u32be(data, 0);
        extra.height = u32be(data, 4);
      } else if (type === 'tEXt') {
        var z = data.indexOf(0);
        if (z > 0) {
          var key = ascii(data, 0, z);
          texts.push({ key: key, text: decodeSmart(data.subarray(z + 1)), source: 'PNG tEXt' });
        }
      } else if (type === 'zTXt') {
        var z2 = data.indexOf(0);
        if (z2 > 0) {
          var key2 = ascii(data, 0, z2);
          var method = data[z2 + 1];
          if (method !== 0) warnings.push('PNG zTXt 使用了未知压缩方法：' + method);
          else {
            try {
              var inf = inflateBytes(data.subarray(z2 + 2));
              texts.push({ key: key2, text: null, source: 'PNG zTXt', _inflate: inf });
            } catch (e) { warnings.push('PNG zTXt 解压失败：' + e.message); }
          }
        }
      } else if (type === 'iTXt') {
        var p = data.indexOf(0);
        if (p > 0) {
          var key3 = ascii(data, 0, p);
          p++;
          if (p + 2 <= data.length) {
            var compFlag = data[p++];
            var compMethod = data[p++];
            var langEnd = data.indexOf(0, p);
            if (langEnd >= 0) {
              p = langEnd + 1;
              var transEnd = data.indexOf(0, p);
              if (transEnd >= 0) {
                p = transEnd + 1;
                var payload = data.subarray(p);
                if (compFlag === 1) {
                  if (compMethod !== 0) warnings.push('PNG iTXt 使用了未知压缩方法：' + compMethod);
                  else {
                    try {
                      var inf2 = inflateBytes(payload);
                      texts.push({ key: key3, text: null, source: 'PNG iTXt', _inflate: inf2 });
                    } catch (e) { warnings.push('PNG iTXt 解压失败：' + e.message); }
                  }
                } else {
                  texts.push({ key: key3, text: decodeSmart(payload), source: 'PNG iTXt' });
                }
              }
            }
          }
        }
      } else if (type === 'eXIf') {
        parseExifTiff(data, 'PNG eXIf', texts, warnings);
      }
      if (type === 'IEND') break;
      off += 12 + len;
    }
    return { texts: texts, extra: extra };
  }

  async function resolvePngTexts(result, warnings) {
    for (var i = 0; i < result.texts.length; i++) {
      var t = result.texts[i];
      if (t._inflate) {
        try {
          t.text = decodeSmart(await t._inflate);
        } catch (e) {
          t.text = '';
          if (warnings) warnings.push('PNG 压缩文本块解压失败：' + e.message);
        }
        delete t._inflate;
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // JPEG
  // ---------------------------------------------------------------------------

  function parseJpeg(u8, warnings) {
    var texts = [];
    var extra = {};
    if (u8.length < 4 || u8[0] !== 0xff || u8[1] !== 0xd8) throw new Error('不是有效的 JPEG 文件');
    var off = 2;
    var guard = 0;
    while (off < u8.length && guard++ < 200000) {
      if (u8[off] !== 0xff) { off++; continue; }
      while (off < u8.length && u8[off] === 0xff) off++;
      if (off >= u8.length) break;
      var marker = u8[off++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (off + 2 > u8.length) break;
      var len = u16be(u8, off);
      if (len < 2 || off + len > u8.length) { warnings.push('JPEG 段被截断'); break; }
      var start = off + 2;
      var end = off + len;
      var data = u8.subarray(start, end);
      if (marker === 0xe1) {
        if (data.length >= 6 && ascii(data, 0, 6) === 'Exif\u0000\u0000') {
          parseExifTiff(data, 'JPEG EXIF', texts, warnings);
        } else if (data.length > 29 && ascii(data, 0, 29).indexOf('http://ns.adobe.com/xap/1.0/') === 0) {
          var xml = decodeSmart(data.subarray(29));
          if (xml.trim()) texts.push({ key: 'XMP', text: xml, source: 'JPEG XMP' });
        }
      } else if (marker === 0xfe) {
        var com = decodeSmart(data);
        if (com.trim()) texts.push({ key: 'COM', text: com, source: 'JPEG COM' });
      } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (data.length >= 5) {
          extra.height = u16be(data, 1);
          extra.width = u16be(data, 3);
        }
      }
      off = end;
    }
    return { texts: texts, extra: extra };
  }

  // ---------------------------------------------------------------------------
  // WebP
  // ---------------------------------------------------------------------------

  function parseWebp(u8, warnings) {
    var texts = [];
    var extra = {};
    if (u8.length < 12 || ascii(u8, 0, 4) !== 'RIFF' || ascii(u8, 8, 4) !== 'WEBP') {
      throw new Error('不是有效的 WebP 文件');
    }
    var off = 12;
    var guard = 0;
    while (off + 8 <= u8.length && guard++ < 100000) {
      var fourcc = ascii(u8, off, 4);
      var size = u32le(u8, off + 4);
      if (size > u8.length) { warnings.push('WebP 块大小异常，已停止解析'); break; }
      var end = Math.min(u8.length, off + 8 + size);
      var data = u8.subarray(off + 8, end);
      if (fourcc === 'EXIF') {
        parseExifTiff(data, 'WebP EXIF', texts, warnings);
      } else if (fourcc === 'XMP ') {
        var xml = decodeSmart(data);
        if (xml.trim()) texts.push({ key: 'XMP', text: xml, source: 'WebP XMP' });
      } else if (fourcc === 'VP8X' && data.length >= 10) {
        extra.width = 1 + (data[4] | (data[5] << 8) | (data[6] << 16));
        extra.height = 1 + (data[7] | (data[8] << 8) | (data[9] << 16));
      }
      off = end + (size & 1);
    }
    return { texts: texts, extra: extra };
  }

  // ---------------------------------------------------------------------------
  // GIF
  // ---------------------------------------------------------------------------

  function parseGif(u8, warnings) {
    var texts = [];
    var extra = {};
    if (u8.length < 13 || ascii(u8, 0, 3) !== 'GIF') throw new Error('不是有效的 GIF 文件');
    extra.width = u16le(u8, 6);
    extra.height = u16le(u8, 8);
    var flags = u8[10];
    var off = 13;
    if (flags & 0x80) off += 3 * (1 << ((flags & 7) + 1));
    var guard = 0;
    while (off < u8.length && guard++ < 200000) {
      var b = u8[off++];
      if (b === 0x3b) break;
      if (b === 0x21) {
        if (off >= u8.length) break;
        var label = u8[off++];
        if (label === 0xfe) {
          var res = readGifSubBlocks(u8, off);
          off = res.off;
          if (res.data.length) texts.push({ key: 'Comment', text: decodeSmart(res.data), source: 'GIF Comment' });
        } else if (label === 0xff) {
          if (off + 11 > u8.length) break;
          var app = ascii(u8, off, 11);
          off += 11;
          var res2 = readGifSubBlocks(u8, off);
          off = res2.off;
          if (app.indexOf('XMP DataXMP') === 0 && res2.data.length) {
            texts.push({ key: 'XMP', text: decodeSmart(res2.data), source: 'GIF XMP' });
          }
        } else {
          var res3 = readGifSubBlocks(u8, off);
          off = res3.off;
        }
      } else if (b === 0x2c) {
        if (off + 9 > u8.length) break;
        var lf = u8[off + 8];
        off += 9;
        if (lf & 0x80) off += 3 * (1 << ((lf & 7) + 1));
        if (off >= u8.length) break;
        off++; // LZW minimum code size
        var res4 = readGifSubBlocks(u8, off);
        off = res4.off;
      } else {
        break;
      }
    }
    return { texts: texts, extra: extra };
  }

  function readGifSubBlocks(u8, off) {
    var chunks = [];
    var total = 0;
    while (off < u8.length) {
      var n = u8[off++];
      if (!n) break;
      if (off + n > u8.length) { off = u8.length; break; }
      chunks.push(u8.subarray(off, off + n));
      total += n;
      off += n;
      if (total > 32 * MB) break;
    }
    var out = new Uint8Array(total);
    var p = 0;
    for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], p); p += chunks[i].length; }
    return { data: out, off: off };
  }

  // ---------------------------------------------------------------------------
  // MP4 / MOV
  // ---------------------------------------------------------------------------

  function mp4KeyName(type) {
    var map = {
      '\u00a9cmt': 'comment', '\u00a9des': 'description', '\u00a9nam': 'title',
      '\u00a9gen': 'genre', '\u00a9day': 'date', '\u00a9too': 'encoder',
      '\u00a9ART': 'artist', '\u00a9alb': 'album', 'cprt': 'copyright',
      'desc': 'description', 'ldes': 'long_description', 'tvsh': 'show',
      'tvnn': 'network', 'stik': 'media_type', 'purd': 'purchase_date'
    };
    return map[type] || type;
  }

  function collectMp4Data(buf, start, end, key, ctx) {
    if (end - start < 8) return;
    var typeIndicator = u32be(buf, start);
    var value = buf.subarray(start + 8, end);
    if (!value.length) return;
    if (typeIndicator === 1 || typeIndicator === 0) {
      var text = decodeSmart(value);
      if (text.trim()) ctx.texts.push({ key: key || 'data', text: text, source: 'MP4 容器标签' });
    } else if (typeIndicator === 2) {
      var text2 = decodeUtf16(value, false);
      if (text2.trim()) ctx.texts.push({ key: key || 'data', text: text2, source: 'MP4 容器标签' });
    }
  }

  function walkMp4Boxes(buf, start, end, ctx, parent, itemKey, freeform, depth) {
    if (depth > 12) return;
    var off = start;
    var guard = 0;
    while (off + 8 <= end && guard++ < 100000) {
      var size = u32be(buf, off);
      var type = ascii(buf, off + 4, 4);
      var hdr = 8;
      if (size === 1) {
        if (off + 16 > end) break;
        size = u64be(buf, off + 8);
        hdr = 16;
      } else if (size === 0) {
        size = end - off;
      }
      if (size < hdr || off + size > end) break;
      var body = off + hdr;
      var boxEnd = off + size;

      if (type === 'data' && (parent === 'ilst-item' || parent === 'freeform')) {
        collectMp4Data(buf, body, boxEnd, itemKey || (freeform && freeform.name) || 'data', ctx);
      } else if (type === '----') {
        var ff = freeform || {};
        walkMp4Boxes(buf, body, boxEnd, ctx, 'freeform', null, ff, depth + 1);
      } else if (type === 'mean' && parent === 'freeform') {
        if (freeform) freeform.mean = stripTrailingNul(decodeSmart(buf.subarray(body, boxEnd)));
      } else if (type === 'name' && parent === 'freeform') {
        if (freeform) freeform.name = stripTrailingNul(decodeSmart(buf.subarray(body, boxEnd)));
      } else if (type === 'ilst') {
        walkMp4Boxes(buf, body, boxEnd, ctx, 'ilst', null, null, depth + 1);
      } else if (parent === 'ilst') {
        walkMp4Boxes(buf, body, boxEnd, ctx, 'ilst-item', mp4KeyName(type), null, depth + 1);
      } else if (type === 'meta') {
        // meta 是 full box，前 4 字节为 version/flags
        walkMp4Boxes(buf, body + 4, boxEnd, ctx, 'meta', null, null, depth + 1);
      } else if (type === 'udta') {
        walkMp4Boxes(buf, body, boxEnd, ctx, 'udta', null, null, depth + 1);
      } else if (type === '\u00a9cmt' || type === '\u00a9des' || type === '\u00a9nam' || type === '\u00a9too' || type === 'desc' || type === 'ldes') {
        walkMp4Boxes(buf, body, boxEnd, ctx, 'ilst-item', mp4KeyName(type), null, depth + 1);
      } else if (type === 'moov' || type === 'trak' || type === 'mdia' || type === 'minf' || type === 'stbl' || type === 'edts' || type === 'dinf' || type === 'mvex') {
        walkMp4Boxes(buf, body, boxEnd, ctx, type, null, null, depth + 1);
      }
      off = boxEnd;
    }
  }

  async function parseMp4(file, warnings) {
    var texts = [];
    var extra = { brands: [] };
    var size = file.size;
    var pos = 0;
    var guard = 0;
    var ctx = { texts: texts };
    while (pos + 8 <= size && guard++ < 10000) {
      var hdr = await readRange(file, pos, Math.min(pos + 32, size));
      if (hdr.length < 8) break;
      var boxSize = u32be(hdr, 0);
      var type = ascii(hdr, 4, 4);
      var headerSize = 8;
      if (boxSize === 1) {
        if (hdr.length < 16) break;
        boxSize = u64be(hdr, 8);
        headerSize = 16;
      } else if (boxSize === 0) {
        boxSize = size - pos;
      }
      if (boxSize < headerSize || pos + boxSize > size + 1) {
        warnings.push('MP4 顶层 box 大小异常，已停止解析');
        break;
      }
      if (type === 'ftyp') {
        var brandBuf = await readRange(file, pos + headerSize, Math.min(pos + boxSize, pos + headerSize + 64));
        if (brandBuf.length >= 4) extra.brands.push(ascii(brandBuf, 0, 4));
        var compat = brandBuf.subarray(8);
        for (var ci = 0; ci + 4 <= compat.length; ci += 4) {
          var b4 = ascii(compat, ci, 4).replace(/\u0000/g, '');
          if (b4 && extra.brands.indexOf(b4) === -1) extra.brands.push(b4);
        }
      } else if (type === 'moov') {
        var bodyLen = boxSize - headerSize;
        var readLen = Math.min(bodyLen, 128 * MB);
        if (readLen < bodyLen) warnings.push('MP4 moov 过大，仅解析前 128MB');
        var moov = await readRange(file, pos + headerSize, pos + headerSize + readLen);
        walkMp4Boxes(moov, 0, moov.length, ctx, 'moov', null, null, 0);
      } else if (type === 'meta') {
        var metaLen = Math.min(boxSize - headerSize, 64 * MB);
        var meta = await readRange(file, pos + headerSize, pos + headerSize + metaLen);
        // 顶层 meta 也是 full box，前 4 字节为 version/flags
        walkMp4Boxes(meta, 4, meta.length, ctx, 'meta', null, null, 0);
      } else if (type === 'uuid') {
        var uuidLen = Math.min(boxSize - headerSize, 32 * MB);
        var ub = await readRange(file, pos + headerSize, pos + headerSize + uuidLen);
        if (ub.length > 16) {
          var payload = ub.subarray(16);
          var uuidText = decodeSmart(payload);
          if (/prompt|workflow|class_type|xmpmeta|<!DOCTYPE|<\?xpacket/i.test(uuidText)) {
            texts.push({ key: 'uuid/XMP', text: uuidText, source: 'MP4 uuid' });
          }
        }
      }
      pos += boxSize;
    }
    return { texts: texts, extra: extra };
  }

  // ---------------------------------------------------------------------------
  // WebM / MKV (EBML)
  // ---------------------------------------------------------------------------

  var EBML = 0x1a45dfa3;
  var SEGMENT = 0x18538067;
  var TAGS = 0x1254c367;
  var TAG = 0x7373;
  var SIMPLE_TAG = 0x67c8;
  var TAG_NAME = 0x45a3;
  var TAG_STRING = 0x4487;
  var TAG_BINARY = 0x4485;
  var INFO = 0x1549a966;
  var TITLE = 0x7ba9;
  var MUXING_APP = 0x4d80;
  var WRITING_APP = 0x5741;
  var CLUSTER = 0x1f43b675;
  var ATTACHMENTS = 0x1941a469;

  function readEbmlVint(u8, off, keepMarker) {
    if (off >= u8.length) return null;
    var first = u8[off];
    if (first === 0) return null;
    var len = 1;
    var mask = 0x80;
    while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
    if (len > 8 || off + len > u8.length) return null;
    var value = keepMarker ? first : (first & (mask - 1));
    var unknown = !keepMarker && (first & (mask - 1)) === (mask - 1);
    for (var i = 1; i < len; i++) {
      value = value * 256 + u8[off + i];
      if (!keepMarker && u8[off + i] !== 0xff) unknown = false;
    }
    return { value: value, length: len, unknown: unknown };
  }

  function ebmlElement(u8, off, end) {
    var id = readEbmlVint(u8, off, true);
    if (!id) return null;
    var size = readEbmlVint(u8, off + id.length, false);
    if (!size) return null;
    var header = id.length + size.length;
    var dataStart = off + header;
    var dataEnd = size.unknown ? end : dataStart + size.value;
    if (dataStart > end) return null;
    if (dataEnd > end) dataEnd = end;
    return { id: id.value, start: off, dataStart: dataStart, dataEnd: dataEnd, unknown: size.unknown };
  }

  function parseWebm(u8, warnings) {
    var texts = [];
    var extra = {};
    var off = 0;
    var guard = 0;
    var segment = null;
    while (off < u8.length && guard++ < 10000) {
      var el = ebmlElement(u8, off, u8.length);
      if (!el) break;
      if (el.id === EBML) {
        parseEbmlHeader(u8, el.dataStart, el.dataEnd, extra, warnings);
      } else if (el.id === SEGMENT) {
        segment = el;
        break;
      }
      off = el.dataEnd;
    }
    if (segment) parseEbmlSegment(u8, segment.dataStart, segment.dataEnd, texts, warnings, 0);
    return { texts: texts, extra: extra };
  }

  function parseEbmlHeader(u8, start, end, extra, warnings) {
    var off = start;
    while (off < end) {
      var el = ebmlElement(u8, off, end);
      if (!el) break;
      if (el.id === 0x4282) extra.docType = stripTrailingNul(decodeSmart(u8.subarray(el.dataStart, el.dataEnd)));
      off = el.dataEnd;
    }
  }

  function parseEbmlSegment(u8, start, end, texts, warnings, depth) {
    if (depth > 4) return;
    var off = start;
    var guard = 0;
    while (off < end && guard++ < 20000) {
      var el = ebmlElement(u8, off, end);
      if (!el) break;
      if (el.id === TAGS) parseEbmlTags(u8, el.dataStart, el.dataEnd, texts, warnings, 0);
      else if (el.id === INFO) parseEbmlInfo(u8, el.dataStart, el.dataEnd, texts, warnings);
      off = el.dataEnd;
      if (off <= el.start) break;
    }
  }

  function parseEbmlInfo(u8, start, end, texts, warnings) {
    var off = start;
    while (off < end) {
      var el = ebmlElement(u8, off, end);
      if (!el) break;
      var txt = '';
      if (el.id === TITLE) txt = stripTrailingNul(decodeSmart(u8.subarray(el.dataStart, el.dataEnd)));
      else if (el.id === MUXING_APP) txt = stripTrailingNul(decodeSmart(u8.subarray(el.dataStart, el.dataEnd)));
      else if (el.id === WRITING_APP) txt = stripTrailingNul(decodeSmart(u8.subarray(el.dataStart, el.dataEnd)));
      if (txt.trim()) texts.push({ key: el.id === TITLE ? 'Title' : (el.id === MUXING_APP ? 'MuxingApp' : 'WritingApp'), text: txt, source: 'WebM Info' });
      off = el.dataEnd;
    }
  }

  function parseEbmlTags(u8, start, end, texts, warnings, depth) {
    if (depth > 6) return;
    var off = start;
    while (off < end) {
      var el = ebmlElement(u8, off, end);
      if (!el) break;
      if (el.id === TAG) parseEbmlTag(u8, el.dataStart, el.dataEnd, texts, warnings, depth + 1);
      off = el.dataEnd;
    }
  }

  function parseEbmlTag(u8, start, end, texts, warnings, depth) {
    var off = start;
    while (off < end) {
      var el = ebmlElement(u8, off, end);
      if (!el) break;
      if (el.id === SIMPLE_TAG) parseEbmlSimpleTag(u8, el.dataStart, el.dataEnd, texts, warnings, depth + 1);
      off = el.dataEnd;
    }
  }

  function parseEbmlSimpleTag(u8, start, end, texts, warnings, depth) {
    var off = start;
    var name = null;
    var value = null;
    var binary = false;
    while (off < end) {
      var el = ebmlElement(u8, off, end);
      if (!el) break;
      if (el.id === TAG_NAME) name = stripTrailingNul(decodeSmart(u8.subarray(el.dataStart, el.dataEnd)));
      else if (el.id === TAG_STRING) value = stripTrailingNul(decodeSmart(u8.subarray(el.dataStart, el.dataEnd)));
      else if (el.id === TAG_BINARY) binary = true;
      else if (el.id === SIMPLE_TAG) parseEbmlSimpleTag(u8, el.dataStart, el.dataEnd, texts, warnings, depth + 1);
      off = el.dataEnd;
    }
    if (name && value && value.trim() && !binary) {
      texts.push({ key: name, text: value, source: 'WebM Tag' });
    }
  }

  // ---------------------------------------------------------------------------
  // 文件读取 / 类型识别
  // ---------------------------------------------------------------------------

  function readRange(file, start, end) {
    var len = Math.max(0, Math.min(file.size, end) - start);
    if (len === 0) return Promise.resolve(new Uint8Array(0));
    return file.slice(start, start + len).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  async function readAll(file) {
    var ab = await file.arrayBuffer();
    return new Uint8Array(ab);
  }

  function detectKind(head, ext) {
    if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
    if (head.length >= 6 && ascii(head, 0, 3) === 'GIF') return 'gif';
    if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return 'webp';
    if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'webm';
    if (head.length >= 8 && ascii(head, 4, 4) === 'ftyp') {
      var brand = ascii(head, 8, 4);
      if (brand === 'avif' || brand === 'avis') return 'avif';
      return 'mp4';
    }
    if (ext === 'json' || (head.length && (head[0] === 0x7b || head[0] === 0x5b))) return 'json';
    var map = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', jpe: 'jpeg', webp: 'webp', gif: 'gif', mp4: 'mp4', m4v: 'mp4', mov: 'mp4', webm: 'webm', mkv: 'webm', avif: 'avif', json: 'json' };
    return map[ext] || 'unknown';
  }

  // ---------------------------------------------------------------------------
  // 元数据整理
  // ---------------------------------------------------------------------------

  function createEmptyMetadata() {
    return {
      prompt: null,
      workflow: null,
      promptRaw: null,
      workflowRaw: null,
      entries: [],
      candidates: [],
      promptSource: null,
      workflowSource: null
    };
  }

  function interpretTexts(texts, warnings) {
    var meta = createEmptyMetadata();
    var candidates = [];
    var entries = [];

    for (var i = 0; i < texts.length; i++) {
      var t = texts[i];
      if (!t || typeof t.text !== 'string' || !t.text.trim()) continue;
      var text = t.text;
      entries.push({ key: t.key || 'text', source: t.source || '未知', text: text });
      var keyLower = String(t.key || '').toLowerCase();
      var found = analyzeJsonText(text, t.source || t.key || '文本', 0);
      for (var f = 0; f < found.length; f++) {
        found[f].entryKey = t.key;
        candidates.push(found[f]);
      }
      // 即使不是 ComfyUI JSON，也记录一份; 后面用于其它参数展示
    }

    candidates = dedupeCandidates(candidates);
    meta.candidates = candidates;
    meta.entries = entries;

    var promptCandidates = candidates.filter(function (c) { return c.kind === 'prompt'; });
    var workflowCandidates = candidates.filter(function (c) { return c.kind === 'workflow'; });
    promptCandidates.sort(function (a, b) { return scoreJson('prompt', b.obj) - scoreJson('prompt', a.obj); });
    workflowCandidates.sort(function (a, b) { return scoreJson('workflow', b.obj) - scoreJson('workflow', a.obj); });

    if (promptCandidates.length) {
      meta.prompt = promptCandidates[0].obj;
      meta.promptRaw = promptCandidates[0].raw;
      meta.promptSource = promptCandidates[0].source;
      if (promptCandidates.length > 1) warnings.push('检测到多份 prompt 元数据，已选用节点最多的一份');
    }
    if (workflowCandidates.length) {
      meta.workflow = workflowCandidates[0].obj;
      meta.workflowRaw = workflowCandidates[0].raw;
      meta.workflowSource = workflowCandidates[0].source;
      if (workflowCandidates.length > 1) warnings.push('检测到多份 workflow 元数据，已选用节点最多的一份');
    }

    // 精确字段名优先（例如 tEXt 的 prompt / workflow 即使不是最大候选也优先）
    for (var e = 0; e < entries.length; e++) {
      var entry = entries[e];
      var key = String(entry.key).toLowerCase().trim();
      if (!meta.prompt && /(^|[^a-z])prompt([^a-z]|$)/i.test(key)) {
        var pc = candidates.filter(function (c) { return c.kind === 'prompt' && c.entryKey === entry.key; })[0];
        if (pc) { meta.prompt = pc.obj; meta.promptRaw = pc.raw; meta.promptSource = entry.source; }
      }
      if (!meta.workflow && /workflow/i.test(key)) {
        var wc = candidates.filter(function (c) { return c.kind === 'workflow' && c.entryKey === entry.key; })[0];
        if (wc) { meta.workflow = wc.obj; meta.workflowRaw = wc.raw; meta.workflowSource = entry.source; }
      }
    }

    return meta;
  }

  function decodeContainerTag(text) {
    // WebP EXIF 中 ComfyUI 写成 "workflow:{...}" / "prompt:{...}"
    if (typeof text !== 'string') return text;
    return text.trim();
  }

  // ---------------------------------------------------------------------------
  // 节点与参数
  // ---------------------------------------------------------------------------

  function categorize(classType) {
    var c = String(classType || '');
    if (/save|preview|video\s*combine|output|export/i.test(c)) return 'output';
    if (/lora|checkpoint|loader|load|unet|clip|vae|controlnet|upscale|stylemodel|ipadapter|instantid|photomaker|gguf/i.test(c)) return 'loader';
    if (/sampler|guider|scheduler|noise|sigmas|sampling|cfg/i.test(c)) return 'sampler';
    if (/text|conditioning|prompt|encode|guidance|gligen|controlnet\s*apply/i.test(c)) return 'condition';
    if (/latent|empty|image|video|frame|mask|resize|crop|composite|vae\s*(encode|decode)|pixel/i.test(c)) return 'latent';
    if (/audio|sound|music|speech/i.test(c)) return 'audio';
    return 'other';
  }

  function categoryLabel(cat) {
    return { loader: '加载器', sampler: '采样', condition: '条件', latent: '图像/潜空间', output: '输出', audio: '音频', other: '其他' }[cat] || '其他';
  }

  function categoryColor(cat) {
    return {
      loader: '#f59e0b', sampler: '#a78bfa', condition: '#38bdf8', latent: '#34d399',
      output: '#f472b6', audio: '#fb7185', other: '#94a3b8'
    }[cat] || '#94a3b8';
  }

  function numericIdCompare(a, b) {
    var na = Number(a), nb = Number(b);
    if (isFinite(na) && isFinite(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  }

  function buildPromptNodes(prompt, workflow) {
    if (!looksLikePrompt(prompt)) return [];
    var wfMap = new Map();
    if (workflow && Array.isArray(workflow.nodes)) {
      for (var w = 0; w < workflow.nodes.length; w++) {
        var wn = workflow.nodes[w];
        if (wn && wn.id !== undefined) wfMap.set(String(wn.id), wn);
      }
    }
    var ids = Object.keys(prompt).filter(function (id) {
      var v = prompt[id];
      return isPlainObject(v) && typeof v.class_type === 'string';
    }).sort(numericIdCompare);
    var nodes = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var raw = prompt[id];
      var wf = wfMap.get(String(id));
      var cls = raw.class_type;
      var title = (raw._meta && raw._meta.title) || (wf && (wf.title || wf.properties && wf.properties['Node name for S&R'])) || cls;
      var cat = categorize(cls);
      var inputs = [];
      var rawInputs = raw.inputs || {};
      var keys = Object.keys(rawInputs);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var val = rawInputs[key];
        var link = null;
        if (Array.isArray(val) && val.length >= 2 && (typeof val[0] === 'string' || typeof val[0] === 'number') && prompt[String(val[0])]) {
          link = { id: String(val[0]), slot: Number(val[1]) };
        } else if (Array.isArray(val) && val.length && Array.isArray(val[0]) && val[0].length >= 2 && prompt[String(val[0][0])]) {
          link = val.map(function (v) { return { id: String(v[0]), slot: Number(v[1]) }; });
        }
        inputs.push({ key: key, value: link ? null : val, link: link });
      }
      nodes.push({
        id: String(id),
        classType: cls,
        title: title,
        category: cat,
        categoryLabel: categoryLabel(cat),
        inputs: inputs,
        raw: raw,
        workflowNode: wf || null,
        mode: wf && typeof wf.mode === 'number' ? wf.mode : 0
      });
    }
    return nodes;
  }

  var WORKFLOW_WIDGET_NAMES = {
    CheckpointLoaderSimple: ['ckpt_name'],
    CheckpointLoader: ['config_name', 'ckpt_name'],
    LoraLoader: ['lora_name', 'strength_model', 'strength_clip'],
    LoraLoaderModelOnly: ['lora_name', 'strength_model'],
    CLIPTextEncode: ['text'],
    CLIPTextEncodeSDXL: ['width', 'height', 'crop_w', 'crop_h', 'target_width', 'target_height', 'text_g', 'text_l'],
    KSampler: ['seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
    KSamplerAdvanced: ['add_noise', 'noise_seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'start_at_step', 'end_at_step', 'return_with_leftover_noise'],
    EmptyLatentImage: ['width', 'height', 'batch_size'],
    EmptySD3LatentImage: ['width', 'height', 'batch_size'],
    SaveImage: ['filename_prefix'],
    SaveAnimatedWEBP: ['filename_prefix', 'fps', 'lossless', 'quality', 'method'],
    VAELoader: ['vae_name'],
    UNETLoader: ['unet_name', 'weight_dtype'],
    CLIPLoader: ['clip_name', 'type'],
    DualCLIPLoader: ['clip_name1', 'clip_name2', 'type'],
    ControlNetLoader: ['control_net_name'],
    UpscaleModelLoader: ['model_name'],
    ImageScale: ['upscale_method', 'width', 'height', 'crop']
  };

  function buildWorkflowNodes(workflow) {
    if (!looksLikeWorkflow(workflow)) return [];
    var links = new Map();
    if (Array.isArray(workflow.links)) {
      for (var i = 0; i < workflow.links.length; i++) {
        var l = workflow.links[i];
        if (Array.isArray(l) && l.length >= 5) links.set(l[0], l);
      }
    }
    var out = [];
    var wfNodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    for (var n = 0; n < wfNodes.length; n++) {
      var node = wfNodes[n];
      if (!node || typeof node.type !== 'string') continue;
      var title = node.title || (node.properties && node.properties['Node name for S&R']) || node.type;
      var cat = categorize(node.type);
      var inputs = [];
      var nodeInputs = Array.isArray(node.inputs) ? node.inputs : [];
      for (var j = 0; j < nodeInputs.length; j++) {
        var inp = nodeInputs[j];
        if (!inp) continue;
        if (inp.link !== null && inp.link !== undefined && links.has(inp.link)) {
          var ll = links.get(inp.link);
          inputs.push({
            key: inp.name || ('input_' + j),
            value: inp.widget && inp.widget.value !== undefined ? inp.widget.value : null,
            link: { id: String(ll[1]), slot: Number(ll[2]), outputSlot: Number(ll[2]), type: ll[5] || inp.type || '' }
          });
        } else if (inp.widget && inp.widget.value !== undefined) {
          inputs.push({ key: inp.name || ('input_' + j), value: inp.widget.value, link: null });
        } else if (inp.link === null || inp.link === undefined) {
          inputs.push({ key: inp.name || ('input_' + j), value: null, link: null });
        }
      }
      if (Array.isArray(node.widgets_values)) {
        var widgetNames = WORKFLOW_WIDGET_NAMES[node.type] || [];
        for (var wv = 0; wv < node.widgets_values.length; wv++) {
          var wkey = widgetNames[wv] || ('widget[' + wv + ']');
          if (!inputs.some(function (x) { return x.key === wkey; })) {
            inputs.push({ key: wkey, value: node.widgets_values[wv], link: null });
          }
        }
      }
      out.push({
        id: String(node.id),
        classType: node.type,
        title: title,
        category: cat,
        categoryLabel: categoryLabel(cat),
        inputs: inputs,
        raw: node,
        workflowNode: node,
        mode: typeof node.mode === 'number' ? node.mode : 0,
        pos: node.pos,
        size: node.size
      });
    }
    return out.sort(function (a, b) { return numericIdCompare(a.id, b.id); });
  }

  function nodeMapFromPrompt(prompt) {
    var map = new Map();
    if (!looksLikePrompt(prompt)) return map;
    var ids = Object.keys(prompt);
    for (var i = 0; i < ids.length; i++) {
      var v = prompt[ids[i]];
      if (isPlainObject(v) && typeof v.class_type === 'string') {
        map.set(String(ids[i]), {
          id: String(ids[i]),
          classType: v.class_type,
          title: (v._meta && v._meta.title) || v.class_type,
          inputs: v.inputs || {},
          raw: v
        });
      }
    }
    return map;
  }

  function asLink(v, map) {
    if (Array.isArray(v) && v.length >= 2 && (typeof v[0] === 'string' || typeof v[0] === 'number') && map.has(String(v[0]))) {
      return { id: String(v[0]), slot: Number(v[1]) };
    }
    return null;
  }

  function walkUpstream(start, map, visit) {
    if (!start) return;
    var seen = new Set();
    var stack = [start];
    var guard = 0;
    while (stack.length && guard++ < 10000) {
      var cur = stack.pop();
      if (!cur) continue;
      var key = cur.id + ':' + (cur.slot === undefined ? '' : cur.slot);
      if (seen.has(key)) continue;
      seen.add(key);
      var node = map.get(String(cur.id));
      if (!node) continue;
      visit(node, cur);
      var inputs = node.inputs || {};
      var keys = Object.keys(inputs);
      for (var i = 0; i < keys.length; i++) {
        var v = inputs[keys[i]];
        var l = asLink(v, map);
        if (l) stack.push(l);
        else if (Array.isArray(v)) {
          for (var j = 0; j < v.length; j++) {
            var l2 = asLink(v[j], map);
            if (l2) stack.push(l2);
          }
        }
      }
    }
  }

  function textOfNode(node) {
    var inp = node.inputs || {};
    if (typeof inp.text === 'string' && inp.text.trim()) return inp.text;
    if (typeof inp.text_g === 'string' || typeof inp.text_l === 'string') {
      return [inp.text_g, inp.text_l].filter(function (x) { return typeof x === 'string' && x.trim(); }).join('\n');
    }
    if (typeof inp.clip_l === 'string' || typeof inp.t5xxl === 'string') {
      return [inp.clip_l, inp.t5xxl].filter(function (x) { return typeof x === 'string' && x.trim(); }).join('\n');
    }
    if (typeof inp.string === 'string' && /text|string|prompt/i.test(node.classType)) return inp.string;
    if (typeof inp.prompt === 'string' && /text|prompt/i.test(node.classType)) return inp.prompt;
    return '';
  }

  function collectTextsFromLink(link, map) {
    if (!link) return [];
    var found = [];
    walkUpstream(link, map, function (node) {
      var text = textOfNode(node);
      if (text) found.push({ nodeId: node.id, title: node.title, classType: node.classType, text: text });
    });
    return uniqueBy(found, function (x) { return x.nodeId; });
  }

  function linkLabel(link, map) {
    if (!link) return null;
    var node = map.get(String(link.id));
    return {
      id: String(link.id),
      slot: link.slot,
      classType: node ? node.classType : '未知节点',
      title: node ? node.title : ('#' + link.id)
    };
  }

  function findSamplerNodes(map) {
    var arr = [];
    map.forEach(function (node) {
      var c = node.classType;
      if (!/sampler|guider/i.test(c)) return;
      if (/select|scheduler|sigmas/i.test(c)) return;
      var inp = node.inputs || {};
      var score = 0;
      if (inp.latent_image) score += 3;
      if (inp.steps !== undefined) score += 2;
      if (inp.seed !== undefined || inp.noise_seed !== undefined) score += 2;
      if (inp.positive || inp.negative) score += 1;
      if (inp.model) score += 1;
      if (inp.cfg !== undefined) score += 1;
      if (score > 0) arr.push({ node: node, score: score });
    });
    arr.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return numericIdCompare(a.node.id, b.node.id);
    });
    return arr.map(function (x) { return x.node; });
  }

  function traceField(start, map, keys, maxDepth) {
    var result = null;
    if (!start) return result;
    walkUpstream(start, map, function (node) {
      if (result !== null) return;
      var inp = node.inputs || {};
      for (var i = 0; i < keys.length; i++) {
        if (inp[keys[i]] !== undefined && inp[keys[i]] !== null) {
          result = { value: inp[keys[i]], node: node };
          return;
        }
      }
    });
    return result;
  }

  function buildSummary(prompt, workflow, nodes) {
    var map = nodeMapFromPrompt(prompt);
    var samplers = findSamplerNodes(map);
    var primary = samplers[0] || null;
    var allNodes = Array.from(map.values());
    var summary = {
      positive: null,
      negative: null,
      positiveNodes: [],
      negativeNodes: [],
      modelName: null,
      modelSource: null,
      loras: [],
      others: [],
      sampler: null,
      samplers: [],
      latent: null,
      outputs: [],
      counts: { nodes: nodes.length, byClass: {}, byCategory: {} },
      promptMissing: !prompt,
      workflowOnly: !prompt && !!workflow
    };

    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      summary.counts.byClass[n.classType] = (summary.counts.byClass[n.classType] || 0) + 1;
      summary.counts.byCategory[n.category] = (summary.counts.byCategory[n.category] || 0) + 1;
    }

    // 条件文本：优先 sampler.positive / negative，其次 guider，再退回全图
    var posLink = primary ? asLink(primary.inputs.positive, map) : null;
    var negLink = primary ? asLink(primary.inputs.negative, map) : null;
    if (primary && (!posLink || !negLink)) {
      var guiderLink = asLink(primary.inputs.guider, map);
      if (guiderLink) {
        walkUpstream(guiderLink, map, function (g) {
          if (!posLink) posLink = asLink(g.inputs.positive, map);
          if (!negLink) negLink = asLink(g.inputs.negative, map);
        });
      }
    }
    if (!posLink && !negLink) {
      var textNodes = allNodes.filter(function (n) { return !!textOfNode(n); });
      var posNode = textNodes.filter(function (n) { return /positive|正向|正面|pos/i.test(n.title + ' ' + n.classType); })[0] || textNodes[0];
      var negNode = textNodes.filter(function (n) { return /negative|负向|负面|neg/i.test(n.title + ' ' + n.classType); })[0] || (textNodes.length > 1 ? textNodes[1] : null);
      if (posNode) summary.positiveNodes = [{ nodeId: posNode.id, title: posNode.title, classType: posNode.classType, text: textOfNode(posNode) }];
      if (negNode && negNode.id !== (posNode && posNode.id)) summary.negativeNodes = [{ nodeId: negNode.id, title: negNode.title, classType: negNode.classType, text: textOfNode(negNode) }];
    } else {
      summary.positiveNodes = collectTextsFromLink(posLink, map);
      summary.negativeNodes = collectTextsFromLink(negLink, map);
    }
    summary.positive = joinTexts(summary.positiveNodes);
    summary.negative = joinTexts(summary.negativeNodes);

    // 模型链
    var modelLink = primary ? asLink(primary.inputs.model, map) : null;
    if (!modelLink && primary) {
      var gLink = asLink(primary.inputs.guider, map);
      if (gLink) {
        walkUpstream(gLink, map, function (g) {
          if (!modelLink) modelLink = asLink(g.inputs.model, map);
        });
      }
    }
    var modelNodes = [];
    walkUpstream(modelLink, map, function (node) {
      var inp = node.inputs || {};
      if (inp.ckpt_name || inp.unet_name || inp.model_name || inp.gguf_name || inp.checkpoint) {
        modelNodes.push(node);
      }
      if (/lora/i.test(node.classType) || inp.lora_name) {
        summary.loras.push({
          nodeId: node.id,
          title: node.title,
          name: firstDefined(inp.lora_name, inp.lora, inp.name),
          strengthModel: inp.strength_model,
          strengthClip: inp.strength_clip
        });
      }
      if (inp.vae_name) summary.others.push({ kind: 'VAE', name: inp.vae_name, nodeId: node.id });
      if (inp.clip_name || inp.clip_name1 || inp.clip_name2) {
        summary.others.push({ kind: 'CLIP', name: firstDefined(inp.clip_name, inp.clip_name1, inp.clip_name2), nodeId: node.id });
      }
    });
    if (!modelNodes.length) {
      for (var mi = 0; mi < allNodes.length; mi++) {
        var mn = allNodes[mi];
        var minp = mn.inputs || {};
        if (minp.ckpt_name || minp.unet_name || minp.model_name || minp.gguf_name || minp.checkpoint) modelNodes.push(mn);
      }
    }
    if (modelNodes.length) {
      var mnode = modelNodes[0];
      var mkeys = ['ckpt_name', 'unet_name', 'model_name', 'gguf_name', 'checkpoint'];
      for (var mk = 0; mk < mkeys.length; mk++) {
        if (mnode.inputs[mkeys[mk]]) {
          summary.modelName = mnode.inputs[mkeys[mk]];
          summary.modelSource = { nodeId: mnode.id, title: mnode.title, field: mkeys[mk] };
          break;
        }
      }
    }
    // 全图收集 LoRA（有些工作流模型链没有连接 LoRA 输出）
    for (var li = 0; li < allNodes.length; li++) {
      var ln = allNodes[li];
      if (/lora/i.test(ln.classType) && ln.inputs && ln.inputs.lora_name) {
        var exists = summary.loras.some(function (x) { return x.nodeId === ln.id; });
        if (!exists) {
          summary.loras.push({
            nodeId: ln.id,
            title: ln.title,
            name: ln.inputs.lora_name,
            strengthModel: ln.inputs.strength_model,
            strengthClip: ln.inputs.strength_clip
          });
        }
      }
    }
    summary.loras = uniqueBy(summary.loras, function (x) { return x.nodeId; });
    summary.others = uniqueBy(summary.others, function (x) { return x.kind + ':' + x.nodeId + ':' + x.name; });

    // 采样器参数
    for (var si = 0; si < samplers.length; si++) {
      summary.samplers.push(extractSampler(samplers[si], map));
    }
    summary.sampler = summary.samplers[0] || null;

    // 尺寸 / 批次
    var latentLink = primary ? asLink(primary.inputs.latent_image, map) : null;
    var latent = findLatentInfo(latentLink, map, allNodes);
    summary.latent = latent;

    // 输出节点
    var outputNodes = nodes.filter(function (n) {
      return /save|preview|video\s*combine|output/i.test(n.classType) && !/loader/i.test(n.classType);
    });
    for (var oi = 0; oi < outputNodes.length; oi++) {
      var on = outputNodes[oi];
      summary.outputs.push(extractOutput(on));
    }

    return summary;
  }

  function joinTexts(items) {
    var seen = new Set();
    var parts = [];
    for (var i = 0; i < items.length; i++) {
      var t = (items[i].text || '').trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      parts.push(t);
    }
    return parts.length ? parts.join('\n\n') : null;
  }

  function extractSampler(node, map) {
    var inp = node.inputs || {};
    function scalar(v) {
      return (v === undefined || v === null || Array.isArray(v) || typeof v === 'object') ? undefined : v;
    }
    var out = {
      nodeId: node.id,
      title: node.title,
      classType: node.classType,
      seed: scalar(inp.seed) !== undefined ? scalar(inp.seed) : scalar(inp.noise_seed),
      steps: scalar(inp.steps),
      cfg: scalar(inp.cfg),
      samplerName: scalar(inp.sampler_name) !== undefined ? scalar(inp.sampler_name) : scalar(inp.sampler),
      scheduler: scalar(inp.scheduler),
      denoise: scalar(inp.denoise),
      startAtStep: scalar(inp.start_at_step),
      endAtStep: scalar(inp.end_at_step),
      sources: {}
    };
    if (out.seed !== undefined) out.sources.seed = node.id;
    if (out.steps !== undefined) out.sources.steps = node.id;
    if (out.cfg !== undefined) out.sources.cfg = node.id;
    if (out.samplerName !== undefined) out.sources.sampler = node.id;
    if (out.scheduler !== undefined) out.sources.scheduler = node.id;

    // SamplerCustomAdvanced：seed 在 RandomNoise，cfg 在 Guider，steps 在 Sigmas/Scheduler
    if (out.seed === undefined && inp.noise) {
      var s = traceField(asLink(inp.noise, map), map, ['noise_seed', 'seed']);
      if (s) { out.seed = s.value; out.sources.seed = s.node.id; }
    }
    if (out.cfg === undefined && inp.guider) {
      var c = traceField(asLink(inp.guider, map), map, ['cfg']);
      if (c) { out.cfg = c.value; out.sources.cfg = c.node.id; }
    }
    if (out.steps === undefined && inp.sigmas) {
      var st = traceField(asLink(inp.sigmas, map), map, ['steps']);
      if (st) { out.steps = st.value; out.sources.steps = st.node.id; }
    }
    if (out.steps === undefined && inp.scheduler) {
      var st2 = traceField(asLink(inp.scheduler, map), map, ['steps']);
      if (st2) { out.steps = st2.value; out.sources.steps = st2.node.id; }
    }
    if (out.samplerName === undefined && inp.sampler) {
      var sn = traceField(asLink(inp.sampler, map), map, ['sampler_name']);
      if (sn) { out.samplerName = sn.value; out.sources.sampler = sn.node.id; }
    }
    if (out.scheduler === undefined && inp.sigmas) {
      var sc = traceField(asLink(inp.sigmas, map), map, ['scheduler']);
      if (sc) { out.scheduler = sc.value; out.sources.scheduler = sc.node.id; }
    }
    return out;
  }

  function findLatentInfo(link, map, allNodes) {
    var info = { width: null, height: null, batch: null, frames: null, source: null, details: [] };
    function take(node) {
      var inp = node.inputs || {};
      if (info.width === null && num(inp.width) !== null) { info.width = num(inp.width); info.source = info.source || node.id; }
      if (info.height === null && num(inp.height) !== null) { info.height = num(inp.height); info.source = info.source || node.id; }
      if (info.batch === null && num(inp.batch_size) !== null) { info.batch = num(inp.batch_size); }
      if (info.frames === null && num(firstDefined(inp.length, inp.frame_count, inp.num_frames)) !== null) {
        info.frames = num(firstDefined(inp.length, inp.frame_count, inp.num_frames));
        info.source = info.source || node.id;
      }
      if (num(inp.width) !== null || num(inp.height) !== null || num(inp.length) !== null) {
        info.details.push({ nodeId: node.id, classType: node.classType, width: num(inp.width), height: num(inp.height), batch: num(inp.batch_size), frames: num(firstDefined(inp.length, inp.frame_count, inp.num_frames)) });
      }
    }
    walkUpstream(link, map, take);
    if (info.width === null || info.height === null) {
      for (var i = 0; i < allNodes.length; i++) {
        var n = allNodes[i];
        if (/EmptyLatent|Empty.*Latent|WanImageToVideo|Hunyuan.*Video|LTXV.*Video|SD3.*Latent|Latent/i.test(n.classType)) take(n);
        if (info.width !== null && info.height !== null) break;
      }
    }
    return info;
  }

  function extractOutput(node) {
    var inp = node.inputs || {};
    var o = {
      nodeId: node.id,
      classType: node.classType,
      title: node.title,
      filenamePrefix: inp.filename_prefix,
      format: inp.format,
      fps: firstDefined(inp.frame_rate, inp.fps),
      crf: inp.crf,
      quality: inp.quality,
      lossless: inp.lossless,
      saveMetadata: inp.save_metadata,
      loopCount: inp.loop_count,
      pingpong: inp.pingpong,
      frames: firstDefined(inp.frame_load_cap, inp.frame_count),
      codec: inp.codec,
      raw: inp
    };
    return o;
  }

  function buildWorkflowInfo(workflow, nodes) {
    if (!looksLikeWorkflow(workflow)) return null;
    var wfNodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    var groups = [];
    if (Array.isArray(workflow.groups)) {
      for (var i = 0; i < workflow.groups.length; i++) {
        var g = workflow.groups[i];
        if (!g) continue;
        groups.push({
          title: g.title || '未命名分组',
          bounding: Array.isArray(g.bounding) ? g.bounding : null,
          color: g.color
        });
      }
    }
    var muted = [];
    var bypassed = [];
    for (var n = 0; n < wfNodes.length; n++) {
      var node = wfNodes[n];
      if (!node) continue;
      var item = { id: String(node.id), title: node.title || node.type, type: node.type, mode: node.mode };
      if (node.mode === 2) muted.push(item);
      if (node.mode === 4) bypassed.push(item);
    }
    return {
      nodeCount: wfNodes.length,
      linkCount: Array.isArray(workflow.links) ? workflow.links.length : 0,
      groupCount: groups.length,
      groups: groups,
      muted: muted,
      bypassed: bypassed,
      version: workflow.version,
      revision: workflow.revision,
      lastNodeId: workflow.last_node_id,
      extra: workflow.extra || null,
      raw: workflow
    };
  }

  // ---------------------------------------------------------------------------
  // 报告
  // ---------------------------------------------------------------------------

  function buildReport(fileInfo, kind, container, containerResult, warnings, scanInfo) {
    var texts = (containerResult && containerResult.texts) || [];
    var meta = interpretTexts(texts, warnings);
    var prompt = meta.prompt;
    var workflow = meta.workflow;
    var nodes = prompt ? buildPromptNodes(prompt, workflow) : buildWorkflowNodes(workflow);
    var summary = buildSummary(prompt, workflow, nodes);
    var wfInfo = buildWorkflowInfo(workflow, nodes);

    if (!prompt && !workflow) {
      warnings.push('未找到 ComfyUI 的 prompt / workflow 元数据');
    } else if (!prompt && workflow) {
      warnings.push('只找到 UI workflow，没有 API prompt；节点值按 workflow 的 widgets_values 顺序展示，标签可能不是真实参数名');
    } else if (prompt && !workflow) {
      warnings.push('只找到 API prompt，没有 UI workflow；缺少画布布局与节点标题');
    }

    var detection = [];
    if (prompt) detection.push('prompt · ' + (meta.promptSource || '未知来源'));
    if (workflow) detection.push('workflow · ' + (meta.workflowSource || '未知来源'));

    return {
      tool: 'ComfyUI Param Inspector',
      version: VERSION,
      file: fileInfo,
      kind: kind,
      container: container,
      detection: detection,
      metadata: {
        prompt: prompt,
        workflow: workflow,
        promptRaw: meta.promptRaw,
        workflowRaw: meta.workflowRaw,
        promptSource: meta.promptSource,
        workflowSource: meta.workflowSource,
        entries: meta.entries,
        candidates: meta.candidates.map(function (c) {
          return { kind: c.kind, source: c.source, entryKey: c.entryKey || null, chars: c.raw ? c.raw.length : 0 };
        })
      },
      nodes: nodes,
      summary: summary,
      workflowInfo: wfInfo,
      warnings: warnings,
      scan: scanInfo || null,
      extra: (containerResult && containerResult.extra) || {}
    };
  }

  // ---------------------------------------------------------------------------
  // 入口
  // ---------------------------------------------------------------------------

  function makeFileLike(file) {
    if (file && typeof file.slice === 'function' && typeof file.arrayBuffer === 'function') return file;
    throw new Error('parseFile 需要 File/Blob 对象');
  }

  async function parseFile(input) {
    var file = makeFileLike(input);
    var name = file.name || '未命名文件';
    var size = file.size || 0;
    var ext = extOf(name);
    var warnings = [];
    var head = await readRange(file, 0, Math.min(32, size));
    var kind = detectKind(head, ext);
    var containerResult = { texts: [], extra: {} };
    var container = '未知';
    var truncated = false;
    var fallbackRaw = null;

    if (kind === 'json') {
      var text = decodeSmart(await readAll(file));
      containerResult.texts.push({ key: 'file', text: text, source: 'JSON 文件' });
      container = 'JSON';
    } else if (kind === 'mp4' || kind === 'avif') {
      try { containerResult = await parseMp4(file, warnings); }
      catch (e) { warnings.push('MP4 解析失败：' + e.message); containerResult = { texts: [], extra: {} }; }
      container = kind === 'avif' ? 'AVIF' : 'MP4';
    } else if (kind === 'webm') {
      if (size <= FULL_READ_LIMIT) {
        var wb = await readAll(file);
        fallbackRaw = wb;
        try { containerResult = parseWebm(wb, warnings); }
        catch (e) { warnings.push('WebM 解析失败：' + e.message); containerResult = { texts: [], extra: {} }; }
        container = 'WebM';
      } else {
        var wh = await readRange(file, 0, 16 * MB);
        var wt = await readRange(file, Math.max(0, size - VIDEO_TAIL_LIMIT), size);
        containerResult.texts.push({ key: 'head', text: decodeSmart(wh), source: 'WebM 首段' });
        containerResult.texts.push({ key: 'tail', text: decodeSmart(wt), source: 'WebM 尾段' });
        container = 'WebM（大文件扫描）';
        truncated = true;
        warnings.push('WebM 文件超过 128MB，仅扫描首尾以查找文本元数据');
      }
    } else if (kind === 'png' || kind === 'jpeg' || kind === 'webp' || kind === 'gif') {
      var buf;
      if (size <= FULL_READ_LIMIT) {
        buf = await readAll(file);
      } else {
        buf = await readRange(file, 0, IMAGE_HEAD_LIMIT);
        truncated = true;
        warnings.push('图片文件超过 128MB，仅读取前 40MB；元数据通常位于文件开头');
      }
      fallbackRaw = buf;
      if (kind === 'png') {
        try {
          containerResult = parsePng(buf, warnings);
          containerResult = await resolvePngTexts(containerResult, warnings);
        } catch (e) {
          warnings.push('PNG 解析失败：' + e.message);
          containerResult = { texts: [], extra: {} };
        }
        container = 'PNG';
      } else if (kind === 'jpeg') {
        try { containerResult = parseJpeg(buf, warnings); }
        catch (e) { warnings.push('JPEG 解析失败：' + e.message); containerResult = { texts: [], extra: {} }; }
        container = 'JPEG';
      } else if (kind === 'webp') {
        try { containerResult = parseWebp(buf, warnings); }
        catch (e) { warnings.push('WebP 解析失败：' + e.message); containerResult = { texts: [], extra: {} }; }
        container = 'WebP';
      } else {
        try { containerResult = parseGif(buf, warnings); }
        catch (e) { warnings.push('GIF 解析失败：' + e.message); containerResult = { texts: [], extra: {} }; }
        container = 'GIF';
      }
    } else {
      // 未知格式：把整个文件当文本扫描（上限 64MB）
      var ub = size <= 64 * MB ? await readAll(file) : await readRange(file, 0, 64 * MB);
      if (size > 64 * MB) { truncated = true; warnings.push('未知格式文件过大，仅扫描前 64MB'); }
      var utext = decodeSmart(ub);
      if (/[\x00-\x08\x0e-\x1f]/.test(utext.slice(0, 1000))) {
        warnings.push('无法识别文件容器格式');
      }
      containerResult.texts.push({ key: 'raw', text: utext, source: '原始扫描' });
      container = '未知格式';
    }

    var report = buildReport(
      { name: name, size: size, type: file.type || '', ext: ext },
      kind === 'avif' ? 'mp4' : kind,
      container,
      containerResult,
      warnings,
      { truncated: truncated, bytesRead: size <= FULL_READ_LIMIT ? size : null }
    );

    // 容器里完全没识别出 ComfyUI JSON 时，对原始文本做一次兜底扫描
    if (!report.metadata.prompt && !report.metadata.workflow) {
      var scanText = containerResult.texts.map(function (t) { return t.text; }).join('\n');
      if (fallbackRaw && fallbackRaw.length <= 16 * MB) {
        scanText += '\n' + decodeSmart(fallbackRaw);
      }
      if (scanText) {
        var found = findJsonObjects(scanText, '兜底扫描');
        if (found.length) {
          var p = found.filter(function (c) { return c.kind === 'prompt'; })[0];
          var w = found.filter(function (c) { return c.kind === 'workflow'; })[0];
          if (p) {
            report.metadata.prompt = p.obj;
            report.metadata.promptRaw = p.raw;
            report.metadata.promptSource = p.source;
          }
          if (w) {
            report.metadata.workflow = w.obj;
            report.metadata.workflowRaw = w.raw;
            report.metadata.workflowSource = w.source;
          }
          if (p || w) {
            report.nodes = p ? buildPromptNodes(p.obj, w ? w.obj : null) : buildWorkflowNodes(w.obj);
            report.summary = buildSummary(p ? p.obj : null, w ? w.obj : null, report.nodes);
            report.workflowInfo = buildWorkflowInfo(w ? w.obj : null, report.nodes);
            report.detection = [];
            if (p) report.detection.push('prompt · ' + p.source);
            if (w) report.detection.push('workflow · ' + w.source);
            report.warnings = report.warnings.filter(function (x) { return x.indexOf('未找到') === -1 && x.indexOf('只找到') === -1; });
            if (p && !w) report.warnings.push('只找到 API prompt，没有 UI workflow；缺少画布布局与节点标题');
            if (w && !p) report.warnings.push('只找到 UI workflow，没有 API prompt；节点值按 workflow 的 widgets_values 顺序展示，标签可能不是真实参数名');
          }
        }
      }
    }

    return report;
  }

  async function parseBytes(bytes, name, type) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var file;
    if (typeof File !== 'undefined') {
      file = new File([u8], name || '未命名文件', { type: type || '' });
    } else {
      file = {
        name: name || '未命名文件', size: u8.length, type: type || '',
        slice: function (s, e) {
          var part = u8.slice(s, e);
          return { arrayBuffer: function () { return Promise.resolve(part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength)); } };
        },
        arrayBuffer: function () { return Promise.resolve(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)); }
      };
    }
    return parseFile(file);
  }

  return {
    VERSION: VERSION,
    parseFile: parseFile,
    parseBytes: parseBytes,
    findJsonObjects: findJsonObjects,
    categorize: categorize,
    categoryLabel: categoryLabel,
    categoryColor: categoryColor,
    workflowWidgetNames: WORKFLOW_WIDGET_NAMES,
    formatBytes: formatBytes,
    decodeSmart: decodeSmart,
    // 便于测试
    _internals: {
      parsePng: parsePng,
      parseJpeg: parseJpeg,
      parseWebp: parseWebp,
      parseGif: parseGif,
      parseWebm: parseWebm,
      buildPromptNodes: buildPromptNodes,
      buildSummary: buildSummary,
      looksLikePrompt: looksLikePrompt,
      looksLikeWorkflow: looksLikeWorkflow
    }
  };
});
