import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseFile } from "music-metadata";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MP3_DIR = path.join(ROOT, "mp3");
const MEDIA_DIR = path.join(ROOT, "media");
const COVERS_DIR = path.join(ROOT, "covers");
const ICONS_DIR = path.join(ROOT, "icons");

const THEME = {
  bg: "#2d1b4e",
  accent: "#f5d742",
};

function listMp3Files() {
  if (!fs.existsSync(MP3_DIR)) {
    console.error("Немає папки mp3 у корені проєкту.");
    process.exit(1);
  }
  return fs
    .readdirSync(MP3_DIR)
    .filter((f) => f.toLowerCase().endsWith(".mp3"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function lyricsFromMeta(common) {
  const blocks = common.lyrics;
  if (!blocks || !blocks.length) return "";
  return blocks.map((b) => (b.text || "").trim()).filter(Boolean).join("\n\n");
}

async function writeCoverFromPicture(picture, outPath) {
  if (!picture || !picture.data || !picture.data.length) return false;
  const buf = Buffer.from(picture.data);
  const img = sharp(buf).rotate();
  const meta = await img.metadata();
  const w = meta.width || 600;
  const size = Math.min(800, w);
  await img
    .resize(size, size, { fit: "cover", position: "centre" })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(outPath);
  return true;
}

async function buildPwaIcons() {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  const makePng = async (px) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}">
  <rect width="100%" height="100%" fill="${THEME.bg}"/>
  <circle cx="${px / 2}" cy="${px / 2}" r="${Math.floor(px * 0.28)}" fill="none" stroke="${THEME.accent}" stroke-width="${Math.max(4, px / 48)}"/>
  <circle cx="${px / 2}" cy="${px / 2}" r="${Math.floor(px * 0.1)}" fill="${THEME.accent}"/>
</svg>`;
    const out = path.join(ICONS_DIR, `icon-${px}.png`);
    await sharp(Buffer.from(svg)).png().toFile(out);
    console.log("OK", path.relative(ROOT, out));
  };
  await makePng(192);
  await makePng(512);
}

async function main() {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const files = listMp3Files();
  const tracks = [];
  const emittedBin = new Set();
  let idx = 0;
  for (const file of files) {
    idx += 1;
    const id = `t${String(idx).padStart(2, "0")}`;
    const abs = path.join(MP3_DIR, file);
    const raw = fs.readFileSync(abs);
    const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
    const binName = `${hash}.bin`;
    const binAbs = path.join(MEDIA_DIR, binName);
    fs.writeFileSync(binAbs, raw);
    emittedBin.add(binName);
    const meta = await parseFile(abs);
    const common = meta.common;
    const title = (common.title || path.basename(file, ".mp3")).trim();
    const artist = Array.isArray(common.artist)
      ? common.artist.join(", ")
      : (common.artist || "").trim();
    const durationSec = meta.format.duration
      ? Math.round(meta.format.duration * 10) / 10
      : 0;
    const lyrics = lyricsFromMeta(common);

    const pic = common.picture && common.picture[0];
    let coverRel = null;
    if (pic) {
      const coverName = `${id}.jpg`;
      const coverAbs = path.join(COVERS_DIR, coverName);
      const ok = await writeCoverFromPicture(pic, coverAbs);
      if (ok) coverRel = `covers/${coverName}`.replace(/\\/g, "/");
    }

    tracks.push({
      id,
      file: `media/${binName}`.replace(/\\/g, "/"),
      mime: "audio/mpeg",
      title,
      artist,
      durationSec,
      lyrics,
      cover: coverRel,
    });
    console.log("Трек", id, "—", title, artist ? `(${artist})` : "");
  }

  for (const name of fs.readdirSync(MEDIA_DIR)) {
    if (!name.endsWith(".bin")) continue;
    if (!emittedBin.has(name)) {
      fs.unlinkSync(path.join(MEDIA_DIR, name));
      console.log("видалено застарілий", path.join("media", name));
    }
  }

  const outJson = path.join(ROOT, "tracks.json");
  fs.writeFileSync(outJson, JSON.stringify({ generatedAt: new Date().toISOString(), tracks }, null, 2), "utf8");
  console.log("OK", path.relative(ROOT, outJson), `(${tracks.length} треків)`);

  await buildPwaIcons();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
