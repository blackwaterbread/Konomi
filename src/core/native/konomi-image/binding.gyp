{
  "targets": [{
    "target_name": "konomi_image",
    "sources": ["konomi-image.cpp"],
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
          "VCCLCompilerTool": {
            "RuntimeLibrary": 0,
            "AdditionalOptions": ["/O2", "/Brepro", "/utf-8"]
          },
          "VCLinkerTool": {
            "AdditionalOptions": ["/Brepro"]
          }
        }
      }],
      ["OS=='mac'", {
        "xcode_settings": {
          "MACOSX_DEPLOYMENT_TARGET": "11.0",
          "OTHER_CFLAGS": ["-O2"]
        }
      }],
      ["OS=='linux'", {
        "cflags": ["-O2"]
      }]
    ]
  }]
}
