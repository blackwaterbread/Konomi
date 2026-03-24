#define _USE_MATH_DEFINES
#include <napi.h>
#include <png.h>
#include <cmath>
#include <cstring>
#include <vector>
#include <algorithm>
#include <cstdio>
#include <unordered_map>
#include <cstdint>

// ── DCT lookup table (precomputed at init) ────────────────────────────────────

static const int DCT_N    = 32;
static const int HASH_N   = 8;   // top-left HASH_N×HASH_N of 2D DCT
static const int HASH_BITS = HASH_N * HASH_N; // 64

static double s_dct_cos[DCT_N][DCT_N]; // [k][n]
static double s_dct_scale[DCT_N];

static void init_dct() {
  for (int k = 0; k < DCT_N; k++) {
    s_dct_scale[k] = (k == 0) ? 1.0 / sqrt((double)DCT_N) : sqrt(2.0 / DCT_N);
    for (int n = 0; n < DCT_N; n++) {
      s_dct_cos[k][n] = cos(M_PI * (2 * n + 1) * k / (2.0 * DCT_N));
    }
  }
}

// 1D DCT-II matching the JS implementation
static void dct1d(const double* in, double* out) {
  for (int k = 0; k < DCT_N; k++) {
    double sum = 0.0;
    const double* cos_row = s_dct_cos[k];
    for (int n = 0; n < DCT_N; n++) {
      sum += in[n] * cos_row[n];
    }
    out[k] = sum * s_dct_scale[k];
  }
}

// ── libpng read callback ──────────────────────────────────────────────────────

struct PngReadState {
  const uint8_t* data;
  size_t         size;
  size_t         pos;
};

static void png_read_from_buffer(png_structp png, png_bytep out, png_size_t len) {
  auto* s = static_cast<PngReadState*>(png_get_io_ptr(png));
  if (s->pos + len > s->size) {
    png_error(png, "read past end");
    return;
  }
  memcpy(out, s->data + s->pos, len);
  s->pos += len;
}

// ── Decoded PNG result ────────────────────────────────────────────────────────

struct DecodedPng {
  std::vector<uint8_t> pixels; // row-major, `channels` bytes per pixel
  int    width    = 0;
  int    height   = 0;
  int    channels = 0; // 3 (RGB) or 4 (RGBA)
  bool   ok       = false;
};

// Decode a PNG buffer to raw pixels.
// keep_alpha=true  → preserve alpha channel (NAI steganography path)
// keep_alpha=false → strip alpha (pHash path, only needs RGB)
static DecodedPng decode_png(const uint8_t* data, size_t size, bool keep_alpha) {
  DecodedPng result;

  if (size < 8 || png_sig_cmp(data, 0, 8) != 0) return result;

  png_structp png = png_create_read_struct(PNG_LIBPNG_VER_STRING,
                                            nullptr, nullptr, nullptr);
  if (!png) return result;

  png_infop info = png_create_info_struct(png);
  if (!info) {
    png_destroy_read_struct(&png, nullptr, nullptr);
    return result;
  }

  // Error handler: longjmp back here on libpng error.
  // NOTE: longjmp bypasses C++ stack unwinding, so std::vector destructors
  // (result.pixels, row_ptrs) won't run — leaking their heap buffers.
  // This only triggers on corrupt/truncated PNG data; valid NAI images never
  // hit this path. Accepted trade-off for a desktop app.
  if (setjmp(png_jmpbuf(png))) {
    png_destroy_read_struct(&png, &info, nullptr);
    return result; // result.ok = false
  }

  PngReadState state{data, size, 0};
  png_set_read_fn(png, &state, png_read_from_buffer);
  png_read_info(png, info);

  int color_type = png_get_color_type(png, info);
  int bit_depth  = png_get_bit_depth(png, info);

  // Normalize to 8-bit RGBA or RGB
  if (bit_depth == 16)
    png_set_strip_16(png);
  if (color_type == PNG_COLOR_TYPE_PALETTE)
    png_set_palette_to_rgb(png);
  if (color_type == PNG_COLOR_TYPE_GRAY && bit_depth < 8)
    png_set_expand_gray_1_2_4_to_8(png);
  if (png_get_valid(png, info, PNG_INFO_tRNS))
    png_set_tRNS_to_alpha(png);
  if (color_type == PNG_COLOR_TYPE_GRAY ||
      color_type == PNG_COLOR_TYPE_GRAY_ALPHA)
    png_set_gray_to_rgb(png);

  if (!keep_alpha &&
      (color_type == PNG_COLOR_TYPE_RGBA ||
       color_type == PNG_COLOR_TYPE_GRAY_ALPHA ||
       png_get_valid(png, info, PNG_INFO_tRNS)))
    png_set_strip_alpha(png);

  png_read_update_info(png, info);

  int w        = (int)png_get_image_width(png, info);
  int h        = (int)png_get_image_height(png, info);
  int channels = (int)png_get_channels(png, info);
  size_t rowbytes = png_get_rowbytes(png, info);

  result.pixels.resize((size_t)h * rowbytes);

  std::vector<png_bytep> row_ptrs((size_t)h);
  for (int y = 0; y < h; y++)
    row_ptrs[y] = result.pixels.data() + (size_t)y * rowbytes;

  png_read_image(png, row_ptrs.data());
  png_destroy_read_struct(&png, &info, nullptr);

  result.width    = w;
  result.height   = h;
  result.channels = channels;
  result.ok       = true;
  return result;
}

// ── computePHash ─────────────────────────────────────────────────────────────
//
// computePHash(buf: Buffer): string | null
//
// Replicates the JS pipeline:
//   PNG decode → grayscale bilinear resize to 32×32 → 2D DCT-II (separable)
//   → top-left 8×8 → median → 64-bit hash as 16-char lowercase hex string

Napi::Value ComputePHash(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "Expected Buffer").ThrowAsJavaScriptException();
    return env.Null();
  }

  auto buf = info[0].As<Napi::Buffer<uint8_t>>();
  auto png = decode_png(buf.Data(), buf.ByteLength(), /*keep_alpha=*/false);
  if (!png.ok) return env.Null();

  int srcW = png.width, srcH = png.height, ch = png.channels;
  const double xRatio = (double)srcW / DCT_N;
  const double yRatio = (double)srcH / DCT_N;

  // Bilinear resize + grayscale → DCT_N × DCT_N grid
  double grid[DCT_N][DCT_N];
  for (int dy = 0; dy < DCT_N; dy++) {
    for (int dx = 0; dx < DCT_N; dx++) {
      double sx = dx * xRatio, sy = dy * yRatio;
      int x0 = (int)sx, y0 = (int)sy;
      int x1 = (x0 + 1 < srcW) ? x0 + 1 : x0;
      int y1 = (y0 + 1 < srcH) ? y0 + 1 : y0;
      double xf = sx - x0, yf = sy - y0;

      auto gray = [&](int x, int y) -> double {
        const uint8_t* p = png.pixels.data() + ((size_t)y * srcW + x) * ch;
        return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
      };

      grid[dy][dx] =
        gray(x0, y0) * (1 - xf) * (1 - yf) +
        gray(x1, y0) *      xf  * (1 - yf) +
        gray(x0, y1) * (1 - xf) *      yf  +
        gray(x1, y1) *      xf  *      yf;
    }
  }

  // Row-wise DCT
  double row_dct[DCT_N][DCT_N];
  for (int y = 0; y < DCT_N; y++)
    dct1d(grid[y], row_dct[y]);

  // Column-wise DCT
  double col_in[DCT_N], col_out[DCT_N];
  double col_dct[DCT_N][DCT_N];
  for (int x = 0; x < DCT_N; x++) {
    for (int y = 0; y < DCT_N; y++) col_in[y] = row_dct[y][x];
    dct1d(col_in, col_out);
    for (int y = 0; y < DCT_N; y++) col_dct[y][x] = col_out[y];
  }

  // Extract top-left HASH_N × HASH_N
  double sub[HASH_BITS];
  for (int y = 0; y < HASH_N; y++)
    for (int x = 0; x < HASH_N; x++)
      sub[y * HASH_N + x] = col_dct[y][x];

  // Median of 64 values (average of two middle elements, matching JS)
  double sorted[HASH_BITS];
  memcpy(sorted, sub, sizeof(sub));
  std::sort(sorted, sorted + HASH_BITS);
  double median = (sorted[31] + sorted[32]) / 2.0;

  // Build 64-bit hash
  uint64_t hash = 0;
  for (int i = 0; i < HASH_BITS; i++)
    hash = (hash << 1) | (sub[i] > median ? 1u : 0u);

  char hex[17];
  snprintf(hex, sizeof(hex), "%016llx", (unsigned long long)hash);
  return Napi::String::New(env, hex);
}

// ── extractNaiLsb ─────────────────────────────────────────────────────────────
//
// extractNaiLsb(buf: Buffer): { rgb: Buffer, alpha: Buffer | null } | null
//
// Decodes the PNG and extracts NAI steganography LSBs, replicating the JS:
//
//   const MAX_RGB_BITS = 15*8 + 32 + 2_000_000;
//   for x in [0, w):
//     for y in [0, h):
//       if hasAlpha: bA.push(pixel[A] & 1)
//       bRgb.push(pixel[R]&1, pixel[G]&1, pixel[B]&1)
//       if bRgb.length >= MAX_RGB_BITS: stop
//
// Returns bit arrays (one bit per byte, value 0 or 1) as Buffers.

Napi::Value ExtractNaiLsb(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "Expected Buffer").ThrowAsJavaScriptException();
    return env.Null();
  }

  auto buf = info[0].As<Napi::Buffer<uint8_t>>();
  auto png = decode_png(buf.Data(), buf.ByteLength(), /*keep_alpha=*/true);
  if (!png.ok) return env.Null();

  int w = png.width, h = png.height, ch = png.channels;
  bool has_alpha = (ch == 4);

  static const int MAX_RGB_BITS = 15 * 8 + 32 + 2000000; // 2000152
  int max_pixels = (MAX_RGB_BITS + 2) / 3;                // ceil

  std::vector<uint8_t> rgb_bits;
  std::vector<uint8_t> alpha_bits;
  rgb_bits.reserve((size_t)std::min(w * h, max_pixels) * 3);
  if (has_alpha)
    alpha_bits.reserve((size_t)std::min(w * h, max_pixels));

  // Column-major traversal matching the JS code (x outer, y inner)
  bool done = false;
  for (int x = 0; x < w && !done; x++) {
    for (int y = 0; y < h && !done; y++) {
      const uint8_t* p = png.pixels.data() + ((size_t)y * w + x) * ch;
      if (has_alpha) alpha_bits.push_back(p[3] & 1u);
      rgb_bits.push_back(p[0] & 1u);
      rgb_bits.push_back(p[1] & 1u);
      rgb_bits.push_back(p[2] & 1u);
      if ((int)rgb_bits.size() >= MAX_RGB_BITS) done = true;
    }
  }

  auto rgb_buf = Napi::Buffer<uint8_t>::Copy(
    env, rgb_bits.data(), rgb_bits.size());

  Napi::Object result = Napi::Object::New(env);
  result.Set("rgb", rgb_buf);

  if (has_alpha) {
    auto alpha_buf = Napi::Buffer<uint8_t>::Copy(
      env, alpha_bits.data(), alpha_bits.size());
    result.Set("alpha", alpha_buf);
  } else {
    result.Set("alpha", env.Null());
  }

  return result;
}

// ── computeAllPairs ───────────────────────────────────────────────────────────
//
// computeAllPairs(params: object): Array<{imageAId, imageBId, phashDistance, textScore}>
//
// Replaces the O(N²) JS pair loop in phash.ts using two strategies:
//
//   1. Inverted token index  — accumulates weighted intersection per pair only
//      for pairs that share at least one token.  Tokens with df > N/4 are
//      skipped from the index (they are "masterpiece"-style common tokens whose
//      IDF is low anyway and would otherwise produce df² work).
//
//   2. pHash pass            — iterates all N*(N-1)/2 pairs with a single
//      POPCNT instruction each; picks up visually-close pairs that share no
//      text tokens.

static int popcount64(uint64_t x) {
#ifdef _MSC_VER
  return (int)__popcnt64(x);
#else
  return __builtin_popcountll(x);
#endif
}

static uint64_t parse_hex64(const char* s, size_t len) {
  uint64_t v = 0;
  for (size_t i = 0; i < len && i < 16; ++i) {
    char c = s[i];
    uint64_t n;
    if      (c >= '0' && c <= '9') n = (uint64_t)(c - '0');
    else if (c >= 'a' && c <= 'f') n = (uint64_t)(c - 'a' + 10);
    else if (c >= 'A' && c <= 'F') n = (uint64_t)(c - 'A' + 10);
    else break;
    v = (v << 4) | n;
  }
  return v;
}

struct PairAcc {
  float promptInter     = 0.f;
  float charInter       = 0.f;
  float positiveInter   = 0.f;
  float conflictABInter = 0.f; // A.positive ∩ B.negative
  float conflictBAInter = 0.f; // B.positive ∩ A.negative
};

// Accumulate same-field intersection for every pair in `list`.
static void acc_same(
  const std::vector<uint32_t>& list, float w,
  float PairAcc::* field,
  std::unordered_map<uint64_t, PairAcc>& out
) {
  uint32_t n = (uint32_t)list.size();
  for (uint32_t i = 0; i < n; ++i) {
    uint32_t a = list[i];
    for (uint32_t j = i + 1; j < n; ++j)
      out[((uint64_t)a << 32) | list[j]].*field += w;
  }
}

// Accumulate cross-field conflict: A has token in positive, B in negative.
static void acc_cross(
  const std::vector<uint32_t>& pos_list,
  const std::vector<uint32_t>& neg_list,
  float w,
  std::unordered_map<uint64_t, PairAcc>& out
) {
  for (uint32_t pi : pos_list) {
    for (uint32_t ni : neg_list) {
      if (pi == ni) continue;
      // Pair key always has smaller index in high 32 bits.
      if (pi < ni)
        out[((uint64_t)pi << 32) | ni].conflictABInter += w;
      else
        out[((uint64_t)ni << 32) | pi].conflictBAInter += w;
    }
  }
}

static inline float wjacc(float inter, double wa, double wb) {
  double u = wa + wb - (double)inter;
  return (u <= 0.0) ? 0.f : (float)((double)inter / u);
}

// Replicates computeTextScore() from phash.ts.
static float score_from_acc(
  const PairAcc& acc,
  double pwa, double cwa, double nwa, double xwa,  // A: prompt/char/neg/pos wt sums
  double pwb, double cwb, double nwb, double xwb,  // B
  bool hpa, bool hca,                              // A has prompt / char tokens
  bool hpb, bool hcb,
  float conflict_w
) {
  float ps = wjacc(acc.promptInter,   pwa, pwb);
  float cs = wjacc(acc.charInter,     cwa, cwb);
  float xs = wjacc(acc.positiveInter, xwa, xwb);

  bool hp = hpa || hpb, hc = hca || hcb;
  float pw = hp ? .55f : 0.f, cw = hc ? .25f : 0.f;
  float xw = 1.f - pw - cw;
  float base = pw * ps + cw * cs + xw * xs;

  float cab = wjacc(acc.conflictABInter, xwa, nwb);
  float cba = wjacc(acc.conflictBAInter, xwb, nwa);
  float pen = cab > cba ? cab : cba;

  float s = base - pen * conflict_w;
  return s < 0.f ? 0.f : s > 1.f ? 1.f : s;
}

Napi::Value ComputeAllPairs(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "Expected object").ThrowAsJavaScriptException();
    return env.Null();
  }

  auto p = info[0].As<Napi::Object>();

  // ── Parse inputs ─────────────────────────────────────────────────────────

  auto ids_arr = p.Get("imageIds").As<Napi::Int32Array>();
  uint32_t N   = (uint32_t)ids_arr.ElementLength();
  const int32_t* image_ids = ids_arr.Data();
  if (N < 2) return Napi::Array::New(env, 0);

  // pHash: JS Array of 16-char hex strings ("" = no hash)
  auto phash_js = p.Get("pHashHex").As<Napi::Array>();
  std::vector<uint64_t> phash_vals(N, 0);
  std::vector<bool>     has_phash(N, false);
  for (uint32_t i = 0; i < N; ++i) {
    Napi::Value v = phash_js[i];
    if (v.IsString()) {
      std::string s = v.As<Napi::String>().Utf8Value();
      if (s.size() == 16) {
        phash_vals[i] = parse_hex64(s.data(), 16);
        has_phash[i]  = true;
      }
    }
  }

  // Typed-array helpers
  auto u32 = [&](const char* k) { return p.Get(k).As<Napi::Uint32Array>().Data(); };
  auto i32 = [&](const char* k) { return p.Get(k).As<Napi::Int32Array>().Data(); };
  auto f64 = [&](const char* k) { return p.Get(k).As<Napi::Float64Array>().Data(); };
  auto u8  = [&](const char* k) { return p.Get(k).As<Napi::Uint8Array>().Data(); };

  const uint32_t* prom_d = u32("promptData");   const int32_t* prom_o = i32("promptOffsets");
  const uint32_t* char_d = u32("charData");     const int32_t* char_o = i32("charOffsets");
  const uint32_t* neg_d  = u32("negData");      const int32_t* neg_o  = i32("negOffsets");
  const uint32_t* pos_d  = u32("posData");      const int32_t* pos_o  = i32("posOffsets");

  const double* prom_w = f64("promptWts");
  const double* char_w = f64("charWts");
  const double* neg_w  = f64("negWts");
  const double* pos_w  = f64("posWts");

  const uint8_t* has_prom = u8("hasPrompt");
  const uint8_t* has_char = u8("hasChar");

  auto tw_arr    = p.Get("tokenWeights").As<Napi::Float64Array>();
  uint32_t vsz   = (uint32_t)tw_arr.ElementLength();
  const double* tok_w = tw_arr.Data();

  int   ui_max      = p.Get("uiThresholdMax").As<Napi::Number>().Int32Value();
  float text_loose  = (float)p.Get("textThreshold").As<Napi::Number>().DoubleValue();
  float hybrid_loose= (float)p.Get("hybridThreshold").As<Napi::Number>().DoubleValue();
  float h_phash     = (float)p.Get("hybridPHashWeight").As<Napi::Number>().DoubleValue();
  float h_text      = (float)p.Get("hybridTextWeight").As<Napi::Number>().DoubleValue();
  float conflict_w  = (float)p.Get("conflictPenaltyWeight").As<Napi::Number>().DoubleValue();

  // ── Build inverted index ──────────────────────────────────────────────────
  // fidx[field][tokenId] = image indices (0..N-1) that have this token
  // fields: 0=prompt  1=char  2=neg  3=positive(prompt∪char)

  std::vector<std::vector<std::vector<uint32_t>>> fidx(4,
    std::vector<std::vector<uint32_t>>(vsz));

  auto build_idx = [&](int f, const uint32_t* data, const int32_t* offs) {
    for (uint32_t i = 0; i < N; ++i)
      for (int32_t k = offs[i]; k < offs[i + 1]; ++k) {
        uint32_t t = data[k];
        if (t < vsz) fidx[f][t].push_back(i);
      }
  };
  build_idx(0, prom_d, prom_o);
  build_idx(1, char_d, char_o);
  build_idx(2, neg_d,  neg_o);
  build_idx(3, pos_d,  pos_o);

  // ── Accumulate weighted intersections via inverted index ──────────────────
  // Tokens with df > N/4 are skipped: their IDF contribution is small
  // (common tokens like "masterpiece") and iterating df² pairs is expensive.

  std::unordered_map<uint64_t, PairAcc> tpairs;
  tpairs.reserve(std::min((uint64_t)N * N / 4, (uint64_t)4000000));

  const uint32_t max_df = std::max(N / 4u, 2u);

  for (uint32_t t = 0; t < vsz; ++t) {
    if (tok_w[t] <= 0.0) continue;
    float w = (float)tok_w[t];

    if (fidx[0][t].size() <= max_df) acc_same(fidx[0][t], w, &PairAcc::promptInter,   tpairs);
    if (fidx[1][t].size() <= max_df) acc_same(fidx[1][t], w, &PairAcc::charInter,     tpairs);
    if (fidx[3][t].size() <= max_df) acc_same(fidx[3][t], w, &PairAcc::positiveInter, tpairs);
    if (fidx[3][t].size() <= max_df && fidx[2][t].size() <= max_df)
      acc_cross(fidx[3][t], fidx[2][t], w, tpairs);
  }

  // ── pHash pass: find visually-close pairs not in tpairs ──────────────────
  // Each comparison is a single XOR + POPCNT: fast even for large N.

  std::unordered_map<uint64_t, int> phash_only;
  for (uint32_t i = 0; i < N - 1; ++i) {
    if (!has_phash[i]) continue;
    for (uint32_t j = i + 1; j < N; ++j) {
      if (!has_phash[j]) continue;
      int d = popcount64(phash_vals[i] ^ phash_vals[j]);
      if (d > ui_max) continue;
      uint64_t key = ((uint64_t)i << 32) | j;
      if (tpairs.count(key) == 0)
        phash_only.emplace(key, d);
    }
  }

  // ── Build result ──────────────────────────────────────────────────────────

  auto should_persist = [&](int dist, bool hp, float ts) {
    if (hp && dist <= ui_max) return true;
    if (ts >= text_loose)     return true;
    if (!hp) return false;
    float ps = 1.f - (float)dist / 64.f;
    return h_phash * ps + h_text * ts >= hybrid_loose;
  };

  Napi::Array out = Napi::Array::New(env);
  uint32_t ri = 0;

  auto push_row = [&](int32_t aid, int32_t bid, int dist, bool hp, float ts) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("imageAId", aid);
    obj.Set("imageBId", bid);
    if (hp) obj.Set("phashDistance", dist);
    else    obj.Set("phashDistance", env.Null());
    obj.Set("textScore", (double)ts);
    out[ri++] = obj;
  };

  for (auto& [key, acc] : tpairs) {
    uint32_t ai = (uint32_t)(key >> 32), bi = (uint32_t)(key & 0xFFFFFFFF);
    bool hp  = has_phash[ai] && has_phash[bi];
    int  dist = hp ? popcount64(phash_vals[ai] ^ phash_vals[bi]) : -1;
    float ts = score_from_acc(acc,
      prom_w[ai], char_w[ai], neg_w[ai], pos_w[ai],
      prom_w[bi], char_w[bi], neg_w[bi], pos_w[bi],
      (bool)has_prom[ai], (bool)has_char[ai],
      (bool)has_prom[bi], (bool)has_char[bi],
      conflict_w);
    if (should_persist(dist, hp, ts))
      push_row(image_ids[ai], image_ids[bi], dist, hp, ts);
  }

  for (auto& [key, dist] : phash_only) {
    uint32_t ai = (uint32_t)(key >> 32), bi = (uint32_t)(key & 0xFFFFFFFF);
    push_row(image_ids[ai], image_ids[bi], dist, true, 0.f);
  }

  return out;
}

// ── Module init ───────────────────────────────────────────────────────────────

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  init_dct();
  exports.Set("computePHash",    Napi::Function::New(env, ComputePHash));
  exports.Set("extractNaiLsb",   Napi::Function::New(env, ExtractNaiLsb));
  exports.Set("computeAllPairs", Napi::Function::New(env, ComputeAllPairs));
  return exports;
}

NODE_API_MODULE(konomi_image, Init)
