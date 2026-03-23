{
  "targets": [{
    "target_name": "webp_alpha",
    "sources": ["webp-alpha.cpp"],
    "include_dirs": [
      "<!@(node -p \"require('node-addon-api').include\")",
      "<!@(node gyp_helpers/get-include.js)"
    ],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
    "libraries": [
      "<!@(node gyp_helpers/get-lib.js)"
    ],
    "conditions": [
      ["OS=='win'", {
        "msvs_settings": {
          "VCCLCompilerTool": { "RuntimeLibrary": 0 }
        }
      }],
      ["OS=='mac'", {
        "xcode_settings": {
          "MACOSX_DEPLOYMENT_TARGET": "11.0"
        }
      }]
    ]
  }]
}
