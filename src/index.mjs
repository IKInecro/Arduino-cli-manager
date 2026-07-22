import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const configFile = path.join(appRoot, '.arduino-tui.json');
const workspaceRoot = os.homedir();
const cli = 'arduino-cli';
const RESET = '\x1b[0m';
const C = { blue: '\x1b[38;5;39m', cyan: '\x1b[38;5;51m', mint: '\x1b[38;5;48m', yellow: '\x1b[38;5;221m', red: '\x1b[38;5;203m', dim: '\x1b[38;5;245m', white: '\x1b[38;5;255m', panel: '\x1b[48;5;236m', select: '\x1b[48;5;24m' };
const editable = new Set(['.ino', '.c', '.cc', '.cpp', '.h', '.hpp', '.py', '.js', '.mjs', '.json', '.txt', '.md', '.yaml', '.yml', '.conf', '.sh']);
const ignored = new Set(['node_modules', '.git', '.cache', '.config', '.local', '.npm', '.cargo', '.rustup', '.vscode', 'Downloads']);
const initial = { projectRoot: os.homedir(), fqbn: 'esp8266:esp8266:nodemcuv2', port: '/dev/ttyUSB0', baud: '9600', targetFile: '' };
let settings = { ...initial };
let state = { view: 'files', selected: 0, managerSelected: 0, expanded: new Set([workspaceRoot, initial.projectRoot]), nodes: [], managerItems: [], managerKind: 'boards', managerTitle: 'Installed boards', managerQuery: '', cli: 'Checking…', board: 'Checking…', usb: [], status: 'Loading Arduino CLI…', log: [], busy: false, inputActive: false, buildOutput: [], serialOutput: [], serialActive: false, monitorProcess: null, buildAction: 'idle', pickerActive: false, pickerSelected: 0, pickerFiles: [] };

function stripAnsi(v = '') { return String(v).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, ''); }
function visLen(v) { return stripAnsi(v).length; }
function clip(v, w) { const s = String(v ?? '—'); return s.length > w ? s.slice(0, Math.max(1, w - 1)) + '…' : s; }
function padRight(v, w) { const n = visLen(v); return n >= w ? v : v + ' '.repeat(w - n); }
function addLog(m) { state.log = [`${new Date().toLocaleTimeString('id-ID')}  ${m}`, ...state.log].slice(0, 3); }
function loadSettings() { try { settings = { ...settings, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) }; } catch {} settings.projectRoot = path.resolve(settings.projectRoot); }
function saveSettings() { fs.writeFileSync(configFile, `${JSON.stringify(settings, null, 2)}\n`); }
function readEnv() { try { for (const raw of fs.readFileSync(path.join(settings.projectRoot, '.arduino-env'), 'utf8').split('\n')) { const [key, ...rest] = raw.split('='); const value = rest.join('=').trim(); if (key === 'fqbn') settings.fqbn = value || settings.fqbn; if (key === 'port') settings.port = value || settings.port; if (key === 'baud') settings.baud = value || settings.baud; } } catch {} }
async function command(file, args, timeout = 15000) { try { const { stdout, stderr } = await run(file, args, { timeout, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }); return stripAnsi(stdout || stderr).trim() || 'OK'; } catch (e) { return stripAnsi(e.stderr || e.stdout || e.message).trim() || 'Command failed'; } }

function getNodes() {
  const nodes = [{ path: workspaceRoot, name: workspaceRoot, depth: 0, isDir: true }];
  function walk(dir, depth) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.filter(e => !e.name.startsWith('.') && !ignored.has(e.name)).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)).forEach(e => {
      const full = path.join(dir, e.name);
      const isDir = e.isDirectory();
      if (!isDir && !editable.has(path.extname(e.name).toLowerCase())) return;
      nodes.push({ path: full, name: e.name, depth, isDir });
      if (isDir && state.expanded.has(full) && depth < 5) walk(full, depth + 1);
    });
  }
  if (state.expanded.has(workspaceRoot)) walk(workspaceRoot, 1);
  return nodes;
}
function selectedNode() { state.nodes = getNodes(); state.selected = Math.max(0, Math.min(state.selected, state.nodes.length - 1)); return state.nodes[state.selected]; }

function pane(title, rows, width, height) {
  const inner = width - 2;
  const titleVis = visLen(title);
  const out = [`${C.blue}╭─${C.cyan}${clip(title, inner - 2)}${RESET}${C.blue}${'─'.repeat(Math.max(0, inner - titleVis - 1))}╮${RESET}`];
  for (let i = 0; i < height - 2; i += 1) {
    const row = rows[i] || '';
    out.push(`${C.blue}│${RESET}${padRight(row, inner)}${C.blue}│${RESET}`);
  }
  out.push(`${C.blue}╰${'─'.repeat(inner)}╯${RESET}`);
  return out;
}

function paintRow(text, selected, width, tone = C.white) {
  const body = ` ${clip(text, width - 3)}`;
  return selected ? `${C.select}${C.white}${body}${RESET}` : `${tone}${body}${RESET}`;
}

function renderHeader(width) {
  const art = [
    ' █████╗ ██████╗ ██████╗ ██╗   ██╗██╗███╗   ██╗ ██████╗        ██████╗██╗     ██╗      ███╗   ███╗███╗   ██╗ ██████╗ ',
    '██╔══██╗██╔══██╗██╔══██╗██║   ██║██║████╗  ██║██╔═══██╗      ██╔════╝██║     ██║      ████╗ ████║████╗  ██║██╔════╝ ',
    '███████║██████╔╝██║  ██║██║   ██║██║██╔██╗ ██║██║   ██║_____|██║     ██║     ██║      ██╔████╔██║██╔██╗ ██║██║  ███╗',
    '██╔══██║██╔══██║██║  ██║██║   ██║██║██║╚██╗██║██║   ██║_____|██║     ██║     ██║      ██║╚██╔╝██║██║╚██╗██║██║   ██║',
    '██║  ██║██║  ██║██████╔╝╚██████╔╝██║██║ ╚████║╚██████╔╝      ╚██████╗███████╗██║      ██║ ╚═╝ ██║██║ ╚████║╚██████╔╝',
    '╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝╚═╝  ╚═══╝ ╚═════╝        ╚═════╝╚══════╝╚═╝      ╚═╝     ╚═╝╚═╝  ╚═══╝ ╚═════╝ ',
  ];
  process.stdout.write(`${C.cyan}${art.map(l => clip(l, width)).join('\n')}${RESET}\n\n`);
  const tabs = [['files', '1 FILES'], ['boards', '2 SEARCH/INSTALL BOARD'], ['libraries', '3 SEARCH/INSTALL LIBRARY'], ['build', '4 BUILD']].map(([id, label]) => state.view === id ? `${C.select}${C.white} ${label} ${RESET}` : `${C.dim} ${label} ${RESET}`).join('  ');
  process.stdout.write(` ${tabs}\n\n`);
}

function renderStatus(width) {
  const board = clip(state.board, 36);
  const usbConnected = state.usb.length > 0;
  const usb = usbConnected ? `${C.mint}● connected${RESET}` : `${C.dim}○ none${RESET}`;
  const fqbn = clip(settings.fqbn, 28);
  const inner = width - 4;
  const items = [
    `${C.dim}BOARD${RESET}  ${C.white}${board}${RESET}`,
    `${C.dim}USB${RESET}  ${usb}`,
    `${C.dim}PORT${RESET}  ${C.white}${settings.port}${RESET}`,
    `${C.dim}FQBN${RESET}  ${C.white}${fqbn}${RESET}`,
  ];
  const line = '   ' + items.join(`   ${C.dim}│${RESET}   `);
  process.stdout.write(`${C.blue}╭${'─'.repeat(inner + 2)}╮${RESET}\n`);
  process.stdout.write(`${C.blue}│${RESET} ${padRight(line, inner)} ${C.blue}│${RESET}\n`);
  process.stdout.write(`${C.blue}╰${'─'.repeat(inner + 2)}╯${RESET}\n`);
}

function fileRows(width, height) {
  selectedNode();
  const start = Math.max(0, state.selected - Math.floor((height - 2) / 2));
  return state.nodes.slice(start, start + height - 2).map((node, index) => {
    const actual = start + index;
    const icon = node.isDir ? (state.expanded.has(node.path) ? '▼' : '▶') : '•';
    return paintRow(`${'  '.repeat(node.depth)}${icon} ${node.name}`, actual === state.selected, width, node.isDir ? C.cyan : C.white);
  });
}

function previewRows(width) {
  const node = selectedNode();
  if (!node) return [' No item selected'];
  const rows = [`${C.dim} PATH${RESET}`, ` ${C.mint}${clip(node.path, width - 5)}${RESET}`, '', node.isDir ? `${C.cyan}  Folder${RESET}` : `${C.mint}  Editable file${RESET}`, ''];
  if (node.isDir) {
    let count = 0;
    try { count = fs.readdirSync(node.path).length; } catch {}
    rows.push(` ${C.dim}${count} items${RESET}`);
  } else {
    try {
      const content = fs.readFileSync(node.path, 'utf8').split('\n').slice(0, 12);
      rows.push(`${C.dim} PREVIEW${RESET}`, ...content.map(l => ` ${clip(l, width - 5)}`));
    } catch { rows.push(` ${C.yellow}Preview unavailable${RESET}`); }
    rows.push('', `${C.dim}ENTER / e to edit${RESET}`);
  }
  return rows;
}

function managerRows(width, height) {
  const start = Math.max(0, state.managerSelected - Math.floor((height - 2) / 2));
  return state.managerItems.slice(start, start + height - 2).map((item, index) => {
    const actual = start + index;
    const isSelected = actual === state.managerSelected;
    const name = clip(item.name, width - 12);
    const ver = item.version ? `${C.dim}${clip(item.version, 8)}${RESET}` : '';
    const label = `${name}  ${ver}`;
    return paintRow(label, isSelected, width);
  });
}

function managerPreview(width) {
  const item = state.managerItems[state.managerSelected];
  if (!item || !item.name) return [' No results yet'];
  const kind = state.view === 'boards' ? 'SEARCH/INSTALL BOARD' : 'SEARCH/INSTALL LIBRARY';
  const rows = [`${C.dim}${kind}${RESET}`, ''];
  if (state.view === 'boards') {
    rows.push(` ${C.cyan}${item.name}${RESET}`);
    rows.push(` ${C.dim}ID:${RESET} ${item.id}`);
    if (item.version) rows.push(` ${C.dim}Installed:${RESET} ${C.white}${item.version}${RESET}`);
    if (item.latest && item.latest !== item.version) rows.push(` ${C.dim}Latest:${RESET} ${C.mint}${item.latest}${RESET}`);
  } else {
    rows.push(` ${C.cyan}${item.name}${RESET}`);
    if (item.author) rows.push(` ${C.dim}Author:${RESET} ${item.author}`);
    if (item.maintainer && item.maintainer !== item.author) rows.push(` ${C.dim}Maintainer:${RESET} ${item.maintainer}`);
    if (item.version) rows.push(` ${C.dim}Version:${RESET} ${C.white}${item.version}${RESET}`);
    if (item.license) rows.push(` ${C.dim}License:${RESET} ${item.license}`);
    if (item.category) rows.push(` ${C.dim}Category:${RESET} ${item.category}`);
    if (item.summary) rows.push(` ${C.dim}Info:${RESET} ${clip(item.summary, width - 8)}`);
    if (item.website) rows.push(` ${C.dim}Web:${RESET} ${clip(item.website, width - 8)}`);
  }
  rows.push('');
  rows.push(`${C.dim}Query: ${state.managerQuery || 'installed'}${RESET}`);
  rows.push('');
  rows.push(' [Enter] install / input name');
  rows.push(' [s]  search');
  rows.push(' [u]  update index');
  rows.push(' [r]  reload');
  return rows;
}

function scanInoFiles() {
  const files = [];
  function walk(dir, depth) {
    if (depth > 5) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || ignored.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (path.extname(e.name).toLowerCase() === '.ino') files.push({ path: full, name: e.name, rel: path.relative(workspaceRoot, full) });
    }
  }
  walk(workspaceRoot, 0);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return files;
}

function pickerRows(width, height) {
  state.pickerFiles = scanInoFiles();
  state.pickerSelected = Math.max(0, Math.min(state.pickerSelected, state.pickerFiles.length - 1));
  const start = Math.max(0, state.pickerSelected - Math.floor((height - 2) / 2));
  return state.pickerFiles.slice(start, start + height - 2).map((file, index) => {
    const actual = start + index;
    const isSelected = actual === state.pickerSelected;
    const marker = file.path === settings.targetFile ? ` ${C.mint}◀ locked${RESET}` : '';
    return paintRow(`${file.rel}${marker}`, isSelected, width, C.mint);
  });
}

function pickerPreview(width) {
  const file = state.pickerFiles[state.pickerSelected];
  if (!file) return [' No .ino files found'];
  const isLocked = file.path === settings.targetFile;
  return [
    `${C.dim} SELECT FILE${RESET}`,
    ` ${C.mint}${clip(file.path, width - 5)}${RESET}`,
    '',
    isLocked ? ` ${C.mint}✓ Locked for compile/upload${RESET}` : ` ${C.dim}Enter to lock this file${RESET}`,
    '',
    `${C.dim} ↑/↓ navigate, Enter select, Esc cancel${RESET}`,
  ];
}

function buildRows(width) {
  const target = clip(settings.targetFile || '—', width - 10);
  const project = clip(settings.projectRoot, width - 10);
  const fqbn = clip(settings.fqbn, width - 12);
  const port = clip(settings.port, width - 12);
  const baud = settings.baud;
  const rows = [
    `${C.dim} TARGET FILE${RESET}`,
    ` ${settings.targetFile ? C.mint : C.dim}${target}${RESET}`,
    '',
    `${C.dim} PROJECT${RESET}`,
    ` ${C.mint}${project}${RESET}`,
    '',
    `${C.dim} FQBN${RESET}  ${C.white}${fqbn}${RESET}`,
    `${C.dim} PORT${RESET}  ${C.white}${port}${RESET}`,
    `${C.dim} BAUD${RESET}  ${C.white}${baud}${RESET}`,
    '',
    `${C.dim} ACTIONS${RESET}`,
    ` ${state.buildAction === 'compiling' ? C.yellow : C.mint}[c] Compile${RESET}`,
    ` ${state.buildAction === 'uploading' ? C.yellow : C.cyan}[u] Upload${RESET}`,
    ` ${C.mint}[s] Select file${RESET}`,
    ` ${state.serialActive ? C.mint : C.cyan}[m] Monitor${RESET}${state.serialActive ? ` ${C.mint}● ACTIVE${RESET}` : ''}`,
    '',
    `${C.dim} LOG${RESET}`,
    ...state.log.map(l => ` ${C.dim}${clip(l, width - 5)}${RESET}`),
  ];
  return rows;
}

function buildPreview(width) {
  if (state.serialActive) {
    const lines = state.serialOutput.slice(-(20));
    return [
      `${C.mint} SERIAL MONITOR ● ${RESET}`,
      `${C.dim} ${settings.port} @ ${settings.baud} baud${RESET}`,
      '',
      ...lines.map(l => ` ${C.white}${clip(l, width - 5)}${RESET}`),
      '',
      `${C.dim} [m] stop monitor  [q] quit${RESET}`,
    ];
  }
  if (state.buildOutput.length > 0) {
    return [
      `${C.cyan} BUILD OUTPUT${RESET}`,
      '',
      ...state.buildOutput.slice(-(20)).map(l => ` ${clip(l, width - 5)}`),
      '',
      `${C.dim} [c] compile  [u] upload  [m] monitor${RESET}`,
    ];
  }
  return [
    `${C.dim} BUILD OUTPUT${RESET}`,
    '',
    ` ${C.dim}No output yet.${RESET}`,
    '',
    `${C.dim} Press [c] to compile${RESET}`,
    `${C.dim} Press [u] to upload${RESET}`,
    `${C.dim} Press [m] for serial monitor${RESET}`,
  ];
}

function footer() {
  const footers = {
    files: '[↑/↓] navigate  [←/→] folder  [Enter/e] edit  [r] refresh',
    boards: '[↑/↓] select  [Enter] install  [s] search  [u] update  [r] reload',
    libraries: '[↑/↓] select  [Enter] install  [s] search  [u] update  [r] reload',
    build: '[c] compile  [u] upload  [m] monitor  [s] select .ino file',
  };
  const text = footers[state.view] || '';
  const panels = '[1] Files  [2] Boards  [3] Libraries  [4] Build';
  process.stdout.write(`${C.panel}${C.white} ${text}   ${panels}  [h] help  [q] quit ${RESET}\n${C.dim} ${clip(state.status, Math.max(40, (process.stdout.columns || 100) - 2))}${RESET}\n`);
}

function render() {
  if (!state.inputActive) return;
  const width = Math.max(88, process.stdout.columns || 110);
  const height = Math.max(14, Math.min(22, (process.stdout.rows || 34) - 14));
  const leftWidth = Math.max(36, Math.floor(width * 0.53));
  const rightWidth = width - leftWidth - 3;
  process.stdout.write('\x1b[?25l\x1b[2J\x1b[H');
  renderHeader(width);
  renderStatus(width);
  const isFiles = state.view === 'files';
  const isBuild = state.view === 'build';
  const isManager = !isFiles && !isBuild;
  const inPicker = isBuild && state.pickerActive;
  const leftTitle = isFiles ? ' WORKSPACE TREE' : (inPicker ? ' .INO FILES' : (isBuild ? ' PROJECT & ACTIONS' : ` ${state.view === 'boards' ? 'SEARCH/INSTALL BOARD' : 'SEARCH/INSTALL LIBRARY'} · ${state.managerTitle}`));
  const rightTitle = isFiles ? ' PREVIEW' : (inPicker ? ' LOCK FILE' : (isBuild ? ' OUTPUT / SERIAL' : ' PACKAGE ACTIONS'));
  const leftRows = isFiles ? fileRows(leftWidth, height) : (inPicker ? pickerRows(leftWidth, height) : (isBuild ? buildRows(leftWidth) : managerRows(leftWidth, height)));
  const rightRows = isFiles ? previewRows(rightWidth) : (inPicker ? pickerPreview(rightWidth) : (isBuild ? buildPreview(rightWidth) : managerPreview(rightWidth)));
  const left = pane(leftTitle, leftRows, leftWidth, height);
  const right = pane(rightTitle, rightRows, rightWidth, height);
  for (let i = 0; i < left.length; i += 1) process.stdout.write(`${left[i]} ${right[i]}\n`);
  footer();
}

function attachInput() { if (state.inputActive) return; state.inputActive = true; process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', onKey); }
function detachInput() { if (!state.inputActive) return; process.stdin.off('data', onKey); process.stdin.setRawMode(false); state.inputActive = false; }
function restore() { stopSerial(); detachInput(); process.stdout.write(`\x1b[?25h${RESET}\n`); }
async function terminalTask(task) { detachInput(); process.stdout.write(`\x1b[?25h${RESET}\x1b[2J\x1b[H`); try { return await task(); } finally { attachInput(); render(); } }
async function ask(question) { return terminalTask(() => new Promise(resolve => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(question, answer => { rl.close(); resolve(answer.trim()); }); })); }

async function refreshStatus() { state.busy = true; state.status = 'Refreshing devices…'; render(); readEnv(); const [version, boards] = await Promise.all([command(cli, ['version']), command(cli, ['board', 'list'])]); state.cli = version.split('\n')[0]; const validBoards = boards.split('\n').filter(l => l && !/^Port\s/i.test(l) && /\/dev\/|COM\d/i.test(l)); state.usb = validBoards; state.board = validBoards[0] || 'No USB board detected'; state.busy = false; state.status = 'Devices and Arduino CLI refreshed'; render(); }
function parseManagerOutput(output, kind) {
  try {
    const data = JSON.parse(output);
    if (kind === 'boards') {
      const platforms = data.platforms || [];
      return platforms.map(p => {
        const vers = Object.keys(p.releases || {}).sort();
        const latest = vers.pop() || '';
        const r = p.releases?.[latest] || {};
        return { id: p.id || '', name: r.name || p.id || '', version: latest, latest, maintainer: p.maintainer || '', website: p.website || '', raw: '' };
      });
    }
    const libs = data.libraries || data.installed_libraries || [];
    return libs.map(l => {
      const lib = l.library || l;
      const vers = Object.keys(lib.releases || {}).sort();
      const latest = vers.pop() || lib.version || '';
      const r = lib.releases?.[latest] || {};
      return {
        id: lib.name || '', name: lib.name || '',
        author: r.author || lib.author || '',
        version: r.version || lib.version || latest,
        latest: r.version || lib.version || latest,
        summary: r.sentence || lib.sentence || '',
        website: r.website || lib.website || '',
        category: r.category || lib.category || '',
        maintainer: r.maintainer || lib.maintainer || '',
        paragraph: r.paragraph || lib.paragraph || '',
        license: r.license || lib.license || '',
        raw: '',
      };
    });
  } catch {
    const rawLines = output.split('\n');
    const nonEmpty = rawLines.filter(l => l.trim());
    if (nonEmpty.length === 0) return [];
    if (nonEmpty.length === 1 && /no\s+\w+\s+installed/i.test(nonEmpty[0])) return [];

    const hasBlock = nonEmpty.some(l => /^Name:\s*"/.test(l.trim()));
    if (hasBlock) {
      const items = [];
      let cur = {};
      for (const line of rawLines) {
        const t = line.trim();
        if (!t) continue;
        const ci = t.indexOf(':');
        if (ci <= 0) continue;
        const key = t.slice(0, ci).trim().toLowerCase();
        let val = t.slice(ci + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);

        if (key === 'name' && cur.name) {
          items.push({ ...cur });
          cur = {};
        }
        cur[key] = val;
      }
      if (cur.name) items.push(cur);
      return items.map(item => ({
        id: item.name || '', name: item.name || '',
        author: item.author || '',
        version: (item.versions || item.version || '').replace(/^\[|\]$/g, '').split(',').pop().trim().replace(/^"/, '').replace(/"$/, '') || '',
        latest: (item.versions || item.version || '').replace(/^\[|\]$/g, '').split(',').pop().trim().replace(/^"/, '').replace(/"$/, '') || '',
        summary: item.sentence || '',
        website: item.website || '', category: item.category || '',
        maintainer: item.maintainer || '', paragraph: item.paragraph || '',
        license: item.license || '', raw: '',
      }));
    }

    const data = nonEmpty.filter(l => !/^Downloading/i.test(l));
    if (data.length < 2) return [];
    const items = [];
    for (let i = 1; i < data.length; i++) {
      const line = data[i];
      const parts = line.split(/\s{2,}|\t/);
      if (kind === 'boards' && parts.length >= 2) {
        const r = /^(\S+)\s+(.+)$/.exec(line);
        if (!r) continue;
        const id = r[1];
        const rest = r[2].split(/\s{2,}/);
        const v1 = rest[0] || '';
        const name = rest.slice(rest.length > 1 ? 1 : 0).join(' ') || id;
        const v2 = rest.length > 1 ? rest[rest.length > 2 ? 1 : 0] : '';
        if (id && id !== 'ID' && !id.startsWith('---')) items.push({ id, name, version: v1 || v2, latest: v2 || v1, raw: line });
      } else if (kind !== 'boards') {
        const name = parts[0] || '';
        const author = parts[1] || '';
        const version = parts[2] || '';
        const summary = parts.slice(3).join(' ') || '';
        if (name && name !== 'Name' && !name.startsWith('---')) items.push({ id: name, name, author, version, summary, raw: line });
      }
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    return items;
  }
}

async function loadManager(kind, query = '') {
  state.busy = true;
  state.managerKind = kind;
  state.managerQuery = query;
    state.managerTitle = query ? `Search: ${query}` : 'All installed';
  state.status = `${query ? 'Searching' : 'Loading'} ${kind}…`;
  render();
  const useJson = kind === 'boards' || !query;
  const args = kind === 'boards'
    ? ['core', query ? 'search' : 'list', ...(useJson ? ['--format', 'json'] : []), ...(query ? [query] : [])]
    : ['lib', query ? 'search' : 'list', ...(useJson ? ['--format', 'json'] : []), ...(query ? [query] : [])];
  const output = await command(cli, args, 60000);
  const parsed = parseManagerOutput(output, kind);
  if (parsed.length > 0) {
    state.managerItems = parsed;
  } else {
    state.managerItems = [{ id: 'No results', name: 'No results', version: '', latest: '', raw: '' }];
  }
  state.managerSelected = 0;
  state.busy = false;
  state.status = `${parsed.length} ${kind === 'boards' ? 'board' : 'library'} found`;
  render();
}
async function installManagerItem() {
  const kind = state.view === 'boards' ? 'boards' : 'libraries';
  const item = state.managerItems[state.managerSelected];
  if (!item || !item.id) return;
  const suggested = item.id;
  const name = await ask(`Install ${kind} [${suggested}]: `);
  const target = name || suggested;
  if (!target) return;
  state.busy = true;
  state.status = `Installing ${target}…`;
  render();
  const output = await command(cli, [state.view === 'boards' ? 'core' : 'lib', 'install', target], 300000);
  state.busy = false;
  state.status = output.split('\n').at(-1) || 'Install complete';
  addLog(state.status);
  await loadManager(kind, state.managerQuery);
}
async function updateIndex() { const kind = state.view === 'boards' ? 'boards' : 'libraries'; state.busy = true; state.status = 'Updating package index…'; render(); await command(cli, [state.view === 'boards' ? 'core' : 'lib', 'update-index'], 180000); state.busy = false; state.status = 'Index updated'; addLog(state.status); await loadManager(kind, state.managerQuery); }
async function openSelected() { const node = selectedNode(); if (!node || node.isDir) { state.status = 'Select a file, not a folder'; render(); return; } const editor = process.env.EDITOR || 'nano'; await terminalTask(() => new Promise(resolve => { const child = spawn(editor, [node.path], { stdio: 'inherit' }); child.once('error', () => { state.status = `Editor ${editor} unavailable`; resolve(); }); child.once('exit', () => { state.status = `Editor closed: ${node.name}`; resolve(); }); })); render(); }
function toggleFolder(open) { const node = selectedNode(); if (!node?.isDir) return; if (open) state.expanded.add(node.path); else state.expanded.delete(node.path); render(); }
function stopSerial() { if (state.monitorProcess) { state.monitorProcess.kill(); state.monitorProcess = null; } state.serialActive = false; state.serialOutput = []; }
async function showHelp() { await terminalTask(async () => { process.stdout.write(`${C.cyan}ARDUINO-CLI-MNG keyboard guide${RESET}\n\n1 FILES: arrows navigate tree, Enter/e edit, r refresh.\n2 SEARCH/INSTALL BOARD: Enter install, s search, u update, r reload.\n3 SEARCH/INSTALL LIBRARY: Enter install, s search, u update, r reload.\n4 BUILD: c compile, u upload, m serial monitor, s select .ino file.\n\nPress Enter to return…`); await new Promise(resolve => process.stdin.once('data', resolve)); }); }
async function changeView(view) { if (view !== 'build') stopSerial(); state.view = view; if (view === 'boards') await loadManager('boards'); else if (view === 'libraries') await loadManager('libraries'); else render(); }

async function onKey(data) {
  const key = data.toString();
  if (key === 'q' || key === '\u0003') { stopSerial(); restore(); process.exit(0); }
  if (state.busy) return;
  if (key === '1') return changeView('files');
  if (key === '2') return changeView('boards');
  if (key === '3') return changeView('libraries');
  if (key === '4') return changeView('build');
  if (key === 'h' || key === '?') return showHelp();

  if (state.view === 'build') {
    if (state.pickerActive) {
      if (key === '\u001b[A' && state.pickerSelected > 0) { state.pickerSelected--; render(); }
      else if (key === '\u001b[B' && state.pickerSelected < state.pickerFiles.length - 1) { state.pickerSelected++; render(); }
      else if (key === '\r' || key === '\n') {
        const file = state.pickerFiles[state.pickerSelected];
        if (file) {
          settings.targetFile = file.path;
          settings.projectRoot = path.dirname(file.path);
          state.expanded.add(settings.projectRoot);
          saveSettings();
          state.status = `Locked: ${file.name}`;
          addLog(state.status);
          state.pickerActive = false;
          render();
        }
      }
      else if (key === '\u001b' || key.toLowerCase() === 's') { state.pickerActive = false; render(); }
      return;
    }
    if (key.toLowerCase() === 's') { state.pickerActive = true; state.pickerSelected = 0; state.pickerFiles = scanInoFiles(); render(); }
    else if (key.toLowerCase() === 'c') {
      const target = settings.targetFile || settings.projectRoot;
      if (!target) { state.status = 'Select a .ino file first with [s]'; render(); return; }
      state.buildOutput = [];
      state.buildAction = 'compiling';
      state.status = 'Compiling…';
      render();
      const output = await command(cli, ['compile', '--fqbn', settings.fqbn, target], 180000);
      state.buildOutput = output.split('\n').filter(l => l.trim()).slice(-30);
      state.buildAction = 'idle';
      state.status = output.split('\n').at(-1) || 'Compile complete';
      addLog(state.status);
      render();
    } else if (key.toLowerCase() === 'u') {
      const target = settings.targetFile || settings.projectRoot;
      if (!target) { state.status = 'Select a .ino file first with [s]'; render(); return; }
      state.buildOutput = [];
      state.buildAction = 'uploading';
      state.status = 'Uploading…';
      render();
      const output = await command(cli, ['compile', '--upload', '--fqbn', settings.fqbn, '--port', settings.port, target], 180000);
      state.buildOutput = output.split('\n').filter(l => l.trim()).slice(-30);
      state.buildAction = 'idle';
      state.status = output.split('\n').at(-1) || 'Upload complete';
      addLog(state.status);
      render();
    } else if (key.toLowerCase() === 'm') {
      if (state.serialActive) {
        state.monitorProcess?.kill();
        state.monitorProcess = null;
        state.serialActive = false;
        state.status = 'Serial monitor stopped';
        render();
      } else {
        state.serialOutput = [];
        state.serialActive = true;
        state.status = 'Starting serial monitor…';
        render();
        const child = spawn(cli, ['monitor', '--port', settings.port, '--config', `baudrate=${settings.baud}`], { stdio: ['pipe', 'pipe', 'inherit'] });
        state.monitorProcess = child;
        child.stdout.on('data', chunk => {
          const lines = chunk.toString().split('\n').filter(l => l.trim());
          state.serialOutput.push(...lines);
          if (state.serialOutput.length > 200) state.serialOutput = state.serialOutput.slice(-200);
          if (state.serialActive) render();
        });
        child.on('error', () => { state.serialActive = false; state.status = 'Monitor failed'; render(); });
        child.on('exit', () => { state.serialActive = false; state.monitorProcess = null; state.status = 'Monitor closed'; render(); });
      }
    }
    return;
  }

  if (state.view !== 'files') {
    if (key === '\u001b[A') { state.managerSelected = Math.max(0, state.managerSelected - 1); render(); }
    else if (key === '\u001b[B') { state.managerSelected = Math.min(state.managerItems.length - 1, state.managerSelected + 1); render(); }
    else if (key === '\r' || key === '\n') await installManagerItem();
    else if (key.toLowerCase() === 's') { const query = await ask('Search: '); if (query) await loadManager(state.view === 'boards' ? 'boards' : 'libraries', query); }
    else if (key.toLowerCase() === 'u') await updateIndex();
    else if (key.toLowerCase() === 'r') await loadManager(state.view === 'boards' ? 'boards' : 'libraries');
    return;
  }
  if (key === '\u001b[A') { state.selected = Math.max(0, state.selected - 1); render(); }
  else if (key === '\u001b[B') { state.selected = Math.min(state.nodes.length - 1, state.selected + 1); render(); }
  else if (key === '\u001b[C') toggleFolder(true);
  else if (key === '\u001b[D') toggleFolder(false);
  else if (key === '\r' || key === '\n' || key.toLowerCase() === 'e') await openSelected();
  else if (key.toLowerCase() === 'r') await refreshStatus();
}

loadSettings(); state.expanded.add(settings.projectRoot);
if (!process.stdout.isTTY || !process.stdin.isTTY) { console.error('arduino-cli-mng must be run from an interactive terminal.'); process.exit(1); }
process.on('SIGINT', () => { restore(); process.exit(0); }); process.on('exit', restore);
attachInput(); await refreshStatus();
