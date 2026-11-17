'use strict';
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

// ---------------- 示例 ComfyUI 工作流 ----------------

const PROMPT_TEXT = 'a solitary lighthouse on a basalt cliff at dusk, turbulent sea, volumetric storm clouds, dramatic god rays, cinematic wide shot, ultra detailed, moody teal and amber palette, 35mm film grain';
const NEGATIVE_TEXT = 'blurry, low quality, watermark, text, oversaturated, deformed structures, extra masts, bad anatomy';

const PROMPT = {
  '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'dreamshaperXL_v21TurboDPMSDE.safetensors' } },
  '2': { class_type: 'LoraLoader', inputs: { model: ['1', 0], clip: ['1', 1], lora_name: 'add_detail_xl.safetensors', strength_model: 0.65, strength_clip: 0.5 } },
  '3': { class_type: 'CLIPTextEncode', _meta: { title: '正向提示词' }, inputs: { text: PROMPT_TEXT, clip: ['2', 1] } },
  '4': { class_type: 'CLIPTextEncode', _meta: { title: '负向提示词' }, inputs: { text: NEGATIVE_TEXT, clip: ['2', 1] } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
  '6': {
    class_type: 'KSampler',
    _meta: { title: 'KSampler' },
    inputs: {
      seed: 123456789012345, steps: 28, cfg: 6.5, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1,
      model: ['2', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0]
    }
  },
  '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['1', 2] } },
  '8': { class_type: 'SaveImage', inputs: { filename_prefix: 'ComfyUI', images: ['7', 0] } }
};

function makeWorkflow() {
  const nodes = [
    {
      id: 1, type: 'CheckpointLoaderSimple', title: '加载模型', pos: [40, 120], size: [320, 106], flags: {}, order: 0, mode: 0,
      inputs: [], outputs: [
        { name: 'MODEL', type: 'MODEL', links: [1], slot_index: 0 },
        { name: 'CLIP', type: 'CLIP', links: [2, 3, 4], slot_index: 1 },
        { name: 'VAE', type: 'VAE', links: [5], slot_index: 2 }
      ],
      properties: { 'Node name for S&R': 'CheckpointLoaderSimple' }, widgets_values: ['dreamshaperXL_v21TurboDPMSDE.safetensors']
    },
    {
      id: 2, type: 'LoraLoader', title: '细节 LoRA', pos: [400, 120], size: [320, 130], flags: {}, order: 1, mode: 0,
      inputs: [
        { name: 'model', type: 'MODEL', link: 1 },
        { name: 'clip', type: 'CLIP', link: 2 }
      ],
      outputs: [
        { name: 'MODEL', type: 'MODEL', links: [6], slot_index: 0 },
        { name: 'CLIP', type: 'CLIP', links: [3, 4], slot_index: 1 }
      ],
      properties: { 'Node name for S&R': 'LoraLoader' }, widgets_values: ['add_detail_xl.safetensors', 0.65, 0.5]
    },
    {
      id: 3, type: 'CLIPTextEncode', title: '正向提示词', pos: [760, 40], size: [360, 190], flags: {}, order: 2, mode: 0,
      inputs: [{ name: 'clip', type: 'CLIP', link: 3 }],
      outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [7], slot_index: 0 }],
      properties: { 'Node name for S&R': 'CLIPTextEncode' }, widgets_values: [PROMPT_TEXT]
    },
    {
      id: 4, type: 'CLIPTextEncode', title: '负向提示词', pos: [760, 280], size: [360, 190], flags: {}, order: 3, mode: 0,
      inputs: [{ name: 'clip', type: 'CLIP', link: 4 }],
      outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [8], slot_index: 0 }],
      properties: { 'Node name for S&R': 'CLIPTextEncode' }, widgets_values: [NEGATIVE_TEXT]
    },
    {
      id: 5, type: 'EmptyLatentImage', title: '空 Latent 1024²', pos: [760, 520], size: [320, 106], flags: {}, order: 4, mode: 0,
      inputs: [], outputs: [{ name: 'LATENT', type: 'LATENT', links: [9], slot_index: 0 }],
      properties: { 'Node name for S&R': 'EmptyLatentImage' }, widgets_values: [1024, 1024, 1]
    },
    {
      id: 6, type: 'KSampler', title: 'KSampler', pos: [1160, 250], size: [360, 262], flags: {}, order: 5, mode: 0,
      inputs: [
        { name: 'model', type: 'MODEL', link: 6 },
        { name: 'positive', type: 'CONDITIONING', link: 7 },
        { name: 'negative', type: 'CONDITIONING', link: 8 },
        { name: 'latent_image', type: 'LATENT', link: 9 }
      ],
      outputs: [{ name: 'LATENT', type: 'LATENT', links: [10], slot_index: 0 }],
      properties: { 'Node name for S&R': 'KSampler' }, widgets_values: [123456789012345, 'randomize', 28, 6.5, 'dpmpp_2m', 'karras', 1]
    },
    {
      id: 7, type: 'VAEDecode', title: 'VAE 解码', pos: [1560, 250], size: [300, 80], flags: {}, order: 6, mode: 0,
      inputs: [
        { name: 'samples', type: 'LATENT', link: 10 },
        { name: 'vae', type: 'VAE', link: 5 }
      ],
      outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [11], slot_index: 0 }],
      properties: { 'Node name for S&R': 'VAEDecode' }, widgets_values: []
    },
    {
      id: 8, type: 'SaveImage', title: '保存图像', pos: [1900, 250], size: [320, 340], flags: {}, order: 7, mode: 0,
      inputs: [{ name: 'images', type: 'IMAGE', link: 11 }],
      outputs: [], properties: { 'Node name for S&R': 'SaveImage' }, widgets_values: ['ComfyUI']
    },
    {
      id: 9, type: 'Note', title: '参数备注', pos: [40, 300], size: [300, 160], flags: {}, order: 8, mode: 2,
      inputs: [], outputs: [], properties: {}, widgets_values: ['这是被静音的备注节点\n不会参与执行']
    },
    {
      id: 10, type: 'PreviewImage', title: '预览', pos: [2270, 250], size: [320, 300], flags: {}, order: 9, mode: 4,
      inputs: [{ name: 'images', type: 'IMAGE', link: 12 }],
      outputs: [], properties: { 'Node name for S&R': 'PreviewImage' }, widgets_values: []
    }
  ];
  const links = [
    [1, 1, 0, 2, 0, 'MODEL'],
    [2, 1, 1, 2, 1, 'CLIP'],
    [3, 2, 1, 3, 0, 'CLIP'],
    [4, 2, 1, 4, 0, 'CLIP'],
    [5, 1, 2, 7, 1, 'VAE'],
    [6, 2, 0, 6, 0, 'MODEL'],
    [7, 3, 0, 6, 1, 'CONDITIONING'],
    [8, 4, 0, 6, 2, 'CONDITIONING'],
    [9, 5, 0, 6, 3, 'LATENT'],
    [10, 6, 0, 7, 0, 'LATENT'],
    [11, 7, 0, 8, 0, 'IMAGE'],
    [12, 7, 0, 10, 0, 'IMAGE']
  ];
  return {
    last_node_id: 10,
    last_link_id: 12,
    nodes,
    links,
    groups: [
      { title: '模型加载', bounding: [20, 40, 720, 280], color: '#3f6212' },
      { title: '采样流程', bounding: [740, 0, 1040, 660], color: '#4c1d95' },
      { title: '输出', bounding: [1880, 180, 730, 450], color: '#9d174d' }
    ],
    config: {},
    extra: { ds: { scale: 0.72, offset: [120, 80] }, frontendVersion: '1.24.0' },
    version: 0.4
  };
}

const WORKFLOW = makeWorkflow();

// ---------------- PNG ----------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'latin1');
  const body = Buffer.concat([typeBuf, data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function makeArt(width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    for (let x = 0; x < width; x++) {
      const nx = x / width, ny = y / height;
      const blob1 = Math.exp(-(((nx - 0.28) ** 2) / 0.035 + ((ny - 0.44) ** 2) / 0.10));
      const blob2 = Math.exp(-(((nx - 0.72) ** 2) / 0.05 + ((ny - 0.58) ** 2) / 0.065));
      const blob3 = Math.exp(-(((nx - 0.52) ** 2) / 0.12 + ((ny - 0.16) ** 2) / 0.035));
      const vignette = 0.55 + 0.45 * Math.cos((nx - 0.5) * 2.2) * Math.cos((ny - 0.5) * 2.2);
      const r = Math.round(20 + 168 * blob1 + 32 * blob2 + 55 * blob3 + 18 * Math.sin(ny * 17));
      const g = Math.round(16 + 102 * blob1 + 135 * blob2 + 25 * blob3 + 12 * Math.sin(nx * 11));
      const b = Math.round(38 + 58 * blob1 + 190 * blob2 + 90 * blob3 + 18 * Math.cos((nx + ny) * 9));
      raw[p++] = Math.max(0, Math.min(255, Math.round(r * vignette)));
      raw[p++] = Math.max(0, Math.min(255, Math.round(g * vignette)));
      raw[p++] = Math.max(0, Math.min(255, Math.round(b * vignette)));
      raw[p++] = 255;
    }
  }
  return raw;
}

function makePng(textEntries, opts = {}) {
  const width = opts.width || 768;
  const height = opts.height || 512;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const chunks = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr)];
  for (const entry of textEntries) {
    if (entry.type === 'tEXt') chunks.push(pngChunk('tEXt', Buffer.concat([Buffer.from(entry.key, 'latin1'), Buffer.from([0]), Buffer.from(entry.text, 'utf8')])));
    else if (entry.type === 'zTXt') chunks.push(pngChunk('zTXt', Buffer.concat([Buffer.from(entry.key, 'latin1'), Buffer.from([0, 0]), zlib.deflateSync(Buffer.from(entry.text, 'utf8'))])));
    else if (entry.type === 'iTXt') {
      const payload = Buffer.concat([Buffer.from(entry.key, 'latin1'), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(entry.text, 'utf8')]);
      // key \0 flag=0 method=0 lang\0 translated\0 text
      chunks.push(pngChunk('iTXt', payload));
    } else if (entry.type === 'iTXtZ') {
      const payload = Buffer.concat([Buffer.from(entry.key, 'latin1'), Buffer.from([0, 1, 0, 0, 0]), zlib.deflateSync(Buffer.from(entry.text, 'utf8'))]);
      chunks.push(pngChunk('iTXt', payload));
    }
  }
  chunks.push(pngChunk('IDAT', zlib.deflateSync(makeArt(width, height), { level: 9 })));
  chunks.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

// ---------------- EXIF / JPEG ----------------

function exifTiff(tags) {
  // tags: [{tag, type, bytes}]
  const entries = tags.map((t) => ({ ...t, count: t.bytes.length }));
  const dataStart = 8 + 2 + entries.length * 12 + 4;
  const header = Buffer.alloc(dataStart);
  header.write('II', 0, 'latin1');
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(8, 4);
  header.writeUInt16LE(entries.length, 8);
  let dataOff = dataStart;
  entries.forEach((e, i) => {
    const p = 10 + i * 12;
    header.writeUInt16LE(e.tag, p);
    header.writeUInt16LE(e.type, p + 2);
    header.writeUInt32LE(e.count, p + 4);
    if (e.bytes.length <= 4) {
      e.bytes.copy(header, p + 8);
    } else {
      header.writeUInt32LE(dataOff, p + 8);
    }
    dataOff += e.bytes.length;
  });
  header.writeUInt32LE(0, 10 + entries.length * 12);
  const dataParts = [];
  entries.forEach((e) => { if (e.bytes.length > 4) dataParts.push(e.bytes); });
  return Buffer.concat([header, ...dataParts]);
}

const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==',
  'base64'
);

function makeJpegWithExif(userComment, extraTags = []) {
  const tags = [{ tag: 0x9286, type: 7, bytes: Buffer.concat([Buffer.from('ASCII\0\0\0', 'latin1'), Buffer.from(userComment, 'utf8')]) }, ...extraTags];
  const tiff = exifTiff(tags);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.alloc(2 + 2 + payload.length);
  app1[0] = 0xff; app1[1] = 0xe1;
  app1.writeUInt16BE(payload.length + 2, 2);
  payload.copy(app1, 4);
  return Buffer.concat([TINY_JPEG.subarray(0, 2), app1, TINY_JPEG.subarray(2)]);
}

// ---------------- WebP ----------------

function makeWebpWithExif(userComment) {
  const tiff = exifTiff([{ tag: 0x9286, type: 7, bytes: Buffer.concat([Buffer.from('ASCII\0\0\0', 'latin1'), Buffer.from(userComment, 'utf8')]) }]);
  const exifPayload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const chunk = Buffer.alloc(8 + exifPayload.length + (exifPayload.length & 1));
  chunk.write('EXIF', 0, 'latin1');
  chunk.writeUInt32LE(exifPayload.length, 4);
  exifPayload.copy(chunk, 8);
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), chunk]);
  const out = Buffer.alloc(8 + body.length);
  out.write('RIFF', 0, 'latin1');
  out.writeUInt32LE(body.length, 4);
  body.copy(out, 8);
  return out;
}

// ---------------- MP4 ----------------

function box(type, payload, large = false) {
  const typeBuf = Buffer.from(type, 'latin1');
  if (large) {
    const out = Buffer.alloc(16 + payload.length);
    out.writeUInt32BE(1, 0);
    typeBuf.copy(out, 4);
    out.writeUInt32BE(0, 8);
    out.writeUInt32BE(16 + payload.length, 12);
    payload.copy(out, 16);
    return out;
  }
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(8 + payload.length, 0);
  typeBuf.copy(out, 4);
  payload.copy(out, 8);
  return out;
}

function fullBox(type, payload) {
  return box(type, Buffer.concat([Buffer.alloc(4), payload]));
}

function dataAtom(text) {
  return box('data', Buffer.concat([Buffer.from([0, 0, 0, 1]), Buffer.from([0, 0, 0, 0]), Buffer.from(text, 'utf8')]));
}

function makeMp4(comment, description) {
  const hdlr = fullBox('hdlr', Buffer.concat([
    Buffer.alloc(4), Buffer.from('mdir', 'latin1'), Buffer.from('appl', 'latin1'),
    Buffer.alloc(9), Buffer.from([0])
  ]));
  const ilst = box('ilst', Buffer.concat([
    box('\u00a9cmt', dataAtom(comment)),
    box('\u00a9des', dataAtom(description))
  ]));
  const meta = fullBox('meta', Buffer.concat([hdlr, ilst]));
  const moov = box('moov', box('udta', meta));
  const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom', 'latin1'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2mp41', 'latin1')]));
  return Buffer.concat([ftyp, moov]);
}

// ---------------- WebM ----------------

function vintSize(n) {
  for (let len = 1; len <= 8; len++) {
    const max = Math.pow(2, 7 * len) - 1;
    if (n < max) {
      const bytes = Buffer.alloc(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) { bytes[i] = v & 255; v = Math.floor(v / 256); }
      bytes[0] |= (1 << (8 - len));
      return bytes;
    }
  }
  throw new Error('size too big');
}
function ebmlId(hex) { return Buffer.from(hex.replace(/\s+/g, ''), 'hex'); }
function ebml(idHex, payload) {
  const id = ebmlId(idHex);
  const size = vintSize(payload.length);
  return Buffer.concat([id, size, payload]);
}
function ebmlString(idHex, str) { return ebml(idHex, Buffer.from(str, 'utf8')); }
function ebmlUint(idHex, n) {
  const b = Buffer.alloc(4); b.writeUInt32BE(n);
  return ebml(idHex, b);
}
function makeWebm(tags) {
  const simple = tags.map(([k, v]) => ebml('67C8', Buffer.concat([ebmlString('45A3', k), ebmlString('4487', v)])));
  const tag = ebml('7373', Buffer.concat([ebml('63C0', Buffer.alloc(0)), ...simple]));
  const tagsEl = ebml('1254C367', tag);
  const info = ebml('1549A966', Buffer.concat([
    ebmlUint('2AD7B1', 1000000),
    ebmlString('4D80', 'ComfyUI'),
    ebmlString('5741', 'ComfyUI'),
    ebmlString('7BA9', 'ComfyUI test clip')
  ]));
  const segment = ebml('18538067', Buffer.concat([info, tagsEl]));
  const header = ebml('1A45DFA3', Buffer.concat([
    ebmlUint('4286', 1), ebmlUint('42F7', 1), ebmlUint('42F2', 4), ebmlUint('42F3', 8),
    ebmlString('4282', 'webm'), ebmlUint('4287', 4), ebmlUint('4285', 2)
  ]));
  return Buffer.concat([header, segment]);
}

// ---------------- GIF ----------------

const TINY_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function gifSubBlocks(buf) {
  const parts = [];
  for (let off = 0; off < buf.length; off += 255) {
    const chunk = buf.subarray(off, Math.min(off + 255, buf.length));
    parts.push(Buffer.from([chunk.length]), chunk);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function makeGif(comment) {
  // 在 LSD + 全局色表之后插入注释扩展
  const flags = TINY_GIF[10];
  let off = 13;
  if (flags & 0x80) off += 3 * (1 << ((flags & 7) + 1));
  const head = TINY_GIF.subarray(0, off);
  const tail = TINY_GIF.subarray(off);
  const commentExt = Buffer.concat([Buffer.from([0x21, 0xfe]), gifSubBlocks(Buffer.from(comment, 'utf8'))]);
  return Buffer.concat([head, commentExt, tail]);
}

// ---------------- 导出 ----------------

const fixtures = {
  prompt: PROMPT,
  workflow: WORKFLOW,
  promptText: PROMPT_TEXT,
  negativeText: NEGATIVE_TEXT,
  png: makePng([
    { type: 'tEXt', key: 'prompt', text: JSON.stringify(PROMPT) },
    { type: 'tEXt', key: 'workflow', text: JSON.stringify(WORKFLOW) }
  ]),
  pngNoMeta: makePng([]),
  pngWorkflowOnly: makePng([{ type: 'tEXt', key: 'workflow', text: JSON.stringify(WORKFLOW) }]),
  pngZtxt: makePng([
    { type: 'zTXt', key: 'prompt', text: JSON.stringify(PROMPT) },
    { type: 'zTXt', key: 'workflow', text: JSON.stringify(WORKFLOW) }
  ]),
  pngItxt: makePng([
    { type: 'iTXt', key: 'prompt', text: JSON.stringify(PROMPT) },
    { type: 'iTXtZ', key: 'workflow', text: JSON.stringify(WORKFLOW) }
  ]),
  jpeg: makeJpegWithExif(JSON.stringify(PROMPT)),
  webp: makeWebpWithExif('prompt:' + JSON.stringify(PROMPT) + '\nworkflow:' + JSON.stringify(WORKFLOW)),
  mp4: makeMp4(JSON.stringify(PROMPT), JSON.stringify(WORKFLOW)),
  webm: makeWebm([['prompt', JSON.stringify(PROMPT)], ['workflow', JSON.stringify(WORKFLOW)], ['comment', 'made with ComfyUI']]),
  gif: makeGif(JSON.stringify(PROMPT)),
  jsonPrompt: Buffer.from(JSON.stringify(PROMPT, null, 2), 'utf8'),
  jsonWorkflow: Buffer.from(JSON.stringify(WORKFLOW, null, 2), 'utf8')
};

function writeFixtures(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const names = {
    png: 'sample-sdxl.png', pngNoMeta: 'no-metadata.png', pngWorkflowOnly: 'workflow-only.png',
    pngZtxt: 'sample-ztxt.png', pngItxt: 'sample-itxt.png', jpeg: 'sample-exif.jpg',
    webp: 'sample-exif.webp', mp4: 'sample-tags.mp4', webm: 'sample-tags.webm', gif: 'sample-comment.gif',
    jsonPrompt: 'prompt-api.json', jsonWorkflow: 'workflow-ui.json'
  };
  for (const [key, name] of Object.entries(names)) {
    fs.writeFileSync(path.join(dir, name), fixtures[key]);
  }
}

module.exports = { fixtures, writeFixtures, PROMPT, WORKFLOW, PROMPT_TEXT, NEGATIVE_TEXT };

if (require.main === module) {
  const dir = path.join(__dirname, 'fixtures');
  writeFixtures(dir);
  console.log('fixtures written to', dir);
}
