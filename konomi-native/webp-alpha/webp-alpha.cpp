#include <napi.h>
#include <webp/decode.h>

// decodeAlpha(buf: Buffer): { alpha: Buffer, width: number, height: number } | null
Napi::Value DecodeAlpha(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "Expected Buffer").ThrowAsJavaScriptException();
    return env.Null();
  }

  auto input = info[0].As<Napi::Buffer<uint8_t>>();
  const uint8_t* data = input.Data();
  size_t dataSize = input.ByteLength();

  int width = 0, height = 0;
  if (!WebPGetInfo(data, dataSize, &width, &height)) {
    return env.Null();
  }

  uint8_t* rgba = WebPDecodeRGBA(data, dataSize, &width, &height);
  if (!rgba) return env.Null();

  int total = width * height;
  uint8_t* alphaData = new uint8_t[total];
  for (int i = 0; i < total; i++) {
    alphaData[i] = rgba[i * 4 + 3];
  }
  WebPFree(rgba);

  auto alphaBuf = Napi::Buffer<uint8_t>::Copy(env, alphaData, static_cast<size_t>(total));
  delete[] alphaData;

  Napi::Object result = Napi::Object::New(env);
  result.Set("width", Napi::Number::New(env, width));
  result.Set("height", Napi::Number::New(env, height));
  result.Set("alpha", alphaBuf);
  return result;
}

// decodeRgb(buf: Buffer): { rgb: Buffer, width: number, height: number } | null
Napi::Value DecodeRgb(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "Expected Buffer").ThrowAsJavaScriptException();
    return env.Null();
  }

  auto input = info[0].As<Napi::Buffer<uint8_t>>();
  const uint8_t* data = input.Data();
  size_t dataSize = input.ByteLength();

  int width = 0, height = 0;
  uint8_t* rgb = WebPDecodeRGB(data, dataSize, &width, &height);
  if (!rgb) return env.Null();

  size_t total = (size_t)width * (size_t)height * 3;
  auto rgbBuf = Napi::Buffer<uint8_t>::Copy(env, rgb, total);
  WebPFree(rgb);

  Napi::Object result = Napi::Object::New(env);
  result.Set("width", Napi::Number::New(env, width));
  result.Set("height", Napi::Number::New(env, height));
  result.Set("rgb", rgbBuf);
  return result;
}

// ── resizeWebp ───────────────────────────────────────────────────────────────
//
// resizeWebp(buf: Buffer, maxWidth: number): { data: Buffer, width: number, height: number } | null
//
// Decodes a WebP buffer, bilinear-resizes so that width <= maxWidth (preserving
// aspect ratio), and returns raw BGRA pixel data suitable for Electron
// nativeImage.createFromBitmap().  Returns null if already small enough or
// decode fails.

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

Napi::Value ResizeWebp(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "Expected (Buffer, number)").ThrowAsJavaScriptException();
    return env.Null();
  }

  auto input = info[0].As<Napi::Buffer<uint8_t>>();
  const uint8_t* data = input.Data();
  size_t dataSize = input.ByteLength();
  int maxWidth = info[1].As<Napi::Number>().Int32Value();
  if (maxWidth <= 0) return env.Null();

  int width = 0, height = 0;
  uint8_t* rgba = WebPDecodeRGBA(data, dataSize, &width, &height);
  if (!rgba) return env.Null();

  if (width <= maxWidth) {
    WebPFree(rgba);
    return env.Null(); // already small enough
  }

  int dstW = maxWidth;
  int dstH = (int)((double)height * maxWidth / width + 0.5);
  if (dstH < 1) dstH = 1;

  size_t outSize = (size_t)dstW * dstH * 4;
  auto outBuf = Napi::Buffer<uint8_t>::New(env, outSize);

  bilinear_resize_to_bgra(rgba, width, height, 4, outBuf.Data(), dstW, dstH);
  WebPFree(rgba);

  Napi::Object result = Napi::Object::New(env);
  result.Set("data",   outBuf);
  result.Set("width",  Napi::Number::New(env, dstW));
  result.Set("height", Napi::Number::New(env, dstH));
  return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("decodeAlpha", Napi::Function::New(env, DecodeAlpha));
  exports.Set("decodeRgb", Napi::Function::New(env, DecodeRgb));
  exports.Set("resizeWebp", Napi::Function::New(env, ResizeWebp));
  return exports;
}

NODE_API_MODULE(webp_alpha, Init)
