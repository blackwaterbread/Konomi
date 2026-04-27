#define _USE_MATH_DEFINES
#include <napi.h>
#include <png.h>
#include <turbojpeg.h>
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

// ── Streaming pHash: row-by-row PNG decode → 32×32 bilinear sample ──────────
//
// Instead of decoding the full image (~4.5 MB for 1024×1536) and then
// shrinking to 32×32, we keep only two row buffers and sample destination
// pixels on the fly.  This eliminates the large allocation and dramatically
// improves cache behaviour.

Napi::Value ComputePHash(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "Expected Buffer").ThrowAsJavaScriptException();
    return env.Null();
  }

  auto buf = info[0].As<Napi::Buffer<uint8_t>>();
  const uint8_t* data = buf.Data();
  size_t size = buf.ByteLength();

  if (size < 8 || png_sig_cmp(data, 0, 8) != 0) return env.Null();

  png_structp png = png_create_read_struct(PNG_LIBPNG_VER_STRING,
                                            nullptr, nullptr, nullptr);
  if (!png) return env.Null();
  png_infop pinfo = png_create_info_struct(png);
  if (!pinfo) { png_destroy_read_struct(&png, nullptr, nullptr); return env.Null(); }

  if (setjmp(png_jmpbuf(png))) {
    png_destroy_read_struct(&png, &pinfo, nullptr);
    return env.Null();
  }

  PngReadState state{data, size, 0};
  png_set_read_fn(png, &state, png_read_from_buffer);
  png_read_info(png, pinfo);

  int color_type = png_get_color_type(png, pinfo);
  int bit_depth  = png_get_bit_depth(png, pinfo);

  if (bit_depth == 16)      png_set_strip_16(png);
  if (color_type == PNG_COLOR_TYPE_PALETTE) png_set_palette_to_rgb(png);
  if (color_type == PNG_COLOR_TYPE_GRAY && bit_depth < 8)
    png_set_expand_gray_1_2_4_to_8(png);
  if (png_get_valid(png, pinfo, PNG_INFO_tRNS)) png_set_tRNS_to_alpha(png);
  if (color_type == PNG_COLOR_TYPE_GRAY ||
      color_type == PNG_COLOR_TYPE_GRAY_ALPHA)
    png_set_gray_to_rgb(png);
  if (color_type == PNG_COLOR_TYPE_RGBA ||
      color_type == PNG_COLOR_TYPE_GRAY_ALPHA ||
      png_get_valid(png, pinfo, PNG_INFO_tRNS))
    png_set_strip_alpha(png);

  png_read_update_info(png, pinfo);

  int w  = (int)png_get_image_width(png, pinfo);
  int h  = (int)png_get_image_height(png, pinfo);
  int ch = (int)png_get_channels(png, pinfo);
  size_t rowbytes = png_get_rowbytes(png, pinfo);

  const double xRatio = (double)w / DCT_N;
  const double yRatio = (double)h / DCT_N;

  // Precompute horizontal sample positions (same for every row)
  struct XSample { int x0, x1; double xf; };
  XSample xs[DCT_N];
  for (int dx = 0; dx < DCT_N; dx++) {
    double sx = dx * xRatio;
    xs[dx].x0 = (int)sx;
    xs[dx].x1 = (xs[dx].x0 + 1 < w) ? xs[dx].x0 + 1 : xs[dx].x0;
    xs[dx].xf = sx - xs[dx].x0;
  }

  // Two-row buffer for bilinear Y interpolation
  std::vector<uint8_t> row_a(rowbytes), row_b(rowbytes, 0);
  uint8_t* row_cur  = row_a.data();
  uint8_t* row_prev = row_b.data();

  double grid[DCT_N][DCT_N];
  int next_dy = 0;

  for (int y = 0; y < h; y++) {
    png_read_row(png, row_cur, nullptr);

    // Process any destination rows whose y1 == y
    while (next_dy < DCT_N) {
      double sy = next_dy * yRatio;
      int y0 = (int)sy;
      int y1 = (y0 + 1 < h) ? y0 + 1 : y0;
      if (y < y1) break; // need the next source row first

      double yf = sy - y0;
      const uint8_t* r0 = (y0 == y) ? row_cur : row_prev;
      const uint8_t* r1 = row_cur;

      for (int dx = 0; dx < DCT_N; dx++) {
        const auto& s = xs[dx];
        const uint8_t* p00 = r0 + s.x0 * ch;
        const uint8_t* p10 = r0 + s.x1 * ch;
        const uint8_t* p01 = r1 + s.x0 * ch;
        const uint8_t* p11 = r1 + s.x1 * ch;

        double g00 = 0.299 * p00[0] + 0.587 * p00[1] + 0.114 * p00[2];
        double g10 = 0.299 * p10[0] + 0.587 * p10[1] + 0.114 * p10[2];
        double g01 = 0.299 * p01[0] + 0.587 * p01[1] + 0.114 * p01[2];
        double g11 = 0.299 * p11[0] + 0.587 * p11[1] + 0.114 * p11[2];

        grid[next_dy][dx] =
          g00 * (1 - s.xf) * (1 - yf) +
          g10 *      s.xf  * (1 - yf) +
          g01 * (1 - s.xf) *      yf  +
          g11 *      s.xf  *      yf;
      }
      next_dy++;
    }

    // Swap row buffers
    uint8_t* tmp = row_prev;
    row_prev = row_cur;
    row_cur  = tmp;

    if (next_dy >= DCT_N) break; // all 32 destination rows done
  }

  png_destroy_read_struct(&png, &pinfo, nullptr);

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
// When `is_target` is non-null, only pairs where at least one index is a target
// are accumulated.
static void acc_same(
  const std::vector<uint32_t>& list, float w,
  float PairAcc::* field,
  std::unordered_map<uint64_t, PairAcc>& out,
  const char* is_target = nullptr
) {
  uint32_t n = (uint32_t)list.size();
  for (uint32_t i = 0; i < n; ++i) {
    uint32_t a = list[i];
    for (uint32_t j = i + 1; j < n; ++j) {
      if (is_target && !is_target[a] && !is_target[list[j]]) continue;
      out[((uint64_t)a << 32) | list[j]].*field += w;
    }
  }
}

// Accumulate cross-field conflict: A has token in positive, B in negative.
static void acc_cross(
  const std::vector<uint32_t>& pos_list,
  const std::vector<uint32_t>& neg_list,
  float w,
  std::unordered_map<uint64_t, PairAcc>& out,
  const char* is_target = nullptr
) {
  for (uint32_t pi : pos_list) {
    for (uint32_t ni : neg_list) {
      if (pi == ni) continue;
      uint32_t a, b;
      float PairAcc::* field;
      if (pi < ni) {
        a = pi; b = ni; field = &PairAcc::conflictABInter;
      } else {
        a = ni; b = pi; field = &PairAcc::conflictBAInter;
      }
      if (is_target && !is_target[a] && !is_target[b]) continue;
      out[((uint64_t)a << 32) | b].*field += w;
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
  if (N < 2) {
    Napi::Object empty = Napi::Object::New(env);
    auto zero_ab = Napi::ArrayBuffer::New(env, 0);
    empty.Set("imageAIds", Napi::Int32Array::New(env, 0, zero_ab, 0));
    empty.Set("imageBIds", Napi::Int32Array::New(env, 0, zero_ab, 0));
    empty.Set("phashDistances", Napi::Int32Array::New(env, 0, zero_ab, 0));
    auto zero_f64 = Napi::ArrayBuffer::New(env, 0);
    empty.Set("textScores", Napi::Float64Array::New(env, 0, zero_f64, 0));
    return empty;
  }

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

  // Optional target indices — when provided, only pairs involving at least
  // one target index are computed (partial update mode).
  std::vector<char> is_target_vec;
  const char* is_target_ptr = nullptr;
  {
    auto ti_val = p.Get("targetIndices");
    if (ti_val.IsTypedArray()) {
      is_target_vec.resize(N, 0);
      auto tarr = ti_val.As<Napi::Uint32Array>();
      uint32_t tlen = (uint32_t)tarr.ElementLength();
      const uint32_t* tdata = tarr.Data();
      for (uint32_t i = 0; i < tlen; ++i) {
        if (tdata[i] < N) is_target_vec[tdata[i]] = 1;
      }
      is_target_ptr = is_target_vec.data();
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
  // Tokens with df > N/4 are skipped from the O(df²) pair enumeration to
  // avoid quadratic blowup on common tokens.  Their contributions are
  // corrected in a separate pass over existing pairs below.

  std::unordered_map<uint64_t, PairAcc> tpairs;
  tpairs.reserve(std::min((uint64_t)N * N / 4, (uint64_t)4000000));

  // Cap per-token df for O(df²) pair enumeration.  Tokens above this threshold
  // are deferred to the cheaper skip-correction pass over existing pairs.
  // With N=35K the old N/4 (=8750) allowed tokens with df=5000 to generate
  // C(5000,2)=12.5M pairs each, causing multi-GB memory usage in tpairs.
  const uint32_t max_df = std::max(std::min(N / 4u, 500u), 2u);

  struct SkipEntry { float weight; uint32_t tid; };
  std::vector<SkipEntry> skip_prompt, skip_char, skip_pos, skip_cross;

  for (uint32_t t = 0; t < vsz; ++t) {
    if (tok_w[t] <= 0.0) continue;
    float w = (float)tok_w[t];

    bool ps = fidx[0][t].size() > max_df;
    bool cs = fidx[1][t].size() > max_df;
    bool xs = fidx[3][t].size() > max_df;
    bool ns = fidx[2][t].size() > max_df;

    if (!ps) acc_same(fidx[0][t], w, &PairAcc::promptInter,   tpairs, is_target_ptr);
    else     skip_prompt.push_back({w, t});

    if (!cs) acc_same(fidx[1][t], w, &PairAcc::charInter,     tpairs, is_target_ptr);
    else     skip_char.push_back({w, t});

    if (!xs) acc_same(fidx[3][t], w, &PairAcc::positiveInter, tpairs, is_target_ptr);
    else     skip_pos.push_back({w, t});

    if (!xs && !ns) acc_cross(fidx[3][t], fidx[2][t], w, tpairs, is_target_ptr);
    else            skip_cross.push_back({w, t});
  }

  // ── Correct skipped-token contributions ──────────────────────────────────
  // For each skipped token, build a per-image membership flag (O(N·S)),
  // then iterate existing tpairs to add the missing intersection weight.
  // S is small (typically 20-40 tokens), so this is cheap.

  if (!tpairs.empty() &&
      (!skip_prompt.empty() || !skip_char.empty() ||
       !skip_pos.empty()    || !skip_cross.empty())) {

    auto build_has = [&](const std::vector<SkipEntry>& entries, int field) {
      std::vector<std::vector<uint8_t>> has(
        entries.size(), std::vector<uint8_t>(N, 0));
      for (size_t s = 0; s < entries.size(); ++s)
        for (uint32_t idx : fidx[field][entries[s].tid])
          has[s][idx] = 1;
      return has;
    };

    auto hp = build_has(skip_prompt, 0);
    auto hc = build_has(skip_char,   1);
    auto hx = build_has(skip_pos,    3);
    std::vector<std::vector<uint8_t>> hcp, hcn;
    if (!skip_cross.empty()) {
      hcp = build_has(skip_cross, 3);
      hcn = build_has(skip_cross, 2);
    }

    for (auto& [key, acc] : tpairs) {
      uint32_t ai = (uint32_t)(key >> 32);
      uint32_t bi = (uint32_t)(key & 0xFFFFFFFF);

      for (size_t s = 0; s < skip_prompt.size(); ++s)
        if (hp[s][ai] && hp[s][bi]) acc.promptInter += skip_prompt[s].weight;

      for (size_t s = 0; s < skip_char.size(); ++s)
        if (hc[s][ai] && hc[s][bi]) acc.charInter += skip_char[s].weight;

      for (size_t s = 0; s < skip_pos.size(); ++s)
        if (hx[s][ai] && hx[s][bi]) acc.positiveInter += skip_pos[s].weight;

      for (size_t s = 0; s < skip_cross.size(); ++s) {
        if (hcp[s][ai] && hcn[s][bi]) acc.conflictABInter += skip_cross[s].weight;
        if (hcp[s][bi] && hcn[s][ai]) acc.conflictBAInter += skip_cross[s].weight;
      }
    }
  }

  // ── Release inverted index — no longer needed after accumulation ─────────
  { decltype(fidx) tmp; std::swap(fidx, tmp); }

  // ── pHash pass: find visually-close pairs not in tpairs ──────────────────
  // Each comparison is a single XOR + POPCNT: fast even for large N.
  // When targets are specified, skip pairs where neither index is a target.

  std::unordered_map<uint64_t, int> phash_only;
  for (uint32_t i = 0; i < N - 1; ++i) {
    if (!has_phash[i]) continue;
    for (uint32_t j = i + 1; j < N; ++j) {
      if (!has_phash[j]) continue;
      if (is_target_ptr && !is_target_ptr[i] && !is_target_ptr[j]) continue;
      int d = popcount64(phash_vals[i] ^ phash_vals[j]);
      if (d > ui_max) continue;
      uint64_t key = ((uint64_t)i << 32) | j;
      if (tpairs.count(key) == 0)
        phash_only.emplace(key, d);
    }
  }

  // ── Build result as flat typed arrays ─────────────────────────────────────

  auto should_persist = [&](int dist, bool hp, float ts) {
    if (hp && dist <= ui_max) return true;
    if (ts >= text_loose)     return true;
    if (!hp) return false;
    float ps = 1.f - (float)dist / 64.f;
    return h_phash * ps + h_text * ts >= hybrid_loose;
  };

  size_t est = tpairs.size() + phash_only.size();
  std::vector<int32_t>  res_aids, res_bids, res_dists;
  std::vector<double>   res_texts;
  res_aids.reserve(est);
  res_bids.reserve(est);
  res_dists.reserve(est);
  res_texts.reserve(est);

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
    if (should_persist(dist, hp, ts)) {
      res_aids.push_back(image_ids[ai]);
      res_bids.push_back(image_ids[bi]);
      res_dists.push_back(hp ? dist : -1);
      res_texts.push_back((double)ts);
    }
  }

  for (auto& [key, dist] : phash_only) {
    uint32_t ai = (uint32_t)(key >> 32), bi = (uint32_t)(key & 0xFFFFFFFF);
    res_aids.push_back(image_ids[ai]);
    res_bids.push_back(image_ids[bi]);
    res_dists.push_back(dist);
    res_texts.push_back(0.0);
  }

  // Release hash maps before allocating JS typed arrays
  { decltype(tpairs)    t; std::swap(tpairs, t); }
  { decltype(phash_only) t; std::swap(phash_only, t); }

  uint32_t count = (uint32_t)res_aids.size();
  size_t i32_bytes = (size_t)count * sizeof(int32_t);
  size_t f64_bytes = (size_t)count * sizeof(double);

  auto a_ab = Napi::ArrayBuffer::New(env, i32_bytes);
  auto b_ab = Napi::ArrayBuffer::New(env, i32_bytes);
  auto d_ab = Napi::ArrayBuffer::New(env, i32_bytes);
  auto t_ab = Napi::ArrayBuffer::New(env, f64_bytes);
  if (count > 0) {
    memcpy(a_ab.Data(), res_aids.data(),  i32_bytes);
    memcpy(b_ab.Data(), res_bids.data(),  i32_bytes);
    memcpy(d_ab.Data(), res_dists.data(), i32_bytes);
    memcpy(t_ab.Data(), res_texts.data(), f64_bytes);
  }

  Napi::Object result = Napi::Object::New(env);
  result.Set("imageAIds",      Napi::Int32Array::New(env, count, a_ab, 0));
  result.Set("imageBIds",      Napi::Int32Array::New(env, count, b_ab, 0));
  result.Set("phashDistances", Napi::Int32Array::New(env, count, d_ab, 0));
  result.Set("textScores",     Napi::Float64Array::New(env, count, t_ab, 0));
  return result;
}

// ── resizePng ────────────────────────────────────────────────────────────────
//
// resizePng(buf: Buffer, maxWidth: number): { data: Buffer, width: number, height: number } | null
//
// Decodes a PNG buffer, bilinear-resizes so that width <= maxWidth (preserving
// aspect ratio), and returns raw BGRA pixel data suitable for Electron
// nativeImage.createFromBitmap().  Returns null if the image is already
// small enough or if decoding fails.

static void bilinear_resize_to_bgra(
    const uint8_t* src, int srcW, int srcH, int srcCh,
    uint8_t* dst, int dstW, int dstH) {
  const double xRatio = (double)srcW / dstW;
  const double yRatio = (double)srcH / dstH;

  for (int y = 0; y < dstH; y++) {
    const double srcY  = y * yRatio;
    const int    y0    = (int)srcY;
    const int    y1    = (y0 + 1 < srcH) ? y0 + 1 : y0;
    const double yFrac = srcY - y0;

    for (int x = 0; x < dstW; x++) {
      const double srcX  = x * xRatio;
      const int    x0    = (int)srcX;
      const int    x1    = (x0 + 1 < srcW) ? x0 + 1 : x0;
      const double xFrac = srcX - x0;

      const double w00 = (1.0 - xFrac) * (1.0 - yFrac);
      const double w10 = xFrac * (1.0 - yFrac);
      const double w01 = (1.0 - xFrac) * yFrac;
      const double w11 = xFrac * yFrac;

      const uint8_t* p00 = src + ((size_t)y0 * srcW + x0) * srcCh;
      const uint8_t* p10 = src + ((size_t)y0 * srcW + x1) * srcCh;
      const uint8_t* p01 = src + ((size_t)y1 * srcW + x0) * srcCh;
      const uint8_t* p11 = src + ((size_t)y1 * srcW + x1) * srcCh;

      double r = p00[0]*w00 + p10[0]*w10 + p01[0]*w01 + p11[0]*w11;
      double g = p00[1]*w00 + p10[1]*w10 + p01[1]*w01 + p11[1]*w11;
      double b = p00[2]*w00 + p10[2]*w10 + p01[2]*w01 + p11[2]*w11;
      double a = 255.0;
      if (srcCh == 4) {
        a = p00[3]*w00 + p10[3]*w10 + p01[3]*w01 + p11[3]*w11;
      }

      // Output as BGRA for Electron nativeImage.createFromBitmap
      uint8_t* out = dst + ((size_t)y * dstW + x) * 4;
      out[0] = (uint8_t)(b + 0.5);
      out[1] = (uint8_t)(g + 0.5);
      out[2] = (uint8_t)(r + 0.5);
      out[3] = (uint8_t)(a + 0.5);
    }
  }
}

Napi::Value ResizePng(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "Expected (Buffer, number)").ThrowAsJavaScriptException();
    return env.Null();
  }

  auto buf = info[0].As<Napi::Buffer<uint8_t>>();
  int maxWidth = info[1].As<Napi::Number>().Int32Value();
  if (maxWidth <= 0) return env.Null();

  DecodedPng decoded = decode_png(buf.Data(), buf.ByteLength(), true);
  if (!decoded.ok) return env.Null();
  if (decoded.width <= maxWidth) return env.Null(); // already small enough

  int dstW = maxWidth;
  int dstH = (int)((double)decoded.height * maxWidth / decoded.width + 0.5);
  if (dstH < 1) dstH = 1;

  size_t outSize = (size_t)dstW * dstH * 4;
  auto outBuf = Napi::Buffer<uint8_t>::New(env, outSize);

  bilinear_resize_to_bgra(
    decoded.pixels.data(), decoded.width, decoded.height, decoded.channels,
    outBuf.Data(), dstW, dstH);

  Napi::Object result = Napi::Object::New(env);
  result.Set("data",   outBuf);
  result.Set("width",  Napi::Number::New(env, dstW));
  result.Set("height", Napi::Number::New(env, dstH));
  return result;
}

// ── JPEG encoding (libjpeg-turbo) ─────────────────────────────────────────────

// Encode raw BGRA pixels to a JPEG buffer using libjpeg-turbo.
// Input: Buffer (BGRA, width*height*4 bytes), width, height, quality (1-100)
// Output: Buffer (JPEG bytes), or null on failure.
Napi::Value EncodeJpeg(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 4
      || !info[0].IsBuffer()
      || !info[1].IsNumber()
      || !info[2].IsNumber()
      || !info[3].IsNumber()) {
    Napi::TypeError::New(env, "Expected (Buffer, number, number, number)")
      .ThrowAsJavaScriptException();
    return env.Null();
  }

  auto buf = info[0].As<Napi::Buffer<uint8_t>>();
  int width   = info[1].As<Napi::Number>().Int32Value();
  int height  = info[2].As<Napi::Number>().Int32Value();
  int quality = info[3].As<Napi::Number>().Int32Value();

  if (width <= 0 || height <= 0) return env.Null();
  if (quality < 1) quality = 1;
  if (quality > 100) quality = 100;

  const size_t expected = (size_t)width * height * 4;
  if (buf.ByteLength() < expected) return env.Null();

  tjhandle compressor = tjInitCompress();
  if (!compressor) return env.Null();

  unsigned char* jpegBuf = nullptr;
  unsigned long  jpegSize = 0;
  const int rc = tjCompress2(
    compressor,
    buf.Data(),                      // BGRA source
    width,
    0,                                // pitch (0 = width*pixelSize)
    height,
    TJPF_BGRA,                        // input pixel format
    &jpegBuf,
    &jpegSize,
    TJSAMP_420,                       // 4:2:0 chroma subsampling
    quality,
    TJFLAG_FASTDCT
  );

  tjDestroy(compressor);

  if (rc != 0 || !jpegBuf) {
    if (jpegBuf) tjFree(jpegBuf);
    return env.Null();
  }

  // Copy into a Napi-managed buffer, then free libjpeg-turbo's buffer.
  auto out = Napi::Buffer<uint8_t>::Copy(env, jpegBuf, jpegSize);
  tjFree(jpegBuf);
  return out;
}

// ── Module init ───────────────────────────────────────────────────────────────

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  init_dct();
  exports.Set("computePHash",    Napi::Function::New(env, ComputePHash));
  exports.Set("extractNaiLsb",   Napi::Function::New(env, ExtractNaiLsb));
  exports.Set("computeAllPairs", Napi::Function::New(env, ComputeAllPairs));
  exports.Set("resizePng",       Napi::Function::New(env, ResizePng));
  exports.Set("encodeJpeg",      Napi::Function::New(env, EncodeJpeg));
  return exports;
}

NODE_API_MODULE(konomi_image, Init)
