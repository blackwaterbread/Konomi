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

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("decodeAlpha", Napi::Function::New(env, DecodeAlpha));
  return exports;
}

NODE_API_MODULE(webp_alpha, Init)
