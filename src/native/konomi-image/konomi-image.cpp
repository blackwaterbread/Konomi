#define _USE_MATH_DEFINES
#include <napi.h>
#include <png.h>
#include <cmath>
#include <cstring>
#include <vector>
#include <algorithm>
#include <cstdio>

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
  // NOTE: std::vector destructors won't run on longjmp.
  // For corrupt images (rare in practice) this may leak the pixel buffer.
  // Acceptable trade-off for a desktop app.
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

// ── Module init ───────────────────────────────────────────────────────────────

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  init_dct();
  exports.Set("computePHash",   Napi::Function::New(env, ComputePHash));
  exports.Set("extractNaiLsb",  Napi::Function::New(env, ExtractNaiLsb));
  return exports;
}

NODE_API_MODULE(konomi_image, Init)
