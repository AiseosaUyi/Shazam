import { transcribe } from 'ai';
import { put } from '@vercel/blob';
import { ProjectSandbox } from '@/lib/agent/sandbox';
import type { PlatformRepo, MediaAsset } from '@/lib/db/platform-repo';

/**
 * Agent-driven video editing. Real ffmpeg runs inside the user's persistent media sandbox
 * (a Firecracker VM), never inside a serverless function. Operations are structured so the
 * model composes edits reliably instead of hand-writing ffmpeg filter graphs.
 */

export type VideoOp =
  | { op: 'trim'; start: number; end?: number }
  | { op: 'cut_silences'; min_silence?: number; threshold_db?: number }
  | { op: 'reframe'; aspect: '9:16' | '1:1' | '16:9' | '4:5' }
  | { op: 'speed'; factor: number }
  | { op: 'captions'; style?: 'bold' | 'clean'; position?: 'bottom' | 'middle' }
  | { op: 'add_music'; url: string; volume?: number }
  | { op: 'concat'; urls: string[] }
  | { op: 'mute' };

export const TRANSCRIBE_MODEL = process.env.SHAZAM_TRANSCRIBE_MODEL || 'elevenlabs/scribe-v2';
const FF = '/tmp/ffbin/ffmpeg';
const FFPROBE = '/tmp/ffbin/ffprobe';
const FONT_DIR = '/usr/share/fonts/dejavu-sans-fonts';
const WORK = '/vercel/sandbox/media';

const ENSURE_FFMPEG = `set -e
(command -v xz >/dev/null || sudo dnf install -y -q xz dejavu-sans-fonts >/dev/null 2>&1)
if [ ! -x ${FF} ]; then mkdir -p /tmp/ffbin && cd /tmp/ffbin && curl -sSfL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o ff.tar.xz && tar -xJf ff.tar.xz --strip-components=1 && rm ff.tar.xz; fi
mkdir -p ${WORK}`;

function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function assertPublicHttps(url: string): void {
  const u = new URL(url);
  if (u.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)) {
    throw new Error(`Only public https media URLs are allowed (got ${u.hostname}).`);
  }
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

/**
 * Builds short caption cues (≤ maxWords, ≤ 2.5s) from transcript segments. Handles both
 * sentence-level segments and word-level tokens (some models return one word per segment).
 */
export function buildSrt(segments: Array<{ text: string; startSecond: number; endSecond: number }>, maxWords = 5, maxSeconds = 2.5): string {
  // Expand to timed words.
  const words: Array<{ w: string; start: number; end: number }> = [];
  for (const seg of segments) {
    const parts = seg.text.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const per = (seg.endSecond - seg.startSecond) / parts.length;
    parts.forEach((w, i) => words.push({ w, start: seg.startSecond + i * per, end: seg.startSecond + (i + 1) * per }));
  }
  const cues: Array<{ start: number; end: number; text: string }> = [];
  let cur: typeof words = [];
  const flush = () => {
    if (cur.length) cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((x) => x.w).join(' ') });
    cur = [];
  };
  for (const word of words) {
    const tooLong = cur.length >= maxWords || (cur.length > 0 && word.end - cur[0].start > maxSeconds);
    const gap = cur.length > 0 && word.start - cur[cur.length - 1].end > 0.6;
    if (tooLong || gap) flush();
    cur.push(word);
    if (/[.!?]$/.test(word.w)) flush();
  }
  flush();
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(Math.max(c.end, c.start + 0.3))}\n${c.text}\n`).join('\n');
}

/** Parses `silencedetect` output into the spans of speech to keep. */
export function speechSpans(ffmpegLog: string, duration: number, pad = 0.15): Array<[number, number]> {
  const silences: Array<[number, number]> = [];
  let start: number | null = null;
  for (const line of ffmpegLog.split('\n')) {
    const s = line.match(/silence_start: (-?[\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (s) start = Math.max(0, parseFloat(s[1]));
    if (e && start !== null) {
      silences.push([start, parseFloat(e[1])]);
      start = null;
    }
  }
  if (start !== null) silences.push([start, duration]);
  const keep: Array<[number, number]> = [];
  let cursor = 0;
  for (const [a, b] of silences) {
    if (a - cursor > 0.05) keep.push([Math.max(0, cursor - pad), Math.min(duration, a + pad)]);
    cursor = b;
  }
  if (duration - cursor > 0.05) keep.push([Math.max(0, cursor - pad), duration]);
  return keep;
}

export interface VideoEditResult {
  asset: MediaAsset;
  log: string[];
  durationSeconds: number;
}

export class VideoEditor {
  private sandbox: ProjectSandbox;
  private log: string[] = [];

  constructor(private userId: string) {
    this.sandbox = new ProjectSandbox(userId, 'media');
  }

  private async sh(cmd: string, timeoutMs = 280_000): Promise<string> {
    const r = await this.sandbox.run(cmd, timeoutMs);
    if (r.exitCode !== 0) throw new Error(`ffmpeg step failed (exit ${r.exitCode}): ${r.output.slice(-1200)}`);
    return r.output;
  }

  private async duration(file: string): Promise<number> {
    const out = await this.sh(`${FFPROBE} -v error -show_entries format=duration -of csv=p=0 ${q(file)}`);
    return parseFloat(out.trim().split('\n').pop() || '0') || 0;
  }

  private async hasAudio(file: string): Promise<boolean> {
    const out = await this.sh(`${FFPROBE} -v error -select_streams a -show_entries stream=index -of csv=p=0 ${q(file)} || true`);
    return out.trim().length > 0;
  }

  async transcribe(file: string) {
    await this.sh(`${FF} -y -v error -i ${q(file)} -vn -ac 1 -ar 16000 -b:a 64k ${q(`${WORK}/audio.mp3`)}`);
    const audio = await this.sandbox.readBinary(`${WORK}/audio.mp3`);
    if (!audio) throw new Error('Could not extract audio for transcription.');
    const result = await transcribe({ model: TRANSCRIBE_MODEL, audio: new Uint8Array(audio) });
    return result;
  }

  async transcribeUrl(sourceUrl: string) {
    assertPublicHttps(sourceUrl);
    await this.sh(ENSURE_FFMPEG, 280_000);
    const src = `${WORK}/tx-${Date.now().toString(36)}`;
    await this.sh(`curl -sSfL --max-filesize 1500000000 ${q(sourceUrl)} -o ${q(src)}`);
    try {
      return await this.transcribe(src);
    } finally {
      await this.sh(`rm -f ${q(src)}`, 60_000).catch(() => '');
    }
  }

  async edit(sourceUrl: string, ops: VideoOp[], platform: PlatformRepo, title = 'Edited video'): Promise<VideoEditResult> {
    assertPublicHttps(sourceUrl);
    await this.sh(ENSURE_FFMPEG, 280_000);
    const id = Date.now().toString(36);
    let cur = `${WORK}/${id}-0.mp4`;
    await this.sh(`curl -sSfL --max-filesize 1500000000 ${q(sourceUrl)} -o ${q(`${WORK}/${id}-src`)} && ${FF} -y -v error -i ${q(`${WORK}/${id}-src`)} -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart ${q(cur)}`);
    this.log.push('Loaded source video');

    let n = 0;
    const next = () => `${WORK}/${id}-${++n}.mp4`;
    const enc = '-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart';

    for (const op of ops) {
      const out = next();
      switch (op.op) {
        case 'trim': {
          const to = op.end !== undefined ? `-to ${Number(op.end)}` : '';
          await this.sh(`${FF} -y -v error -ss ${Number(op.start)} ${to} -i ${q(cur)} ${enc} ${q(out)}`);
          this.log.push(`Trimmed ${op.start}s → ${op.end ?? 'end'}`);
          break;
        }
        case 'cut_silences': {
          if (!(await this.hasAudio(cur))) {
            this.log.push('Skipped silence cut (no audio track)');
            continue;
          }
          const dur = await this.duration(cur);
          const det = await this.sandbox.run(`${FF} -hide_banner -i ${q(cur)} -af silencedetect=noise=${Number(op.threshold_db ?? -35)}dB:d=${Number(op.min_silence ?? 0.6)} -f null - 2>&1`, 280_000);
          const spans = speechSpans(det.output, dur);
          if (spans.length <= 1 && spans[0] && spans[0][1] - spans[0][0] > dur - 0.3) {
            this.log.push('No long silences found');
            continue;
          }
          const expr = spans.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+');
          await this.sh(`${FF} -y -v error -i ${q(cur)} -vf ${q(`select='${expr}',setpts=N/FRAME_RATE/TB`)} -af ${q(`aselect='${expr}',asetpts=N/SR/TB`)} ${enc} ${q(out)}`);
          const after = await this.duration(out);
          this.log.push(`Cut silences: ${dur.toFixed(1)}s → ${after.toFixed(1)}s (${spans.length} segments kept)`);
          break;
        }
        case 'reframe': {
          const [w, h] = op.aspect.split(':').map(Number);
          const size = op.aspect === '9:16' ? '1080:1920' : op.aspect === '1:1' ? '1080:1080' : op.aspect === '4:5' ? '1080:1350' : '1920:1080';
          // Center crop to the target aspect, then scale.
          const crop = `crop='if(gt(a,${w}/${h}),ih*${w}/${h},iw)':'if(gt(a,${w}/${h}),ih,iw*${h}/${w})',scale=${size}`;
          await this.sh(`${FF} -y -v error -i ${q(cur)} -vf ${q(crop)} ${enc} ${q(out)}`);
          this.log.push(`Reframed to ${op.aspect}`);
          break;
        }
        case 'speed': {
          const f = Math.min(4, Math.max(0.25, Number(op.factor)));
          const atempo = f > 2 ? `atempo=2,atempo=${(f / 2).toFixed(3)}` : f < 0.5 ? `atempo=0.5,atempo=${(f / 0.5).toFixed(3)}` : `atempo=${f}`;
          const audio = (await this.hasAudio(cur)) ? `-af ${q(atempo)}` : '';
          await this.sh(`${FF} -y -v error -i ${q(cur)} -vf ${q(`setpts=PTS/${f}`)} ${audio} ${enc} ${q(out)}`);
          this.log.push(`Speed ×${f}`);
          break;
        }
        case 'captions': {
          const t = await this.transcribe(cur);
          if (!t.segments?.length) {
            this.log.push('No speech detected for captions');
            continue;
          }
          const srtPath = `${WORK}/${id}-${n}.srt`;
          await this.sandbox.writeBinary(srtPath, new TextEncoder().encode(buildSrt(t.segments as any)));
          const bold = op.style !== 'clean';
          const style = `FontName=DejaVu Sans,FontSize=${bold ? 16 : 13},Bold=${bold ? 1 : 0},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=${bold ? 3 : 2},Shadow=0,Alignment=${op.position === 'middle' ? 5 : 2},MarginV=${op.position === 'middle' ? 0 : 60}`;
          await this.sh(`${FF} -y -v error -i ${q(cur)} -vf ${q(`subtitles=${srtPath}:fontsdir=${FONT_DIR}:force_style='${style}'`)} ${enc} ${q(out)}`);
          this.log.push(`Burned in captions (${t.segments.length} segments, ${TRANSCRIBE_MODEL})`);
          break;
        }
        case 'add_music': {
          assertPublicHttps(op.url);
          const music = `${WORK}/${id}-music`;
          await this.sh(`curl -sSfL --max-filesize 200000000 ${q(op.url)} -o ${q(music)}`);
          const vol = Math.min(1, Math.max(0, Number(op.volume ?? 0.15)));
          const graph = (await this.hasAudio(cur))
            ? `[1:a]volume=${vol}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]`
            : `[1:a]volume=${vol}[a]`;
          await this.sh(`${FF} -y -v error -i ${q(cur)} -stream_loop -1 -i ${q(music)} -filter_complex ${q(graph)} -map 0:v -map '[a]' -shortest ${enc} ${q(out)}`);
          this.log.push(`Added background music at ${Math.round(vol * 100)}% volume`);
          break;
        }
        case 'concat': {
          const parts = [cur];
          for (let i = 0; i < op.urls.length; i++) {
            assertPublicHttps(op.urls[i]);
            const p = `${WORK}/${id}-c${i}.mp4`;
            await this.sh(`curl -sSfL ${q(op.urls[i])} -o ${q(`${p}.src`)} && ${FF} -y -v error -i ${q(`${p}.src`)} -vf scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1 ${enc} ${q(p)}`);
            parts.push(p);
          }
          const inputs = parts.map((p) => `-i ${q(p)}`).join(' ');
          const filter = parts.map((_, i) => `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1,setsar=1[v${i}];`).join('') + parts.map((_, i) => `[v${i}][${i}:a]`).join('') + `concat=n=${parts.length}:v=1:a=1[v][a]`;
          await this.sh(`${FF} -y -v error ${inputs} -filter_complex ${q(filter)} -map '[v]' -map '[a]' ${enc} ${q(out)}`);
          this.log.push(`Joined ${parts.length} clips`);
          break;
        }
        case 'mute': {
          await this.sh(`${FF} -y -v error -i ${q(cur)} -c:v copy -an ${q(out)}`);
          this.log.push('Removed audio');
          break;
        }
      }
      cur = out;
    }

    const durationSeconds = await this.duration(cur);
    const bytes = await this.sandbox.readBinary(cur);
    if (!bytes) throw new Error('Rendered video could not be read back from the sandbox.');
    const blob = await put(`videos/${this.userId}/${id}.mp4`, bytes, { access: 'public', addRandomSuffix: true, contentType: 'video/mp4' });
    await this.sh(`rm -f ${WORK}/${id}-*`, 60_000).catch(() => '');

    const asset = await platform.addMedia(this.userId, {
      kind: 'video',
      url: blob.url,
      prompt: title,
      model: 'ffmpeg (Vercel Sandbox)',
      meta: { ops, log: this.log, durationSeconds, source: sourceUrl, sizeBytes: bytes.length },
    });
    return { asset, log: this.log, durationSeconds };
  }
}
