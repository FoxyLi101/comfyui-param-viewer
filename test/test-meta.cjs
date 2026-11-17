'use strict';
const assert = require('node:assert/strict');
const { fixtures } = require('./make-fixtures.cjs');
const { parseBytes } = require('../src/comfy-meta.cjs');

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('  FAIL ' + name);
    console.error(e.stack || e);
    process.exitCode = 1;
  }
}

const baseChecks = (r, label) => {
  assert.equal(r.nodes.length, 8, label + ': node count');
  assert.ok(r.metadata.prompt, label + ': prompt exists');
  assert.equal(r.summary.positive.includes('lighthouse'), true, label + ': positive text');
  assert.equal(r.summary.negative.includes('blurry'), true, label + ': negative text');
  assert.equal(r.summary.modelName, 'dreamshaperXL_v21TurboDPMSDE.safetensors', label + ': model');
  assert.equal(r.summary.loras[0].name, 'add_detail_xl.safetensors', label + ': lora');
  assert.equal(r.summary.sampler.seed, 123456789012345, label + ': seed');
  assert.equal(r.summary.sampler.steps, 28, label + ': steps');
  assert.equal(r.summary.sampler.cfg, 6.5, label + ': cfg');
  assert.equal(r.summary.sampler.samplerName, 'dpmpp_2m', label + ': sampler');
  assert.equal(r.summary.sampler.scheduler, 'karras', label + ': scheduler');
  assert.equal(r.summary.latent.width, 1024, label + ': width');
  assert.equal(r.summary.latent.height, 1024, label + ': height');
  assert.equal(r.summary.latent.batch, 1, label + ': batch');
  assert.equal(r.summary.outputs[0].classType, 'SaveImage', label + ': output');
  const ks = r.nodes.find(n => n.classType === 'KSampler');
  assert.ok(ks, label + ': KSampler node');
  const positiveInput = ks.inputs.find(i => i.key === 'positive');
  assert.deepEqual(positiveInput.link, { id: '3', slot: 0 }, label + ': link');
  assert.equal(r.summary.workflowInfo ? r.summary.workflowInfo.nodeCount : 0, 0, label + ': summary must not own workflow');
};

(async () => {
  console.log('ComfyUI metadata parser tests');

  await test('PNG tEXt prompt + workflow', async () => {
    const r = await parseBytes(fixtures.png, 'sample.png');
    baseChecks(r);
    assert.equal(r.container, 'PNG');
    assert.equal(r.workflowInfo.nodeCount, 10);
    assert.equal(r.workflowInfo.linkCount, 12);
    assert.equal(r.workflowInfo.groupCount, 3);
    assert.equal(r.workflowInfo.muted.length, 1);
    assert.equal(r.workflowInfo.bypassed.length, 1);
    assert.deepEqual(r.detection.sort(), ['prompt · PNG tEXt', 'workflow · PNG tEXt']);
    assert.equal(r.metadata.entries.length, 2);
  });

  await test('PNG zTXt compressed', async () => {
    const r = await parseBytes(fixtures.pngZtxt, 'sample-ztxt.png');
    baseChecks(r);
    assert.equal(r.detection[0], 'prompt · PNG zTXt');
    assert.equal(r.detection[1], 'workflow · PNG zTXt');
  });

  await test('PNG iTXt (mixed compressed/uncompressed)', async () => {
    const r = await parseBytes(fixtures.pngItxt, 'sample-itxt.png');
    baseChecks(r);
    assert.equal(r.detection[0], 'prompt · PNG iTXt');
    assert.equal(r.detection[1], 'workflow · PNG iTXt');
  });

  await test('JPEG EXIF UserComment', async () => {
    const r = await parseBytes(fixtures.jpeg, 'sample.jpg');
    baseChecks(r);
    assert.equal(r.container, 'JPEG');
    assert.ok(r.detection[0].includes('JPEG EXIF'));
    assert.equal(r.workflowInfo, null);
  });

  await test('WebP EXIF with prompt:/workflow: prefix', async () => {
    const r = await parseBytes(fixtures.webp, 'sample.webp');
    baseChecks(r);
    assert.equal(r.container, 'WebP');
    assert.ok(r.detection[0].includes('WebP EXIF'));
    assert.ok(r.detection[1].includes('WebP EXIF'));
    assert.equal(r.workflowInfo.nodeCount, 10);
  });

  await test('MP4 container tags (©cmt / ©des)', async () => {
    const r = await parseBytes(fixtures.mp4, 'sample.mp4');
    baseChecks(r);
    assert.equal(r.container, 'MP4');
    assert.ok(r.detection[0].includes('MP4'));
    assert.equal(r.workflowInfo.nodeCount, 10);
  });

  await test('WebM EBML Tags', async () => {
    const r = await parseBytes(fixtures.webm, 'sample.webm');
    baseChecks(r);
    assert.equal(r.container, 'WebM');
    assert.ok(r.detection[0].includes('WebM'));
    assert.equal(r.workflowInfo.nodeCount, 10);
  });

  await test('GIF comment', async () => {
    const r = await parseBytes(fixtures.gif, 'sample.gif');
    baseChecks(r);
    assert.equal(r.container, 'GIF');
    assert.ok(r.detection[0].includes('GIF'));
  });

  await test('JSON API prompt', async () => {
    const r = await parseBytes(fixtures.jsonPrompt, 'prompt-api.json');
    baseChecks(r);
    assert.equal(r.container, 'JSON');
  });

  await test('JSON UI workflow', async () => {
    const r = await parseBytes(fixtures.jsonWorkflow, 'workflow-ui.json');
    assert.equal(r.nodes.length, 10);
    assert.equal(r.metadata.prompt, null);
    assert.ok(r.metadata.workflow);
    assert.equal(r.workflowInfo.nodeCount, 10);
    assert.equal(r.nodes.find(n => n.classType === 'KSampler').inputs.filter(i => ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'].includes(i.key)).length, 6);
  });

  await test('PNG workflow-only fallback', async () => {
    const r = await parseBytes(fixtures.pngWorkflowOnly, 'workflow-only.png');
    assert.equal(r.nodes.length, 10);
    assert.equal(r.metadata.prompt, null);
    assert.ok(r.metadata.workflow);
    assert.ok(r.warnings.some(w => w.includes('UI workflow')));
    assert.ok(r.nodes.find(n => n.classType === 'CheckpointLoaderSimple').inputs.some(i => i.key === 'ckpt_name'));
  });

  await test('PNG without metadata', async () => {
    const r = await parseBytes(fixtures.pngNoMeta, 'no-metadata.png');
    assert.equal(r.nodes.length, 0);
    assert.equal(r.metadata.prompt, null);
    assert.ok(r.warnings.some(w => w.includes('未找到 ComfyUI')));
  });

  await test('unknown container raw JSON fallback', async () => {
    const raw = Buffer.from('xxxxxx' + JSON.stringify(fixtures.prompt) + 'yyyyyy', 'utf8');
    const r = await parseBytes(raw, 'mystery.bin');
    assert.equal(r.nodes.length, 8);
    assert.equal(r.summary.sampler.seed, 123456789012345);
    assert.equal(r.metadata.promptSource, '原始扫描');
  });

  await test('wrapper JSON with prompt + workflow', async () => {
    const raw = Buffer.from(JSON.stringify({ prompt: fixtures.prompt, workflow: fixtures.workflow }), 'utf8');
    const r = await parseBytes(raw, 'wrapper.json');
    assert.equal(r.nodes.length, 8);
    assert.equal(r.workflowInfo.nodeCount, 10);
    assert.ok(r.metadata.prompt);
    assert.ok(r.metadata.workflow);
  });

  await test('empty file is handled without throwing', async () => {
    const r = await parseBytes(Buffer.alloc(0), 'empty.png');
    assert.equal(r.nodes.length, 0);
    assert.ok(r.warnings.length > 0);
  });

  console.log('\n' + passed + ' tests passed');
})();
