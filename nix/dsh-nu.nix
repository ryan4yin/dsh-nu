{
  lib,
  buildNpmPackage,
  dsh,
  nushell,
  src,
}:
let
  manifest = lib.importJSON (src + "/package.json");
  inherit (manifest) version;
  testedNushell = manifest.testedWith.nushell;
in
# The plugin is installed as a directory holding package.json, cordis.patch.yml,
# and dist/, which is what dsh.withPlugins consumes through passthru.pluginPatch.
# The preflight reads Nushell's IDE output and fails closed when it drifts.
lib.warnIf (lib.getVersion nushell != testedNushell)
  "dsh-nu: building with Nushell ${lib.getVersion nushell}, but this release is tested with ${testedNushell}; shell calls may be refused until the versions match"
buildNpmPackage (finalAttrs: {
  pname = "dsh-nu";
  inherit version;

  src = lib.cleanSourceWith {
    inherit src;
    filter =
      path: _type:
      !(builtins.elem (baseNameOf path) [
        ".git"
        ".work"
        "dist"
        "node_modules"
      ]);
  };

  npmDepsHash = "sha256-h3r3FFQofZA8d/2S3wnyGu/OAQlTKjFQ3fNZz1K75Kw=";

  dontNpmBuild = false;

  # The dsh packages this bundle imports are optional peer dependencies, so
  # npm does not install them. Link the copy that ships with the dsh
  # installation the caller selected; the compiler and the runtime resolve
  # the same files from there. dsh packages from nur-packages and
  # llm-agents.nix nest the scope under the dsh package, other layouts keep it
  # at the installation root; fail clearly when neither exists.
  buildPhase = ''
    runHook preBuild

    peerScope=${dsh}/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
    if [ ! -d "$peerScope" ]; then
      peerScope=${dsh}/lib/node_modules/@deepseek-ai
    fi
    if [ ! -d "$peerScope" ]; then
      echo "dsh-nu: ${dsh} does not ship the @deepseek-ai peer packages" >&2
      exit 1
    fi
    ln -sfn "$peerScope" node_modules/@deepseek-ai
    npm run build

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/node_modules
    cp -r dist examples package.json cordis.patch.yml README.md LICENSE $out/

    # dsh.withPlugins applies this patch as a file path, so the bundle's
    # package-name imports become absolute paths. nuPath is fixed at build
    # time because the wrapper does not inherit a Nushell PATH entry.
    substituteInPlace $out/cordis.patch.yml \
      --replace-fail 'dsh-nu/executor' "$out/dist/executor.js" \
      --replace-fail 'dsh-nu/teaching' "$out/dist/teaching.js"
    sed -i "s|nuPath:.*|nuPath: ${nushell}/bin/nu|" $out/cordis.patch.yml

    ln -s "$(readlink node_modules/@deepseek-ai)" $out/node_modules/@deepseek-ai

    runHook postInstall
  '';

  passthru = {
    # Rendered patch used by dsh.withPlugins.
    pluginPatch = "${finalAttrs.finalPackage}/cordis.patch.yml";
  };

  meta = {
    description = "Nushell-only shell executor, syntax preflight, and teaching layer for dsh";
    homepage = "https://github.com/ryan4yin/dsh-nu";
    changelog = "https://github.com/ryan4yin/dsh-nu/releases";
    license = lib.licenses.mit;
    platforms = lib.platforms.all;
  };
})
